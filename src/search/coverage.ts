/**
 * Coverage-first Selector - 覆盖率优先选择
 *
 * 移植自 OCE 的 CoverageSelector（贪心两段填充）：
 * - Pass 1（preferNewPath=true）：按得分降序遍历，优先把每个文件的最高分 chunk 选进来，
 *   实现"每文件至少覆盖一段"（coverage-first）。
 * - Pass 2（preferNewPath=false）：再次遍历，为已选中的文件补充更多低分 chunk。
 *
 * 约束：
 * - 每文件最多 maxPerPath 段（复用 maxSegmentsPerFile）
 * - 总预算 maxChars（复用 maxTotalChars，用 raw 区间长度近似估算）
 * - 同文件 chunk 与已选 chunk 的重叠比例超过 overlapThreshold 时抑制
 */

import type { ScoredChunk } from './types.js';

export interface CoverageSelectionOptions {
  /** 每文件最多选中段数 */
  maxPerPath: number;
  /** 总字符预算（用 raw_end - raw_start 近似） */
  maxChars: number;
  /** 同文件重叠比例阈值：overlap / min(len) 超过该值则抑制 */
  overlapThreshold: number;
}

/** 用 raw 区间长度估算 chunk 的文本长度 */
function estimateChunkChars(chunk: ScoredChunk): number {
  return Math.max(0, chunk.record.raw_end - chunk.record.raw_start);
}

/** 计算与已选 peer 的重叠比例（基于较短的区间） */
function overlapRatioAgainst(chunk: ScoredChunk, peers: ScoredChunk[]): number {
  const start = chunk.record.raw_start;
  const end = chunk.record.raw_end;
  const ownLen = Math.max(1, end - start);

  let maxRatio = 0;
  for (const peer of peers) {
    const pStart = peer.record.raw_start;
    const pEnd = peer.record.raw_end;
    const overlap = Math.min(end, pEnd) - Math.max(start, pStart);
    if (overlap <= 0) continue;
    const minLen = Math.min(ownLen, pEnd - pStart);
    const ratio = overlap / Math.max(1, minLen);
    if (ratio > maxRatio) maxRatio = ratio;
  }
  return maxRatio;
}

/**
 * 覆盖率优先选择：返回按得分降序的入选 chunk 子集
 *
 * 选择过程不改变 chunk 的相对得分排序，只做裁剪。
 */
export function coverageSelect(
  chunks: ScoredChunk[],
  options: CoverageSelectionOptions,
): ScoredChunk[] {
  if (chunks.length === 0) return [];

  const sorted = [...chunks].sort((a, b) => b.score - a.score);

  const pathCounts = new Map<string, number>();
  const selectedByPath = new Map<string, ScoredChunk[]>();
  const selected: ScoredChunk[] = [];
  let totalChars = 0;

  for (const preferNewPath of [true, false]) {
    for (const chunk of sorted) {
      const count = pathCounts.get(chunk.filePath) ?? 0;

      // Pass 1 只收新文件的"第一段"；Pass 2 只收已选中文件的补充段
      if (preferNewPath !== (count === 0)) continue;

      // 每文件上限
      if (count >= options.maxPerPath) continue;

      // 同文件重叠抑制（与已选中的 chunk 比较）
      const peers = selectedByPath.get(chunk.filePath);
      if (peers && overlapRatioAgainst(chunk, peers) > options.overlapThreshold) continue;

      // 总预算
      const len = estimateChunkChars(chunk);
      if (totalChars + len > options.maxChars) continue;

      selected.push(chunk);
      pathCounts.set(chunk.filePath, count + 1);
      totalChars += len;
      const byPath = selectedByPath.get(chunk.filePath);
      if (byPath === undefined) {
        const bucket: ScoredChunk[] = [];
        selectedByPath.set(chunk.filePath, bucket);
        bucket.push(chunk);
      } else {
        byPath.push(chunk);
      }
    }
  }

  return selected;
}
