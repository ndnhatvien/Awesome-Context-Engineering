import type { IncomingMessage, ServerResponse } from 'node:http';
import '../src/config.js';
import { applyRequestOverrides } from '../src/cloud/overrides.js';
import { handleCodebaseRetrieval } from '../src/mcp/tools/codebaseRetrieval.js';
import { logger } from '../src/utils/logger.js';

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
 * Vercel Serverless Function Handler for REST Semantic Search
 */
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, apikey, x-embeddings-api-key, x-embeddings-base-url, x-embeddings-model, x-embeddings-dimensions, x-rerank-api-key, x-rerank-base-url, x-rerank-model, x-supabase-url, x-supabase-key, x-supabase-service-role-key',
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method Not Allowed, use POST' }));
    return;
  }

  try {
    let payload: Record<string, unknown> = {};
    if (req.body && typeof req.body === 'object') {
      payload = req.body as Record<string, unknown>;
    } else {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    }

    applyRequestOverrides(req.headers, payload);

    const query =
      (payload.information_request as string) ||
      (payload.query as string) ||
      (payload.q as string) ||
      (typeof payload.message === 'string' ? payload.message : '');

    if (!query) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing information_request or query parameter' }));
      return;
    }

    const repoPath =
      (payload.repo_path as string) ||
      (payload.project_id as string) ||
      (payload.workspace_root as string) ||
      (payload.workspacePath as string) ||
      process.cwd();
    const technicalTerms = Array.isArray(payload.technical_terms)
      ? (payload.technical_terms as string[])
      : undefined;

    const result = await handleCodebaseRetrieval({
      repo_path: repoPath,
      information_request: query,
      technical_terms: technicalTerms,
      cost_aware_ranking: Boolean(payload.cost_aware_ranking ?? true),
      response_mode:
        (payload.response_mode as 'overview' | 'raw' | 'skeleton' | undefined) || 'overview',
    });

    const text = result.content?.[0]?.text || '';
    res.statusCode = result.isError ? 500 : 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ...result,
        status: result.isError ? 'error' : 'ok',
        formatted_retrieval: text,
        formattedRetrieval: text,
        result: text,
      }),
    );
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message }, 'API Search Error');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
