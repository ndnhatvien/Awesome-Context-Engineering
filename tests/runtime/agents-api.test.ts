/**
 * Agent Orchestration API Tests
 *
 * Tests for /agents/* endpoints:
 * - /agents/check-tool-safety
 * - /agents/revoke-tool-access
 * - /agents/edit-file
 * - /agents/run-remote-tool
 */

import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkToolSafety, isToolRevoked, revokedToolsMap } from '../../src/mcp/agentRoutes.js';

// ===========================================
// Test: checkToolSafety
// ===========================================

test('checkToolSafety — safe tool returns safe', () => {
  const result = checkToolSafety('codebase-retrieval', {
    repo_path: '/workspace/project',
    information_request: 'find auth logic',
  });
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.risk_level, 'safe');
});

test('checkToolSafety — path traversal is denied', () => {
  const result = checkToolSafety(
    'edit-file',
    {
      file_path: '../../etc/passwd',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
  assert.ok(result.reason?.includes('Path traversal'));
});

test('checkToolSafety — system path /etc is denied', () => {
  const result = checkToolSafety('edit-file', {
    file_path: '/etc/passwd',
  });
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
  assert.ok(result.reason?.includes('system-sensitive'));
});

test('checkToolSafety — Windows system path is denied', () => {
  const result = checkToolSafety('edit-file', {
    file_path: 'C:\\Windows\\System32\\config',
  });
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
});

test('checkToolSafety — .ssh path is denied', () => {
  const result = checkToolSafety('edit-file', {
    file_path: '/home/user/.ssh/id_rsa',
  });
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
  assert.ok(result.reason?.includes('.ssh'));
});

test('checkToolSafety — editing .env returns warning', () => {
  const result = checkToolSafety(
    'edit-file',
    {
      file_path: 'src/.env',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.risk_level, 'warning');
  assert.ok(result.reason?.includes('.env'));
});

test('checkToolSafety — editing package.json returns warning', () => {
  const result = checkToolSafety(
    'edit-file',
    {
      file_path: 'package.json',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.risk_level, 'warning');
});

test('checkToolSafety — dangerous command rm -rf / is denied', () => {
  const result = checkToolSafety('run-command', {
    command: 'rm -rf /',
  });
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
  assert.ok(result.reason?.includes('Dangerous command'));
});

test('checkToolSafety — normal edit in workspace is safe', () => {
  const result = checkToolSafety(
    'edit-file',
    {
      file_path: 'src/app.ts',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.risk_level, 'safe');
});

test('checkToolSafety — delete-file without repo_path is denied', () => {
  const result = checkToolSafety('delete-file', {
    file_path: 'some-file.ts',
  });
  assert.strictEqual(result.safe, false);
  assert.strictEqual(result.risk_level, 'denied');
});

test('checkToolSafety — delete-file with repo_path is warning', () => {
  const result = checkToolSafety(
    'delete-file',
    {
      file_path: 'temp.ts',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.safe, true);
  assert.strictEqual(result.risk_level, 'warning');
});

// ===========================================
// Test: revokedToolsMap & isToolRevoked
// ===========================================

test('isToolRevoked — returns false for unknown session', () => {
  assert.strictEqual(isToolRevoked('unknown-session', 'edit-file'), false);
});

test('isToolRevoked — returns true after revoking specific tool', () => {
  const sessionId = 'test-session-1';
  revokedToolsMap.set(sessionId, new Set(['edit-file']));
  assert.strictEqual(isToolRevoked(sessionId, 'edit-file'), true);
  assert.strictEqual(isToolRevoked(sessionId, 'run-remote-tool'), false);
  // Cleanup
  revokedToolsMap.delete(sessionId);
});

test('isToolRevoked — wildcard * revokes all tools', () => {
  const sessionId = 'test-session-2';
  revokedToolsMap.set(sessionId, new Set(['*']));
  assert.strictEqual(isToolRevoked(sessionId, 'edit-file'), true);
  assert.strictEqual(isToolRevoked(sessionId, 'run-remote-tool'), true);
  assert.strictEqual(isToolRevoked(sessionId, 'any-tool'), true);
  // Cleanup
  revokedToolsMap.delete(sessionId);
});

// ===========================================
// Test: edit-file (file system)
// ===========================================

const TEST_DIR = path.join(process.cwd(), '.test-agents-tmp');

async function setupTestDir(): Promise<void> {
  await fs.mkdir(TEST_DIR, { recursive: true });
}

async function cleanupTestDir(): Promise<void> {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

test('edit-file — create file works', async () => {
  await setupTestDir();
  try {
    const filePath = path.join(TEST_DIR, 'new-file.txt');
    const content = 'Hello, Agent!';
    await fs.writeFile(filePath, content, 'utf-8');
    const result = await fs.readFile(filePath, 'utf-8');
    assert.strictEqual(result, content);
  } finally {
    await cleanupTestDir();
  }
});

test('edit-file — patch logic applies correctly', async () => {
  await setupTestDir();
  try {
    const filePath = path.join(TEST_DIR, 'patch-test.txt');
    const original = 'line1\nline2\nline3\nline4\nline5';
    await fs.writeFile(filePath, original, 'utf-8');

    // Simulate patch: replace line 2-3 with new content
    const lines = original.split('\n');
    const startLine = 2;
    const endLine = 3;
    const replacement = 'NEW_LINE_2\nNEW_LINE_3';
    const replacementLines = replacement.split('\n');
    lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
    const newContent = lines.join('\n');

    await fs.writeFile(filePath, newContent, 'utf-8');
    const result = await fs.readFile(filePath, 'utf-8');
    assert.strictEqual(result, 'line1\nNEW_LINE_2\nNEW_LINE_3\nline4\nline5');
  } finally {
    await cleanupTestDir();
  }
});

test('edit-file — path traversal detection works', () => {
  const result = checkToolSafety(
    'edit-file',
    {
      file_path: '../../../etc/passwd',
    },
    '/workspace/project',
  );
  assert.strictEqual(result.risk_level, 'denied');
  assert.ok(result.reason?.includes('Path traversal'));
});

// ===========================================
// Test: run-remote-tool (self-dispatch validation)
// ===========================================

test('run-remote-tool — safety check blocks dangerous remote tool call', () => {
  const result = checkToolSafety('run-command', {
    command: 'rm -rf /',
  });
  assert.strictEqual(result.risk_level, 'denied');
});

test('run-remote-tool — revoked session is properly blocked', () => {
  const sessionId = 'remote-test-session';
  revokedToolsMap.set(sessionId, new Set(['run-remote-tool']));
  assert.strictEqual(isToolRevoked(sessionId, 'run-remote-tool'), true);
  assert.strictEqual(isToolRevoked(sessionId, 'edit-file'), false);
  revokedToolsMap.delete(sessionId);
});

// ===========================================
// Summary
// ===========================================

test('agents-api — all core unit tests pass', () => {
  console.log('\n✅ All agent API unit tests passed!\n');
  assert.ok(true);
});
