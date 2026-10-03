import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { handleAgentMemory } from '../../src/mcp/tools/agentMemory.js';
import { MemoryService } from '../../src/memory/MemoryService.js';
import { initMemoryTables } from '../../src/memory/schema.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  initMemoryTables(db);
  return db;
}

test('MemoryService: 记录和读取四层记忆条目', () => {
  const db = createTestDb();
  const service = new MemoryService(db);

  // 1. 记录 failure
  const failItem = service.recordMemory({
    category: 'failure',
    title: 'Background timer hangs process',
    content: 'setInterval without unref() prevents Node.js process from exiting',
    targetFiles: ['src/mcp/sessionManager.ts'],
    tags: ['timer', 'node'],
  });

  assert.equal(failItem.category, 'failure');
  assert.equal(failItem.title, 'Background timer hangs process');
  assert.deepEqual(failItem.targetFiles, ['src/mcp/sessionManager.ts']);

  // 2. 记录 strategy
  const stratItem = service.recordMemory({
    category: 'strategy',
    title: 'Always unref background timers',
    content: 'Call timer.unref?.() immediately after creating setInterval',
    targetFiles: ['src/mcp/sessionManager.ts'],
    tags: ['timer', 'best-practice'],
  });

  // 3. 记录 constraint
  const constItem = service.recordMemory({
    category: 'constraint',
    title: 'Strict ESM relative import extensions',
    content: 'All relative imports in TypeScript must have .js extensions',
    tags: ['esm', 'typescript'],
  });

  // 列表查询
  const all = service.listMemories();
  assert.equal(all.length, 3);

  const failures = service.listMemories('failure');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, failItem.id);

  // get by ID
  const retrieved = service.getMemory(stratItem.id);
  assert.ok(retrieved);
  assert.equal(retrieved?.title, 'Always unref background timers');

  // delete
  const deleted = service.deleteMemory(constItem.id);
  assert.equal(deleted, true);
  assert.equal(service.listMemories().length, 2);

  db.close();
});

test('MemoryService: findRelevantMemories 按关联文件与关键词加权检索', () => {
  const db = createTestDb();
  const service = new MemoryService(db);

  service.recordMemory({
    category: 'failure',
    title: 'LanceDB schema mismatch',
    content: 'Dropping columns without table recreate throws LanceError',
    targetFiles: ['src/vectorStore/index.ts'],
    tags: ['lancedb', 'vector'],
    priority: 60,
  });

  service.recordMemory({
    category: 'failure',
    title: 'Timer leak',
    content: 'Uncleaned timer causes memory leak',
    targetFiles: ['src/mcp/sessionManager.ts'],
    tags: ['timer'],
    priority: 50,
  });

  // 搜索关联文件 sessionManager.ts
  const resultsByFile = service.findRelevantMemories({
    targetFiles: ['src/mcp/sessionManager.ts'],
  });

  assert.ok(resultsByFile.length > 0);
  assert.equal(resultsByFile[0].title, 'Timer leak');

  // 搜索关键词 LanceDB
  const resultsByQuery = service.findRelevantMemories({
    query: 'LanceDB schema',
  });

  assert.ok(resultsByQuery.length > 0);
  assert.equal(resultsByQuery[0].title, 'LanceDB schema mismatch');

  db.close();
});

test('MemoryService: compileWorkingContext 按优先级生成上下文并在超预算时裁剪', () => {
  const db = createTestDb();
  const service = new MemoryService(db);

  service.recordMemory({
    category: 'constraint',
    title: 'Never read process.env directly',
    content: 'Always read configuration from src/config.ts getters',
    priority: 85,
  });

  service.recordMemory({
    category: 'failure',
    title: 'Do not import native bindings in MCP init',
    content: 'Dynamic import is required to keep MCP boot fast',
    priority: 75,
  });

  service.recordMemory({
    category: 'strategy',
    title: 'Incremental indexing with xxhash',
    content: 'Use fast hash comparisons to skip unchanged files',
    priority: 60,
  });

  service.recordMemory({
    category: 'decision',
    title: 'Use tsup for ESM bundle',
    content: 'Target node 22 with clean sourcemap configs',
    priority: 50,
  });

  // 正常预算下的编译
  const normalCompiled = service.compileWorkingContext({
    task: 'Refactor search pipeline',
    maxChars: 5000,
  });

  assert.ok(normalCompiled.markdown.includes('Current Task / Objective'));
  assert.ok(normalCompiled.markdown.includes('Refactor search pipeline'));
  assert.ok(normalCompiled.markdown.includes('Project Constraints & Rules'));
  assert.ok(normalCompiled.markdown.includes('Never read process.env directly'));
  assert.ok(normalCompiled.markdown.includes('Known Failures to Avoid'));
  assert.equal(normalCompiled.truncated, false);

  // 极紧预算（500 chars）：应优先裁剪 low priority（decision, strategy）而保留 constraint & task
  const tightCompiled = service.compileWorkingContext({
    task: 'Fix critical bug',
    maxChars: 500,
  });

  assert.equal(tightCompiled.truncated, true);
  assert.ok(tightCompiled.markdown.length <= 600);
  assert.ok(tightCompiled.markdown.includes('Fix critical bug'));
  assert.ok(tightCompiled.markdown.includes('Project Constraints & Rules'));

  db.close();
});

test('handleAgentMemory: MCP Tool 端到端调用', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-memory-test-'));

  try {
    // 1. record_failure
    const recordRes = await handleAgentMemory({
      repo_path: tmpDir,
      action: 'record_failure',
      title: 'SQLite locked in concurrent writes',
      content: 'Enable WAL mode and busy_timeout to avoid database locked errors',
      target_files: ['src/db/index.ts'],
      tags: ['sqlite', 'concurrency'],
    });

    assert.equal(recordRes.isError, undefined);
    assert.ok(recordRes.content[0].text.includes('Memory recorded [FAILURE]'));

    // 2. query
    const queryRes = await handleAgentMemory({
      repo_path: tmpDir,
      action: 'query',
      query: 'SQLite concurrent',
    });

    assert.equal(queryRes.isError, undefined);
    assert.ok(queryRes.content[0].text.includes('SQLite locked in concurrent writes'));

    // 3. compile_context
    const compileRes = await handleAgentMemory({
      repo_path: tmpDir,
      action: 'compile_context',
      task: 'Optimize SQLite write performance',
    });

    assert.equal(compileRes.isError, undefined);
    assert.ok(compileRes.content[0].text.includes('ACE Working Context'));
    assert.ok(compileRes.content[0].text.includes('SQLite locked in concurrent writes'));

    // 4. setup_hooks
    const hooksRes = await handleAgentMemory({
      repo_path: tmpDir,
      action: 'setup_hooks',
    });

    assert.equal(hooksRes.isError, undefined);
    assert.ok(hooksRes.content[0].text.includes('Claude Code native hooks configured'));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'hooks', 'session-start.mjs')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
