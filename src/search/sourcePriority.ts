/**
 * Source Priority Ranking - 源码优先级排序
 *
 * 移植自 OCE 的 source_priority 机制：
 * 对 rerank 后的候选按文件路径的"信息价值"施加衰减系数，
 * 让源码文件（代码）权重最高，文档/测试类文件降权，从而提升上下文纯度。
 *
 * 说明：系数只影响排序与 SmartTopK 阈值计算，不改变候选集合本身；
 * 与 OCE 的 "scored_hits × factor(path)" 语义保持一致。
 */

import type { ScoredChunk } from './types.js';

/** 文档类目录（路径段） */
const DOC_DIR_SEGMENTS = new Set([
  'docs',
  'doc',
  'documentation',
  'examples',
  'example',
  'guides',
  'guide',
  'site',
  'website',
  'wiki',
  'assets',
]);

/** 文档类扩展名 */
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc', '.markdown']);

/** 测试类目录（路径段） */
const TEST_DIR_SEGMENTS = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'e2e',
  'integration',
  'integration_test',
  'integration-tests',
  'test-d',
  '__mocks__',
  '__snapshots__',
]);

/** 测试类文件名特征（foo.test.ts / foo.spec.tsx / foo.e2e.ts） */
const TEST_FILE_HINT = /[._-](test|spec|e2e|snap)[._-]/i;

export interface SourcePriorityOptions {
  enabled: boolean;
  /** 文档文件分数系数 */
  docFactor: number;
  /** 测试文件分数系数 */
  testFactor: number;
}

/** 从路径提取小写扩展名（含点，如 ".md"）；无扩展名返回空串 */
function getExt(lowerPath: string): string {
  const idx = lowerPath.lastIndexOf('.');
  return idx >= 0 ? lowerPath.slice(idx) : '';
}

/**
 * 计算路径对应的优先级系数
 *
 * 优先级：文档 < 测试 < 源码
 */
export function sourcePriorityFactor(filePath: string, options: SourcePriorityOptions): number {
  const lower = filePath.toLowerCase();
  const segments = lower.split('/');
  const baseName = segments[segments.length - 1] ?? '';

  // 文档类：目录命中或文档扩展名命中
  const isDoc = segments.some((s) => DOC_DIR_SEGMENTS.has(s)) || DOC_EXTENSIONS.has(getExt(lower));
  if (isDoc) return options.docFactor;

  // 测试类：目录命中或文件名命中
  const isTest = segments.some((s) => TEST_DIR_SEGMENTS.has(s)) || TEST_FILE_HINT.test(baseName);
  if (isTest) return options.testFactor;

  // 源码：不变权
  return 1.0;
}

/**
 * 对候选列表应用源码优先级（重打分 + 降序重排）
 *
 * 未启用或输入为空时原样返回，保证调用方无副作用。
 */
export function applySourcePriority(
  items: ScoredChunk[],
  options: SourcePriorityOptions,
): ScoredChunk[] {
  if (!options.enabled || items.length === 0) return items;

  return items
    .map((item) => ({
      item,
      factor: sourcePriorityFactor(item.filePath, options),
    }))
    .sort((a, b) => {
      // 先用系数折算后的有效分排序，分数相同保持原相对顺序（稳定）
      const scA = a.item.score * a.factor;
      const scB = b.item.score * b.factor;
      if (scB !== scA) return scB - scA;
      return 0;
    })
    .map(({ item, factor }) => ({
      ...item,
      score: item.score * factor,
    }));
}
