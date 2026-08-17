/**
 * Indexer module - stub to satisfy imports
 *
 * This module provides placeholder exports for the indexer functionality.
 * Currently not implemented but referenced by other modules.
 */

import type Database from 'better-sqlite3';
import type { ProcessResult } from '../scanner/processor.js';
import type { SearchResult } from '../vectorStore/index.js';

export interface Indexer {
  clear(): Promise<void>;
  resetEmbeddingClient(): void;
  indexFiles(
    db: Database.Database,
    files: ProcessResult[],
    onProgress?: (completed: number, total: number) => void,
  ): Promise<{ indexed: number; deleted: number; errors: number }>;
  textSearch(
    query: string,
    topK: number,
    filter?: string,
  ): Promise<SearchResult[]>;
}

export async function getIndexer(_projectId: string, _dimensions: number): Promise<Indexer | null> {
  return null;
}

export function closeIndexer(_projectId: string): void {
  // No-op
}

export function closeAllIndexers(): void {
  // No-op
}
