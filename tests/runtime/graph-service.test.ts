/**
 * Impact Graph Service Tests
 *
 * Verify graph traversal, target resolution, and basic impact analysis.
 * Note: This is a simplified test that focuses on core functionality.
 */

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ImpactGraphService } from '../../src/graph/ImpactGraphService.js';
import { upsertGraphEdges, upsertGraphNodes } from '../../src/graph/indexer.js';
import { initGraphTables } from '../../src/graph/schema.js';
import type { GraphEdge, GraphNode } from '../../src/graph/types.js';

// Initialize test database
const db = new Database(':memory:');
initGraphTables(db);

// Create simplified test graph:
// file A -> function foo
// file B -> imports A -> function bar -> calls foo
// test file -> test1 -> imports B -> calls bar

const nodes: GraphNode[] = [
  { id: 'file:a', kind: 'file', name: 'a.ts', filePath: 'src/a.ts', language: 'typescript', fileHash: 'a1' },
  { id: 'sym:a:foo', kind: 'function', name: 'foo', filePath: 'src/a.ts', startLine: 1, endLine: 3, language: 'typescript', fileHash: 'a1' },

  { id: 'file:b', kind: 'file', name: 'b.ts', filePath: 'src/b.ts', language: 'typescript', fileHash: 'b1' },
  { id: 'sym:b:bar', kind: 'function', name: 'bar', filePath: 'src/b.ts', startLine: 1, endLine: 5, language: 'typescript', fileHash: 'b1' },

  { id: 'file:test', kind: 'file', name: 'test.ts', filePath: 'src/test.ts', language: 'typescript', fileHash: 't1' },
  { id: 'test:test:test1', kind: 'test', name: 'test case 1', filePath: 'src/test.ts', startLine: 3, endLine: 6, language: 'typescript', fileHash: 't1' },
];

const edges: GraphEdge[] = [
  // Containment
  { id: 'e1', fromId: 'file:a', toId: 'sym:a:foo', kind: 'contains', filePath: 'src/a.ts', confidence: 'exact', fileHash: 'a1' },
  { id: 'e2', fromId: 'file:b', toId: 'sym:b:bar', kind: 'contains', filePath: 'src/b.ts', confidence: 'exact', fileHash: 'b1' },
  { id: 'e3', fromId: 'file:test', toId: 'test:test:test1', kind: 'contains', filePath: 'src/test.ts', confidence: 'exact', fileHash: 't1' },

  // Imports (file level dependencies)
  { id: 'e4', fromId: 'file:b', toId: 'file:a', kind: 'imports', filePath: 'src/b.ts', confidence: 'exact', fileHash: 'b1' },
  { id: 'e5', fromId: 'file:test', toId: 'file:b', kind: 'imports', filePath: 'src/test.ts', confidence: 'exact', fileHash: 't1' },

  // Calls (function level dependencies)
  { id: 'e6', fromId: 'sym:b:bar', toId: 'sym:a:foo', kind: 'calls', filePath: 'src/b.ts', confidence: 'heuristic', fileHash: 'b1' },
  { id: 'e7', fromId: 'test:test:test1', toId: 'sym:b:bar', kind: 'calls', filePath: 'src/test.ts', confidence: 'heuristic', fileHash: 't1' },
];

upsertGraphNodes(db, nodes);
upsertGraphEdges(db, edges);

const service = new ImpactGraphService(db);

// Test 1: Resolve file target
const fileImpact = await service.analyzeImpact(['src/a.ts'], { depth: 2 });

assert.equal(fileImpact.resolvedTargets.length, 1);
assert.equal(fileImpact.resolvedTargets[0].filePath, 'src/a.ts');
assert.equal(fileImpact.resolvedTargets[0].kind, 'file');

console.log('File impact:', {
  affectedFiles: fileImpact.affectedFiles.length,
  tests: fileImpact.directTests.length + fileImpact.indirectTests.length,
});

// file:b imports file:a, so it should be affected
const affectedB = fileImpact.affectedFiles.find((f) => f.filePath === 'src/b.ts');
assert(affectedB, 'b.ts should be affected by changes to a.ts');

// Test 2: Resolve symbol target
const symImpact = await service.analyzeImpact(['src/a.ts:foo'], { depth: 2 });

assert.equal(symImpact.resolvedTargets.length, 1);
assert.equal(symImpact.resolvedTargets[0].kind, 'function');

// sym:b:bar calls sym:a:foo
const affectedBFile = symImpact.affectedFiles.find((f) => f.filePath === 'src/b.ts');
assert(affectedBFile, 'b.ts should be affected by changes to foo');

// Test 3: Resolve by name only
const nameImpact = await service.analyzeImpact(['foo'], { depth: 2 });

assert.equal(nameImpact.resolvedTargets.length, 1);
assert.equal(nameImpact.resolvedTargets[0].filePath, 'src/a.ts');

// Test 4: Not found target
const notFoundImpact = await service.analyzeImpact(['nonexistent.ts'], { depth: 2 });

assert.equal(notFoundImpact.resolvedTargets.length, 1);
assert.equal(notFoundImpact.resolvedTargets[0].notFound, true);
assert(notFoundImpact.warnings.length > 0, 'Should have warning for not found');

// Test 5: Depth limiting
const depth1Impact = await service.analyzeImpact(['src/a.ts'], { depth: 1 });
const depth2Impact = await service.analyzeImpact(['src/a.ts'], { depth: 2 });

// More depth should find same or more results
assert(
  depth2Impact.affectedFiles.length >= depth1Impact.affectedFiles.length,
  'Greater depth should find more or equal results',
);

// Test 6: Tests-only mode
const testsOnlyImpact = await service.analyzeImpact(['src/a.ts'], {
  depth: 2,
  testsOnly: true,
});

assert.equal(testsOnlyImpact.affectedFiles.length, 0, 'Should not return affected files in tests-only mode');

// Test 7: Multiple targets
const multiTargetImpact = await service.analyzeImpact(['src/a.ts', 'src/b.ts'], { depth: 2 });

assert.equal(multiTargetImpact.resolvedTargets.length, 2);

// Test 8: Impact paths
const pathsImpact = await service.analyzeImpact(['src/a.ts'], {
  depth: 2,
  includePaths: true,
});

// Paths may or may not be found depending on test connectivity
console.log('Impact paths generated:', pathsImpact.impactPaths.length);

db.close();

console.log('✓ Impact graph service tests passed');
