/**
 * Impact Graph Types
 *
 * TypeScript interfaces for the impact graph MVP.
 * Graph stores structural relationships between files, symbols, and tests
 * to support affected test discovery and change impact analysis.
 */

/** Graph node kinds */
export type GraphNodeKind = 'file' | 'function' | 'class' | 'method' | 'import' | 'test';

/** Graph edge kinds */
export type GraphEdgeKind = 'contains' | 'imports' | 'calls' | 'references' | 'test_covers';

/** Edge confidence level */
export type EdgeConfidence = 'exact' | 'heuristic' | 'unresolved';

/** Graph index status */
export type GraphIndexStatus = 'indexed' | 'skipped' | 'error';

/** Graph node representing a file, symbol, or test */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  breadcrumb?: string;
  signature?: string;
  language: string;
  fileHash: string;
  metadata?: Record<string, unknown>;
}

/** Graph edge representing a relationship between nodes */
export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: GraphEdgeKind;
  filePath: string;
  confidence: EdgeConfidence;
  fileHash: string;
  metadata?: Record<string, unknown>;
}

/** Graph index state per file */
export interface GraphIndexState {
  filePath: string;
  fileHash: string;
  indexedAt: number;
  language: string;
  nodeCount: number;
  edgeCount: number;
  status: GraphIndexStatus;
  errorMessage?: string;
}

/** Resolved target from user input */
export interface GraphResolvedTarget {
  input: string;
  nodeId?: string;
  kind?: GraphNodeKind;
  filePath?: string;
  notFound?: boolean;
}

/** Affected test result */
export interface AffectedTest {
  filePath: string;
  testName?: string;
  score: number;
  depth: number;
  reason?: string;
  isDirect: boolean;
}

/** Affected file result */
export interface AffectedFile {
  filePath: string;
  score: number;
  depth: number;
  reason?: string;
}

/** Impact path showing dependency chain */
export interface ImpactPath {
  path: string[];
  score: number;
  description: string;
}

/** Impact analysis result */
export interface ImpactAnalysisResult {
  inputTargets: string[];
  resolvedTargets: GraphResolvedTarget[];
  directTests: AffectedTest[];
  indirectTests: AffectedTest[];
  affectedFiles: AffectedFile[];
  impactPaths: ImpactPath[];
  warnings: string[];
}

/** Internal traversal result */
export interface TraversalResult {
  nodes: Array<{
    node: GraphNode;
    depth: number;
    path: string[];
    score: number;
    edges: GraphEdge[];
  }>;
}

/** Node ID factory functions */
export function makeFileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

export function makeSymbolNodeId(
  filePath: string,
  name: string,
  startLine: number,
  endLine: number,
): string {
  return `symbol:${filePath}:${name}:L${startLine}-L${endLine}`;
}

export function makeTestNodeId(
  filePath: string,
  label: string,
  startLine: number,
  endLine: number,
): string {
  const sanitized = label.slice(0, 80).replace(/[:\n]/g, ' ');
  return `test:${filePath}:${sanitized}:L${startLine}-L${endLine}`;
}

export function makeImportNodeId(filePath: string, importPath: string): string {
  return `import:${filePath}:${importPath}`;
}

export function makeUnresolvedNodeId(importPath: string): string {
  return `unresolved:${importPath}`;
}
