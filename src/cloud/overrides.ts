import type { IncomingHttpHeaders } from 'node:http';

/**
 * 支持从 Request Headers 或 Body 动态覆盖 Embedding / Reranker / Supabase 凭据
 * 允许在 MCP Client (Cursor, Windsurf, Claude Desktop, Web UI) 中动态传入 API Keys
 */
export function applyRequestOverrides(
  headers: IncomingHttpHeaders,
  payload?: Record<string, unknown>,
): void {
  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  const embKey =
    getHeader('x-embeddings-api-key') ||
    getHeader('x-embeddings-api-keys') ||
    (payload?.embeddings_api_key as string) ||
    (payload?.embeddings_api_keys as string);
  if (embKey) process.env.EMBEDDINGS_API_KEY = embKey;

  const embBase = getHeader('x-embeddings-base-url') || (payload?.embeddings_base_url as string);
  if (embBase) process.env.EMBEDDINGS_BASE_URL = embBase;

  const embModel = getHeader('x-embeddings-model') || (payload?.embeddings_model as string);
  if (embModel) process.env.EMBEDDINGS_MODEL = embModel;

  const embDim =
    getHeader('x-embeddings-dimensions') ||
    (payload?.embeddings_dimensions !== undefined
      ? String(payload.embeddings_dimensions)
      : undefined);
  if (embDim) process.env.EMBEDDINGS_DIMENSIONS = embDim;

  const rerankKey =
    getHeader('x-rerank-api-key') ||
    getHeader('x-rerank-api-keys') ||
    (payload?.rerank_api_key as string) ||
    (payload?.rerank_api_keys as string);
  if (rerankKey) process.env.RERANK_API_KEY = rerankKey;

  const rerankBase = getHeader('x-rerank-base-url') || (payload?.rerank_base_url as string);
  if (rerankBase) process.env.RERANK_BASE_URL = rerankBase;

  const rerankModel = getHeader('x-rerank-model') || (payload?.rerank_model as string);
  if (rerankModel) process.env.RERANK_MODEL = rerankModel;

  const supabaseUrl = getHeader('x-supabase-url') || (payload?.supabase_url as string);
  if (supabaseUrl) process.env.SUPABASE_URL = supabaseUrl;

  const supabaseKey =
    getHeader('x-supabase-service-role-key') ||
    getHeader('x-supabase-key') ||
    (payload?.supabase_service_role_key as string) ||
    (payload?.supabase_key as string);
  if (supabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseKey;
}
