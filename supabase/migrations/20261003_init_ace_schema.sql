-- ============================================================================
-- ACE (Awesome Context Engineering) - Supabase / pgvector Schema Migration
-- ============================================================================

-- 1. Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Create code_chunks table for high-dimensional semantic code chunks
CREATE TABLE IF NOT EXISTS public.code_chunks (
  chunk_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(1024), -- Dimension matches EMBEDDINGS_DIMENSIONS (default 1024)
  display_code TEXT NOT NULL,
  vector_text TEXT NOT NULL,
  language TEXT NOT NULL,
  breadcrumb TEXT NOT NULL,
  start_index INTEGER NOT NULL DEFAULT 0,
  end_index INTEGER NOT NULL DEFAULT 0,
  raw_start INTEGER NOT NULL DEFAULT 0,
  raw_end INTEGER NOT NULL DEFAULT 0,
  vec_start INTEGER NOT NULL DEFAULT 0,
  vec_end INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for project filtering, file deletions, and vector/lexical retrieval
CREATE INDEX IF NOT EXISTS idx_code_chunks_project_id 
  ON public.code_chunks(project_id);

CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path 
  ON public.code_chunks(project_id, file_path);

-- HNSW Vector Index for sub-millisecond approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_hnsw 
  ON public.code_chunks USING hnsw (embedding vector_cosine_ops);

-- GIN Trigram Index for fast lexical full-text search matching
CREATE INDEX IF NOT EXISTS idx_code_chunks_vector_text_trgm 
  ON public.code_chunks USING gin (vector_text gin_trgm_ops);

-- 3. Create agent_memories table for 4-layer persistent agent memory
CREATE TABLE IF NOT EXISTS public.agent_memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('failure', 'constraint', 'strategy', 'decision')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  related_files TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_project_id 
  ON public.agent_memories(project_id);

CREATE INDEX IF NOT EXISTS idx_agent_memories_category 
  ON public.agent_memories(project_id, category);

-- 4. Create token_savings_ledger table for ROI tracking
CREATE TABLE IF NOT EXISTS public.token_savings_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tokens_saved INTEGER NOT NULL,
  model TEXT NOT NULL,
  usd_saved NUMERIC(10, 6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_savings_project_id 
  ON public.token_savings_ledger(project_id);

-- 5. RPC Function: match_code_chunks (Vector Cosine Similarity)
CREATE OR REPLACE FUNCTION public.match_code_chunks(
  query_embedding vector(1024),
  match_count INT DEFAULT 10,
  filter_project_id TEXT DEFAULT NULL,
  filter_language TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  project_id TEXT,
  file_path TEXT,
  file_hash TEXT,
  chunk_index INT,
  display_code TEXT,
  vector_text TEXT,
  language TEXT,
  breadcrumb TEXT,
  start_index INT,
  end_index INT,
  raw_start INT,
  raw_end INT,
  vec_start INT,
  vec_end INT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.chunk_id,
    c.project_id,
    c.file_path,
    c.file_hash,
    c.chunk_index,
    c.display_code,
    c.vector_text,
    c.language,
    c.breadcrumb,
    c.start_index,
    c.end_index,
    c.raw_start,
    c.raw_end,
    c.vec_start,
    c.vec_end,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.code_chunks c
  WHERE (filter_project_id IS NULL OR c.project_id = filter_project_id)
    AND (filter_language IS NULL OR c.language = filter_language)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 6. RPC Function: hybrid_search_chunks (Reciprocal Rank Fusion in SQL)
CREATE OR REPLACE FUNCTION public.hybrid_search_chunks(
  query_embedding vector(1024),
  query_text TEXT,
  match_count INT DEFAULT 20,
  filter_project_id TEXT DEFAULT NULL,
  rrf_k INT DEFAULT 60
)
RETURNS TABLE (
  chunk_id TEXT,
  project_id TEXT,
  file_path TEXT,
  file_hash TEXT,
  chunk_index INT,
  display_code TEXT,
  vector_text TEXT,
  language TEXT,
  breadcrumb TEXT,
  start_index INT,
  end_index INT,
  raw_start INT,
  raw_end INT,
  vec_start INT,
  vec_end INT,
  similarity FLOAT,
  rrf_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH vector_ranks AS (
    SELECT
      c.chunk_id,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rank_vec,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS vec_sim
    FROM public.code_chunks c
    WHERE (filter_project_id IS NULL OR c.project_id = filter_project_id)
    LIMIT match_count * 2
  ),
  lexical_ranks AS (
    SELECT
      c.chunk_id,
      ROW_NUMBER() OVER (ORDER BY similarity(c.vector_text, query_text) DESC) AS rank_lex
    FROM public.code_chunks c
    WHERE (filter_project_id IS NULL OR c.project_id = filter_project_id)
      AND c.vector_text % query_text
    LIMIT match_count * 2
  ),
  fused AS (
    SELECT
      COALESCE(v.chunk_id, l.chunk_id) AS chunk_id,
      COALESCE(v.vec_sim, 0.0) AS sim,
      (COALESCE(1.0 / (rrf_k + v.rank_vec), 0.0) + COALESCE(1.0 / (rrf_k + l.rank_lex), 0.0))::FLOAT AS score
    FROM vector_ranks v
    FULL OUTER JOIN lexical_ranks l ON v.chunk_id = l.chunk_id
  )
  SELECT
    c.chunk_id,
    c.project_id,
    c.file_path,
    c.file_hash,
    c.chunk_index,
    c.display_code,
    c.vector_text,
    c.language,
    c.breadcrumb,
    c.start_index,
    c.end_index,
    c.raw_start,
    c.raw_end,
    c.vec_start,
    c.vec_end,
    f.sim AS similarity,
    f.score AS rrf_score
  FROM fused f
  JOIN public.code_chunks c ON c.chunk_id = f.chunk_id
  ORDER BY f.score DESC
  LIMIT match_count;
END;
$$;
