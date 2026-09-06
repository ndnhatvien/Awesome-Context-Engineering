/**
 * Impact Graph Indexer
 *
 * Handles upsertion and deletion of graph nodes, edges, and index state.
 * Integrates with the existing self-healing file lifecycle.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type { GraphEdge, GraphIndexState, GraphIndexStatus, GraphNode } from './types.js';

/**
 * Delete all graph data for a given file path.
 * Used during file updates or deletions.
 */
export function deleteGraphDataForFile(db: Database.Database, filePath: string): void {
  db.prepare('DELETE FROM graph_nodes WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM graph_edges WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM graph_index_state WHERE file_path = ?').run(filePath);
}

/**
 * Upsert graph nodes (bulk insert/replace).
 */
export function upsertGraphNodes(db: Database.Database, nodes: GraphNode[]): void {
  if (nodes.length === 0) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO graph_nodes (
      id, kind, name, file_path, start_line, end_line,
      breadcrumb, signature, language, file_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((nodesToInsert: GraphNode[]) => {
    for (const node of nodesToInsert) {
      stmt.run(
        node.id,
        node.kind,
        node.name,
        node.filePath,
        node.startLine ?? null,
        node.endLine ?? null,
        node.breadcrumb ?? null,
        node.signature ?? null,
        node.language,
        node.fileHash,
        node.metadata ? JSON.stringify(node.metadata) : null,
      );
    }
  });

  transaction(nodes);
}

/**
 * Upsert graph edges (bulk insert/replace).
 */
export function upsertGraphEdges(db: Database.Database, edges: GraphEdge[]): void {
  if (edges.length === 0) return;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO graph_edges (
      id, from_id, to_id, kind, file_path,
      confidence, file_hash, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((edgesToInsert: GraphEdge[]) => {
    for (const edge of edgesToInsert) {
      stmt.run(
        edge.id,
        edge.fromId,
        edge.toId,
        edge.kind,
        edge.filePath,
        edge.confidence,
        edge.fileHash,
        edge.metadata ? JSON.stringify(edge.metadata) : null,
      );
    }
  });

  transaction(edges);
}

/**
 * Write graph index state for a file.
 */
export function writeGraphIndexState(db: Database.Database, state: GraphIndexState): void {
  db.prepare(`
    INSERT OR REPLACE INTO graph_index_state (
      file_path, file_hash, indexed_at, language,
      node_count, edge_count, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    state.filePath,
    state.fileHash,
    state.indexedAt,
    state.language,
    state.nodeCount,
    state.edgeCount,
    state.status,
    state.errorMessage ?? null,
  );
}

/**
 * Get graph index state for a file.
 */
export function getGraphIndexState(
  db: Database.Database,
  filePath: string,
): GraphIndexState | null {
  const row = db
    .prepare(
      `
    SELECT file_path, file_hash, indexed_at, language,
           node_count, edge_count, status, error_message
    FROM graph_index_state
    WHERE file_path = ?
  `,
    )
    .get(filePath) as
    | {
        file_path: string;
        file_hash: string;
        indexed_at: number;
        language: string;
        node_count: number;
        edge_count: number;
        status: GraphIndexStatus;
        error_message: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    filePath: row.file_path,
    fileHash: row.file_hash,
    indexedAt: row.indexed_at,
    language: row.language,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
  };
}

/**
 * Check if a file's graph is up-to-date.
 */
export function isGraphUpToDate(
  db: Database.Database,
  filePath: string,
  currentHash: string,
): boolean {
  const state = getGraphIndexState(db, filePath);
  if (!state) return false;
  return state.fileHash === currentHash && state.status === 'indexed';
}

/**
 * Index a file's graph data.
 * This is the main entry point for graph extraction.
 *
 * @param db Database connection
 * @param filePath File path
 * @param fileHash File hash
 * @param language File language
 * @param source File source code
 * @returns true if indexing succeeded, false otherwise
 */
export async function indexFileGraph(
  db: Database.Database,
  filePath: string,
  fileHash: string,
  language: string,
  source: string,
): Promise<boolean> {
  // Only process TypeScript/JavaScript for MVP
  const supportedLanguages = ['typescript', 'javascript', 'tsx', 'jsx'];
  if (!supportedLanguages.includes(language.toLowerCase())) {
    // Write skip status
    writeGraphIndexState(db, {
      filePath,
      fileHash,
      indexedAt: Date.now(),
      language,
      nodeCount: 0,
      edgeCount: 0,
      status: 'skipped',
    });
    return true; // Not an error, just skipped
  }

  try {
    // Import extractor dynamically
    const { extractTsJsGraph } = await import('./extractors/tsJsExtractor.js');

    // Extract graph data
    const result = await extractTsJsGraph({
      filePath,
      language: language.toLowerCase() as 'typescript' | 'javascript' | 'tsx' | 'jsx',
      source,
      fileHash,
    });

    // Log diagnostics if any
    for (const diag of result.diagnostics) {
      logger.debug({ filePath, diagnostic: diag }, 'Graph extraction diagnostic');
    }

    // Delete old graph data for this file
    deleteGraphDataForFile(db, filePath);

    // Upsert new nodes and edges
    upsertGraphNodes(db, result.nodes);
    upsertGraphEdges(db, result.edges);

    // Write success state
    writeGraphIndexState(db, {
      filePath,
      fileHash,
      indexedAt: Date.now(),
      language,
      nodeCount: result.nodes.length,
      edgeCount: result.edges.length,
      status: 'indexed',
    });

    logger.debug(
      { filePath, nodes: result.nodes.length, edges: result.edges.length },
      'Graph indexed successfully',
    );

    return true;
  } catch (error) {
    const err = error as Error;
    logger.warn({ filePath, error: err.message }, 'Graph extraction failed (best-effort)');

    // Write error state
    writeGraphIndexState(db, {
      filePath,
      fileHash,
      indexedAt: Date.now(),
      language,
      nodeCount: 0,
      edgeCount: 0,
      status: 'error',
      errorMessage: err.message,
    });

    // Return true to not break the indexing pipeline
    return true;
  }
}

/**
 * Get all graph nodes for a file.
 */
export function getGraphNodesForFile(db: Database.Database, filePath: string): GraphNode[] {
  const rows = db
    .prepare(
      `
    SELECT id, kind, name, file_path, start_line, end_line,
           breadcrumb, signature, language, file_hash, metadata_json
    FROM graph_nodes
    WHERE file_path = ?
  `,
    )
    .all(filePath) as Array<{
    id: string;
    kind: string;
    name: string;
    file_path: string;
    start_line: number | null;
    end_line: number | null;
    breadcrumb: string | null;
    signature: string | null;
    language: string;
    file_hash: string;
    metadata_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as GraphNode['kind'],
    name: row.name,
    filePath: row.file_path,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    breadcrumb: row.breadcrumb ?? undefined,
    signature: row.signature ?? undefined,
    language: row.language,
    fileHash: row.file_hash,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  }));
}

/**
 * Get all graph edges for a file.
 */
export function getGraphEdgesForFile(db: Database.Database, filePath: string): GraphEdge[] {
  const rows = db
    .prepare(
      `
    SELECT id, from_id, to_id, kind, file_path,
           confidence, file_hash, metadata_json
    FROM graph_edges
    WHERE file_path = ?
  `,
    )
    .all(filePath) as Array<{
    id: string;
    from_id: string;
    to_id: string;
    kind: string;
    file_path: string;
    confidence: string;
    file_hash: string;
    metadata_json: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    kind: row.kind as GraphEdge['kind'],
    filePath: row.file_path,
    confidence: row.confidence as GraphEdge['confidence'],
    fileHash: row.file_hash,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  }));
}
