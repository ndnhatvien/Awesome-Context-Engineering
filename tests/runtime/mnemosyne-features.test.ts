import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { AdaptiveReplacementCache } from '../../src/cache/AdaptiveReplacementCache.js';
import { getLanguage } from '../../src/scanner/language.js';
import {
  introspectSqliteDatabase,
  parseSqlSchema,
  parseSqlToChunks,
  schemaToChunks,
} from '../../src/scanner/schemaIngester.js';
import {
  applyCostModelRanking,
  calculateDensityScore,
  estimateChunkTokens,
  estimateTokens,
} from '../../src/search/costModelRanking.js';
import type { ScoredChunk } from '../../src/search/types.js';

// ===========================================
// Test Suite 1: Adaptive Replacement Cache (ARC)
// ===========================================

test('ARC Cache: 基础存取与命中率统计', () => {
  const cache = new AdaptiveReplacementCache<string, string>(4);

  assert.equal(cache.size, 0);
  assert.equal(cache.get('k1'), undefined);

  cache.set('k1', 'val1');
  assert.equal(cache.has('k1'), true);
  assert.equal(cache.peek('k1'), 'val1');
  assert.equal(cache.get('k1'), 'val1'); // 1 miss, 1 hit

  const stats = cache.getStats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.hitRatio, 0.5);
  assert.equal(stats.capacity, 4);
});

test('ARC Cache: 访问两次以上晋升至 T2 (频次优先)', () => {
  const cache = new AdaptiveReplacementCache<string, string>(4);

  cache.set('a', '1');
  // First access after set promotes to T2 in ARC
  cache.get('a');

  const stats = cache.getStats();
  assert.equal(stats.t2Size, 1);
  assert.equal(stats.t1Size, 0);
});

test('ARC Cache: 幽灵命中自适应调整目标大小 p', () => {
  // Capacity = 2
  const cache = new AdaptiveReplacementCache<string, string>(2);

  cache.set('k1', 'v1');
  cache.set('k2', 'v2');
  // Evicts k1 into B1 ghost history
  cache.set('k3', 'v3');

  let stats = cache.getStats();
  assert.ok(stats.b1Size > 0, 'k1 应进入 B1 幽灵列表');

  // Request k1 again (hits B1 ghost history)
  cache.set('k1', 'v1_new');
  stats = cache.getStats();
  // Target p should adaptively increase to favor recency
  assert.ok(stats.p > 0, 'B1 幽灵命中后 p 应增加');
});

test('ARC Cache: 抗扫描污染 (Scan Resistance)', () => {
  // Cache of capacity 3
  const cache = new AdaptiveReplacementCache<string, string>(3);

  // Hot items: accessed multiple times -> safely stored in T2
  cache.set('hot_1', 'val1');
  cache.get('hot_1');
  cache.set('hot_2', 'val2');
  cache.get('hot_2');

  assert.equal(cache.getStats().t2Size, 2);

  // Large scan sequence of 10 one-off keys
  for (let i = 0; i < 10; i++) {
    cache.set(`scan_${i}`, `temp_${i}`);
  }

  // Hot items in T2 should NOT be wiped out by one-off scan items
  assert.equal(cache.has('hot_1'), true, '频繁热点项 hot_1 应抵抗扫描污染保留在缓存中');
  assert.equal(cache.has('hot_2'), true, '频繁热点项 hot_2 应抵抗扫描污染保留在缓存中');
});

test('ARC Cache: TTL 过期清理与 onEvict 回调', async () => {
  const evicted: Array<{ key: string; value: string }> = [];
  const cache = new AdaptiveReplacementCache<string, string>({
    capacity: 2,
    defaultTtlMs: 25,
    onEvict: (key, value) => {
      evicted.push({ key, value });
    },
  });

  cache.set('ttl_key', 'quick_val');
  assert.equal(cache.get('ttl_key'), 'quick_val');

  // Wait for TTL expiration
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(cache.get('ttl_key'), undefined, 'TTL 到期后应返回 undefined');
  assert.equal(cache.has('ttl_key'), false);

  // Test onEvict on overflow
  cache.set('x', '1', 10000);
  cache.set('y', '2', 10000);
  cache.set('z', '3', 10000);
  assert.ok(evicted.length > 0, '溢出淘汰时应触发 onEvict 回调');
});

// ===========================================
// Test Suite 2: Cost-Model Ranking (Value-per-Token)
// ===========================================

test('Cost-Model: Token 估算与密度公式计算', () => {
  assert.equal(estimateTokens(''), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(400)), 100);

  // When alpha = 0: pure relevance, no token penalty
  assert.equal(calculateDensityScore(0.9, 1000, 0), 0.9);

  // When alpha = 0.15: compact chunk has higher value-per-token density
  const compactDensity = calculateDensityScore(0.85, 100, 0.15); // reference size 100 -> ~0.85
  const bloatedDensity = calculateDensityScore(0.88, 2500, 0.15); // heavily penalized

  assert.ok(
    compactDensity > bloatedDensity,
    `紧凑代码块密度得分 (${compactDensity.toFixed(4)}) 应高于庞大冗余文件 (${bloatedDensity.toFixed(4)})`,
  );
});

test('Cost-Model: applyCostModelRanking 智能重排序', () => {
  function createFakeChunk(filePath: string, score: number, codeLength: number): ScoredChunk {
    return {
      filePath,
      chunkIndex: 0,
      score,
      source: 'both',
      record: {
        chunk_id: `${filePath}#0`,
        file_path: filePath,
        file_hash: 'hash',
        chunk_index: 0,
        vector: [],
        display_code: 'x'.repeat(codeLength),
        vector_text: 'x'.repeat(codeLength),
        language: 'typescript',
        breadcrumb: 'Test',
        start_index: 0,
        end_index: codeLength,
        raw_start: 0,
        raw_end: codeLength,
        vec_start: 0,
        vec_end: codeLength,
        _distance: 1 - score,
      },
    };
  }

  // Chunk A: bloated 6000 chars (1500 tokens), score 0.89
  const bloatedChunk = createFakeChunk('src/huge_monolith.ts', 0.89, 6000);
  // Chunk B: compact 320 chars (80 tokens), score 0.86
  const compactChunk = createFakeChunk('src/focused_helper.ts', 0.86, 320);

  const candidates = [bloatedChunk, compactChunk];

  // Pure density re-ranking (preserveTopK = 0)
  const ranked = applyCostModelRanking(candidates, { alpha: 0.18, preserveTopK: 0 });

  assert.equal(
    ranked[0].filePath,
    'src/focused_helper.ts',
    '高信息密度的紧凑函数应被排在臃肿大文件前面',
  );

  // Anchor protection test (preserveTopK = 1)
  const anchored = applyCostModelRanking(candidates, { alpha: 0.18, preserveTopK: 1 });
  assert.equal(
    anchored[0].filePath,
    'src/huge_monolith.ts',
    '开启 anchor 保护时，Top-1 绝对高分应保留在第一位',
  );
  assert.equal(anchored[1].filePath, 'src/focused_helper.ts');
});

// ===========================================
// Test Suite 3: Database Schema & DDL Ingestion
// ===========================================

test('SchemaIngester: SQL DDL 解析 Table / Columns / Foreign Keys / Indices', () => {
  const sqlDdl = `
    -- Core user table
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_org ON users(organization_id);

    CREATE TABLE audit_logs (
      log_id INTEGER PRIMARY KEY,
      user_id UUID,
      action TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `;

  const schemas = parseSqlSchema(sqlDdl, 'schema.sql');
  assert.equal(schemas.length, 2);

  const usersTable = schemas.find((s) => s.tableName.toLowerCase() === 'users');
  assert.ok(usersTable, '应成功解析 users 表');
  assert.equal(usersTable?.columns.length, 5);

  const emailCol = usersTable?.columns.find((c) => c.name === 'email');
  assert.equal(emailCol?.type, 'VARCHAR(255)');
  assert.equal(emailCol?.isUnique, true);
  assert.equal(emailCol?.isNullable, false);

  assert.equal(usersTable?.indices.length, 2);
  assert.ok(usersTable?.indices.some((idx) => idx.name === 'idx_users_email' && idx.isUnique));

  const auditTable = schemas.find((s) => s.tableName.toLowerCase() === 'audit_logs');
  assert.ok(auditTable, '应成功解析 audit_logs 表');
  assert.equal(auditTable?.foreignKeys.length, 1);
  assert.equal(auditTable?.foreignKeys[0].foreignTable, 'users');
  assert.equal(auditTable?.foreignKeys[0].onDelete, 'SET NULL');
});

test('SchemaIngester: schemaToChunks 产出高保真语义分片', () => {
  const sqlDdl = `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT REFERENCES users(id)
    );
  `;

  const chunks = parseSqlToChunks(sqlDdl, 'db/migrations/001_projects.sql');
  assert.equal(chunks.length, 1);

  const chunk = chunks[0];
  assert.equal(chunk.metadata.language, 'sql');
  assert.deepEqual(chunk.metadata.contextPath, ['Schema', 'Table', 'projects']);
  assert.ok(chunk.displayCode.includes('CREATE TABLE projects'));
  assert.ok(chunk.vectorText.includes('Table Schema: projects'));
  assert.ok(chunk.vectorText.includes('owner_id (TEXT, REFERENCES users)'));
});

test('SchemaIngester: 实时 SQLite 数据库内省 (introspectSqliteDatabase)', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE departments (
        dept_id INTEGER PRIMARY KEY AUTOINCREMENT,
        dept_name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE employees (
        emp_id INTEGER PRIMARY KEY,
        full_name TEXT NOT NULL,
        department_id INTEGER,
        salary REAL DEFAULT 0.0,
        FOREIGN KEY (department_id) REFERENCES departments(dept_id)
      );

      CREATE INDEX idx_emp_dept ON employees(department_id);
    `);

    const schemas = introspectSqliteDatabase(db);
    assert.equal(schemas.length, 2);

    const emp = schemas.find((s) => s.tableName === 'employees');
    assert.ok(emp);
    assert.equal(emp?.columns.length, 4);
    assert.equal(emp?.primaryKeys[0], 'emp_id');
    assert.equal(emp?.foreignKeys.length, 1);
    assert.equal(emp?.foreignKeys[0].foreignTable, 'departments');
    assert.ok(emp?.indices.some((idx) => idx.name === 'idx_emp_dept'));
  } finally {
    db.close();
  }
});

test('Language: .ddl 扩展名正确识别为 sql', () => {
  assert.equal(getLanguage('migrations/001_initial.ddl'), 'sql');
  assert.equal(getLanguage('schema.sql'), 'sql');
});
