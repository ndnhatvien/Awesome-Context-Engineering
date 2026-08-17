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

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: SERVER_VERSION,
    });
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
