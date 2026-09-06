import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EmbeddingCache } from '../../src/api/embeddingCache.js';

test('EmbeddingCache - set, get, and roundtrip values', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-embed-cache-test-'));

  try {
    const cache = new EmbeddingCache('test-model', tempDir);
    const texts = ['hello world', 'test query', 'another string to cache'];
    const originalVectors = [
      [1.0, 2.0, -3.5, 4.2],
      [-0.1, 0.2, 0.3, -0.4],
      [10.5, 20.6, 30.7, 40.8],
    ].map((arr) => Array.from(new Float32Array(arr)));

    // Put values
    await cache.putMany(texts, originalVectors);

    // Get values
    const { hits, misses } = await cache.getMany(texts);

    assert.equal(misses.length, 0, 'Should have 0 misses');
    assert.equal(hits.size, 3, 'Should have 3 hits');

    assert.deepEqual(hits.get(0), originalVectors[0], 'First vector matches');
    assert.deepEqual(hits.get(1), originalVectors[1], 'Second vector matches');
    assert.deepEqual(hits.get(2), originalVectors[2], 'Third vector matches');

    // Test partial hit / miss
    const mixedTexts = ['hello world', 'unseen text here'];
    const checkResult = await cache.getMany(mixedTexts);
    assert.equal(checkResult.hits.size, 1, 'Should have 1 hit');
    assert.deepEqual(checkResult.hits.get(0), originalVectors[0], 'First text matches hello world');
    assert.equal(checkResult.misses.length, 1, 'Should have 1 miss');
    assert.equal(checkResult.misses[0].text, 'unseen text here', 'Miss should be the unseen text');
    assert.equal(checkResult.misses[0].originalIndex, 1, 'Miss index is correct');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('EmbeddingCache - handle corrupt or empty files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-embed-cache-corrupt-'));

  try {
    const cache = new EmbeddingCache('corrupt-model', tempDir);
    const texts = ['corrupt text'];

    // Warm up cache directory structure
    await cache.getMany(texts);

    // Compute entry path and write corrupt data (non-multiple of 4 bytes)
    const md5Hex = crypto.createHash('md5').update('corrupt text').digest('hex');
    const entryPath = path.join(
      tempDir,
      'cache',
      'embeddings',
      'corrupt-model',
      md5Hex.slice(0, 2),
      `${md5Hex}.bin`,
    );

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, Buffer.from([1, 2, 3])); // 3 bytes is invalid for float array

    // Get values (should delete corrupt file and treat as miss)
    const { hits, misses } = await cache.getMany(texts);
    assert.equal(hits.size, 0, 'No hits should be found for corrupt file');
    assert.equal(misses.length, 1, 'Should return as a miss');
    assert.equal(fs.existsSync(entryPath), false, 'Corrupt file should have been deleted');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('EmbeddingCache - purge old records', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-embed-cache-purge-'));

  try {
    const cache = new EmbeddingCache('purge-model', tempDir);
    const texts = ['fresh item', 'stale item'];
    const originalVectors = [
      [1.0, 2.0],
      [3.0, 4.0],
    ].map((arr) => Array.from(new Float32Array(arr)));

    // Put values
    await cache.putMany(texts, originalVectors);

    // Backdate the stale item file
    const md5Hex = crypto.createHash('md5').update('stale item').digest('hex');
    const entryPath = path.join(
      tempDir,
      'cache',
      'embeddings',
      'purge-model',
      md5Hex.slice(0, 2),
      `${md5Hex}.bin`,
    );

    const past = new Date(Date.now() - 10 * 24 * 3600 * 1000); // 10 days ago
    fs.utimesSync(entryPath, past, past);

    // Purge records older than 5 days
    const purgeResult = await cache.purge(5);
    assert.equal(purgeResult.deleted, 1, 'Should delete exactly 1 stale item');

    // Verify fresh item is still present and stale is gone
    const checkResult = await cache.getMany(texts);
    assert.equal(checkResult.hits.size, 1, 'Should find only 1 hit');
    assert.deepEqual(
      checkResult.hits.get(0),
      originalVectors[0],
      'Remaining item matches fresh item',
    );
    assert.equal(checkResult.misses.length, 1, 'Stale item is missing');
    assert.equal(checkResult.misses[0].text, 'stale item');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
