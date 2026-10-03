/**
 * Supabase / pgvector Cloud Types
 */

export interface SupabaseConfig {
  /** Supabase project URL (e.g. https://xyzcompany.supabase.co) */
  url: string;
  /** Supabase service_role or anon key */
  key: string;
  /** Schema name (default: public) */
  schema?: string;
  /** Request timeout in ms (default: 15000) */
  timeoutMs?: number;
}

export interface SupabaseChunkRow {
  chunk_id: string;
  project_id: string;
  file_path: string;
  file_hash: string;
  chunk_index: number;
  embedding?: number[] | string;
  display_code: string;
  vector_text: string;
  language: string;
  breadcrumb: string;
  start_index: number;
  end_index: number;
  raw_start: number;
  raw_end: number;
  vec_start: number;
  vec_end: number;
  created_at?: string;
  updated_at?: string;
  similarity?: number;
}

export interface MatchCodeChunksParams {
  query_embedding: number[];
  match_count?: number;
  filter_project_id?: string;
  filter_language?: string;
}

export interface HybridSearchChunksParams {
  query_embedding: number[];
  query_text: string;
  match_count?: number;
  filter_project_id?: string;
  rrf_k?: number;
}
