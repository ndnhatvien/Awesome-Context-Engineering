/**
 * Live Search Benchmark
 *
 * 在真实索引上跑 SearchService 的端到端评测：
 *   1. scan() 索引目标仓库（走真实 Embedding API，增量/强制可选）
 *   2. 逐个 query 调用 buildContextPack()，取最终 ContextPack.files 作为排名
 *   3. 用 Recall@K / MRR / nDCG 与 ground-truth 文件路径对照
 *   4. 对比两组配置：OCE 4 特性全关（baseline） vs 全开
 *
 * 用法：
 *   tsx src/search/eval/runLiveBenchmark.ts <repoPath> [--dataset path] [--k 1,3,5] [--force]
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateProjectId } from '../../db/index.js';
import { scan } from '../../scanner/index.js';
import { logger } from '../../utils/logger.js';
import { SearchService } from '../SearchService.js';
import type { SearchConfig } from '../types.js';
import { evaluateBenchmarkCases } from './metrics.js';
import type { BenchmarkCase, BenchmarkSummary } from './types.js';

const DEFAULT_K_VALUES = [1, 3, 5];
const DEFAULT_DATASET = 'tests/benchmark/fixtures/live-benchmark.jsonl';

/** OCE 4 特性全关 = baseline 模式 */
const OCE_FEATURES_OFF: Partial<SearchConfig> = {
  exactSymbolRecallEnabled: false,
  pathBoostEnabled: false,
  sourcePriorityEnabled: false,
  coverageEnabled: false,
};

/** OCE 4 特性全开 = 默认配置 */
const OCE_FEATURES_ON: Partial<SearchConfig> = {};

function printUsage(): void {
  process.stdout.write(
    [
      '用法: tsx src/search/eval/runLiveBenchmark.ts <repoPath> [--dataset path] [--k 1,3,5] [--force]',
      '示例: tsx src/search/eval/runLiveBenchmark.ts tests/benchmark/fixtures/golden-repo --force',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

interface CliOptions {
  repoPath: string;
  datasetPath: string;
  kValues: number[];
  force: boolean;
}

function parseKValues(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_K_VALUES;
  const parsed = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  if (parsed.length === 0) {
    throw new Error('--k 无效，应为正整数列表，如 1,3,5');
  }
  return [...new Set(parsed)].sort((a, b) => a - b);
}

/**
 * 纯 ground-truth 数据集加载（live benchmark 的 retrieved 由运行时产生，
 * 这里仅读取 {id, query, relevant}，初始 retrieved 为空数组）。
 */
async function loadGroundTruth(datasetPath: string): Promise<BenchmarkCase[]> {
  const raw = await fs.readFile(datasetPath, 'utf-8');
  const cases: BenchmarkCase[] = [];

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const parsed = JSON.parse(line) as {
      id?: unknown;
      query?: unknown;
      relevant?: unknown;
    };
    const id = parsed.id;
    const query = parsed.query;
    const relevant = parsed.relevant;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`数据集行缺少字符串字段 id: ${line.slice(0, 80)}`);
    }
    if (typeof query !== 'string' || query.length === 0) {
      throw new Error(`数据集行缺少字符串字段 query: ${line.slice(0, 80)}`);
    }
    if (typeof relevant !== 'object' || relevant === null || Array.isArray(relevant)) {
      throw new Error(`数据集行 missing object：字段 relevant: ${line.slice(0, 80)}`);
    }
    const gains: Record<string, number> = {};
    for (const [filePath, rawGain] of Object.entries(relevant as Record<string, unknown>)) {
      const gain = Number(rawGain);
      if (!Number.isFinite(gain) || gain <= 0) continue;
      gains[filePath] = gain;
    }
    if (Object.keys(gains).length === 0) {
      throw new Error(`数据集行 relevant 必须含正数增益: ${line.slice(0, 80)}`);
    }
    cases.push({ id, query, retrieved: [], relevant: gains });
  }

  return cases;
}

function parseCliArgs(argv: string[]): CliOptions {
  const repoPath = argv[0];
  if (!repoPath) {
    throw new Error('缺少仓库路径参数');
  }

  let datasetPath = DEFAULT_DATASET;
  let kValues = DEFAULT_K_VALUES;
  let force = false;
  let rest = argv.slice(1);

  while (rest.length > 0) {
    const flag = rest[0];
    rest = rest.slice(1);
    if (flag === '--dataset') {
      datasetPath = rest[0] ?? datasetPath;
      rest = rest.slice(1);
    } else if (flag === '--k') {
      kValues = parseKValues(rest[0]);
      rest = rest.slice(1);
    } else if (flag === '--force') {
      force = true;
    }
  }

  return { repoPath, datasetPath, kValues, force };
}

/**
 * 执行单个模式的全部查询（每查询一次 buildContextPack）。
 * 返回 BenchmarkCase 列表，retrieved 取最终文件排名。
 */
async function runMode(
  projectId: string,
  repoPath: string,
  dataset: BenchmarkCase[],
  overlay: Partial<SearchConfig>,
  label: string,
): Promise<BenchmarkCase[]> {
  const service = new SearchService(projectId, repoPath, overlay);
  await service.init();

  const cases: BenchmarkCase[] = [];
  try {
    for (const entry of dataset) {
      const startedAt = Date.now();
      let retrieved: string[] = [];
      let errorMessage: string | undefined;

      try {
        const pack = await service.buildContextPack(entry.query);
        // context files 即最终输出排名（按分数降序）
        retrieved = pack.files.map((file) => file.filePath);
      } catch (err) {
        errorMessage = (err as Error).message;
        logger.warn({ query: entry.query, error: errorMessage }, `${label} 查询失败`);
      }

      const elapsedMs = Date.now() - startedAt;
      logger.info(
        { query: entry.query, hits: retrieved, elapsedMs, error: errorMessage },
        `${label} 检索完成`,
      );

      cases.push({
        id: entry.id,
        query: entry.query,
        retrieved,
        relevant: entry.relevant,
      });
    }
  } finally {
    await service.close();
  }

  return cases;
}

function printSummary(title: string, summary: BenchmarkSummary, kValues: number[]): void {
  const recallLine = kValues
    .map((k) => `Recall@${k}: ${summary.recallAtK[String(k)].toFixed(4)}`)
    .join('  ');
  const ndcgLine = kValues
    .map((k) => `nDCG@${k}: ${summary.ndcgAtK[String(k)].toFixed(4)}`)
    .join('  ');
  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`Queries   : ${summary.queryCount}\n`);
  process.stdout.write(`MRR       : ${summary.mrr.toFixed(4)}\n`);
  process.stdout.write(`${recallLine}\n`);
  process.stdout.write(`${ndcgLine}\n`);
}

function printCaseTable(baseline: BenchmarkCase[], oce: BenchmarkCase[]): void {
  process.stdout.write('\n=== 逐条命中对比（relevant → 命中位置 / - 未命中）===\n');
  for (let i = 0; i < baseline.length; i += 1) {
    const b = baseline[i];
    const o = oce[i];
    const rel = Object.keys(b.relevant);
    const posOf = (c: BenchmarkCase) =>
      rel.map((filePath) => `${filePath}#${c.retrieved.indexOf(filePath)}`).join(', ');
    process.stdout.write(`${b.id.padEnd(30)} baseline[${posOf(b).padEnd(24)}] oce[${posOf(o)}]\n`);
  }
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const options = parseCliArgs(argv);
  const repoPath = path.resolve(options.repoPath);
  const projectId = generateProjectId(repoPath);

  logger.info({ repoPath, projectId, force: options.force }, 'Live benchmark 启动');

  // 1) 索引（增量除非 --force；真实 Embedding API 调用）
  const { withLock } = await import('../../utils/lock.js');
  const scanStats = await withLock(
    projectId,
    'index',
    () =>
      scan(repoPath, {
        force: options.force,
        onProgress: (current, total) => {
          if (total !== undefined && current % 10 === 0) {
            process.stdout.write(`索引进度 ${current}/${total}\r`);
          }
        },
      }),
    10 * 60 * 1000,
  );

  process.stdout.write(
    `索引完成: 新增${scanStats.added} 修改${scanStats.modified} 未变${scanStats.unchanged} 删除${scanStats.deleted} 错误${scanStats.errors}\n`,
  );

  // 2) 加载 ground-truth 数据集
  const datasetPath = path.resolve(options.datasetPath);
  const dataset = await loadGroundTruth(datasetPath);
  if (dataset.length === 0) {
    throw new Error(`数据集为空: ${datasetPath}`);
  }

  process.stdout.write(`数据集: ${datasetPath} (${dataset.length} queries)\n`);

  // 3) 跑两种模式
  const baseline = await runMode(projectId, repoPath, dataset, OCE_FEATURES_OFF, 'baseline');
  const oce = await runMode(projectId, repoPath, dataset, OCE_FEATURES_ON, 'oce');

  // 4) 输出
  printCaseTable(baseline, oce);
  printSummary(
    'OCE 特性全关 (baseline)',
    evaluateBenchmarkCases(baseline, options.kValues),
    options.kValues,
  );
  printSummary('OCE 特性全开', evaluateBenchmarkCases(oce, options.kValues), options.kValues);
}

main(process.argv.slice(2)).catch((err) => {
  const error = err as Error;
  logger.error({ err, stack: error.stack }, `Live benchmark 失败: ${error.message}`);
  process.exit(1);
});
