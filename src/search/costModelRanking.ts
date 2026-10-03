/**
 * Cost-Model Ranking (Value-per-Token Optimizer)
 *
 * Inspired by mnemosyne: optimizes context packing by scoring chunks based on
 * information density (value-per-token) rather than raw relevance alone.
 *
 * Formula:
 *   DensityScore = RawScore / (EstimatedTokens ^ alpha)
 *
 * This prevents massive, bloated code files from consuming the entire context budget
 * when compact, high-precision functions provide equivalent or superior information.
 */

import type { ScoredChunk } from './types.js';

export interface CostModelRankingOptions {
  /**
   * Token penalty exponent (alpha).
   * 0.0 = pure relevance (no token penalty)
   * 0.15 = balanced density (recommended default)
   * 0.30 = aggressive density (strongly prioritizes concise definitions)
   * Default: 0.15
   */
  alpha?: number;

  /**
   * Number of top absolute-relevance chunks to preserve as anchors before density re-ranking.
   * Default: 0 (pure density re-ranking)
   */
  preserveTopK?: number;

  /**
   * Reference token size used to normalize density score scale relative to raw score.
   * Default: 100 (a standard 100-token function will have scale multiplier 1.0)
   */
  referenceTokens?: number;

  /**
   * Custom token estimator function. Default estimates 1 token ~= 4 characters.
   */
  tokenEstimator?: (chunk: ScoredChunk) => number;
}

export interface DensityChunkMetadata {
  rawScore: number;
  densityScore: number;
  estimatedTokens: number;
}

/**
 * Estimates token count for a code string or chunk (default: 1 token ≈ 4 characters).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 1;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Estimates token count for a ScoredChunk.
 */
export function estimateChunkTokens(chunk: ScoredChunk): number {
  const code = chunk.record?.display_code || chunk.record?.vector_text || '';
  return estimateTokens(code);
}

/**
 * Calculates the density score given a raw score, token count, and alpha exponent.
 *
 * @param rawScore Base relevance score (e.g. from reranker)
 * @param tokens Estimated token count
 * @param alpha Cost penalty exponent (default 0.15)
 * @param referenceTokens Baseline token size for score scale preservation (default 100)
 */
export function calculateDensityScore(
  rawScore: number,
  tokens: number,
  alpha = 0.15,
  referenceTokens = 100,
): number {
  if (alpha <= 0) return rawScore;
  const safeTokens = Math.max(1, tokens);
  // Normalization factor ensures that a chunk with referenceTokens maintains its rawScore
  const normFactor = referenceTokens ** alpha;
  return (rawScore / safeTokens ** alpha) * normFactor;
}

/**
 * Re-ranks candidate chunks by value-per-token (information density).
 *
 * @param chunks Candidate scored chunks
 * @param options Ranking configuration options
 * @returns Re-ranked chunks sorted by density score
 */
export function applyCostModelRanking(
  chunks: ScoredChunk[],
  options?: CostModelRankingOptions,
): ScoredChunk[] {
  if (chunks.length <= 1) return chunks;

  const alpha = options?.alpha ?? 0.15;
  if (alpha <= 0) return chunks;

  const preserveTopK = Math.max(0, options?.preserveTopK ?? 0);
  const referenceTokens = options?.referenceTokens ?? 100;
  const tokenEstimator = options?.tokenEstimator ?? estimateChunkTokens;

  // Separate anchors if preserveTopK > 0
  const sortedByRaw = chunks.slice().sort((a, b) => b.score - a.score);
  const anchors = preserveTopK > 0 ? sortedByRaw.slice(0, preserveTopK) : [];
  const candidates = preserveTopK > 0 ? sortedByRaw.slice(preserveTopK) : sortedByRaw;

  // Compute density scores for candidates
  const scoredCandidates = candidates.map((chunk) => {
    const tokens = tokenEstimator(chunk);
    const densityScore = calculateDensityScore(chunk.score, tokens, alpha, referenceTokens);
    return {
      chunk: {
        ...chunk,
        score: densityScore,
      },
      densityScore,
      rawScore: chunk.score,
      tokens,
    };
  });

  // Sort candidates by density score descending
  scoredCandidates.sort((a, b) => b.densityScore - a.densityScore);

  return [...anchors, ...scoredCandidates.map((item) => item.chunk)];
}
