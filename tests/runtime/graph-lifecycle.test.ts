/**
 * Graph Lifecycle Tests
 *
 * Verify graph indexing lifecycle: add, modify, delete operations.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  deleteGraphDataForFile,
  getGraphEdgesForFile,
  getGraphIndexState,
  getGraphNodesForFile,
  indexFileGraph,
} from '../../src/graph/indexer.js';
import { initGraphTables } from '../../src/graph/schema.js';

// Initialize test database
const db = new Database(':memory:');
initGraphTables(db);

// Test source code
const testSource = `
import { helper } from './helper';

export function testFunction() {
  return helper();
}

export class TestClass {
  testMethod() {
    testFunction();
  }
}
`;

// Test 1: Added file inserts graph nodes/edges/state
const indexed1 = await indexFileGraph(db, 'src/test.ts', 'hash123', 'typescript', testSource);

assert.equal(indexed1, true, 'Indexing should succeed');

// Check nodes were inserted
const nodes1 = getGraphNodesForFile(db, 'src/test.ts');
assert(nodes1.length > 0, 'Should insert nodes');

const fileNode = nodes1.find((n) => n.kind === 'file');
assert(fileNode, 'Should have file node');

const functionNode = nodes1.find((n) => n.kind === 'function' && n.name === 'testFunction');
assert(functionNode, 'Should have testFunction node');

const classNode = nodes1.find((n) => n.kind === 'class' && n.name === 'TestClass');
assert(classNode, 'Should have TestClass node');

// Check edges were inserted
const edges1 = getGraphEdgesForFile(db, 'src/test.ts');
assert(edges1.length > 0, 'Should insert edges');

const importEdge = edges1.find((e) => e.kind === 'imports');
assert(importEdge, 'Should have import edge');

const containsEdges = edges1.filter((e) => e.kind === 'contains');
assert(containsEdges.length >= 2, 'Should have contains edges');

// Check index state was recorded
const state1 = getGraphIndexState(db, 'src/test.ts');
assert(state1, 'Should have index state');
assert.equal(state1.status, 'indexed', 'Status should be indexed');
assert.equal(state1.fileHash, 'hash123', 'Hash should match');
assert(state1.nodeCount > 0, 'Node count should be recorded');
assert(state1.edgeCount > 0, 'Edge count should be recorded');

// Test 2: Modified file removes old graph rows and inserts new hash rows
const modifiedSource = `
export function testFunction() {
  return 'modified';
}

export function newFunction() {
  testFunction();
}
`;

const indexed2 = await indexFileGraph(db, 'src/test.ts', 'hash456', 'typescript', modifiedSource);

assert.equal(indexed2, true, 'Re-indexing should succeed');

// Check nodes were updated
const nodes2 = getGraphNodesForFile(db, 'src/test.ts');
assert(nodes2.length > 0, 'Should have nodes after update');

// Old class should be gone
const oldClass = nodes2.find((n) => n.kind === 'class' && n.name === 'TestClass');
assert.equal(oldClass, undefined, 'Old TestClass should be removed');

// New function should exist
const newFunc = nodes2.find((n) => n.kind === 'function' && n.name === 'newFunction');
assert(newFunc, 'New newFunction should be added');

// testFunction should still exist
const stillFunc = nodes2.find((n) => n.kind === 'function' && n.name === 'testFunction');
assert(stillFunc, 'testFunction should still exist');

// Check all nodes have the new hash
for (const node of nodes2) {
  assert.equal(node.fileHash, 'hash456', 'All nodes should have new hash');
}

// Check index state was updated
const state2 = getGraphIndexState(db, 'src/test.ts');
assert(state2, 'Should have updated index state');
assert.equal(state2.fileHash, 'hash456', 'Hash should be updated');

// Test 3: Deleted file removes all graph data
deleteGraphDataForFile(db, 'src/test.ts');

const nodesAfterDelete = getGraphNodesForFile(db, 'src/test.ts');
assert.equal(nodesAfterDelete.length, 0, 'All nodes should be deleted');

const edgesAfterDelete = getGraphEdgesForFile(db, 'src/test.ts');
assert.equal(edgesAfterDelete.length, 0, 'All edges should be deleted');

const stateAfterDelete = getGraphIndexState(db, 'src/test.ts');
assert.equal(stateAfterDelete, null, 'Index state should be deleted');

// Test 4: Non-TS/JS files are skipped
const skipped = await indexFileGraph(db, 'src/test.py', 'hash789', 'python', 'def test(): pass');

assert.equal(skipped, true, 'Non-TS/JS files should return true (skipped)');

const pythonState = getGraphIndexState(db, 'src/test.py');
assert(pythonState, 'Should have index state for skipped file');
assert.equal(pythonState.status, 'skipped', 'Status should be skipped');
assert.equal(pythonState.nodeCount, 0, 'Node count should be 0 for skipped');

// Test 5: Error handling - invalid syntax
const invalidSource = 'export function broken(';

const errorResult = await indexFileGraph(
  db,
  'src/error.ts',
  'hasherr',
  'typescript',
  invalidSource,
);

// Should still return true (best-effort)
assert.equal(errorResult, true, 'Error should not fail indexing (best-effort)');

const errorState = getGraphIndexState(db, 'src/error.ts');
assert(errorState, 'Should have index state for error case');
// Note: parser might still extract some nodes despite syntax error, so we don't strictly check status

db.close();

console.log('✓ Graph lifecycle tests passed');
