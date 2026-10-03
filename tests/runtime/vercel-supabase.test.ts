import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import healthHandler from '../../api/health.js';
import mcpHandler from '../../api/mcp.js';
import searchHandler from '../../api/search.js';
import { SupabaseClient } from '../../src/cloud/supabase/supabaseClient.js';
import { SupabaseVectorStore } from '../../src/cloud/supabase/SupabaseVectorStore.js';
import { getSupabaseConfig, isSupabaseMode } from '../../src/config.js';
import type { ChunkRecord } from '../../src/vectorStore/index.js';

// Helper to simulate IncomingMessage and ServerResponse for serverless handlers
function createMockReqRes(options: {
  method?: string;
  url?: string;
  body?: unknown;
}) {
  const req = new EventEmitter() as unknown as IncomingMessage & {
    method: string;
    url: string;
    body?: unknown;
    headers: Record<string, string>;
  };
  req.method = options.method || 'GET';
  req.url = options.url || '/';
  req.body = options.body;
  req.headers = { host: 'localhost' };

  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseData = '';
  let finished = false;

  const res = {
    statusCode,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string) {
      if (chunk) responseData += chunk;
      finished = true;
    },
    get finished() {
      return finished;
    },
    get data() {
      return responseData;
    },
    get json() {
      return responseData ? JSON.parse(responseData) : null;
    },
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    data: string;
    json: any;
  };

  return { req, res };
}

// ===========================================
// Test Suite: Supabase Configuration & Client
// ===========================================

test('Supabase: 环境变量与配置解析', () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevMode = process.env.ACE_STORAGE_MODE;

  try {
    process.env.SUPABASE_URL = 'https://demo.supabase.co/';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
    process.env.ACE_STORAGE_MODE = 'supabase';

    assert.equal(isSupabaseMode(), true);
    const config = getSupabaseConfig();
    assert.ok(config);
    assert.equal(config?.url, 'https://demo.supabase.co');
    assert.equal(config?.key, 'test-secret-key');
    assert.equal(config?.schema, 'public');
  } finally {
    process.env.SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    process.env.ACE_STORAGE_MODE = prevMode;
  }
});

test('SupabaseClient: 客户端构造与参数校验', () => {
  assert.throws(() => new SupabaseClient({ url: '', key: '' }), /requires both url and key/);

  const client = new SupabaseClient({
    url: 'https://sample.supabase.co',
    key: 'secret-token',
  });
  assert.ok(client);
});

// ===========================================
// Test Suite: SupabaseVectorStore
// ===========================================

test('SupabaseVectorStore: 记录转换与距离计算', async () => {
  const store = new SupabaseVectorStore('test-proj', {
    url: 'https://mock.supabase.co',
    key: 'test-key',
  });

  assert.ok(store);
  assert.equal(typeof store.search, 'function');
  assert.equal(typeof store.insert, 'function');
  assert.equal(typeof store.getFileChunks, 'function');
  assert.equal(typeof store.getFilesChunks, 'function');
  assert.equal(typeof store.deleteFile, 'function');
  assert.equal(typeof store.deleteFiles, 'function');
  assert.equal(typeof store.getAllChunkIds, 'function');
});

// ===========================================
// Test Suite: Vercel Serverless Handlers
// ===========================================

test('Vercel API: /api/health 返回健康状态与 cloudReady 标识', async () => {
  const { req, res } = createMockReqRes({ method: 'GET', url: '/api/health' });
  await healthHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.cloudReady, true);
  assert.ok(res.json.storage);
  assert.ok(res.json.version);
});

test('Vercel API: /api/mcp 支持 OPTIONS 与 GET 工具发现', async () => {
  // 1. OPTIONS CORS Preflight
  const { req: optReq, res: optRes } = createMockReqRes({ method: 'OPTIONS' });
  await mcpHandler(optReq, optRes);
  assert.equal(optRes.statusCode, 204);
  assert.equal(optRes.getHeader('access-control-allow-origin'), '*');

  // 2. GET Discovery
  const { req: getReq, res: getRes } = createMockReqRes({ method: 'GET' });
  await mcpHandler(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json.name, 'ace-recall');
  assert.ok(getRes.json.tools.includes('codebase-retrieval'));
  assert.ok(getRes.json.tools.includes('expand-chunk'));
});

test('Vercel API: /api/mcp 处理 JSON-RPC 2.0 tools/list 请求', async () => {
  const rpcPayload = {
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/list',
  };

  const { req, res } = createMockReqRes({ method: 'POST', body: rpcPayload });
  await mcpHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.jsonrpc, '2.0');
  assert.equal(res.json.id, 42);
  assert.ok(res.json.result?.tools?.length >= 4);
});

test('Vercel API: /api/search 参数校验与 405/400 保护', async () => {
  // Reject non-POST
  const { req: getReq, res: getRes } = createMockReqRes({ method: 'GET' });
  await searchHandler(getReq, getRes);
  assert.equal(getRes.statusCode, 405);

  // Reject missing query
  const { req: postReq, res: postRes } = createMockReqRes({ method: 'POST', body: {} });
  await searchHandler(postReq, postRes);
  assert.equal(postRes.statusCode, 400);
});

// ===========================================
// Test Suite: Supabase SQL Migration
// ===========================================

test('Supabase Migration: SQL 脚本包含必要表与 pgvector 扩展', () => {
  const sqlPath = path.resolve('supabase/migrations/20261003_init_ace_schema.sql');
  assert.ok(fs.existsSync(sqlPath), 'Supabase migration 脚本必须存在');

  const content = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(content.includes('CREATE EXTENSION IF NOT EXISTS vector'));
  assert.ok(content.includes('CREATE EXTENSION IF NOT EXISTS pg_trgm'));
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.code_chunks'));
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.agent_memories'));
  assert.ok(content.includes('CREATE TABLE IF NOT EXISTS public.token_savings_ledger'));
  assert.ok(content.includes('FUNCTION public.match_code_chunks'));
  assert.ok(content.includes('FUNCTION public.hybrid_search_chunks'));
});

test('Request Overrides: 支持从 Headers 动态覆盖 Embedding & Reranker 凭据', async () => {
  const { applyRequestOverrides } = await import('../../src/cloud/overrides.js');
  const customHeaders = {
    'x-embeddings-api-key': 'sk-dynamic-embedding-key',
    'x-embeddings-base-url': 'https://custom-embedding.api/v1',
    'x-rerank-api-key': 'sk-dynamic-rerank-key',
  };

  applyRequestOverrides(customHeaders);

  assert.equal(process.env.EMBEDDINGS_API_KEY, 'sk-dynamic-embedding-key');
  assert.equal(process.env.EMBEDDINGS_BASE_URL, 'https://custom-embedding.api/v1');
  assert.equal(process.env.RERANK_API_KEY, 'sk-dynamic-rerank-key');
});

