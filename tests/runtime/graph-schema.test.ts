/**
 * Graph Schema Tests
 *
 * Verify graph table initialization, idempotency, and required indexes.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initGraphTables } from '../../src/graph/schema.js';

// Test 1: Graph tables are created by initialization
const db1 = new Database(':memory:');
initGraphTables(db1);

const tables = db1
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'graph_%'")
  .all() as Array<{ name: string }>;

const tableNames = tables.map((t) => t.name).sort();
assert.deepEqual(tableNames, ['graph_edges', 'graph_index_state', 'graph_nodes']);

// Test 2: Schema initialization is idempotent
initGraphTables(db1);
initGraphTables(db1);

const tablesAfter = db1
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'graph_%'")
  .all() as Array<{ name: string }>;

assert.deepEqual(tablesAfter.map((t) => t.name).sort(), [
  'graph_edges',
  'graph_index_state',
  'graph_nodes',
]);

// Test 3: Required indexes exist
const indexes = db1
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_graph_%'")
  .all() as Array<{ name: string }>;

const indexNames = indexes.map((i) => i.name).sort();
const requiredIndexes = [
  'idx_graph_nodes_file_path',
  'idx_graph_nodes_kind',
  'idx_graph_nodes_name',
  'idx_graph_nodes_hash',
  'idx_graph_edges_from',
  'idx_graph_edges_to',
  'idx_graph_edges_kind',
  'idx_graph_edges_file_path',
  'idx_graph_edges_hash',
].sort();

assert.deepEqual(indexNames, requiredIndexes);

// Test 4: Tables have correct schema
const nodesSchema = db1.prepare("PRAGMA table_info('graph_nodes')").all() as Array<{
  name: string;
  type: string;
  notnull: number;
  pk: number;
}>;

const nodesColumns = nodesSchema.map((c) => c.name).sort();
assert.deepEqual(
  nodesColumns,
  [
    'breadcrumb',
    'end_line',
    'file_hash',
    'file_path',
    'id',
    'kind',
    'language',
    'metadata_json',
    'name',
    'signature',
    'start_line',
  ].sort(),
);

const edgesSchema = db1.prepare("PRAGMA table_info('graph_edges')").all() as Array<{
  name: string;
}>;

const edgesColumns = edgesSchema.map((c) => c.name).sort();
assert.deepEqual(
  edgesColumns,
  [
    'confidence',
    'file_hash',
    'file_path',
    'from_id',
    'id',
    'kind',
    'metadata_json',
    'to_id',
  ].sort(),
);

const indexStateSchema = db1.prepare("PRAGMA table_info('graph_index_state')").all() as Array<{
  name: string;
}>;

const indexStateColumns = indexStateSchema.map((c) => c.name).sort();
assert.deepEqual(
  indexStateColumns,
  [
    'edge_count',
    'error_message',
    'file_hash',
    'file_path',
    'indexed_at',
    'language',
    'node_count',
    'status',
  ].sort(),
);

db1.close();

console.log('✓ Graph schema tests passed');
