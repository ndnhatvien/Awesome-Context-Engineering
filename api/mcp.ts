import type { IncomingMessage, ServerResponse } from 'node:http';
import '../src/config.js';
import {
  handleAgentMemory,
  handleCodebaseImpact,
  handleCodebaseRetrieval,
  handleDetectTasks,
  handleExpandChunk,
  handleGenerateCommitMessage,
} from '../src/mcp/tools/index.js';
import { logger } from '../src/utils/logger.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const MCP_TOOLS = [
  {
    name: 'codebase-retrieval',
    description:
      'PRIMARY semantic code retrieval engine using hybrid vector + lexical recall, smart cutoff, and context packing.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: {
          type: 'string',
          description: 'Absolute path or project identifier for repository.',
        },
        information_request: {
          type: 'string',
          description: 'Semantic intent or description of desired code logic.',
        },
        technical_terms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact identifiers or symbols to hard-filter.',
        },
        cost_aware_ranking: {
          type: 'boolean',
          description: 'Enable Value-per-Token density ranking (recommended).',
        },
      },
      required: ['repo_path', 'information_request'],
    },
  },
  {
    name: 'expand-chunk',
    description: 'Fetch complete uncompressed code block for a specific line span.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        start_line: { type: 'number' },
        end_line: { type: 'number' },
      },
      required: ['file_path', 'start_line', 'end_line'],
    },
  },
  {
    name: 'agent-memory',
    description:
      'Store or query persistent memories across agent sessions (failures, constraints, strategies, decisions).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['record', 'query', 'working-context'] },
        category: { type: 'string', enum: ['failure', 'constraint', 'strategy', 'decision'] },
        title: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'generate-commit-message',
    description: 'Generates semantic Git commit messages according to Conventional Commits.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_path: { type: 'string' },
      },
      required: ['repo_path'],
    },
  },
];

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Vercel Serverless Function Handler for MCP Protocol
 */
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // GET: Server Information & Discovery
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        name: 'ace-recall',
        version: '0.2.0',
        protocol: 'mcp-streamable-http',
        transport: 'serverless-http',
        tools: MCP_TOOLS.map((t) => t.name),
        status: 'ready',
      }),
    );
    return;
  }

  // POST: JSON-RPC 2.0 Handler
  if (req.method === 'POST') {
    let rpc: JsonRpcRequest;
    try {
      if (req.body && typeof req.body === 'object') {
        rpc = req.body as JsonRpcRequest;
      } else {
        const raw = await readBody(req);
        rpc = JSON.parse(raw);
      }
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }),
      );
      return;
    }

    const { id, method, params } = rpc;

    try {
      // 1. tools/list
      if (method === 'tools/list') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { tools: MCP_TOOLS },
          }),
        );
        return;
      }

      // 2. tools/call
      if (method === 'tools/call') {
        const toolName = params?.name;
        const toolArgs = params?.arguments ?? {};

        let toolResult: { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

        switch (toolName) {
          case 'codebase-retrieval':
            toolResult = await handleCodebaseRetrieval(
              toolArgs as Parameters<typeof handleCodebaseRetrieval>[0],
            );
            break;
          case 'expand-chunk':
            toolResult = await handleExpandChunk(
              toolArgs as Parameters<typeof handleExpandChunk>[0],
            );
            break;
          case 'agent-memory':
            toolResult = await handleAgentMemory(
              toolArgs as Parameters<typeof handleAgentMemory>[0],
            );
            break;
          case 'generate-commit-message':
            toolResult = await handleGenerateCommitMessage(
              toolArgs as Parameters<typeof handleGenerateCommitMessage>[0],
            );
            break;
          case 'codebase-impact':
            toolResult = await handleCodebaseImpact(
              toolArgs as Parameters<typeof handleCodebaseImpact>[0],
            );
            break;
          case 'detect-tasks':
            toolResult = await handleDetectTasks(
              toolArgs as Parameters<typeof handleDetectTasks>[0],
            );
            break;
          default:
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Tool '${toolName}' not found` },
              }),
            );
            return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: toolResult,
          }),
        );
        return;
      }

      // Method not handled
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method '${method}' not found` },
        }),
      );
    } catch (err) {
      const error = err as Error;
      logger.error({ error: error.message, stack: error.stack }, 'MCP serverless invocation error');
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: error.message },
        }),
      );
    }
  }
}
