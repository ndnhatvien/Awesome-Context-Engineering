/**
 * Impact Graph Service
 *
 * Provides impact analysis and affected test discovery through graph traversal.
 * Resolves targets, traverses dependencies, ranks results, and generates impact paths.
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type {
  AffectedFile,
  AffectedTest,
  GraphEdge,
  GraphNode,
  GraphResolvedTarget,
  ImpactAnalysisResult,
  ImpactPath,
} from './types.js';
import { makeFileNodeId } from './types.js';

export interface ImpactAnalysisOptions {
  depth?: number;
  maxNodes?: number;
  testsOnly?: boolean;
  includePaths?: boolean;
}

const DEFAULT_DEPTH = 2;
const DEFAULT_MAX_NODES = 200;

// Scoring weights
const CONFIDENCE_WEIGHTS = {
  exact: 1.0,
  heuristic: 0.65,
  unresolved: 0.35,
};
const DEPTH_DECAY = 0.75;
const TEST_FILE_BONUS = 0.2;

/**
 * Main impact analysis service.
 */
export class ImpactGraphService {
  constructor(private db: Database.Database) {}

  /**
   * Analyze impact of changes to target files/symbols.
   */
  async analyzeImpact(
    targets: string[],
    options: ImpactAnalysisOptions = {},
  ): Promise<ImpactAnalysisResult> {
    const { depth = DEFAULT_DEPTH, maxNodes = DEFAULT_MAX_NODES, testsOnly = false, includePaths = false } = options;

    const resolvedTargets = this.resolveTargets(targets);
    const warnings: string[] = [];

    // Check if any targets were not found
    for (const target of resolvedTargets) {
      if (target.notFound) {
        warnings.push(`Target not found: ${target.input}`);
      }
    }

    // Get seed nodes
    const seedNodeIds = resolvedTargets
      .filter((t) => t.nodeId)
      .map((t) => t.nodeId!);

    if (seedNodeIds.length === 0) {
      return {
        inputTargets: targets,
        resolvedTargets,
        directTests: [],
        indirectTests: [],
        affectedFiles: [],
        impactPaths: [],
        warnings: [...warnings, 'No valid targets found to analyze'],
      };
    }

    // Traverse reverse dependencies
    const traversalResult = this.traverseImpact(seedNodeIds, depth, maxNodes);

    // Separate tests and files
    const testNodes: Array<{ node: GraphNode; depth: number; score: number; edges: GraphEdge[] }> = [];
    const fileNodes: Array<{ node: GraphNode; depth: number; score: number }> = [];

    for (const item of traversalResult.nodes) {
      if (item.node.kind === 'test') {
        testNodes.push(item);
      } else if (item.node.kind === 'file' && !testsOnly) {
        fileNodes.push(item);
      }
    }

    // Rank tests
    const directTests = testNodes
      .filter((t) => t.depth === 1)
      .map((t) => this.makeAffectedTest(t, true))
      .sort((a, b) => b.score - a.score);

    const indirectTests = testNodes
      .filter((t) => t.depth > 1)
      .map((t) => this.makeAffectedTest(t, false))
      .sort((a, b) => b.score - a.score);

    // Rank affected files
    const affectedFiles = fileNodes
      .map((f) => this.makeAffectedFile(f))
      .sort((a, b) => b.score - a.score);

    // Generate impact paths if requested
    const impactPaths: ImpactPath[] = [];
    if (includePaths) {
      for (const test of [...directTests, ...indirectTests].slice(0, 10)) {
        const path = this.findShortestPath(seedNodeIds, makeFileNodeId(test.filePath));
        if (path) {
          impactPaths.push({
            path: path.map((nodeId) => this.getNodeName(nodeId)),
            score: test.score,
            description: `Test "${test.testName || test.filePath}" affected via ${path.length - 1} hops`,
          });
        }
      }
    }

    return {
      inputTargets: targets,
      resolvedTargets,
      directTests,
      indirectTests,
      affectedFiles,
      impactPaths,
      warnings,
    };
  }

  /**
   * Resolve targets from user input.
   */
  private resolveTargets(targets: string[]): GraphResolvedTarget[] {
    const resolved: GraphResolvedTarget[] = [];

    for (const target of targets) {
      // Try exact file path match
      const fileNode = this.getNodeByFilePath(target);
      if (fileNode) {
        resolved.push({
          input: target,
          nodeId: fileNode.id,
          kind: fileNode.kind,
          filePath: fileNode.filePath,
        });
        continue;
      }

      // Try symbol path (file:symbol)
      if (target.includes(':')) {
        const [filePath, symbolName] = target.split(':');
        const symbolNodes = this.getSymbolNodes(filePath, symbolName);
        if (symbolNodes.length > 0) {
          resolved.push({
            input: target,
            nodeId: symbolNodes[0].id,
            kind: symbolNodes[0].kind,
            filePath: symbolNodes[0].filePath,
          });
          continue;
        }
      }

      // Try exact name match
      const nodesByName = this.getNodesByName(target);
      if (nodesByName.length > 0) {
        resolved.push({
          input: target,
          nodeId: nodesByName[0].id,
          kind: nodesByName[0].kind,
          filePath: nodesByName[0].filePath,
        });
        continue;
      }

      // Not found
      resolved.push({
        input: target,
        notFound: true,
      });
    }

    return resolved;
  }

  /**
   * Traverse impact graph from seed nodes.
   */
  private traverseImpact(
    seedNodeIds: string[],
    maxDepth: number,
    maxNodes: number,
  ): { nodes: Array<{ node: GraphNode; depth: number; path: string[]; score: number; edges: GraphEdge[] }> } {
    const visited = new Set<string>();
    const result: Array<{ node: GraphNode; depth: number; path: string[]; score: number; edges: GraphEdge[] }> = [];
    const queue: Array<{ nodeId: string; depth: number; path: string[]; score: number }> = seedNodeIds.map((id) => ({
      nodeId: id,
      depth: 0,
      path: [id],
      score: 1.0,
    }));

    while (queue.length > 0 && result.length < maxNodes) {
      const current = queue.shift()!;

      if (visited.has(current.nodeId)) {
        continue;
      }

      visited.add(current.nodeId);

      const node = this.getNodeById(current.nodeId);
      if (!node) {
        continue;
      }

      // Get reverse edges (who depends on this node)
      const reverseEdges = this.getReverseEdges(current.nodeId);

      result.push({
        node,
        depth: current.depth,
        path: current.path,
        score: current.score,
        edges: reverseEdges,
      });

      // Continue traversal if within depth limit
      if (current.depth < maxDepth) {
        for (const edge of reverseEdges) {
          const fromNode = this.getNodeById(edge.fromId);
          if (!fromNode || visited.has(edge.fromId)) {
            continue;
          }

          // Calculate score for next level
          const edgeWeight = CONFIDENCE_WEIGHTS[edge.confidence];
          const depthWeight = Math.pow(DEPTH_DECAY, current.depth + 1);
          const testBonus = fromNode.filePath.includes('.test.') || fromNode.filePath.includes('.spec.') ? TEST_FILE_BONUS : 0;
          const newScore = edgeWeight * depthWeight + testBonus;

          queue.push({
            nodeId: edge.fromId,
            depth: current.depth + 1,
            path: [...current.path, edge.fromId],
            score: newScore,
          });
        }
      }
    }

    return { nodes: result };
  }

  /**
   * Get node by ID.
   */
  private getNodeById(nodeId: string): GraphNode | null {
    const row = this.db
      .prepare(
        `
      SELECT id, kind, name, file_path, start_line, end_line,
             breadcrumb, signature, language, file_hash, metadata_json
      FROM graph_nodes
      WHERE id = ?
    `,
      )
      .get(nodeId) as any;

    if (!row) return null;

    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      breadcrumb: row.breadcrumb ?? undefined,
      signature: row.signature ?? undefined,
      language: row.language,
      fileHash: row.file_hash,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    };
  }

  /**
   * Get node by file path (exact match).
   */
  private getNodeByFilePath(filePath: string): GraphNode | null {
    const row = this.db
      .prepare(
        `
      SELECT id, kind, name, file_path, start_line, end_line,
             breadcrumb, signature, language, file_hash, metadata_json
      FROM graph_nodes
      WHERE file_path = ? AND kind = 'file'
      LIMIT 1
    `,
      )
      .get(filePath) as any;

    if (!row) return null;

    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      language: row.language,
      fileHash: row.file_hash,
    };
  }

  /**
   * Get symbol nodes by file path and name.
   */
  private getSymbolNodes(filePath: string, symbolName: string): GraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, kind, name, file_path, start_line, end_line,
             breadcrumb, signature, language, file_hash, metadata_json
      FROM graph_nodes
      WHERE file_path = ? AND name = ? AND kind IN ('function', 'class', 'method')
    `,
      )
      .all(filePath, symbolName) as any[];

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      breadcrumb: row.breadcrumb ?? undefined,
      language: row.language,
      fileHash: row.file_hash,
    }));
  }

  /**
   * Get nodes by name (exact match).
   */
  private getNodesByName(name: string): GraphNode[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, kind, name, file_path, start_line, end_line,
             breadcrumb, signature, language, file_hash, metadata_json
      FROM graph_nodes
      WHERE name = ?
      LIMIT 10
    `,
      )
      .all(name) as any[];

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      language: row.language,
      fileHash: row.file_hash,
    }));
  }

  /**
   * Get reverse edges (edges pointing TO this node).
   */
  private getReverseEdges(nodeId: string): GraphEdge[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, from_id, to_id, kind, file_path,
             confidence, file_hash, metadata_json
      FROM graph_edges
      WHERE to_id = ?
    `,
      )
      .all(nodeId) as any[];

    return rows.map((row) => ({
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      kind: row.kind,
      filePath: row.file_path,
      confidence: row.confidence,
      fileHash: row.file_hash,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    }));
  }

  /**
   * Make affected test result.
   */
  private makeAffectedTest(
    item: { node: GraphNode; depth: number; score: number; edges: GraphEdge[] },
    isDirect: boolean,
  ): AffectedTest {
    const reason = this.makeReason(item.edges);
    return {
      filePath: item.node.filePath,
      testName: item.node.name,
      score: item.score,
      depth: item.depth,
      reason,
      isDirect,
    };
  }

  /**
   * Make affected file result.
   */
  private makeAffectedFile(
    item: { node: GraphNode; depth: number; score: number },
  ): AffectedFile {
    return {
      filePath: item.node.filePath,
      score: item.score,
      depth: item.depth,
    };
  }

  /**
   * Generate reason string from edges.
   */
  private makeReason(edges: GraphEdge[]): string {
    if (edges.length === 0) return 'Unknown dependency';

    const edgeKinds = edges.map((e) => e.kind);
    if (edgeKinds.includes('imports')) {
      return 'Imports affected file';
    }
    if (edgeKinds.includes('calls')) {
      return 'Calls affected symbol';
    }
    if (edgeKinds.includes('test_covers')) {
      return 'Test covers affected code';
    }
    return 'Depends on affected code';
  }

  /**
   * Find shortest path between two nodes.
   */
  private findShortestPath(fromNodeIds: string[], toNodeId: string): string[] | null {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = fromNodeIds.map((id) => ({
      nodeId: id,
      path: [id],
    }));

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === toNodeId) {
        return current.path;
      }

      if (visited.has(current.nodeId)) {
        continue;
      }

      visited.add(current.nodeId);

      const reverseEdges = this.getReverseEdges(current.nodeId);
      for (const edge of reverseEdges) {
        if (!visited.has(edge.fromId)) {
          queue.push({
            nodeId: edge.fromId,
            path: [...current.path, edge.fromId],
          });
        }
      }
    }

    return null;
  }

  /**
   * Get node name by ID.
   */
  private getNodeName(nodeId: string): string {
    const node = this.getNodeById(nodeId);
    return node ? `${node.filePath}${node.name !== node.filePath ? `:${node.name}` : ''}` : nodeId;
  }
}
