/**
 * Impact Graph Schema
 *
 * SQLite schema initialization for graph_nodes, graph_edges, and graph_index_state tables.
 * Tables are created idempotently and support per-file hash-based self-healing.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

/**
 * Initialize graph tables in the project SQLite database.
 *
 * Creates tables and indexes idempotently. Safe to call multiple times.
 * Should be called from initDb() in src/db/index.ts.
 */
export function initGraphTables(db: Database.Database): void {
  // Create graph_nodes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      breadcrumb TEXT,
      signature TEXT,
      language TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      metadata_json TEXT
    )
  `);

  // Create graph_edges table
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      confidence TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      metadata_json TEXT
    )
  `);

  // Create graph_index_state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_index_state (
      file_path TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      language TEXT NOT NULL,
      node_count INTEGER NOT NULL,
      edge_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT
    )
  `);

  // Create indexes for graph_nodes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_file_path ON graph_nodes(file_path);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind ON graph_nodes(kind);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(name);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_hash ON graph_nodes(file_hash);
  `);

  // Create indexes for graph_edges
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_kind ON graph_edges(kind);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_file_path ON graph_edges(file_path);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_hash ON graph_edges(file_hash);
  `);

  logger.debug('Graph tables initialized');
}

/**
 * Check if graph tables exist and are initialized.
 */
export function isGraphInitialized(db: Database.Database): boolean {
  const tables = db
    .prepare(
      `
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('graph_nodes', 'graph_edges', 'graph_index_state')
    `,
    )
    .all() as Array<{ name: string }>;

  return tables.length === 3;
}
