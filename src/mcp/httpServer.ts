/**
 * ACE MCP HTTP Server
 *
 * HTTP transport for MCP server using StreamableHTTPServerTransport
 */

import type { Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type Response } from 'express';
import { getDashboardStats } from '../dashboard/analyticsService.js';
import { logger } from '../utils/logger.js';
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

  // Root endpoint - dashboard UI
  app.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACE - Awesome Context Engineering</title>
  <style>
    :root {
      --primary: #6366f1;
      --primary-hover: #818cf8;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --bg: #0f0f23;
      --bg-card: rgba(30, 30, 60, 0.6);
      --text-primary: #e2e8f0;
      --text-secondary: #94a3b8;
      --border-card: rgba(255, 255, 255, 0.08);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text-primary); min-height: 100vh; padding: 32px; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 48px; }
    header h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
    header p { color: var(--text-secondary); font-size: 1rem; }
    .endpoints { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 48px; }
    .endpoint-card { background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 12px; padding: 16px 24px; text-decoration: none; color: var(--text-primary); transition: transform 0.2s, box-shadow 0.2s; }
    .endpoint-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.3); }
    .endpoint-card .label { font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
    .endpoint-card .path { font-size: 1.1rem; font-weight: 600; margin-top: 4px; font-family: monospace; }
    .stats-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .stats-header h2 { font-size: 1.5rem; font-weight: 700; }
    .refresh-btn { padding: 8px 16px; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); border-radius: 8px; color: var(--primary); cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: all 0.2s; }
    .refresh-btn:hover { background: rgba(99,102,241,0.2); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 24px; }
    .stat-card { background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 16px; padding: 24px; transition: transform 0.2s; }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(0,0,0,0.4); }
    .stat-card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .stat-icon { font-size: 1.8rem; }
    .stat-card-title { font-size: 0.9rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 2.5rem; font-weight: 700; margin-bottom: 8px; }
    .stat-label { font-size: 0.85rem; color: var(--text-secondary); }
    .stat-primary { color: var(--primary); }
    .stat-success { color: var(--success); }
    .stat-danger { color: var(--danger); }
    .language-chart { background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 16px; padding: 24px; }
    .language-chart h3 { margin-bottom: 20px; font-size: 1.1rem; }
    .language-item { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .language-name { min-width: 100px; font-size: 0.9rem; font-weight: 500; }
    .language-bar-container { flex: 1; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .language-bar { height: 100%; background: linear-gradient(90deg, var(--primary), var(--primary-hover)); border-radius: 4px; transition: width 0.5s ease; }
    .language-count { min-width: 60px; text-align: right; font-size: 0.85rem; color: var(--text-secondary); }
    .error { color: var(--danger); text-align: center; padding: 40px; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
    .loading .stat-value { animation: pulse 1.5s ease-in-out infinite; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>ACE</h1>
      <p>Awesome Context Engineering &mdash; Semantic Retrieval Engine</p>
    </header>
    <div class="endpoints">
      <a class="endpoint-card" href="/health"><div class="label">Health</div><div class="path">/health</div></a>
      <a class="endpoint-card" href="/get-models"><div class="label">Models</div><div class="path">/get-models</div></a>
      <a class="endpoint-card" href="/api/dashboard/stats"><div class="label">Stats API</div><div class="path">/api/dashboard/stats</div></a>
    </div>
    <div class="stats-header">
      <h2>Dashboard</h2>
      <button class="refresh-btn" onclick="loadStats()">Refresh</button>
    </div>
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card"><div class="stat-card-header"><span class="stat-icon">⏱</span><div class="stat-card-title">Uptime</div></div><div class="stat-value stat-success" id="stat-uptime">-</div><div class="stat-label" id="stat-version">ACE Server</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-icon">📁</span><div class="stat-card-title">Indexed Files</div></div><div class="stat-value stat-primary" id="stat-files">-</div><div class="stat-label">Files in workspace</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-icon">🧩</span><div class="stat-card-title">Chunks</div></div><div class="stat-value stat-primary" id="stat-chunks">-</div><div class="stat-label">Semantic code chunks</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-icon">💾</span><div class="stat-card-title">Storage</div></div><div class="stat-value stat-primary" id="stat-size">-</div><div class="stat-label">Total DB size</div></div>
    </div>
    <div class="language-chart"><h3>Languages</h3><div id="lang-content"><div class="stat-label" style="text-align:center;padding:40px">Loading...</div></div></div>
  </div>
  <script>
    async function loadStats() {
      try {
        const r = await fetch('/api/dashboard/stats');
        if (!r.ok) throw new Error(r.statusText);
        const s = await r.json();
        document.getElementById('stat-uptime').textContent = s.system?.uptime || '-';
        document.getElementById('stat-version').textContent = s.system?.nodeVersion || 'ACE Server';
        document.getElementById('stat-files').textContent = s.index?.totalFiles ?? '-';
        document.getElementById('stat-chunks').textContent = s.index?.totalChunks ?? '-';
        document.getElementById('stat-size').textContent = s.index?.totalSize || '-';
        const langs = s.index?.languages || {};
        const entries = Object.entries(langs).sort((a,b) => b[1]-a[1]);
        const el = document.getElementById('lang-content');
        if (!entries.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">No data yet &mdash; run <code>ace index</code> first</div>'; return; }
        const max = Math.max(...entries.map(e=>e[1]));
        el.innerHTML = entries.slice(0,10).map(([name,count]) => '<div class="language-item"><div class="language-name">'+name+'</div><div class="language-bar-container"><div class="language-bar" style="width:'+(count/max*100)+'%"></div></div><div class="language-count">'+count.toLocaleString()+'</div></div>').join('');
      } catch(e) { document.getElementById('lang-content').innerHTML = '<div class="error">Failed to load stats</div>'; }
    }
    loadStats();
    setInterval(loadStats, 30000);
  </script>
</body>
</html>`);
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
