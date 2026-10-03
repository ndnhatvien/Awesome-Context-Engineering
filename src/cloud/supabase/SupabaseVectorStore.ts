/**
 * SupabaseVectorStore - pgvector Adapter for Cloud / Vercel
 *
 * Implements vector storage and similarity retrieval using Supabase PostgreSQL + pgvector.
 * Matches the VectorStore interface, allowing seamless switching from local LanceDB
 * to cloud-hosted pgvector without any changes to SearchService or retrieval pipeline.
 */

import type { ChunkRecord, SearchResult } from '../../vectorStore/index.js';
import { SupabaseClient } from './supabaseClient.js';
import type { MatchCodeChunksParams, SupabaseChunkRow, SupabaseConfig } from './types.js';

export class SupabaseVectorStore {
  private client: SupabaseClient;
  private projectId: string;
  private tableName: string;

  constructor(projectId: string, config: SupabaseConfig, tableName = 'code_chunks') {
    this.projectId = projectId;
    this.tableName = tableName;
    this.client = new SupabaseClient(config);
  }

  /**
   * Initializes the vector store connection / verification.
   */
  async init(): Promise<void> {
    // Lightweight ping to verify credentials
    try {
      await this.client.count(this.tableName, { limit: '1' });
    } catch (err) {
      const error = err as Error;
      // Do not crash during init if table is yet to be populated
      console.warn(
        `[SupabaseVectorStore] Connection warning for ${this.projectId}: ${error.message}`,
      );
    }
  }

  /**
   * Inserts or upserts chunk records into the Supabase code_chunks table.
   */
  async insert(records: ChunkRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Batch records in groups of 100 to avoid payload limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = batch.map((r) => ({
        chunk_id: r.chunk_id,
        project_id: this.projectId,
        file_path: r.file_path,
        file_hash: r.file_hash,
        chunk_index: r.chunk_index,
        embedding: r.vector, // PostgREST pgvector accepts numeric array
        display_code: r.display_code,
        vector_text: r.vector_text,
        language: r.language,
        breadcrumb: r.breadcrumb,
        start_index: r.start_index,
        end_index: r.end_index,
        raw_start: r.raw_start,
        raw_end: r.raw_end,
        vec_start: r.vec_start,
        vec_end: r.vec_end,
        updated_at: new Date().toISOString(),
      }));

      await this.client.insert(this.tableName, rows, { upsert: true });
    }
  }

  /**
   * Performs vector similarity search via Supabase RPC match_code_chunks.
   */
  async search(vector: number[], topK = 10, filter?: string): Promise<SearchResult[]> {
    const params: MatchCodeChunksParams = {
      query_embedding: vector,
      match_count: topK,
      filter_project_id: this.projectId,
    };

    // Extract language filter if present (e.g., "language = 'typescript'")
    if (filter) {
      const langMatch = filter.match(/language\s*=\s*'([^']+)'/i);
      if (langMatch) {
        params.filter_language = langMatch[1];
      }
    }

    const rows = await this.client.rpc<SupabaseChunkRow[]>(
      'match_code_chunks',
      params as unknown as Record<string, unknown>,
    );

    return rows.map((row) => {
      const similarity = row.similarity ?? 0.0;
      // Convert cosine similarity ([-1, 1] -> distance >= 0)
      const distance = Math.max(0, 1 - similarity);

      return {
        chunk_id: row.chunk_id,
        file_path: row.file_path,
        file_hash: row.file_hash,
        chunk_index: row.chunk_index,
        vector: Array.isArray(row.embedding) ? row.embedding : [],
        display_code: row.display_code,
        vector_text: row.vector_text,
        language: row.language,
        breadcrumb: row.breadcrumb,
        start_index: row.start_index,
        end_index: row.end_index,
        raw_start: row.raw_start,
        raw_end: row.raw_end,
        vec_start: row.vec_start,
        vec_end: row.vec_end,
        _distance: distance,
      };
    });
  }

  /**
   * Batch upserts chunk records grouped by file.
   */
  async batchUpsertFiles(
    files: Array<{ path: string; hash: string; records: ChunkRecord[] }>,
  ): Promise<void> {
    const allRecords: ChunkRecord[] = [];
    const deleteFilesList: string[] = [];

    for (const f of files) {
      if (f.records.length > 0) {
        allRecords.push(...f.records);
      } else {
        deleteFilesList.push(f.path);
      }
    }

    if (deleteFilesList.length > 0) {
      await this.deleteFiles(deleteFilesList);
    }

    if (allRecords.length > 0) {
      await this.insert(allRecords);
    }
  }

  /**
   * Deletes all chunks for a single file.
   */
  async deleteFile(filePath: string): Promise<void> {
    await this.deleteByFilePath(filePath);
  }

  /**
   * Deletes all chunks for multiple files.
   */
  async deleteFiles(filePaths: string[]): Promise<void> {
    await this.deleteByFilePaths(filePaths);
  }

  /**
   * Deletes all chunks for a given file path in the project.
   */
  async deleteByFilePath(filePath: string): Promise<void> {
    await this.client.delete(this.tableName, {
      project_id: `eq.${this.projectId}`,
      file_path: `eq.${filePath}`,
    });
  }

  /**
   * Deletes all chunks for a list of file paths.
   */
  async deleteByFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const escaped = filePaths.map((p) => `"${p.replace(/"/g, '""')}"`).join(',');
    await this.client.delete(this.tableName, {
      project_id: `eq.${this.projectId}`,
      file_path: `in.(${escaped})`,
    });
  }

  /**
   * Retrieves all chunks for a specific file path (alias for getFileChunks).
   */
  async getFileChunks(filePath: string): Promise<ChunkRecord[]> {
    return this.getChunksByFilePath(filePath);
  }

  /**
   * Batch retrieves chunks for multiple files, mapped by file path.
   */
  async getFilesChunks(filePaths: string[]): Promise<Map<string, ChunkRecord[]>> {
    const result = new Map<string, ChunkRecord[]>();
    if (filePaths.length === 0) return result;

    const escaped = filePaths.map((p) => `"${p.replace(/"/g, '""')}"`).join(',');
    const rows = await this.client.select<SupabaseChunkRow>(this.tableName, {
      project_id: `eq.${this.projectId}`,
      file_path: `in.(${escaped})`,
      order: 'chunk_index.asc',
    });

    for (const row of rows) {
      const record: ChunkRecord = {
        chunk_id: row.chunk_id,
        file_path: row.file_path,
        file_hash: row.file_hash,
        chunk_index: row.chunk_index,
        vector: Array.isArray(row.embedding) ? row.embedding : [],
        display_code: row.display_code,
        vector_text: row.vector_text,
        language: row.language,
        breadcrumb: row.breadcrumb,
        start_index: row.start_index,
        end_index: row.end_index,
        raw_start: row.raw_start,
        raw_end: row.raw_end,
        vec_start: row.vec_start,
        vec_end: row.vec_end,
      };

      let list = result.get(row.file_path);
      if (!list) {
        list = [];
        result.set(row.file_path, list);
      }
      list.push(record);
    }

    return result;
  }

  /**
   * Retrieves all chunks for a specific file path.
   */
  async getChunksByFilePath(filePath: string): Promise<ChunkRecord[]> {
    const rows = await this.client.select<SupabaseChunkRow>(this.tableName, {
      project_id: `eq.${this.projectId}`,
      file_path: `eq.${filePath}`,
      order: 'chunk_index.asc',
    });

    return rows.map((row) => ({
      chunk_id: row.chunk_id,
      file_path: row.file_path,
      file_hash: row.file_hash,
      chunk_index: row.chunk_index,
      vector: Array.isArray(row.embedding) ? row.embedding : [],
      display_code: row.display_code,
      vector_text: row.vector_text,
      language: row.language,
      breadcrumb: row.breadcrumb,
      start_index: row.start_index,
      end_index: row.end_index,
      raw_start: row.raw_start,
      raw_end: row.raw_end,
      vec_start: row.vec_start,
      vec_end: row.vec_end,
    }));
  }

  /**
   * Retrieves all chunk IDs for this project.
   */
  async getAllChunkIds(): Promise<string[]> {
    const rows = await this.client.select<{ chunk_id: string }>(this.tableName, {
      project_id: `eq.${this.projectId}`,
      select: 'chunk_id',
    });
    return rows.map((r) => r.chunk_id);
  }

  /**
   * Counts total chunks stored for this project.
   */
  async count(): Promise<number> {
    return await this.client.count(this.tableName, {
      project_id: `eq.${this.projectId}`,
    });
  }

  /**
   * Clears all chunks for this project.
   */
  async clear(): Promise<void> {
    await this.client.delete(this.tableName, {
      project_id: `eq.${this.projectId}`,
    });
  }

  /**
   * Closes the vector store (stateless HTTP connection).
   */
  async close(): Promise<void> {
    // No-op for HTTP-based Supabase client
  }
}
