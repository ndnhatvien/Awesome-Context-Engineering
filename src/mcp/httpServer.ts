/**
 * ACE MCP HTTP Server
 *
 * HTTP transport for MCP server using StreamableHTTPServerTransport
 */

import fs from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type Response } from 'express';
import {
  generateSessionToken,
  getAdminAuthConfig,
  verifyAdminPassword,
  verifySessionToken,
} from '../auth/adminAuth.js';
import { getDashboardStats } from '../dashboard/analyticsService.js';
import { logger } from '../utils/logger.js';
import { getDefaultEnvFilePath, getPreferredHomeEnvFilePath } from '../utils/paths.js';
import {
  codebaseImpactSchema,
  codebaseRetrievalSchema,
  detectTasksSchema,
  generateCommitMessageSchema,
  handleCodebaseImpact,
  handleCodebaseRetrieval,
  handleDetectTasks,
  handleGenerateCommitMessage,
} from './tools/index.js';

// ===========================================
// Server Configuration
// ===========================================

const SERVER_NAME = 'ace';
const SERVER_VERSION = '1.0.0';

// ===========================================
// Tool Definitions (shared with stdio server)
// ===========================================

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

Examples of GOOD queries:
* [Goal: Understand Auth] 
  information_request: "How is user authentication flow handled?"
* [Goal: Fix DB Pool bug] 
  information_request: "Logic for database connection pooling and error handling" 
  technical_terms: ["PoolConfig", "Connection", "release"]

Examples of BAD queries:
* "Show me src/main.ts" (Use 'read_file' instead)
* "Find definition of constructor of class Foo" (Use this tool, but put "Foo" in technical_terms)
* "Find all references to function bar across the whole project" (Use 'grep' tool for exhaustive reference counting)
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
            "The SEMANTIC GOAL. Describe the functionality, logic, or behavior you are looking for in full natural language sentences. Focus on 'how it works' rather than exact names. (e.g., 'Trace the execution flow of the login process')",
        },
        technical_terms: {
          type: 'array',
          items: { type: 'string' },
          description:
            'HARD FILTERS. An optional list of EXACT, KNOWN identifiers (class/function names, constants) that MUST appear in the code. Only use terms you are 100% sure exist. Leave empty if exploring.',
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

Example workflow:
1. Stage your changes: git add .
2. Call this tool to generate message
3. Review and commit: git commit -m "generated message"
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
- Quick reference for project automation

The tool returns a formatted list of all detected tasks with descriptions.
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
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Target file path, symbol path (file:symbol), or symbol name to analyze. Can be a single string or array of strings.',
        },
        mode: {
          type: 'string',
          enum: ['impact', 'affected'],
          description:
            'Analysis mode: "impact" for detailed paths, "affected" for test/file list (default: affected)',
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

// ===========================================
// Helper Functions
// ===========================================

function getActiveEnvFilePath(): string {
  const preferredHomeEnvPath = getPreferredHomeEnvFilePath();
  const fallbackEnvPath = getDefaultEnvFilePath();
  const localEnvPath = path.join(process.cwd(), '.env');

  if (fs.existsSync(localEnvPath)) return localEnvPath;
  if (fs.existsSync(preferredHomeEnvPath)) return preferredHomeEnvPath;
  if (fs.existsSync(fallbackEnvPath)) return fallbackEnvPath;

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
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.substring(0, eqIdx).trim();
      if (keysToUpdate.has(key)) {
        lines[i] = `${key}=${updates[key]}`;
        keysToUpdate.delete(key);
      }
    }
  }

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

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return key.slice(0, 5) + '*'.repeat(12) + key.slice(-4);
}

function maskApiKeys(keys: string): string {
  if (!keys) return '';
  return keys
    .split(',')
    .map((k) => maskApiKey(k.trim()))
    .join(', ');
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  }
  return cookies;
}

// ===========================================
// MCP Server Factory
// ===========================================

function createMcpServer(): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Received list_tools request');
    return { tools: TOOLS };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    logger.info({ tool: name }, 'Received call_tool request');

    // Extract progressToken if client requests progress notifications
    const rawToken = extra._meta?.progressToken;
    const progressToken =
      typeof rawToken === 'string' || typeof rawToken === 'number' ? rawToken : undefined;

    // Create progress notification callback
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
            // Ignore notification send failures, don't affect main flow
            logger.debug({ error: (err as Error).message }, 'Failed to send progress notification');
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
      logger.error({ error: error.message, stack: error.stack, tool: name }, 'Tool call failed');
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

// ===========================================
// HTTP Server Setup
// ===========================================

export interface HttpServerOptions {
  port: number;
  host: string;
}

/**
 * Create Express app with MCP endpoints
 */
export function createHttpServerApp(): Express {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Root endpoint - admin dashboard UI
  app.get('/', (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies.ace_session;
    const isAuthenticated =
      sessionToken && config.password && verifySessionToken(sessionToken, config.password);

    if (!isAuthenticated) {
      return res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACE Admin - Login</title>
  <style>
    :root { --primary: #6366f1; --bg: #0f0f23; --bg-card: rgba(30,30,60,0.6); --text: #e2e8f0; --text2: #94a3b8; --danger: #ef4444; --border: rgba(255,255,255,0.08); }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter',-apple-system,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; }
    .login-box { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:48px; width:100%; max-width:400px; }
    h1 { font-size:1.8rem; margin-bottom:8px; text-align:center; }
    .subtitle { color:var(--text2); text-align:center; margin-bottom:32px; font-size:0.9rem; }
    .form-group { margin-bottom:20px; }
    label { display:block; font-size:0.85rem; color:var(--text2); margin-bottom:8px; }
    input[type="password"] { width:100%; padding:12px 16px; background:rgba(255,255,255,0.05); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:1rem; outline:none; transition: border-color 0.2s; }
    input:focus { border-color:var(--primary); }
    .btn { width:100%; padding:12px; background:var(--primary); border:none; border-radius:8px; color:#fff; font-size:1rem; font-weight:600; cursor:pointer; transition:opacity 0.2s; }
    .btn:hover { opacity:0.9; }
    .error-msg { color:var(--danger); font-size:0.85rem; text-align:center; margin-bottom:16px; display:none; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>ACE</h1>
    <div class="subtitle">Admin Dashboard Login</div>
    <div class="error-msg" id="error-msg">Invalid password</div>
    <form action="/admin/login" method="POST">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Enter admin password" required autofocus />
      </div>
      <button type="submit" class="btn">Sign In</button>
    </form>
  </div>
</body>
</html>`);
    }

    // Authenticated - show dashboard
    const hasEmbeddingKey = !!(process.env.EMBEDDINGS_API_KEYS || process.env.EMBEDDINGS_API_KEY);
    const hasRerankKey = !!(process.env.RERANK_API_KEYS || process.env.RERANK_API_KEY);
    const envFilePath = getActiveEnvFilePath();

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACE Admin Dashboard</title>
  <style>
    :root {
      --primary: #6366f1; --primary-hover: #818cf8; --success: #22c55e; --warning: #eab308; --danger: #ef4444;
      --bg: #0f0f23; --bg-card: rgba(30,30,60,0.6); --bg-input: rgba(255,255,255,0.05);
      --text: #e2e8f0; --text2: #94a3b8; --border: rgba(255,255,255,0.08);
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Inter',-apple-system,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; padding:24px; }
    .top-bar { display:flex; align-items:center; justify-content:space-between; margin-bottom:32px; max-width:1100px; margin-left:auto; margin-right:auto; }
    .top-bar h1 { font-size:1.5rem; }
    .top-bar form { margin:0; }
    .btn-logout { background:none; border:1px solid var(--border); color:var(--text2); padding:8px 16px; border-radius:8px; cursor:pointer; font-size:0.85rem; transition:all 0.2s; }
    .btn-logout:hover { border-color:var(--danger); color:var(--danger); }
    .container { max-width:1100px; margin:0 auto; }
    .section-title { font-size:1.1rem; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
    .badge { display:inline-block; padding:2px 10px; border-radius:20px; font-size:0.75rem; font-weight:600; }
    .badge-ok { background:rgba(34,197,94,0.15); color:var(--success); }
    .badge-missing { background:rgba(239,68,68,0.15); color:var(--danger); }
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:32px; }
    .stat-card { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:20px; }
    .stat-label { font-size:0.8rem; color:var(--text2); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; }
    .stat-value { font-size:1.8rem; font-weight:700; }
    .stat-primary { color:var(--primary); }
    .stat-success { color:var(--success); }
    .card { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:24px; }
    .card-subtitle { font-size:0.9rem; font-weight:600; color:var(--text2); margin-bottom:16px; margin-top:24px; }
    .form-group { margin-bottom:16px; }
    .form-group label { display:block; font-size:0.85rem; color:var(--text2); margin-bottom:6px; }
    .form-group input { width:100%; padding:10px 14px; background:var(--bg-input); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:0.9rem; outline:none; transition:border-color 0.2s; }
    .form-group input:focus { border-color:var(--primary); }
    .form-group input[readonly] { opacity:0.6; cursor:default; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .input-wrapper { position:relative; }
    .input-wrapper input { padding-right:40px; }
    .toggle-vis { position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text2); cursor:pointer; padding:4px; }
    .toggle-vis:hover { color:var(--text); }
    .btn-save { padding:12px 32px; background:var(--primary); border:none; border-radius:8px; color:#fff; font-size:0.95rem; font-weight:600; cursor:pointer; transition:all 0.2s; margin-top:8px; }
    .btn-save:hover { background:var(--primary-hover); }
    .lang-chart { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:24px; margin-bottom:24px; }
    .lang-item { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
    .lang-name { min-width:80px; font-size:0.85rem; }
    .lang-bar-bg { flex:1; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden; }
    .lang-bar { height:100%; background:linear-gradient(90deg,var(--primary),var(--primary-hover)); border-radius:3px; }
    .lang-count { min-width:50px; text-align:right; font-size:0.8rem; color:var(--text2); }
    .success-msg { color:var(--success); font-size:0.85rem; margin-top:8px; display:none; }
    .error { color:var(--danger); text-align:center; padding:20px; }
    @media (max-width:640px) { .grid-2 { grid-template-columns:1fr; } body { padding:16px; } }
  </style>
</head>
<body>
  <div class="top-bar">
    <h1>ACE Dashboard</h1>
    <form action="/admin/logout" method="POST"><button type="submit" class="btn-logout">Logout</button></form>
  </div>
  <div class="container">
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value stat-success" id="stat-uptime">-</div></div>
      <div class="stat-card"><div class="stat-label">Indexed Files</div><div class="stat-value stat-primary" id="stat-files">-</div></div>
      <div class="stat-card"><div class="stat-label">Chunks</div><div class="stat-value stat-primary" id="stat-chunks">-</div></div>
      <div class="stat-card"><div class="stat-label">Storage</div><div class="stat-value stat-primary" id="stat-size">-</div></div>
    </div>

    <div class="lang-chart"><h3 style="margin-bottom:16px;font-size:1rem;">Languages</h3><div id="lang-content"><div style="text-align:center;padding:20px;color:var(--text2)">Loading...</div></div></div>

    <div class="card">
      <div class="section-title">
        Configuration
        <span class="badge ${hasEmbeddingKey ? 'badge-ok' : 'badge-missing'}">Embeddings ${hasEmbeddingKey ? 'OK' : 'Missing'}</span>
        <span class="badge ${hasRerankKey ? 'badge-ok' : 'badge-missing'}">Reranker ${hasRerankKey ? 'OK' : 'Missing'}</span>
      </div>
      <div style="font-size:0.8rem;color:var(--text2);margin-bottom:16px;">Config file: ${escapeHtml(envFilePath)}</div>

      <form action="/admin/configure" method="POST" id="config-form">
        <div class="card-subtitle">Embedding Configuration</div>
        <div class="form-group">
          <label>API Key (comma-separated for multi-key rotation)</label>
          <div class="input-wrapper">
            <input type="password" name="embeddings_api_keys" value="${escapeHtml(maskApiKeys(process.env.EMBEDDINGS_API_KEYS || process.env.EMBEDDINGS_API_KEY || ''))}" placeholder="sk-xxxxxxxxxxxx" />
            <button type="button" class="toggle-vis" onclick="toggleVis(this)"><svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" name="embeddings_base_url" value="${escapeHtml(process.env.EMBEDDINGS_BASE_URL || '')}" placeholder="https://api.siliconflow.cn/v1" />
          </div>
          <div class="form-group">
            <label>Model</label>
            <input type="text" name="embeddings_model" value="${escapeHtml(process.env.EMBEDDINGS_MODEL || '')}" placeholder="BAAI/bge-m3" />
          </div>
        </div>

        <div class="card-subtitle">Reranker Configuration</div>
        <div class="form-group">
          <label>API Key (comma-separated for multi-key rotation)</label>
          <div class="input-wrapper">
            <input type="password" name="rerank_api_keys" value="${escapeHtml(maskApiKeys(process.env.RERANK_API_KEYS || process.env.RERANK_API_KEY || ''))}" placeholder="sk-xxxxxxxxxxxx" />
            <button type="button" class="toggle-vis" onclick="toggleVis(this)"><svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" name="rerank_base_url" value="${escapeHtml(process.env.RERANK_BASE_URL || '')}" placeholder="https://api.jina.ai/v1" />
          </div>
          <div class="form-group">
            <label>Model</label>
            <input type="text" name="rerank_model" value="${escapeHtml(process.env.RERANK_MODEL || '')}" placeholder="jina-reranker-v2-base-multilingual" />
          </div>
        </div>

        <div class="card-subtitle">Profile &amp; Logging</div>
        <div class="grid-2">
          <div class="form-group">
            <label>Profile</label>
            <input type="text" name="ace_profile" value="${escapeHtml(process.env.ACE_PROFILE || 'balanced')}" placeholder="quality | balanced | performance" />
          </div>
          <div class="form-group">
            <label>Log Level</label>
            <input type="text" name="log_level" value="${escapeHtml(process.env.LOG_LEVEL || 'info')}" placeholder="debug | info | warn | error" />
          </div>
        </div>

        <div class="success-msg" id="save-success">Configuration saved successfully!</div>
        <button type="submit" class="btn-save">Save Configuration</button>
      </form>
    </div>
  </div>
  <script>
    function toggleVis(btn) {
      const input = btn.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
    }
    async function loadStats() {
      try {
        const r = await fetch('/api/dashboard/stats');
        if (!r.ok) throw new Error(r.statusText);
        const s = await r.json();
        document.getElementById('stat-uptime').textContent = s.system?.uptime || '-';
        document.getElementById('stat-files').textContent = s.index?.totalFiles ?? '-';
        document.getElementById('stat-chunks').textContent = s.index?.totalChunks ?? '-';
        document.getElementById('stat-size').textContent = s.index?.totalSize || '-';
        const langs = s.index?.languages || {};
        const entries = Object.entries(langs).sort((a,b) => b[1]-a[1]);
        const el = document.getElementById('lang-content');
        if (!entries.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2)">No data yet &mdash; run <code>ace index</code></div>'; return; }
        const max = Math.max(...entries.map(e=>e[1]));
        el.innerHTML = entries.slice(0,10).map(([name,count]) => '<div class="lang-item"><div class="lang-name">'+name+'</div><div class="lang-bar-bg"><div class="lang-bar" style="width:'+(count/max*100)+'%"></div></div><div class="lang-count">'+count.toLocaleString()+'</div></div>').join('');
      } catch(e) { document.getElementById('lang-content').innerHTML = '<div class="error">Failed to load stats</div>'; }
    }
    loadStats();
    setInterval(loadStats, 30000);
  </script>
</body>
</html>`);
  });

  // Admin Login Action
  app.post('/admin/login', (req: Request, res: Response) => {
    const { password } = req.body;
    const config = getAdminAuthConfig();

    if (password && config.password && verifyAdminPassword(password, config.password)) {
      const sessionToken = generateSessionToken(config.password);
      res.setHeader(
        'Set-Cookie',
        `ace_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Max-Age=86400`,
      );
      return res.redirect('/');
    }
    return res.redirect('/?error=1');
  });

  // Admin Logout Action
  app.post('/admin/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', 'ace_session=; Path=/; HttpOnly; Max-Age=0');
    res.redirect('/');
  });

  // Admin Configuration Save Action
  app.post('/admin/configure', (req: Request, res: Response) => {
    const config = getAdminAuthConfig();
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies.ace_session;

    if (!sessionToken || !config.password || !verifySessionToken(sessionToken, config.password)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      embeddings_api_keys,
      embeddings_base_url,
      embeddings_model,
      rerank_api_keys,
      rerank_base_url,
      rerank_model,
      ace_profile,
      log_level,
    } = req.body;

    const updates: Record<string, string> = {};

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

    if (ace_profile !== undefined) updates.ACE_PROFILE = ace_profile;
    if (log_level !== undefined) updates.LOG_LEVEL = log_level;

    if (Object.keys(updates).length > 0) {
      try {
        updateEnvFile(updates);
        Object.assign(process.env, updates);
        logger.info({ keys: Object.keys(updates) }, 'Admin updated .env configuration');
      } catch (err) {
        logger.error({ error: (err as Error).message }, 'Failed to update .env file');
      }
    }

    res.redirect('/');
  });

  // Favicon - return 204 to avoid browser warnings
  app.get('/favicon.ico', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
    });
  });

  // Dashboard stats API
  app.get('/api/dashboard/stats', (_req: Request, res: Response) => {
    try {
      const stats = getDashboardStats();
      res.json(stats);
    } catch (err) {
      logger.debug({ error: (err as Error).message }, 'Dashboard stats unavailable');
      res.json({
        index: {
          totalFiles: 0,
          totalChunks: 0,
          totalSize: '0 B',
          lastIndexed: null,
          languages: {},
        },
        tokens: { totalTokens: 0, activeTokens: 0, revokedTokens: 0, recentActivity: [] },
        search: { totalQueries: 0, avgResponseTime: 0, popularQueries: [], recentQueries: [] },
        system: { uptime: '0m', nodeVersion: process.version },
      });
    }
  });

  // Model endpoints (compatibility with existing clients)
  app.get('/get-models', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
      models: [
        {
          id: 'ace-retrieval',
          name: 'ACE Codebase Retrieval',
          description: 'Hybrid semantic + exact match codebase search',
        },
      ],
    });
  });

  app.post('/get-models', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
      models: [
        {
          id: 'ace-retrieval',
          name: 'ACE Codebase Retrieval',
          description: 'Hybrid semantic + exact match codebase search',
        },
      ],
    });
  });

  // Augment compatibility endpoints
  app.get('/augment/get-models', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
      models: [
        {
          id: 'ace-retrieval',
          name: 'ACE Codebase Retrieval',
          description: 'Hybrid semantic + exact match codebase search',
        },
      ],
    });
  });

  app.post('/augment/get-models', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
      models: [
        {
          id: 'ace-retrieval',
          name: 'ACE Codebase Retrieval',
          description: 'Hybrid semantic + exact match codebase search',
        },
      ],
    });
  });

  // MCP SSE endpoint
  app.get('/mcp', async (req: Request, res: Response) => {
    logger.info({ method: 'GET', path: '/mcp' }, 'New MCP SSE connection');

    const transport = new SSEServerTransport('/mcp', res);
    const server = createMcpServer();

    await server.connect(transport);

    // Handle client disconnect
    req.on('close', () => {
      logger.info('MCP SSE connection closed');
    });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    logger.info({ method: 'POST', path: '/mcp' }, 'MCP POST request');

    const transport = new SSEServerTransport('/mcp', res);
    const server = createMcpServer();

    await server.connect(transport);

    // Handle client disconnect
    req.on('close', () => {
      logger.info('MCP POST connection closed');
    });
  });

  // Handle cleanup
  app.delete('/mcp', (_req: Request, res: Response) => {
    logger.info({ method: 'DELETE', path: '/mcp' }, 'MCP session cleanup');
    res.status(200).json({ status: 'ok' });
  });

  return app;
}

/**
 * Start HTTP server
 */
export async function startHttpServer(options: HttpServerOptions): Promise<HttpServer> {
  const app = createHttpServerApp();

  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(options.port, options.host, () => {
        logger.info(
          { port: options.port, host: options.host },
          `MCP HTTP server listening on http://${options.host}:${options.port}`,
        );
        resolve(server);
      });

      server.on('error', (err) => {
        logger.error({ err }, 'HTTP server error');
        reject(err);
      });
    } catch (err) {
      logger.error({ err }, 'Failed to start HTTP server');
      reject(err);
    }
  });
}
