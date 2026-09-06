import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { processFiles } from '../../src/scanner/processor.js';

test('性能档分片应优先减少 chunk 数而不丢失内容', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-chunk-profile-'));
  const filePath = path.join(tempRoot, 'Large.ts');

  try {
    const content = Array.from(
      { length: 200 },
      (_, index) => `export function fn${index}() { return ${index}; }`,
    ).join('\n');

    await fs.writeFile(filePath, content, 'utf8');

    const results = await processFiles(tempRoot, [filePath], new Map());
    const [result] = results;

    assert.equal(result.status, 'added');
    assert.ok(result.chunks.length > 0, '仍应产出 chunk');
    assert.ok(
      result.chunks.length < 20,
      `性能档应减少 chunk 数，当前产出过多: ${result.chunks.length}`,
    );
    assert.equal(
      result.chunks.some((chunk) => chunk.displayCode.includes('fn199')),
      true,
      '尾部内容不应丢失',
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
