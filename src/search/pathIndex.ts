/**
 * Path Index - 文件名/路径查询索引
 *
 * 移植自 OCE 的 path_index 机制（词法化实现）：
 * OCE 用 Milvus 嵌入"路径文档"来回答"xxx 文件在哪"；ACE 天然拥有 files_fts
 * 的 path 列全文索引，因此这里直接对 path 列做加权 FTS 匹配 + basename LIKE 兜底，
 * 零额外 embedding 成本。
 *
 * 流程：
 * 1. detectPathQuery：判断 query 是否疑似文件名/路径意图（含扩展名、含 '/'、
 *    出现 file/where/which 等指示词，或单 token 精确目标）。
 * 2. searchPathsFts：先对 files_fts.path 列做 FTS（path 权重 6），
 *    再去分隔符/过滤变体后做 basename LIKE 兜底补充。
 * 3. mergePathBoost：对已召回的同文件候选择 score 加成，并对未命中文件回填首段。
 */

import type { ChunkRecord } from '../vectorStore/index.js';
import { isFtsInitialized, segmentQuery } from './fts.js';
import type { ScoredChunk } from './types.js';

export interface PathHit {
  path: string;
  score: number;
}

/** 常见代码/文档扩展名（用于识别 filename 意图） */
const PATH_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|swift|cs|csx|cpp|cc|cxx|c|h|hpp|php|rb|dart|vue|svelte|md|mdx|json|yaml|yml|toml|xml|sh|bash|zsh|fish|lua|r|sql|html|css|scss|sass|less)$/i;

/** 自然语言中的文件名/路径意图指示词 */
const PATH_INTENT_WORDS = [
  'file',
  'files',
  'path',
  'where',
  'which',
  '文档',
  '文件',
  '路径',
  '哪个',
  '在哪',
  '文件名',
];

/**
 * 判断 query 是否疑似"找文件/路径"意图
 */
export function detectPathQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  // 1. 路径片段或扩展名
  const tokens = segmentQuery(query);
  if (tokens.some((t) => t.includes('/') || PATH_EXTENSIONS.test(t))) return true;

  // 2. 自然语言指示词（中英文）
  const lower = trimmed.toLowerCase();
  if (PATH_INTENT_WORDS.some((w) => lower.includes(w))) return true;

  // 3. 单 token 查询（无空格）：大概率是文件名/标识符精确目标
  if (!/\s/.test(trimmed)) {
    return trimmed.length >= 3 && /^[A-Za-z0-9_$.-]+$/.test(trimmed);
  }

  return false;
}

/** LIKE 模式中的特殊字符转义 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * files_fts.path 列加权搜索
 *
 * path 列权重 6.0，content 列权重 1.0，确保"路径命中"显著优先于内容命中。
 */
function searchPathFts(
  db: Parameters<typeof isFtsInitialized>[0],
  query: string,
  limit: number,
): PathHit[] {
  if (!isFtsInitialized(db)) return [];

  const tokens = segmentQuery(query).slice(0, 8);
  if (tokens.length === 0) return [];

  const matchExpr = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  try {
    const rows = db
      .prepare(
        `SELECT path, bm25(files_fts, 6.0, 1.0) AS score
         FROM files_fts
         WHERE files_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(`path : (${matchExpr})`, limit) as Array<{ path: string; score: number }>;

    // BM25 返回负值，转正
    return rows.map((r) => ({ path: r.path, score: -r.score }));
  } catch {
    // trigram/列过滤语法不可用时走 basename 兜底
    return [];
  }
}

/**
 * basename LIKE 兜底搜索
 *
 * 对标识符形 token 做 path 子串匹配，覆盖 FTS 语法兼容性差的场景。
 */
function searchPathLike(
  db: Parameters<typeof isFtsInitialized>[0],
  query: string,
  limit: number,
): PathHit[] {
  const tokens = segmentQuery(query)
    .slice(0, 4)
    .filter((t) => /^[A-Za-z0-9_$.-]+$/.test(t) && t.length >= 2);

  if (tokens.length === 0) return [];

  const stmt = db.prepare(`SELECT path FROM files WHERE path LIKE '%' || ? || '%' LIMIT ?`);

  const hits: PathHit[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const escaped = escapeLike(token);
    for (const row of stmt.all(escaped, limit) as Array<{ path: string }>) {
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      hits.push({ path: row.path, score: 1.0 });
    }
    if (hits.length >= limit) break;
  }

  return hits;
}

/**
 * 路径索引搜索：FTS（path 加权）→ LIKE 兜底补充
 */
export function searchPathsFts(
  db: Parameters<typeof isFtsInitialized>[0],
  query: string,
  limit: number,
): PathHit[] {
  const fromFts = searchPathFts(db, query, limit);
  if (fromFts.length >= limit) return fromFts;

  const existing = new Set(fromFts.map((h) => h.path));
  const fromLike = searchPathLike(db, query, limit - fromFts.length).filter(
    (h) => !existing.has(h.path),
  );

  return [...fromFts, ...fromLike].sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface PathBoostOptions {
  weight: number;
  backfillBaseScore: number;
  backfillPerFile: number;
  backfillFiles: number;
}

/**
 * 将路径命中合并进候选：
 * 1. 对已在候选中的同文件 chunk 施加 score 加成
 * 2. 对未命中的强匹配文件回填前几个 chunk
 */
export async function mergePathBoost(
  topM: ScoredChunk[],
  pathHits: PathHit[],
  vectorStore: {
    getFilesChunks(filePaths: string[]): Promise<Map<string, ChunkRecord[]> | undefined>;
  },
  options: PathBoostOptions,
): Promise<ScoredChunk[]> {
  if (pathHits.length === 0) return topM;

  const pathScores = new Map(pathHits.map((h) => [h.path, h.score]));

  // 1. 同文件候选加成（不改变来源，仅加分）
  const boosted = topM.map((candidate) => ({
    ...candidate,
    score: candidate.score + options.weight * (pathScores.get(candidate.filePath) ?? 0),
  }));

  // 2. 回填未命中文件首个 chunk
  const existingPaths = new Set(topM.map((c) => c.filePath));
  const backfillCandidates = pathHits
    .filter((h) => !existingPaths.has(h.path))
    .slice(0, options.backfillFiles);

  if (backfillCandidates.length > 0) {
    const chunksMap = await vectorStore.getFilesChunks(backfillCandidates.map((h) => h.path));
    const backfilled: ScoredChunk[] = [];

    for (const { path } of backfillCandidates) {
      const chunks = chunksMap?.get(path) ?? [];
      for (const chunk of chunks.slice(0, options.backfillPerFile)) {
        backfilled.push({
          filePath: chunk.file_path,
          chunkIndex: chunk.chunk_index,
          score: options.backfillBaseScore,
          source: 'lexical',
          record: { ...chunk, _distance: 0 },
        });
      }
    }

    return [...boosted, ...backfilled].sort((a, b) => b.score - a.score);
  }

  return boosted.sort((a, b) => b.score - a.score);
}
