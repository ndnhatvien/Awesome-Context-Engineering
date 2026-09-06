/**
 * 搜索模块默认配置
 */

import type { SearchConfig } from './types.js';

export const DEFAULT_CONFIG: SearchConfig = {
  // 召回
  vectorTopK: 80,
  vectorTopM: 60,
  ftsTopKFiles: 20,
  lexChunksPerFile: 2,
  lexTotalChunks: 40,

  // 融合
  rrfK0: 20,
  wVec: 0.6,
  wLex: 0.4,
  fusedTopM: 60,
  preRerankPerFileCap: 5,

  // Rerank
  rerankTopN: 10,
  maxRerankChars: 1000,
  maxBreadcrumbChars: 250,
  headRatio: 0.67,

  // 扩展
  neighborHops: 1,
  breadcrumbExpandLimit: 1,
  importFilesPerSeed: 5,
  chunksPerImportFile: 2,
  decayNeighbor: 0.8,
  decayBreadcrumb: 0.7,
  decayImport: 0.6,
  decayDepth: 0.7,

  // ContextPacker
  maxSegmentsPerFile: 3,
  maxTotalChars: 48000,

  // Smart TopK
  enableSmartTopK: true,
  smartTopScoreRatio: 0.5,
  smartTopScoreDeltaAbs: 0.25,
  smartMinScore: 0.25,
  smartMinK: 2,
  smartMaxK: 8,

  // === OCE 移植特性（默认开启，可通过 SearchConfig 覆盖） ===

  // Source Priority Ranking：源码优先
  sourcePriorityEnabled: true,
  sourcePriorityDocFactor: 0.3,
  sourcePriorityTestFactor: 0.5,

  // Exact Symbol Recall：精确符号召回
  exactSymbolRecallEnabled: true,
  exactSymbolTopKPerIdent: 20,
  exactSymbolBoostScore: 0.9,

  // Path Index：文件名/路径查询
  pathBoostEnabled: true,
  pathBoostWeight: 0.3,
  pathIndexTopK: 20,
  pathBackfillBaseScore: 0.6,
  pathBackfillPerFile: 2,
  pathBackfillFiles: 5,

  // Coverage-first Selector
  coverageEnabled: true,
  coverageOverlapThreshold: 0.6,
};
