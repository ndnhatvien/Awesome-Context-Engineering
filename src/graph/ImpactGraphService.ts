/**
 * Impact Graph Service
 *
 * Analyzes code impact through dependency graphs.
 * 基于 graph_nodes / graph_edges 做反向依赖遍历：从变更目标出发，沿着
 * "谁依赖我" 的方向（edge.to_id → edge.from_id）搜索受影响的文件与测试。
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { isGraphInitialized } from './schema.js';
import type {
  EdgeConfidence,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
} from './types.js';

export interface ResolvedTarget {
  input: string;
  filePath: string;
  kind: string;
  notFound?: boolean;
}

export interface TestResult {
  filePath: string;
  testName?: string;
  score: number;
  depth: number;
  reason: string;
}

export interface AffectedFile {
  filePath: string;
  score: number;
  depth: number;
}

export interface ImpactPath {
  description: string;
  path: string[];
}

export interface ImpactResult {
  target: string;
  warnings: string[];
  resolvedTargets: ResolvedTarget[];
  directTests: TestResult[];
  indirectTests: TestResult[];
  affectedFiles: AffectedFile[];
  impactPaths: ImpactPath[];
  dependencyPaths: Array<{
    from: string;
    to: string;
    path: string[];
  }>;
}

export interface AnalyzeOptions {
  depth?: number;
  testsOnly?: boolean;
  includePaths?: boolean;
}

interface _GraphNodeRow {
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
}

interface _GraphEdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
  file_path: string;
  confidence: string;
  file_hash: string;
  metadata_json: string | null;
}

const CONFIDENCE_WEIGHT: Record<string, number> = {
  exact: 1.0,
  heuristic: 0.8,
  unresolved: 0.6,
};

export class ImpactGraphService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Analyze impact of changes to target files/symbols.
   *
   * 目标解析策略（按优先级）：
   *   1. 精确文件路径 → file 节点
   *   2. `文件路径:符号名` → 符号节点
   *   3. 仅符号名 → 匹配 name 节点
   * 命中失败 → 输出 notFound target + warning。
   *
   * 遍历方向为"反向依赖"：从 seed 出发，沿着所有 `to_id = 当前节点` 的边，
   * 到达 `from_id`（依赖当前节点的下游）。深度按跳数计，`depth` 限制最大层数。
   */
  async analyzeImpact(targets: string | string[], options?: AnalyzeOptions): Promise<ImpactResult> {
    const targetArray = Array.isArray(targets) ? targets : [targets];
    const depthLimit = options?.depth ?? 2;
    const testsOnly = options?.testsOnly ?? false;
    const includePaths = options?.includePaths ?? false;

    logger.info({ targets: targetArray, options }, 'Analyzing code impact');

    const warnings: string[] = [];
    const result: ImpactResult = {
      target: targetArray.join(', '),
      warnings,
      resolvedTargets: [],
      directTests: [],
      indirectTests: [],
      affectedFiles: [],
      impactPaths: [],
      dependencyPaths: [],
    };

    if (!isGraphInitialized(this.db)) {
      warnings.push('图索引未初始化（缺少 graph_nodes / graph_edges 表）');
      return result;
    }

    // 加载节点与边
    const nodeRows = this.db
      .prepare(
        `SELECT id, kind, name, file_path, start_line, end_line, breadcrumb,
                signature, language, file_hash, metadata_json FROM graph_nodes`,
      )
      .all() as _GraphNodeRow[];
    const edgeRows = this.db
      .prepare(
        `SELECT id, from_id, to_id, kind, file_path, confidence, file_hash, metadata_json
         FROM graph_edges`,
      )
      .all() as _GraphEdgeRow[];

    const nodes = new Map<string, GraphNode>();
    for (const row of nodeRows) {
      nodes.set(row.id, {
        id: row.id,
        kind: row.kind as GraphNodeKind,
        name: row.name,
        filePath: row.file_path,
        startLine: row.start_line ?? undefined,
        endLine: row.end_line ?? undefined,
        breadcrumb: row.breadcrumb ?? undefined,
        signature: row.signature ?? undefined,
        language: row.language,
        fileHash: row.file_hash,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      });
    }

    // dependentsOf[toId] → 依赖方边（fromId 是受影响的一方）
    const dependentsOf = new Map<string, GraphEdge[]>();
    for (const row of edgeRows) {
      const edge: GraphEdge = {
        id: row.id,
        fromId: row.from_id,
        toId: row.to_id,
        kind: row.kind as GraphEdgeKind,
        filePath: row.file_path,
        confidence: row.confidence as EdgeConfidence,
        fileHash: row.file_hash,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      };
      const list = dependentsOf.get(edge.toId) ?? [];
      list.push(edge);
      dependentsOf.set(edge.toId, list);
    }

    // 解析输入目标 → seed 节点
    const seedIds = new Set<string>();
    const seedFiles = new Set<string>();
    for (const input of targetArray) {
      const resolved = this.resolveTarget(input, nodes);
      result.resolvedTargets.push(
        resolved.chosen ?? { input, filePath: '', kind: '', notFound: true },
      );
      if (resolved.warning) warnings.push(resolved.warning);

      for (const node of resolved.candidates) {
        seedIds.add(node.id);
        seedFiles.add(node.filePath);
      }
    }

    if (seedIds.size === 0) {
      return result;
    }

    // BFS 反向依赖遍历
    const visited = new Set<string>();
    const reaching = new Map<string, { depth: number; path: string[]; score: number }>();
    const reachingEdge = new Map<string, GraphEdge>();
    const queue: Array<{ nodeId: string; depth: number; path: string[]; score: number }> = [];

    for (const seedId of seedIds) {
      visited.add(seedId);
      reaching.set(seedId, { depth: 0, path: [seedId], score: 1 });
      queue.push({ nodeId: seedId, depth: 0, path: [seedId], score: 1 });
    }

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift() as {
        nodeId: string;
        depth: number;
        path: string[];
        score: number;
      };
      if (depth >= depthLimit) continue;

      for (const edge of dependentsOf.get(nodeId) ?? []) {
        const depId = edge.fromId;
        if (visited.has(depId)) continue;

        const nextDepth = depth + 1;
        visited.add(depId);
        const weight = CONFIDENCE_WEIGHT[edge.confidence] ?? 0.6;
        const score = weight / (1 + nextDepth);
        const nextPath = (reaching.get(nodeId)?.path ?? [nodeId]).concat(depId);
        reaching.set(depId, { depth: nextDepth, path: nextPath, score });
        reachingEdge.set(depId, edge);
        queue.push({ nodeId: depId, depth: nextDepth, path: nextPath, score });
      }
    }

    // 汇总受影响文件与测试
    const files = new Map<string, AffectedFile>();
    for (const [nodeId, meta] of reaching) {
      const node = nodes.get(nodeId);
      if (!node || meta.depth === 0) continue;

      const edgeBy = reachingEdge.get(nodeId);
      const reason = edgeBy ? `${edgeBy.kind} → ${node.name}` : node.kind;

      if (node.kind === 'test' || this.isTestFile(node.filePath)) {
        const testResult: TestResult = {
          filePath: node.filePath,
          testName: node.kind === 'test' ? node.name : undefined,
          score: meta.score,
          depth: meta.depth,
          reason,
        };
        if (meta.depth === 1) {
          result.directTests.push(testResult);
        } else {
          result.indirectTests.push(testResult);
        }
        continue;
      }

      if (testsOnly) {
        // 只关心测试，不统计受影响文件
        continue;
      }
      // 被变更文件自身不算"受影响"
      if (seedFiles.has(node.filePath)) continue;

      const existing = files.get(node.filePath);
      if (!existing || meta.score > existing.score) {
        files.set(node.filePath, {
          filePath: node.filePath,
          score: Number(meta.score.toFixed(2)),
          depth: meta.depth,
        });
      }
    }

    result.affectedFiles = [...files.values()].sort((a, b) => b.score - a.score);
    result.directTests.sort((a, b) => b.score - a.score);
    result.indirectTests.sort((a, b) => b.score - a.score);

    // 影响路径（仅当 includePaths 启用时生成，避免大图下开销）
    if (includePaths) {
      for (const [nodeId, meta] of reaching) {
        if (meta.depth === 0) continue;
        const node = nodes.get(nodeId);
        if (!node) continue;
        const edgeBy = reachingEdge.get(nodeId);
        const description = edgeBy
          ? `${edgeBy.fromId} ${edgeBy.kind} → ${edgeBy.toId}`
          : `依赖链 → ${node.name}`;
        result.impactPaths.push({ description, path: meta.path });
      }
    }

    // dependencyPaths（种子 → 依赖链）：记录 seed 到每个可达依赖的方向，
    // 与 impactedPaths 共用 reaching，避免二次遍历
    for (const [nodeId, meta] of reaching) {
      if (meta.depth === 0) continue;
      const seed = meta.path[0];
      result.dependencyPaths.push({ from: seed, to: nodeId, path: meta.path });
    }

    return result;
  }

  /**
   * 解析单个输入目标 → 候选节点列表 + 首选命中 + 警告。
   */
  private resolveTarget(
    input: string,
    nodes: Map<string, GraphNode>,
  ): { candidates: GraphNode[]; chosen?: ResolvedTarget; warning?: string } {
    const nodeList = [...nodes.values()];

    // 1) 精确文件路径
    const fileMatches = nodeList.filter((n) => n.kind === 'file' && n.filePath === input);
    if (fileMatches.length > 0) {
      const node = fileMatches[0];
      return {
        candidates: fileMatches,
        chosen: { input, filePath: node.filePath, kind: node.kind },
      };
    }

    // 2) `路径:符号` 形式
    const colonIdx = input.lastIndexOf(':');
    if (colonIdx > 0) {
      const fp = input.slice(0, colonIdx);
      const symbol = input.slice(colonIdx + 1);
      const symbolMatches = nodeList.filter(
        (n) => n.kind !== 'file' && n.filePath === fp && n.name === symbol,
      );
      if (symbolMatches.length > 0) {
        const node = symbolMatches[0];
        return {
          candidates: symbolMatches,
          chosen: { input, filePath: node.filePath, kind: node.kind },
        };
      }
    }

    // 3) 仅符号名
    const nameMatches = nodeList.filter((n) => n.kind !== 'file' && n.name === input);
    if (nameMatches.length > 0) {
      const node = nameMatches[0];
      return {
        candidates: nameMatches,
        chosen: { input, filePath: node.filePath, kind: node.kind },
      };
    }

    // 4) 未命中
    return {
      candidates: [],
      warning: `未能解析目标 "${input}"，未在图中找到对应节点`,
    };
  }

  private isTestFile(filePath: string): boolean {
    return (
      /(^|[/\\\\])(test|tests|spec|__tests__)[/\\\\]/.test(filePath) ||
      /\.(test|spec)\./.test(filePath)
    );
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
