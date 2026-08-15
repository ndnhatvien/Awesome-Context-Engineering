/**
 * ACE (Awesome Context Engineering) MCP HTTP Server
 *
 * Cung cấp MCP server qua HTTP/SSE thay vì stdio
 */

import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import {
  generateSessionToken,
  getAdminAuthConfig,
  verifyAdminPassword,
  verifySessionToken,
} from '../auth/adminAuth.js';
import { createUser, getUserByEmail, initUsersDb, regenerateUserToken } from '../db/users.js';
import { logger } from '../utils/logger.js';
import { createAgentRoutes } from './agentRoutes.js';
import { getDashboardStats } from '../dashboard/analyticsService.js';
import { sessionManager } from './sessionManager.js';
import { authenticateMCP, getAuthUser, requireAuth } from './sseAuth.js';
import {
  codebaseRetrievalSchema,
  codebaseImpactSchema,
  detectTasksSchema,
  generateCommitMessageSchema,
  handleCodebaseRetrieval,
  handleCodebaseImpact,
  handleDetectTasks,
  handleGenerateCommitMessage,
} from './tools/index.js';

const SERVER_NAME = 'ace-recall';

// Định nghĩa tools giống như stdio server
const TOOLS = [
  {
    name: 'codebase-retrieval',
    description: `
IMPORTANT: This is the PRIMARY tool for searching the codebase.
It uses a hybrid engine (Semantic + Exact Match) to find relevant code.
Think of it as the "Google Search" for this repository.

Capabilities:
1. Semantic Search: Understands "what code does" (e.g., "auth logic") via high-dimensional embeddings.
2. Exact Match: Filters by precise symbols (e.g., class names) via FTS (Full Text Search).
3. Zen Context: Returns code with localized context (breadcrumbs) to avoid token overflow.

<RULES>
# 1. Tool Selection (When to use)
- ALWAYS use this tool FIRST for any code exploration or understanding task.
- DO NOT try to guess file paths. If you don't have the exact path, use this tool.
- DO NOT use 'grep' or 'find' for semantic understanding. Only use them for exhaustive text matching (e.g. "Find ALL occurrences of string 'foo'").

# 2. Before Editing (Critical)
- Before creating a plan or editing any file, YOU MUST call this tool to gather context.
- Ask for ALL symbols involved in the edit (classes, functions, types, constants).
- Do not assume you remember the code structure. Verify it with this tool.

# 3. Query Strategy (How to use)
- Split your intent:
  - Put the "Goal/Context" in 'information_request'.
  - Put "Known Class/Func Names" in 'technical_terms'.
- If the first search is too broad, add more specific 'technical_terms'.
</RULES>
`,
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: {
          type: 'string',
          description: 'The absolute file system path to the repository root.',
        },
        information_request: {
          type: 'string',
          description:
            'The SEMANTIC GOAL. Describe the functionality, logic, or behavior you are looking for in full natural language sentences.',
        },
        technical_terms: {
          type: 'array',
          items: { type: 'string' },
          description:
            'HARD FILTERS. An optional list of EXACT, KNOWN identifiers (class/function names, constants) that MUST appear in the code.',
        },
      },
      required: ['repo_path', 'information_request'],
    },
  },
  {
    name: 'generate-commit-message',
    description: `
Generate an AI-powered commit message from staged git changes.

This tool analyzes your staged changes and creates a well-formatted commit message following best practices.

Use cases:
- After staging changes with 'git add', generate a commit message
- Save time writing meaningful commit messages
- Ensure consistent commit message style across the project

Styles:
- conventional: feat(scope): description (Conventional Commits format)
- simple: Clear, concise description
- detailed: Extended message with explanation
`,
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        style: {
          type: 'string',
          enum: ['conventional', 'simple', 'detailed'],
          description: 'Commit message style (default: conventional)',
        },
        include_body: {
          type: 'boolean',
          description: 'Include detailed body in commit message (default: true)',
        },
      },
      required: ['repo_path'],
    },
  },
  {
    name: 'detect-tasks',
    description: `
Automatically detect runnable tasks in a project.

This tool scans common project files and discovers available tasks/commands:
- package.json (npm/pnpm/yarn scripts)
- Makefile (make targets)
- justfile (just recipes)
- deno.json (deno tasks)
- Cargo.toml (cargo commands)

Use cases:
- "What tasks can I run in this project?"
- "How do I build/test this project?"
- Discover available development commands
`,
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: {
          type: 'string',
          description: 'Path to the project root',
        },
      },
      required: ['repo_path'],
    },
  },
  {
    name: 'codebase-impact',
    description: `
Analyze the impact of code changes through structural dependency graph traversal.

This tool predicts which tests and files are affected when you change a target file or symbol.
It uses a best-effort graph built from TypeScript/JavaScript imports, calls, and test coverage.

Use cases:
- "Which tests should I run if I change this file?"
- "What files depend on this function?"
- "What's the blast radius of modifying this API?"
- Pre-commit impact analysis

Modes:
- 'affected': Find all affected tests and files (default)
- 'impact': Detailed impact analysis with dependency paths

The tool returns:
- Direct tests: Tests that directly import/call the target
- Indirect tests: Tests affected through transitive dependencies
- Affected files: Other source files that depend on the target
- Impact paths: Visual representation of dependency chains (when include_paths=true)

Note: Only TypeScript/JavaScript files are analyzed in the MVP. Graph must be built first with 'ace index'.
`,
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: {
          type: 'string',
          description: 'The absolute file system path to the repository root',
        },
        target: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Target file path, symbol path (file:symbol), or symbol name to analyze',
        },
        mode: {
          type: 'string',
          enum: ['impact', 'affected'],
          description: 'Analysis mode: "impact" for detailed paths, "affected" for test/file list (default: affected)',
        },
        depth: {
          type: 'number',
          description: 'Maximum traversal depth (1-10, default: 2)',
        },
        tests_only: {
          type: 'boolean',
          description: 'Only return affected tests, skip other files (default: false)',
        },
        include_paths: {
          type: 'boolean',
          description: 'Include impact paths showing dependency chains (default: false)',
        },
      },
      required: ['repo_path', 'target'],
    },
  },
];

/**
 * Tạo và cấu hình MCP server instance
 */
function createMcpServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Đăng ký tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('HTTP: Nhận list_tools request');
    return { tools: TOOLS };
  });

  // Đăng ký tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    logger.info({ tool: name }, 'HTTP: Nhận call_tool request');

    // Tạo progress callback nếu có progressToken
    const rawToken = extra._meta?.progressToken;
    const progressToken =
      typeof rawToken === 'string' || typeof rawToken === 'number' ? rawToken : undefined;

    const onProgress = progressToken
      ? async (current: number, total?: number, message?: string) => {
          try {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: current,
                total,
                message,
              },
            });
          } catch (err) {
            logger.debug({ error: (err as Error).message }, 'Gửi progress notification thất bại');
          }
        }
      : undefined;

    try {
      switch (name) {
        case 'codebase-retrieval': {
          const parsed = codebaseRetrievalSchema.parse(args);
          return await handleCodebaseRetrieval(parsed, undefined, onProgress);
        }
        case 'codebase-impact': {
          const parsed = codebaseImpactSchema.parse(args);
          return await handleCodebaseImpact(parsed);
        }
        case 'generate-commit-message': {
          const parsed = generateCommitMessageSchema.parse(args);
          return await handleGenerateCommitMessage(parsed);
        }
        case 'detect-tasks': {
          const parsed = detectTasksSchema.parse(args);
          return await handleDetectTasks(parsed);
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ error: error.message, stack: error.stack, tool: name }, 'Tool call thất bại');
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

function getPreferredHomeEnvFilePath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.ace', '.env');
}

function getDefaultEnvFilePath() {
  return path.join(process.cwd(), '.env');
}

function getActiveEnvFilePath(): string {
  const preferredHomeEnvPath = getPreferredHomeEnvFilePath();
  const fallbackEnvPath = getDefaultEnvFilePath();
  const localEnvPath = path.join(process.cwd(), '.env');

  // Find the first existing candidate
  if (fs.existsSync(localEnvPath)) return localEnvPath;
  if (fs.existsSync(preferredHomeEnvPath)) return preferredHomeEnvPath;
  if (fs.existsSync(fallbackEnvPath)) return fallbackEnvPath;

  // Default to write path
  const preferredDir = path.dirname(preferredHomeEnvPath);
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    return preferredHomeEnvPath;
  } catch {
    return fallbackEnvPath;
  }
}

function updateEnvFile(updates: Record<string, string>): void {
  const filePath = getActiveEnvFilePath();
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const lines = content.split('\n');
  const keysToUpdate = new Set(Object.keys(updates));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      const parts = line.split('=');
      const key = parts[0].trim();
      if (keysToUpdate.has(key)) {
        lines[i] = `${key}=${updates[key]}`;
        keysToUpdate.delete(key);
      }
    }
  }

  // Append new keys
  for (const key of keysToUpdate) {
    lines.push(`${key}=${updates[key]}`);
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function _getSessionCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|; )ace_session=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return key.slice(0, 5) + '*'.repeat(12) + key.slice(-4);
}

function maskApiKeys(keys: string): string {
  if (!keys) return '';
  return keys
    .split(',')
    .map((key) => maskApiKey(key.trim()))
    .join(', ');
}

const LOGIN_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Awesome Context Engineering - Admin Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #060913;
      --bg-card: rgba(13, 20, 38, 0.45);
      --border-card: rgba(99, 102, 241, 0.15);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --primary-glow: rgba(99, 102, 241, 0.35);
      --danger: #ef4444;
      --danger-glow: rgba(239, 68, 68, 0.2);
      --input-bg: rgba(7, 10, 19, 0.6);
      --input-border: rgba(255, 255, 255, 0.08);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      background-color: var(--bg-main);
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      background-image: 
        radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(16, 185, 129, 0.04) 0%, transparent 45%);
      position: relative;
      overflow: hidden;
    }

    /* Decorative glowing spheres */
    body::before {
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 70%);
      top: -100px;
      left: -100px;
      z-index: 0;
    }

    body::after {
      content: '';
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.08) 0%, transparent 75%);
      bottom: -150px;
      right: -150px;
      z-index: 0;
    }
    
    .login-container {
      width: 100%;
      max-width: 440px;
      position: relative;
      z-index: 10;
      animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    header {
      margin-bottom: 32px;
      text-align: center;
    }
    
    .logo-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 18px;
      margin-bottom: 16px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
    }

    .logo-icon {
      font-size: 1.8rem;
      background: linear-gradient(135deg, #a5b4fc 0%, #c084fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 2rem;
      font-weight: 700;
      background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 6px;
    }
    
    .tagline {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: 24px;
      padding: 40px;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 50px var(--primary-glow);
    }
    
    .form-group {
      margin-bottom: 24px;
      position: relative;
    }
    
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    
    input {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      padding: 14px 44px 14px 16px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.95rem;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-glow);
      background: rgba(7, 10, 19, 0.85);
    }

    .toggle-password {
      position: absolute;
      right: 14px;
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 4px;
      transition: color 0.2s;
    }

    .toggle-password:hover {
      color: var(--text-primary);
    }
    
    .alert {
      padding: 14px 16px;
      border-radius: 12px;
      margin-bottom: 24px;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: shake 0.4s ease-in-out;
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-6px); }
      75% { transform: translateX(6px); }
    }
    
    .alert-danger {
      background-color: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: var(--danger);
      box-shadow: 0 0 15px var(--danger-glow);
    }
    
    .btn {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
      color: white;
      border: none;
      border-radius: 12px;
      padding: 14px 28px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
    }
    
    .btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
    }
    
    .btn:active {
      transform: translateY(1px);
    }
    
    .btn-google {
      background: white;
      color: #333;
      border: none;
      border-radius: 12px;
      padding: 14px 28px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
      text-decoration: none;
    }

    .btn-google:hover {
      background: #f8f9fa;
      transform: translateY(-1px);
    }

    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 28px 0;
      color: var(--text-secondary);
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--border-card);
    }
    .divider:not(:empty)::before { margin-right: 15px; }
    .divider:not(:empty)::after { margin-left: 15px; }
  </style>
</head>
<body>
  <div class="login-container">
    <header>
      <div class="logo-container">
        <span class="logo-icon">🔑</span>
      </div>
      <h1>Awesome Context Engineering</h1>
      <p class="tagline">Sign in to manage context engine configuration</p>
    </header>
    
    <div class="card">
      {{#if error}}
      <div class="alert alert-danger" id="login-error">
        <span>⚠️</span>
        <span>Xác thực thất bại, vui lòng thử lại!</span>
      </div>
      {{/if}}

      {{#if googleConfigured}}
      <a href="/auth/google" class="btn-google">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Đăng nhập với Google
      </a>

      <div class="divider">HOẶC DÙNG MẬT KHẨU</div>
      {{/if}}
      
      <form action="/admin/login" method="POST">
        <div class="form-group">
          <label for="login-password">Admin Password</label>
          <div class="input-wrapper">
            <input type="password" id="login-password" name="password" placeholder="Nhập mật khẩu quản trị..." required autofocus />
            <button type="button" class="toggle-password" id="btn-toggle-password" aria-label="Toggle password visibility">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          </div>
        </div>
        
        <button type="submit" class="btn" id="btn-login">Đăng nhập</button>
      </form>
    </div>
  </div>

  <script>
    const passwordInput = document.getElementById('login-password');
    const toggleBtn = document.getElementById('btn-toggle-password');
    
    toggleBtn.addEventListener('click', function() {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      
      if (type === 'text') {
        toggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>';
      } else {
        toggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>';
      }
    });
  </script>
</body>
</html>`;

const ADMIN_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Awesome Context Engineering Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #060913;
      --bg-card: rgba(13, 20, 38, 0.45);
      --border-card: rgba(99, 102, 241, 0.15);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --primary-glow: rgba(99, 102, 241, 0.25);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.2);
      --warning: #f59e0b;
      --warning-glow: rgba(245, 158, 11, 0.2);
      --danger: #ef4444;
      --danger-glow: rgba(239, 68, 68, 0.2);
      --input-bg: rgba(7, 10, 19, 0.6);
      --input-border: rgba(255, 255, 255, 0.08);
      --input-focus: #6366f1;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      background-color: var(--bg-main);
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      background-image: 
        radial-gradient(circle at 5% 5%, rgba(99, 102, 241, 0.06) 0%, transparent 35%),
        radial-gradient(circle at 95% 95%, rgba(16, 185, 129, 0.03) 0%, transparent 40%);
      position: relative;
    }
    
    .container {
      width: 100%;
      max-width: 1200px;
      position: relative;
      z-index: 10;
    }
    
    header {
      margin-bottom: 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 24px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-size: 1.25rem;
    }
    
    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.8rem;
      font-weight: 700;
      background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .tagline {
      color: var(--text-secondary);
      font-size: 0.85rem;
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logout-btn {
      background: rgba(239, 68, 68, 0.1);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.18);
      border-color: rgba(239, 68, 68, 0.4);
      transform: translateY(-1px);
    }

    .logout-btn:active {
      transform: translateY(0);
    }
    
    .alert {
      padding: 16px 20px;
      border-radius: 12px;
      margin-bottom: 24px;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideDown 0.3s ease;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .alert-success {
      background-color: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: var(--success);
      box-shadow: 0 0 15px var(--success-glow);
    }

    .dashboard-layout {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 30px;
    }
    
    @media (max-width: 1024px) {
      .dashboard-layout {
        grid-template-columns: 1fr;
      }
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-card);
      border-radius: 20px;
      padding: 30px;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      height: fit-content;
    }
    
    .card-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-subtitle {
      font-size: 0.95rem;
      font-weight: 600;
      color: #a5b4fc;
      margin: 24px 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-subtitle::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.04);
      margin-left: 8px;
    }
    
    .status-badge {
      font-size: 0.7rem;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    
    .status-badge.configured {
      background-color: rgba(16, 185, 129, 0.08);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    
    .status-badge.missing {
      background-color: rgba(245, 158, 11, 0.08);
      color: var(--warning);
      border: 1px solid rgba(245, 158, 11, 0.25);
    }
    
    .status-badge.active {
      background-color: rgba(99, 102, 241, 0.08);
      color: var(--primary);
      border: 1px solid rgba(99, 102, 241, 0.25);
    }
    
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    
    @media (max-width: 600px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    
    .form-group {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
    }
    
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .input-wrapper.with-action input {
      border-radius: 10px 0 0 10px;
      border-right: none;
    }

    .input-wrapper.with-action .btn-action {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--input-border);
      border-radius: 0 10px 10px 0;
      color: var(--text-primary);
      height: 44px;
      padding: 0 18px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }

    .input-wrapper.with-action .btn-action:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: var(--primary);
    }
    
    input {
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      padding: 12px 42px 12px 14px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 0.92rem;
      transition: all 0.2s ease;
    }
    
    input:focus {
      outline: none;
      border-color: var(--input-focus);
      box-shadow: 0 0 0 3px var(--primary-glow);
      background: rgba(7, 10, 19, 0.8);
    }

    .toggle-visibility {
      position: absolute;
      right: 12px;
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 4px;
      transition: color 0.2s;
    }

    .toggle-visibility:hover {
      color: var(--text-primary);
    }
    
    .btn {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 14px 28px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: block;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
      margin-top: 24px;
    }
    
    .btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
    }
    
    .btn:active {
      transform: translateY(1px);
    }
    
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      font-size: 0.9rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.02);
      padding-bottom: 10px;
    }
    
    .status-row:last-child {
      margin-bottom: 0;
      border-bottom: none;
      padding-bottom: 0;
    }
    
    .status-label {
      color: var(--text-secondary);
    }
    
    .status-value {
      color: var(--text-primary);
      font-weight: 500;
      word-break: break-all;
      text-align: right;
      padding-left: 10px;
    }
    
    .code-container {
      position: relative;
      margin-top: 12px;
    }

    .code-block {
      background: rgba(7, 10, 19, 0.7);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      padding: 16px;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      color: #cbd5e1;
      overflow-x: auto;
      white-space: pre;
      max-height: 240px;
    }

    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 0.75rem;
      padding: 4px 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 500;
    }

    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-primary);
    }
    
    .tabs {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 24px;
      gap: 8px;
    }
    
    .tab {
      padding: 10px 18px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--text-secondary);
      transition: all 0.2s ease;
      font-weight: 500;
      font-size: 0.9rem;
    }
    
    .tab.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    
    .tab:hover {
      color: var(--text-primary);
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .endpoint-item {
      background: rgba(7, 10, 19, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.03);
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 16px;
    }

    .endpoint-item:last-child {
      margin-bottom: 0;
    }
    
    .endpoint-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .password-indicator {
      font-size: 0.75rem;
      margin-top: 4px;
      display: none;
      align-items: center;
      gap: 4px;
    }

    .password-indicator.match {
      color: var(--success);
      display: inline-flex;
    }

    .password-indicator.mismatch {
      color: var(--danger);
      display: inline-flex;
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .modal-overlay.active {
      opacity: 1;
      pointer-events: all;
    }

    .modal-content {
      background: #0a0f1d;
      border: 1px solid var(--border-card);
      border-radius: 20px;
      width: 90%;
      max-width: 650px;
      max-height: 85vh;
      padding: 24px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      animation: modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes modalSlideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 14px;
      margin-bottom: 16px;
    }

    .modal-header h3 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .close-modal {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 1.6rem;
      cursor: pointer;
      line-height: 1;
      transition: color 0.2s;
    }

    .close-modal:hover {
      color: var(--text-primary);
    }

    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: hidden;
      height: 100%;
    }

    .path-display {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--input-border);
      padding: 12px 16px;
      border-radius: 10px;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      color: #a5b4fc;
      word-break: break-all;
    }

    .dir-list {
      border: 1px solid var(--input-border);
      border-radius: 10px;
      background: rgba(7, 10, 19, 0.4);
      overflow-y: auto;
      flex-grow: 1;
      min-height: 250px;
      max-height: 380px;
    }

    .dir-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid rgba(255, 255, 255, 0.02);
      transition: all 0.2s;
      font-size: 0.9rem;
    }

    .dir-item:last-child {
      border-bottom: none;
    }

    .dir-item:hover {
      background: rgba(99, 102, 241, 0.12);
      color: var(--primary);
    }

    .dir-icon {
      font-size: 1.2rem;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 16px;
    }

    .modal-footer .btn {
      margin-top: 0;
      width: auto;
      padding: 10px 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">🚀</div>
        <div>
          <h1>Awesome Context Engineering Dashboard</h1>
          <p class="tagline">Awesome Context Engineering for AI Agents</p>
        </div>
      </div>
      <div class="header-actions">
        <div style="display: flex; gap: 8px;">
          {{#if hasEmbeddingKey}}
          <span class="status-badge configured">Embeddings OK</span>
          {{else}}
          <span class="status-badge missing">Embeddings Missing</span>
          {{/if}}
          {{#if hasRerankKey}}
          <span class="status-badge configured">Reranker OK</span>
          {{else}}
          <span class="status-badge missing">Reranker Missing</span>
          {{/if}}
        </div>
        <form action="/admin/logout" method="POST" style="margin: 0;">
          <button type="submit" class="logout-btn" id="btn-logout">
            <span>Logout</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </form>
      </div>
    </header>
    
    {{#if success}}
    <div class="alert alert-success" id="success-alert">
      <span>✓</span>
      <span>Cấu hình đã được lưu và cập nhật thành công!</span>
    </div>
    {{/if}}
    
    <div class="dashboard-layout">
      <!-- Main configuration card -->
      <div class="card">
        <div class="card-title">
          <span>🔧 Configuration Settings</span>
          <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-secondary)">Ghi đè vào file .env</span>
        </div>
        
        <form action="/admin/configure" method="POST" id="config-form">
          <div class="card-subtitle">🔑 User Identity</div>
          
          <div class="grid" style="margin-bottom: 24px;">
            <div class="form-group">
              <label>Logged in as</label>
              <input type="text" readonly value="{{userEmail}}" style="background: rgba(255,255,255,0.02);" />
            </div>
            <div class="form-group">
              <label>Your API Token (For MCP Client)</label>
              <div class="input-wrapper with-action">
                <input type="text" id="input-api-token" readonly value="{{apiToken}}" style="background: rgba(255,255,255,0.02);" />
                <button type="button" class="btn-action" onclick="navigator.clipboard.writeText(document.getElementById('input-api-token').value).then(() => { this.innerText='Copied!'; setTimeout(() => this.innerText='Copy', 2000); })">Copy</button>
              </div>
              {{regenerateButton}}
              {{adminTokenHtml}}
            </div>
          </div>

          <div class="card-subtitle">📂 Workspace Configuration</div>
          
          <div class="form-group">
            <label for="input-workspace-path">Workspace Path</label>
            <div class="input-wrapper with-action">
              <input type="text" id="input-workspace-path" name="workspace_path" value="{{workspacePath}}" placeholder="C:\\path\\to\\project" required />
              <button type="button" class="btn-action" id="btn-browse-workspace">Browse...</button>
            </div>
          </div>

          <div class="card-subtitle">📡 Embedding Configuration</div>
          
          <div class="form-group">
            <label for="input-embeddings-key">Embeddings API Key</label>
            <div class="input-wrapper">
              <input type="password" id="input-embeddings-key" name="embeddings_api_keys" value="{{embeddingsApiKeys}}" placeholder="api_key_xxxxxxxxxxxxx" />
              <button type="button" class="toggle-visibility" data-target="input-embeddings-key">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
          </div>
          
          <div class="grid">
            <div class="form-group">
              <label for="input-embeddings-url">Embeddings Base URL <span style="font-size: 0.8em; color: var(--text-secondary);">(e.g. https://api.siliconflow.cn/v1)</span></label>
              <input type="text" id="input-embeddings-url" name="embeddings_base_url" value="{{embeddingsBaseUrl}}" placeholder="https://api.jina.ai/v1" />
            </div>
            
            <div class="form-group">
              <label for="input-embeddings-model">Embeddings Model <span style="font-size: 0.8em; color: var(--text-secondary);">(e.g. BAAI/bge-m3)</span></label>
              <input type="text" id="input-embeddings-model" name="embeddings_model" value="{{embeddingsModel}}" placeholder="jina-embeddings-v3" />
            </div>
          </div>
          
          <div class="card-subtitle">⚡ Reranker Configuration</div>
          
          <div class="form-group">
            <label for="input-rerank-key">Reranker API Key</label>
            <div class="input-wrapper">
              <input type="password" id="input-rerank-key" name="rerank_api_keys" value="{{rerankApiKeys}}" placeholder="api_key_xxxxxxxxxxxxx" />
              <button type="button" class="toggle-visibility" data-target="input-rerank-key">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
          </div>
          
          <div class="grid">
            <div class="form-group">
              <label for="input-rerank-url">Reranker Base URL <span style="font-size: 0.8em; color: var(--text-secondary);">(e.g. https://api.siliconflow.cn/v1)</span></label>
              <input type="text" id="input-rerank-url" name="rerank_base_url" value="{{rerankBaseUrl}}" placeholder="https://api.jina.ai/v1" />
            </div>
            
            <div class="form-group">
              <label for="input-rerank-model">Reranker Model <span style="font-size: 0.8em; color: var(--text-secondary);">(e.g. BAAI/bge-reranker-v2-m3)</span></label>
              <input type="text" id="input-rerank-model" name="rerank_model" value="{{rerankModel}}" placeholder="jina-reranker-v2-base-multilingual" />
            </div>
          </div>

          <div class="card-subtitle">🌐 Google OAuth Settings</div>

          <div class="form-group">
            <label for="input-google-client-id">Google Client ID</label>
            <div class="input-wrapper">
              <input type="text" id="input-google-client-id" name="google_client_id" value="{{googleClientId}}" placeholder="xxxxxx.apps.googleusercontent.com" />
            </div>
          </div>

          <div class="form-group">
            <label for="input-google-client-secret">Google Client Secret</label>
            <div class="input-wrapper">
              <input type="password" id="input-google-client-secret" name="google_client_secret" value="{{googleClientSecret}}" placeholder="GOCSPX-xxxxxx" />
              <button type="button" class="toggle-visibility" data-target="input-google-client-secret">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
          </div>

          <div class="card-subtitle">🔒 Security Settings</div>

          <div class="grid">
            <div class="form-group">
              <label for="input-admin-password">Mật khẩu mới (New Password)</label>
              <div class="input-wrapper">
                <input type="password" id="input-admin-password" name="admin_password" placeholder="Bỏ trống nếu không muốn đổi" />
                <button type="button" class="toggle-visibility" data-target="input-admin-password">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="form-group">
              <label for="input-admin-password-confirm">Xác nhận mật khẩu</label>
              <div class="input-wrapper">
                <input type="password" id="input-admin-password-confirm" placeholder="Xác nhận mật khẩu mới" />
                <button type="button" class="toggle-visibility" data-target="input-admin-password-confirm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
              <div class="password-indicator" id="pw-indicator"></div>
            </div>
          </div>
          
          <button type="submit" class="btn" id="btn-save-config">Save Configuration</button>
        </form>
      </div>
      
      <!-- Side information card -->
      <div class="card">
        <div class="tabs">
          <div class="tab active" data-tab="mcp" id="tab-mcp">MCP Integration</div>
          <div class="tab" data-tab="tokens" id="tab-tokens">API Tokens</div>
          <div class="tab" data-tab="system" id="tab-system">System Info</div>
        </div>
        
        <div class="tab-content active" data-content="mcp">
          <div class="endpoint-item">
            <div class="endpoint-label">📱 Claude Desktop (Local Node STDIO)</div>
            <div class="code-container">
              <div class="code-block" id="code-claude-local">{
  "mcpServers": {
    "ace-recall": {
      "command": "node",
      "args": ["{{entryFilePathJson}}", "mcp"]
    }
  }
}</div>
              <button class="copy-btn" data-target="code-claude-local">Copy</button>
            </div>
          </div>

          <div class="endpoint-item">
            <div class="endpoint-label">📦 Claude Desktop (Local NPX STDIO)</div>
            <div class="code-container">
              <div class="code-block" id="code-claude-local-npx">{
  "mcpServers": {
    "ace-recall-npx": {
      "command": "npx",
      "args": [
        "-y",
        "@nv876620-design/ace-recall",
        "mcp"
      ]
    }
  }
}</div>
              <button class="copy-btn" data-target="code-claude-local-npx">Copy</button>
            </div>
          </div>

          <div class="endpoint-item">
            <div class="endpoint-label">🌐 Claude Desktop (Remote NPX - via ace-tool-rs client)</div>
            <div class="code-container">
              <div class="code-block" id="code-claude-npx">{
  "mcpServers": {
    "ace-tool-npx": {
      "command": "npx",
      "args": [
        "ace-tool-rs",
        "--base-url",
        "http://127.0.0.1:{{PORT}}",
        "--token",
        "{{apiToken}}"
      ],
      "env": {}
    }
  }
}</div>
              <button class="copy-btn" data-target="code-claude-npx">Copy</button>
            </div>
          </div>
          
          <div class="endpoint-item">
            <div class="endpoint-label">🚀 Augment (Local)</div>
            <div class="code-container">
              <div class="code-block" id="code-augment-local">{
  "context_providers": [{
    "name": "ace-recall",
    "type": "mcp",
    "url": "http://127.0.0.1:{{PORT}}"
  }]
}</div>
              <button class="copy-btn" data-target="code-augment-local">Copy</button>
            </div>
          </div>
          
          <div class="endpoint-item">
            <div class="endpoint-label">☁️ Augment (Fly.io)</div>
            <div class="code-container">
              <div class="code-block" id="code-augment-fly">{
  "context_providers": [{
    "name": "ace-recall",
    "type": "mcp",
    "url": "https://ace-recall.fly.dev"
  }]
}</div>
              <button class="copy-btn" data-target="code-augment-fly">Copy</button>
            </div>
          </div>
        </div>

        <div class="tab-content" data-content="tokens">
          <div style="margin-bottom: 24px;">
            <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);">Create New Token</h3>
            <form id="token-form" style="display: flex; flex-direction: column; gap: 12px;">
              <input type="text" id="token-userId" placeholder="User ID (e.g., developer)"
                style="width: 100%; padding: 10px 14px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 8px; color: var(--text-primary); font-size: 14px;" required />
              <input type="text" id="token-description" placeholder="Description (optional)"
                style="width: 100%; padding: 10px 14px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 8px; color: var(--text-primary); font-size: 14px;" />
              <input type="number" id="token-expires" placeholder="Expires in days (optional, e.g., 365)"
                style="width: 100%; padding: 10px 14px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 8px; color: var(--text-primary); font-size: 14px;" />
              <button type="submit" class="btn" style="width: 100%; margin-top: 8px;">Create Token</button>
            </form>
          </div>

          <div id="token-result" style="display: none; margin-bottom: 24px; padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
            <div style="font-size: 13px; font-weight: 600; color: var(--success); margin-bottom: 8px;">✓ Token Created</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Save this token securely - it won't be shown again!</div>
            <div style="background: var(--input-bg); padding: 12px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 12px; word-break: break-all; color: var(--text-primary); position: relative;">
              <span id="token-value"></span>
              <button onclick="navigator.clipboard.writeText(document.getElementById('token-value').textContent)"
                style="position: absolute; top: 8px; right: 8px; padding: 4px 8px; background: var(--primary); border: none; border-radius: 4px; color: white; font-size: 11px; cursor: pointer;">Copy</button>
            </div>
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h3 style="font-size: 16px; font-weight: 600; color: var(--text-primary);">Active Tokens</h3>
              <input type="text" id="token-list-userId" placeholder="User ID to filter"
                style="padding: 6px 10px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 6px; color: var(--text-primary); font-size: 13px; width: 180px;" />
              <button onclick="loadTokens()" class="btn" style="padding: 6px 14px; font-size: 13px;">Load</button>
            </div>
            <div id="tokens-list" style="display: flex; flex-direction: column; gap: 10px;">
              <div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px;">Enter a User ID and click Load to view tokens</div>
            </div>
          </div>
        </div>

        <div class="tab-content" data-content="system">
          <div class="status-row">
            <span class="status-label">Server Version:</span>
            <span class="status-value">v0.2.0</span>
          </div>
          <div class="status-row">
            <span class="status-label">Workspace Path:</span>
            <span class="status-value">{{workspacePath}}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Env File Path:</span>
            <span class="status-value">{{envFilePath}}</span>
          </div>
          <div class="status-row">
            <span class="status-label">Server Status:</span>
            <span class="status-badge active"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:#10b981; margin-right:4px;"></span>Running</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Folder Browser Modal -->
  <div class="modal-overlay" id="browse-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Browse Workspace Folder</h3>
        <button type="button" class="close-modal" id="close-modal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="path-display" id="current-path-display">Loading...</div>
        <div class="dir-list" id="dir-list"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancel-modal">Cancel</button>
        <button type="button" class="btn" id="select-modal">Select Current Folder</button>
      </div>
    </div>
  </div>
  
  <script>
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', function() {
        const tabName = tab.getAttribute('data-tab');
        
        // Update active tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update active content
        document.querySelectorAll('.tab-content').forEach(content => {
          if (content.getAttribute('data-content') === tabName) {
            content.classList.add('active');
          } else {
            content.classList.remove('active');
          }
        });
      });
    });
    
    // Replace PORT placeholder with actual port
    const port = window.location.port || '3000';
    document.querySelectorAll('.code-block').forEach(block => {
      block.textContent = block.textContent.replace('{{PORT}}', port);
    });

    // Copy to Clipboard
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const targetId = btn.getAttribute('data-target');
        const codeElement = document.getElementById(targetId);
        navigator.clipboard.writeText(codeElement.textContent).then(function() {
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          btn.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          btn.style.color = '#10b981';
          setTimeout(function() {
            btn.textContent = originalText;
            btn.style.backgroundColor = '';
            btn.style.borderColor = '';
            btn.style.color = '';
          }, 2000);
        });
      });
    });

    // Show/Hide Toggle Visibility
    document.querySelectorAll('.toggle-visibility').forEach(btn => {
      btn.addEventListener('click', function() {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', type);
        
        if (type === 'text') {
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>';
        } else {
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>';
        }
      });
    });

    // Password Match Validation
    const passwordInput = document.getElementById('input-admin-password');
    const confirmInput = document.getElementById('input-admin-password-confirm');
    const indicator = document.getElementById('pw-indicator');
    const form = document.getElementById('config-form');

    function validatePassword() {
      const val = passwordInput.value;
      const conf = confirmInput.value;
      
      if (!val && !conf) {
        indicator.className = 'password-indicator';
        indicator.textContent = '';
        return true;
      }
      
      if (val === conf) {
        indicator.className = 'password-indicator match';
        indicator.textContent = '✓ Mật khẩu khớp';
        return true;
      } else {
        indicator.className = 'password-indicator mismatch';
        indicator.textContent = '✗ Mật khẩu chưa khớp';
        return false;
      }
    }

    passwordInput.addEventListener('input', validatePassword);
    confirmInput.addEventListener('input', validatePassword);

    form.addEventListener('submit', function(e) {
      if (!validatePassword()) {
        e.preventDefault();
        alert('Vui lòng xác nhận mật khẩu chính xác trước khi lưu!');
      }
    });

    // Token Management Functions
    const tokenForm = document.getElementById('token-form');
    const tokenResult = document.getElementById('token-result');
    const tokenValue = document.getElementById('token-value');

    tokenForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const userId = document.getElementById('token-userId').value;
      const description = document.getElementById('token-description').value;
      const expiresInDays = document.getElementById('token-expires').value;

      try {
        const response = await fetch('/admin/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            description: description || undefined,
            expiresInDays: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
          }),
        });

        const data = await response.json();
        if (data.success) {
          tokenValue.textContent = data.token;
          tokenResult.style.display = 'block';
          tokenForm.reset();
          // Reload tokens if same user
          const filterUserId = document.getElementById('token-list-userId').value;
          if (filterUserId === userId) {
            loadTokens();
          }
        } else {
          alert('Failed to create token: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Error creating token: ' + err.message);
      }
    });

    window.loadTokens = async function() {
      const userId = document.getElementById('token-list-userId').value;
      if (!userId) {
        alert('Please enter a User ID');
        return;
      }

      try {
        const response = await fetch('/admin/tokens?userId=' + encodeURIComponent(userId));
        const data = await response.json();

        const listContainer = document.getElementById('tokens-list');
        if (!data.success || data.tokens.length === 0) {
          listContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px; text-align: center; padding: 20px;">No tokens found for this user</div>';
          return;
        }

        listContainer.innerHTML = data.tokens.map(token => {
          const createdDate = new Date(token.createdAt).toLocaleString();
          const expiresDate = token.expiresAt ? new Date(token.expiresAt).toLocaleString() : 'Never';
          const lastUsedDate = token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'Never';
          const isActive = token.isActive === 1;

          return \`
            <div style="padding: 14px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 8px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); font-family: 'Courier New', monospace;">
                  \${token.id}
                </div>
                <span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; \${isActive ? 'background: rgba(16, 185, 129, 0.15); color: var(--success);' : 'background: rgba(239, 68, 68, 0.15); color: var(--danger);'}">
                  \${isActive ? 'ACTIVE' : 'REVOKED'}
                </span>
              </div>
              \${token.description ? \`<div style="font-size: 12px; color: var(--text-secondary);">\${token.description}</div>\` : ''}
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 11px; color: var(--text-secondary);">
                <div><strong>Created:</strong> \${createdDate}</div>
                <div><strong>Expires:</strong> \${expiresDate}</div>
                <div><strong>Last used:</strong> \${lastUsedDate}</div>
              </div>
              \${isActive ? \`<button onclick="revokeToken('\${token.id}')" style="padding: 6px 12px; background: var(--danger); border: none; border-radius: 6px; color: white; font-size: 12px; cursor: pointer; font-weight: 500; margin-top: 4px;">Revoke Token</button>\` : ''}
            </div>
          \`;
        }).join('');
      } catch (err) {
        alert('Error loading tokens: ' + err.message);
      }
    };

    window.revokeToken = async function(tokenId) {
      if (!confirm('Are you sure you want to revoke this token? This action cannot be undone.')) {
        return;
      }

      try {
        const response = await fetch('/admin/tokens/' + tokenId, {
          method: 'DELETE',
        });
        const data = await response.json();

        if (data.success) {
          loadTokens();
        } else {
          alert('Failed to revoke token');
        }
      } catch (err) {
        alert('Error revoking token: ' + err.message);
      }
    };

    // Success alert auto-hide
    const successAlert = document.getElementById('success-alert');
    if (successAlert) {
      setTimeout(function() {
        successAlert.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
        successAlert.style.opacity = '0';
        successAlert.style.transform = 'translateY(-10px)';
        setTimeout(function() { successAlert.remove(); }, 800);
      }, 4000);
    }

    // --- Directory Browser Client Logic ---
    const browseBtn = document.getElementById('btn-browse-workspace');
    const modal = document.getElementById('browse-modal');
    const closeModal = document.getElementById('close-modal');
    const cancelModal = document.getElementById('cancel-modal');
    const selectModal = document.getElementById('select-modal');
    const dirList = document.getElementById('dir-list');
    const currentPathEl = document.getElementById('current-path-display');
    const workspaceInput = document.getElementById('input-workspace-path');
    
    let currentBrowsingPath = '';

    function loadPath(pathVal) {
      currentPathEl.textContent = 'Loading...';
      fetch('/admin/browse?path=' + encodeURIComponent(pathVal))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) {
            currentPathEl.textContent = 'Error: ' + data.error;
            return;
          }
          currentBrowsingPath = data.currentPath;
          currentPathEl.textContent = data.currentPath;
          
          let htmlStr = '';
          
          // Add parent directory link if not at root
          if (data.parentPath && data.parentPath !== data.currentPath) {
            htmlStr += '<div class="dir-item" data-path="' + data.parentPath.replace(/"/g, '&quot;') + '"><span class="dir-icon">📁</span><span>.. (Parent Directory)</span></div>';
          }
          
          data.directories.forEach(function(dir) {
            const separator = data.currentPath.includes('\\\\') ? '\\\\' : '/';
            const fullPath = data.currentPath.endsWith(separator) ? data.currentPath + dir : data.currentPath + separator + dir;
            htmlStr += '<div class="dir-item" data-path="' + fullPath.replace(/"/g, '&quot;') + '"><span class="dir-icon">📁</span><span>' + dir + '</span></div>';
          });
          
          if (data.directories.length === 0) {
            htmlStr += '<div style="padding: 24px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">No subdirectories found</div>';
          }
          
          dirList.innerHTML = htmlStr;
          
          // Add click handlers
          dirList.querySelectorAll('.dir-item').forEach(function(item) {
            item.addEventListener('click', function() {
              loadPath(item.getAttribute('data-path'));
            });
          });
        })
        .catch(function(err) {
          currentPathEl.textContent = 'Error loading path';
          console.error(err);
        });
    }

    browseBtn.addEventListener('click', function() {
      modal.classList.add('active');
      const startPath = workspaceInput.value || '';
      loadPath(startPath);
    });

    const hideModal = function() { modal.classList.remove('active'); };
    closeModal.addEventListener('click', hideModal);
    cancelModal.addEventListener('click', hideModal);
    
    selectModal.addEventListener('click', function() {
      workspaceInput.value = currentBrowsingPath;
      hideModal();
    });
  </script>
</body>
</html>`;

/**
 * Tạo và cấu hình HTTP server app
 */
export function createHttpServerApp(_host = '127.0.0.1'): Express {
  const app = express();
  const server = createMcpServer();

  // Body parser cho POST requests (moved to top of middleware chain)
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Setup session
  app.use(
    session({
      secret: process.env.ACE_ADMIN_PASSWORD || 'ace-secret-fallback',
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 24 * 60 * 60 * 1000 },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id: string, done) => {
    try {
      const db = initUsersDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      db.close();
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: '/auth/google/callback',
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error('No email found from Google'), undefined);
            }
            const db = initUsersDb();
            let user = getUserByEmail(db, email);
            if (!user) {
              user = createUser(db, email, profile.id);
            }
            db.close();
            return done(null, user);
          } catch (err) {
            return done(err, undefined);
          }
        },
      ),
    );
  }

  // Auth Routes
  app.get('/auth/google', (req, res, next) => {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
    } else {
      res
        .status(503)
        .send('Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.');
    }
  });

  app.get(
    '/auth/google/callback',
    (req, res, next) => {
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.authenticate('google', { failureRedirect: '/?error=1' })(req, res, next);
      } else {
        res.redirect('/?error=1');
      }
    },
    (req, res) => {
      res.redirect('/');
    },
  );

  app.post('/auth/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });

  app.post('/auth/token/regenerate', (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).send('Unauthorized');
    }
    const user = req.user as any;
    try {
      const db = initUsersDb();
      regenerateUserToken(db, user.id);
      db.close();
      res.redirect('/?success=true');
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Error regenerating token');
      res.redirect('/?error=1');
    }
  });

  // Apply MCP authentication middleware (skip for admin/health endpoints)
  app.use(authenticateMCP);

  // Custom Cookie Parser Middleware
  app.use((req: Request, _res: Response, next) => {
    (req as any).cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      for (const cookie of cookieHeader.split(';')) {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          (req as any).cookies[name] = decodeURIComponent(value);
        }
      }
    }
    next();
  });

  // Public health and compatibility endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http' });
  });

  app.get('/get-models', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.post('/get-models', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.get('/augment/get-models', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.post('/augment/get-models', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.get('/context-canvas/list', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.post('/context-canvas/list', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.get('/get-implicit-external-sources', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.post('/get-implicit-external-sources', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.get('/search-external-sources', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  app.post('/search-external-sources', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' });
  });

  // Folder browser API
  app.get('/admin/browse', (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let currentPath = (req.query.path as string) || process.cwd();
    try {
      currentPath = path.resolve(currentPath);
      if (!fs.existsSync(currentPath)) {
        currentPath = process.cwd();
      }

      const files = fs.readdirSync(currentPath, { withFileTypes: true });
      const dirs = files
        .filter((f) => f.isDirectory() && !f.name.startsWith('.'))
        .map((f) => f.name)
        .sort();

      const parentPath = path.dirname(currentPath);

      res.json({
        currentPath,
        parentPath,
        directories: dirs,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Dashboard Statistics API
  app.get('/api/dashboard/stats', (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const stats = getDashboardStats();
      res.json(stats);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to get dashboard stats');
      res.status(500).json({ error: 'Failed to load statistics' });
    }
  });

  // Admin dashboard (GET /)
  app.get('/', async (req: Request, res: Response) => {
    const success = req.query.success === 'true';
    const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
    const envFilePath = getActiveEnvFilePath();

    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isPasswordAuthenticated =
      sessionToken && verifySessionToken(sessionToken, config.password!);
    const isGoogleAuthenticated = req.isAuthenticated ? req.isAuthenticated() : false;
    const isAuthenticated = isPasswordAuthenticated || isGoogleAuthenticated;

    if (!isAuthenticated) {
      const error = req.query.error === '1';
      let loginHtml = LOGIN_HTML_TEMPLATE;
      if (error) {
        loginHtml = loginHtml.replace('{{#if error}}', '').replace('{{/if}}', '');
      } else {
        loginHtml = loginHtml.replace(/\{\{#if error\}\}[\s\S]*?\{\{\/if\}\}/, '');
      }
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        loginHtml = loginHtml.replace('{{#if googleConfigured}}', '').replace('{{/if}}', '');
      } else {
        loginHtml = loginHtml.replace(/\{\{#if googleConfigured\}\}[\s\S]*?\{\{\/if\}\}/, '');
      }

      return res.send(loginHtml);
    }

    const user = req.user as any;
    let apiToken = user?.api_token;
    const userEmail = user?.email || 'Admin User';

    // Fetch latest admin token if not Google authenticated
    if (!apiToken) {
      try {
        const { listTokens } = await import('../auth/tokenManager.js');
        const adminTokens = listTokens('admin');
        if (adminTokens.length > 0) {
          // Tokens are sorted by created_at DESC, so the first one is the newest
          apiToken = '*** (Token exists, click Generate to get a new one)';
        } else {
          apiToken = 'N/A (No token generated yet)';
        }
      } catch (err) {
        apiToken = 'N/A (Logged in via Admin Password)';
      }
    }

    const regenerateHtml = isGoogleAuthenticated
      ? '<form action="/auth/token/regenerate" method="POST" style="position: absolute; right: 0; top: -28px;"><button type="submit" style="background: none; border: none; color: var(--warning); cursor: pointer; font-size: 0.8rem; text-decoration: underline;">Regenerate Token</button></form>'
      : '';

    const hasEmbeddingKey = !!process.env.EMBEDDINGS_API_KEYS;
    const hasRerankKey = !!process.env.RERANK_API_KEYS;

    let html = ADMIN_HTML_TEMPLATE;

    // Replace success alert block
    if (success) {
      html = html.replace('{{#if success}}', '').replace('{{/if}}', '');
    } else {
      html = html.replace(/\{\{#if success\}\}[\s\S]*?\{\{\/if\}\}/, '');
    }

    // Replace HasEmbeddingKey badge block
    if (hasEmbeddingKey) {
      html = html.replace(
        /\{\{#if hasEmbeddingKey\}\}([\s\S]*?)\{\{else\}\}[\s\S]*?\{\{\/if\}\}/,
        '$1',
      );
    } else {
      html = html.replace(
        /\{\{#if hasEmbeddingKey\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/,
        '$1',
      );
    }

    // Replace HasRerankKey badge block
    if (hasRerankKey) {
      html = html.replace(
        /\{\{#if hasRerankKey\}\}([\s\S]*?)\{\{else\}\}[\s\S]*?\{\{\/if\}\}/,
        '$1',
      );
    } else {
      html = html.replace(
        /\{\{#if hasRerankKey\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/,
        '$1',
      );
    }

    let adminTokenHtml = '';
    if (!isGoogleAuthenticated) {
      adminTokenHtml = `
      <div style="margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Manage Admin Token:</div>
        <button type="button" class="btn" style="width: auto; padding: 6px 12px; font-size: 0.8rem;" onclick="generateAdminToken()">Generate New Token</button>
        <button type="button" class="btn" style="width: auto; padding: 6px 12px; font-size: 0.8rem; background: var(--danger); margin-left: 8px;" onclick="revokeTokens()">Revoke Tokens</button>
        <div id="new-admin-token" style="margin-top: 8px; color: var(--success); font-weight: bold;"></div>
      </div>
      <script>
        async function generateAdminToken() {
          try {
            const res = await fetch('/admin/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'admin' }) });
            if (res.ok) {
              const data = await res.json();
              document.getElementById('new-admin-token').innerText = 'New Token: ' + data.token + ' (Copy now!)';
              document.getElementById('input-api-token').value = data.token;
            } else {
              const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
              console.error('Error response:', errorData);
              alert('Error generating token: ' + (errorData.error || res.statusText));
            }
          } catch (err) {
            console.error('Exception:', err);
            alert('Error generating token: ' + err.message);
          }
        }
        async function revokeTokens() {
          if (confirm('Are you sure you want to revoke all admin tokens?')) {
            const res = await fetch('/admin/tokens?userId=admin');
            if (res.ok) {
              const data = await res.json();
              for (const t of data.tokens) {
                await fetch('/admin/tokens/' + t.id, { method: 'DELETE' });
              }
              alert('Tokens revoked');
              document.getElementById('input-api-token').value = 'N/A';
            }
          }
        }
      </script>`;
    }

    // Replace escaped config values
    html = html
      .replace(/\{\{userEmail\}\}/g, escapeHtml(userEmail))
      .replace(/\{\{apiToken\}\}/g, escapeHtml(apiToken))
      .replace('{{regenerateButton}}', regenerateHtml)
      .replace('{{adminTokenHtml}}', adminTokenHtml)
      .replace(
        /\{\{embeddingsApiKeys\}\}/g,
        escapeHtml(maskApiKeys(process.env.EMBEDDINGS_API_KEYS || '')),
      )
      .replace(/\{\{embeddingsBaseUrl\}\}/g, escapeHtml(process.env.EMBEDDINGS_BASE_URL || ''))
      .replace(/\{\{embeddingsModel\}\}/g, escapeHtml(process.env.EMBEDDINGS_MODEL || ''))
      .replace(/\{\{rerankApiKeys\}\}/g, escapeHtml(maskApiKeys(process.env.RERANK_API_KEYS || '')))
      .replace(/\{\{rerankBaseUrl\}\}/g, escapeHtml(process.env.RERANK_BASE_URL || ''))
      .replace(/\{\{rerankModel\}\}/g, escapeHtml(process.env.RERANK_MODEL || ''))
      .replace(/\{\{googleClientId\}\}/g, escapeHtml(process.env.GOOGLE_CLIENT_ID || ''))
      .replace(
        /\{\{googleClientSecret\}\}/g,
        escapeHtml(maskApiKeys(process.env.GOOGLE_CLIENT_SECRET || '')),
      )
      .replace(/\{\{workspacePath\}\}/g, escapeHtml(workspacePath))
      .replace(
        /\{\{entryFilePathJson\}\}/g,
        escapeHtml(path.join(workspacePath, 'dist', 'index.js').replace(/\\/g, '\\\\')),
      )
      .replace(/\{\{envFilePath\}\}/g, escapeHtml(envFilePath));

    res.send(html);
  });

  // Admin Login Action
  app.post('/admin/login', (req: Request, res: Response) => {
    const { password } = req.body;
    const config = getAdminAuthConfig();

    if (password && verifyAdminPassword(password, config.password!)) {
      const sessionToken = generateSessionToken(config.password!);
      res.setHeader(
        'Set-Cookie',
        `ace_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Max-Age=86400`,
      );
      return res.redirect('/');
    } else {
      return res.redirect('/?error=1');
    }
  });

  // Admin Logout Action
  app.post('/admin/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', 'ace_session=; Path=/; HttpOnly; Max-Age=0');
    res.redirect('/');
  });

  // Admin Configuration Save Action
  app.post('/admin/configure', (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      return res.status(401).send('Unauthorized');
    }

    const {
      workspace_path,
      embeddings_api_keys,
      embeddings_base_url,
      embeddings_model,
      rerank_api_keys,
      rerank_base_url,
      rerank_model,
      google_client_id,
      google_client_secret,
      admin_password,
    } = req.body;

    const updates: Record<string, string> = {};

    if (workspace_path) {
      updates.WORKSPACE_PATH = workspace_path;
    }

    if (embeddings_api_keys !== undefined && !embeddings_api_keys.includes('*')) {
      updates.EMBEDDINGS_API_KEYS = embeddings_api_keys;
    }
    if (embeddings_base_url !== undefined) updates.EMBEDDINGS_BASE_URL = embeddings_base_url;
    if (embeddings_model !== undefined) updates.EMBEDDINGS_MODEL = embeddings_model;

    if (rerank_api_keys !== undefined && !rerank_api_keys.includes('*')) {
      updates.RERANK_API_KEYS = rerank_api_keys;
    }
    if (rerank_base_url !== undefined) updates.RERANK_BASE_URL = rerank_base_url;
    if (rerank_model !== undefined) updates.RERANK_MODEL = rerank_model;

    if (admin_password && admin_password.trim() !== '') {
      updates.ACE_ADMIN_PASSWORD = admin_password;
    }

    if (google_client_id !== undefined) updates.GOOGLE_CLIENT_ID = google_client_id;
    if (google_client_secret !== undefined && !google_client_secret.includes('*')) {
      updates.GOOGLE_CLIENT_SECRET = google_client_secret;
    }

    if (Object.keys(updates).length > 0) {
      updateEnvFile(updates);
      // Update current process env as well
      Object.assign(process.env, updates);

      // Hot reload Google Strategy if it was added or updated
      if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        passport.use(
          new GoogleStrategy(
            {
              clientID: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              callbackURL: '/auth/google/callback',
            },
            (_accessToken, _refreshToken, profile, done) => {
              try {
                const email = profile.emails?.[0]?.value;
                if (!email) {
                  return done(new Error('No email found from Google'), undefined);
                }
                const db = initUsersDb();
                let user = getUserByEmail(db, email);
                if (!user) {
                  user = createUser(db, email, profile.id);
                }
                db.close();
                return done(null, user);
              } catch (err) {
                return done(err, undefined);
              }
            },
          ),
        );
      }
    }

    res.redirect('/?success=true');
  });

  // API Token Management Endpoints
  app.post('/admin/tokens', async (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      logger.warn('Token generation failed: Unauthorized');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      logger.info({ body: req.body }, 'Attempting to create token');
      const { createToken } = await import('../auth/tokenManager.js');
      const { userId, description, expiresInDays } = req.body;

      if (!userId || typeof userId !== 'string') {
        logger.warn({ userId }, 'Token generation failed: userId is required');
        return res.status(400).json({ error: 'userId is required' });
      }

      logger.info({ userId, description, expiresInDays }, 'Creating token with parameters');
      const result = createToken({
        userId,
        description: description || undefined,
        expiresInDays: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
      });

      logger.info({ tokenId: result.id, userId }, 'Token created successfully');
      res.json({
        success: true,
        token: result.token,
        tokenId: result.id,
        userId,
      });
    } catch (err) {
      const error = err as Error;
      logger.error({ 
        error: error.message, 
        stack: error.stack,
        body: req.body 
      }, 'Failed to create token');
      res.status(500).json({ error: `Failed to create token: ${error.message}` });
    }
  });

  app.get('/admin/tokens', async (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { listTokens } = await import('../auth/tokenManager.js');
      const { userId } = req.query;

      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId query parameter is required' });
      }

      const tokens = listTokens(userId);
      res.json({ success: true, tokens });
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to list tokens');
      res.status(500).json({ error: 'Failed to list tokens' });
    }
  });

  app.delete('/admin/tokens/:tokenId', async (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const sessionToken = (req as any).cookies?.ace_session;
    const isAuthenticated = sessionToken && verifySessionToken(sessionToken, config.password!);

    if (!isAuthenticated) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { revokeToken } = await import('../auth/tokenManager.js');
      const { tokenId } = req.params;

      const success = revokeToken(tokenId as string);
      res.json({ success });
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to revoke token');
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  });

  // Setup Streamable HTTPServer Transport
  const transport = new StreamableHTTPServerTransport();

  server.connect(transport).catch((err) => {
    logger.error({ error: err.message }, 'Failed to connect server to transport');
  });

  // ========================================
  // Agent Orchestration Endpoints
  // ========================================

  // Mount agent routes under /agents prefix (requires authentication)
  app.use('/agents', requireAuth, createAgentRoutes());

  // ========================================
  // MCP Session & SSE Endpoints
  // ========================================

  /**
   * POST /mcp/session - Create new MCP session (authenticated)
   */
  app.post('/mcp/session', requireAuth, (req: Request, res: Response) => {
    const auth = getAuthUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const session = sessionManager.createSession({
        userId: auth.userId,
        tokenId: auth.tokenId,
      });

      res.json({
        sessionId: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        sseEndpoint: `/mcp/sse?sessionId=${session.id}`,
        mcpEndpoint: '/mcp',
      });
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to create session');
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  /**
   * GET /mcp/sse - SSE connection endpoint
   */
  app.get('/mcp/sse', requireAuth, (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId parameter' });
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    // Verify session belongs to authenticated user
    const auth = getAuthUser(req);
    if (!auth || session.userId !== auth.userId) {
      return res.status(403).json({ error: 'Session does not belong to authenticated user' });
    }

    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Attach SSE to session
    if (!sessionManager.attachSSE(sessionId, res)) {
      return res.status(500).json({ error: 'Failed to attach SSE' });
    }

    // Send initial connected event
    sessionManager.sendSSE(sessionId, 'connected', {
      sessionId,
      timestamp: Date.now(),
      message: 'SSE connection established',
    });

    logger.info({ sessionId, userId: session.userId }, 'SSE connection established');
  });

  /**
   * DELETE /mcp/session/:sessionId - Destroy session
   */
  app.delete('/mcp/session/:sessionId', requireAuth, (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify ownership
    const auth = getAuthUser(req);
    if (!auth || session.userId !== auth.userId) {
      return res.status(403).json({ error: 'Cannot destroy session owned by another user' });
    }

    const destroyed = sessionManager.destroySession(sessionId as string);
    res.json({ success: destroyed });
  });

  /**
   * GET /mcp/sessions - List user sessions
   */
  app.get('/mcp/sessions', requireAuth, (req: Request, res: Response) => {
    const auth = getAuthUser(req);
    if (!auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const sessions = sessionManager.getUserSessions(auth.userId);

    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        isConnected: s.isConnected,
      })),
    });
  });

  /**
   * GET /mcp/stats - Session statistics (authenticated)
   */
  app.get('/mcp/stats', requireAuth, (_req: Request, res: Response) => {
    const stats = sessionManager.getStats();
    res.json(stats);
  });

  /**
   * POST /mcp - MCP JSON-RPC endpoint (authenticated)
   */
  app.post('/mcp', requireAuth, async (req: Request, res: Response) => {
    try {
      // Update session activity if sessionId provided
      const sessionId = req.headers['x-session-id'] as string;
      if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session) {
          sessionManager.updateActivity(sessionId);
        }
      }

      const rpcRequest = req.body;

      // Validate JSON-RPC request
      if (!rpcRequest || typeof rpcRequest !== 'object') {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid Request' },
          id: null,
        });
      }

      const { method, params, id } = rpcRequest;

      // Handle tools/list
      if (method === 'tools/list') {
        return res.json({
          jsonrpc: '2.0',
          result: { tools: TOOLS },
          id,
        });
      }

      // Handle tools/call
      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};

        if (!name) {
          return res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Invalid params: missing tool name' },
            id,
          });
        }

        try {
          let result;

          switch (name) {
            case 'codebase-retrieval': {
              const parsed = codebaseRetrievalSchema.parse(args);
              result = await handleCodebaseRetrieval(parsed, undefined, undefined);
              break;
            }
            case 'codebase-impact': {
              const parsed = codebaseImpactSchema.parse(args);
              result = await handleCodebaseImpact(parsed);
              break;
            }
            case 'generate-commit-message': {
              // TODO: implement when available
              result = {
                content: [{ type: 'text', text: 'Tool not yet implemented' }],
                isError: true,
              };
              break;
            }
            case 'detect-tasks': {
              // TODO: implement when available
              result = {
                content: [{ type: 'text', text: 'Tool not yet implemented' }],
                isError: true,
              };
              break;
            }
            default:
              return res.status(404).json({
                jsonrpc: '2.0',
                error: { code: -32602, message: `Unknown tool: ${name}` },
                id,
              });
          }

          return res.json({
            jsonrpc: '2.0',
            result,
            id,
          });
        } catch (err) {
          const error = err as { message?: string; stack?: string };
          logger.error(
            { error: error.message, stack: error.stack, tool: name },
            'Tool call failed',
          );

          return res.json({
            jsonrpc: '2.0',
            result: {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true,
            },
            id,
          });
        }
      }

      // Method not found
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Method not found: ${method}` },
        id,
      });
    } catch (err) {
      logger.error(
        { error: (err as Error).message, stack: (err as Error).stack },
        'Error handling MCP request',
      );
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Internal server error', data: (err as Error).message },
        id: null,
      });
    }
  });

  return app;
}

/**
 * Khởi động HTTP server
 */
export async function startHttpServer(port = 3000, host = '127.0.0.1'): Promise<void> {
  const app = createHttpServerApp(host);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.info(
        { port, host, endpoint: `http://${host}:${port}` },
        'ACE HTTP server đã khởi động',
      );
      resolve();
    });

    server.on('error', (err) => {
      logger.error({ error: err.message }, 'HTTP server error');
      reject(err);
    });
  });
}
