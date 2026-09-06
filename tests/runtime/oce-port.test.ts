import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { batchUpsert, closeDb, initDb } from '../../src/db/index.js';
import { coverageSelect } from '../../src/search/coverage.js';
import { detectPathQuery, mergePathBoost, searchPathsFts } from '../../src/search/pathIndex.js';
import {
  applySourcePriority,
  sourcePriorityFactor,
} from '../../src/search/sourcePriority.js';
import {
  batchDeleteFileSymbols,
  batchUpsertSymbols,
  extractChunkSymbols,
  extractSymbolIdentifiers,
  initSymbolTable,
  isSymbolTableInitialized,
  searchSymbolOccurrences,
  type SymbolRow,
} from '../../src/search/symbols.js';
import type { ScoredChunk } from '../../src/search/types.js';
import { getProjectDataDir } from '../../src/utils/paths.js';

function projectDir(projectId: string): string {
  return getProjectDataDir(projectId);
}

function buildChunk(args: {
  filePath: string;
  chunkIndex: number;
  score: number;
  rawStart: number;
  rawEnd: number;
}): ScoredChunk {
  const fileHash = 'h';
  return {
    filePath: args.filePath,
    chunkIndex: args.chunkIndex,
    score: args.score,
    source: 'vector',
    record: {
      chunk_id: `${args.filePath}#${fileHash}#${args.chunkIndex}`,
      file_path: args.filePath,
      file_hash: fileHash,
      chunk_index: args.chunkIndex,
      vector: [0],
      display_code: '',
      vector_text: '',
      language: 'typescript',
      breadcrumb: `${args.filePath} > fn`,
      start_index: args.rawStart,
      end_index: args.rawEnd,
      raw_start: args.rawStart,
      raw_end: args.rawEnd,
      vec_start: args.rawStart,
      vec_end: args.rawEnd,
      _distance: 0,
    },
  };
}

// ===========================================
// Source Priority Ranking
// ===========================================

test('sourcePriorityFactor 应区分 文档/测试/源码', () => {
  const options = { enabled: true, docFactor: 0.3, testFactor: 0.5 };

  assert.equal(sourcePriorityFactor('docs/guide.md', options), 0.3);
  assert.equal(sourcePriorityFactor('README.md', options), 0.3);
  assert.equal(sourcePriorityFactor('src/app.test.ts', options), 0.5);
  assert.equal(sourcePriorityFactor('tests/foo.ts', options), 0.5);
  assert.equal(sourcePriorityFactor('src/search/GraphExpander.ts', options), 1.0);
});

test('applySourcePriority 应按有效分重排并重打分', () => {
  const docs = buildChunk({ filePath: 'docs/overview.md', chunkIndex: 0, score: 0.9, rawStart: 0, rawEnd: 10 });
  const code = buildChunk({ filePath: 'src/core.ts', chunkIndex: 0, score: 0.7, rawStart: 0, rawEnd: 10 });
  const options = { enabled: true, docFactor: 0.3, testFactor: 0.5 };

  const out = applySourcePriority([docs, code], options);

  // 0.7*1.0 > 0.9*0.3 → 源码排到文档前面
  assert.equal(out[0].filePath, 'src/core.ts');
  assert.equal(out[1].filePath, 'docs/overview.md');
  assert.ok(Math.abs(out[1].score - 0.9 * 0.3) < 1e-9);
});

test('applySourcePriority 未启用时原样返回', () => {
  const items = [buildChunk({ filePath: 'src/a.ts', chunkIndex: 0, score: 0.9, rawStart: 0, rawEnd: 1 })];
  const out = applySourcePriority(items, { enabled: false, docFactor: 0.3, testFactor: 0.5 });
  assert.equal(out, items);
});

// ===========================================
// Coverage-first Selector
// ===========================================

test('coverageSelect 两段填充：先每文件一段，再补第二段', () => {
  const chunks = [
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 0, score: 0.9, rawStart: 0, rawEnd: 11 }),
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 1, score: 0.8, rawStart: 8, rawEnd: 18 }),
    buildChunk({ filePath: 'src/b.ts', chunkIndex: 0, score: 0.7, rawStart: 0, rawEnd: 10 }),
  ];

  const selected = coverageSelect(chunks, {
    maxPerPath: 3,
    maxChars: 1000,
    overlapThreshold: 0.6,
  });

  // Pass1 先收每文件最高分段（a0、b0），Pass2 再补 a1
  assert.deepEqual(
    selected.map((c) => `${c.filePath}#${c.chunkIndex}`),
    ['src/a.ts#0', 'src/b.ts#0', 'src/a.ts#1'],
  );
});

test('coverageSelect 同文件重叠超阈值的 chunk 应被抑制', () => {
  const chunks = [
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 0, score: 0.9, rawStart: 0, rawEnd: 11 }),
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 1, score: 0.8, rawStart: 9, rawEnd: 11 }),
  ];

  const selected = coverageSelect(chunks, {
    maxPerPath: 3,
    maxChars: 1000,
    overlapThreshold: 0.6,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].chunkIndex, 0);
});

test('coverageSelect 应遵守每文件上限与总预算', () => {
  const chunks = [
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 0, score: 0.95, rawStart: 0, rawEnd: 10 }),
    buildChunk({ filePath: 'src/a.ts', chunkIndex: 1, score: 0.8, rawStart: 11, rawEnd: 21 }),
    buildChunk({ filePath: 'src/b.ts', chunkIndex: 0, score: 0.7, rawStart: 0, rawEnd: 10 }),
  ];

  const perPath = coverageSelect(chunks, { maxPerPath: 1, maxChars: 1000, overlapThreshold: 0.6 });
  assert.equal(perPath.filter((c) => c.filePath === 'src/a.ts').length, 1);

  const budget = coverageSelect(chunks, { maxPerPath: 3, maxChars: 19, overlapThreshold: 0.6 });
  assert.deepEqual(budget.map((c) => c.filePath), ['src/a.ts']);
});

// ===========================================
// Exact Symbol Recall
// ===========================================

test('symbol 抽取 → 变体 → 精确召回闭环', async () => {
  const projectId = `oce-symbols-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const db = initDb(projectId);

  try {
    const rows: SymbolRow[] = [
      ...extractChunkSymbols(
        'export function searchServiceFactory() {\n  return {};\n}',
        'typescript',
        'src/a.ts',
        'a#0',
      ),
      ...extractChunkSymbols('export class GraphExpander {}', 'typescript', 'src/b.ts', 'b#0'),
    ];

    assert.ok(rows.some((r) => r.symbolName === 'search_service_factory'), '应包含 snake_case 变体');
    assert.ok(rows.some((r) => r.symbolName === 'graphexpander'), '应包含去分隔符变体');

    batchUpsertSymbols(db, rows);

    // snake_case 查询式能命中 camelCase 声明的符号
    const hits = searchSymbolOccurrences(db, ['search_service_factory'], 10);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].filePath, 'src/a.ts');
    assert.equal(hits[0].chunkId, 'a#0');

    // 去分隔符写法命中
    const lowerHits = searchSymbolOccurrences(db, ['graphexpander'], 10);
    assert.equal(lowerHits.length, 1);
    assert.equal(lowerHits[0].filePath, 'src/b.ts');

    // 删除文件后符号清空
    batchDeleteFileSymbols(db, ['src/a.ts']);
    assert.equal(searchSymbolOccurrences(db, ['search_service_factory'], 10).length, 0);
  } finally {
    closeDb(db);
    await fs.rm(projectDir(projectId), { recursive: true, force: true });
  }
});

test('extractSymbolIdentifiers 应过滤自然语言词并保留代码标识符', () => {
  const ids = extractSymbolIdentifiers('where is the GraphExpander file');
  assert.ok(ids.includes('graphexpander'));
  assert.ok(!ids.includes('where') && !ids.includes('the') && !ids.includes('file'));
});

test('isSymbolTableInitialized 反映表是否存在', () => {
  const projectId = `oce-symbol-init-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const db = initDb(projectId);

  try {
    assert.equal(isSymbolTableInitialized(db), true);
    db.exec('DROP TABLE symbol_occurrences');
    assert.equal(isSymbolTableInitialized(db), false);
    initSymbolTable(db);
    assert.equal(isSymbolTableInitialized(db), true);
  } finally {
    closeDb(db);
    void fs.rm(projectDir(projectId), { recursive: true, force: true });
  }
});

// ===========================================
// Path Index / Filename queries
// ===========================================

test('detectPathQuery 识别文件名/路径意图', () => {
  assert.equal(detectPathQuery('where is GraphExpander.ts'), true);
  assert.equal(detectPathQuery('src/search/index.ts'), true);
  assert.equal(detectPathQuery('GraphExpander'), true, '单 token 视为精确目标');
  assert.equal(detectPathQuery('how should I handle retries in the client'), false);
});

test('searchPathsFts 应命中文件路径列', async () => {
  const projectId = `oce-path-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const db = initDb(projectId);

  try {
    batchUpsert(db, [
      {
        path: 'src/search/GraphExpander.ts',
        hash: 'h1',
        mtime: Date.now(),
        size: 10,
        content: 'export class GraphExpander {}',
        language: 'typescript',
        vectorIndexHash: null,
      },
      {
        path: 'src/search/ContextPacker.ts',
        hash: 'h2',
        mtime: Date.now(),
        size: 10,
        content: 'export class ContextPacker {}',
        language: 'typescript',
        vectorIndexHash: null,
      },
    ]);

    const hits = searchPathsFts(db, 'GraphExpander.ts', 10);
    assert.ok(hits.length >= 1, '至少命中一个文件');
    assert.ok(hits.some((h) => h.path === 'src/search/GraphExpander.ts'));
  } finally {
    closeDb(db);
    await fs.rm(projectDir(projectId), { recursive: true, force: true });
  }
});

test('mergePathBoost 应加分同文件候选并回填新文件首段', async () => {
  const candidates = [buildChunk({ filePath: 'src/search/GraphExpander.ts', chunkIndex: 0, score: 0.5, rawStart: 0, rawEnd: 5 })];

  const pathHits = [
    { path: 'src/search/GraphExpander.ts', score: 9.5 },
    { path: 'src/search/ContextPacker.ts', score: 8.0 },
  ];

  const vectorStore = {
    getFilesChunks: async (paths: string[]) => {
      const map = new Map<string, Array<Record<string, unknown>>>();
      for (const p of paths) {
        map.set(p, [
          {
            chunk_id: `${p}#h#0`,
            file_path: p,
            file_hash: 'h',
            chunk_index: 0,
            vector: [0],
            display_code: '',
            vector_text: '',
            language: 'typescript',
            breadcrumb: `${p} > c`,
            start_index: 0,
            end_index: 10,
            raw_start: 0,
            raw_end: 10,
            vec_start: 0,
            vec_end: 10,
          },
        ]);
      }
      return map;
    },
  } as never;

  const merged = await mergePathBoost(
    candidates,
    pathHits,
    vectorStore as {
      getFilesChunks(
        filePaths: string[],
      ): Promise<Map<string, import('../../src/vectorStore/index.js').ChunkRecord[]>>;
    },
    { weight: 0.3, backfillBaseScore: 0.6, backfillPerFile: 2, backfillFiles: 5 },
  );

  assert.equal(merged.length, 2, '1 个已有候选 + 1 个回填文件首段');
  assert.ok(merged.some((c) => c.filePath === 'src/search/ContextPacker.ts'));
  assert.ok(merged[0].filePath === 'src/search/GraphExpander.ts');
});