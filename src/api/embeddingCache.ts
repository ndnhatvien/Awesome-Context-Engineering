import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { getDataBaseDir } from '../utils/paths.js';

export class EmbeddingCache {
  private cacheDir: string;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used in constructor for path generation
  private model: string;

  constructor(model: string, customBaseDir?: string) {
    this.model = model;
    const sanitizedModel = model.replace(/[^a-zA-Z0-9_-]/g, '_');
    const baseDir = customBaseDir || getDataBaseDir();
    this.cacheDir = path.join(baseDir, 'cache', 'embeddings', sanitizedModel);
  }

  private getEntryPath(md5Hex: string): string {
    const prefix = md5Hex.slice(0, 2);
    return path.join(this.cacheDir, prefix, `${md5Hex}.bin`);
  }

  private computeMd5(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Look up embeddings in the cache.
   * Returns a map of index -> embedding, and an array of text misses.
   */
  async getMany(texts: string[]): Promise<{
    hits: Map<number, number[]>;
    misses: { text: string; originalIndex: number }[];
  }> {
    const hits = new Map<number, number[]>();
    const misses: { text: string; originalIndex: number }[] = [];

    // Ensure cache directory exists
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch {
      // Ignore directory creation failure, treat all as misses
      return { hits, misses: texts.map((text, idx) => ({ text, originalIndex: idx })) };
    }

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const md5 = this.computeMd5(text);
      const entryPath = this.getEntryPath(md5);

      try {
        const buffer = await fs.readFile(entryPath);
        if (buffer.length > 0 && buffer.length % 4 === 0) {
          // Read floats as Float32Array from the buffer
          const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
          hits.set(i, Array.from(floats));

          // Touch mtime asynchronously to keep LRU style (non-blocking)
          const now = new Date();
          fs.utimes(entryPath, now, now).catch(() => {});
        } else {
          // Corrupt cache file, delete it
          await fs.unlink(entryPath).catch(() => {});
          misses.push({ text, originalIndex: i });
        }
      } catch {
        // Cache miss or read error
        misses.push({ text, originalIndex: i });
      }
    }

    return { hits, misses };
  }

  /**
   * Save many embeddings to cache.
   */
  async putMany(texts: string[], embeddings: number[][]): Promise<void> {
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const embedding = embeddings[i];
      if (!embedding || embedding.length === 0) continue;

      const md5 = this.computeMd5(text);
      const entryPath = this.getEntryPath(md5);
      const shardDir = path.dirname(entryPath);

      try {
        await fs.mkdir(shardDir, { recursive: true });

        // Write float values to Float32Array buffer
        const floatArray = new Float32Array(embedding);
        const buffer = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);

        // Atomic write: write to temp file then rename
        const tempPath = path.join(shardDir, `${md5}.tmp`);
        await fs.writeFile(tempPath, buffer);
        await fs.rename(tempPath, entryPath);
      } catch (err) {
        logger.warn(
          { error: (err as Error).message, path: entryPath },
          'Failed to save embedding to cache',
        );
      }
    }
  }

  /**
   * Purge cache entries.
   * If olderThanDays is provided, purges entries older than that.
   */
  async purge(olderThanDays?: number): Promise<{ deleted: number; errors: number }> {
    let deleted = 0;
    let errors = 0;

    if (!existsSync(this.cacheDir)) {
      return { deleted, errors };
    }

    const cutoff = olderThanDays ? Date.now() - olderThanDays * 24 * 3600 * 1000 : null;

    try {
      const shards = await fs.readdir(this.cacheDir, { withFileTypes: true });
      for (const shard of shards) {
        if (!shard.isDirectory()) continue;
        const shardPath = path.join(this.cacheDir, shard.name);
        const entries = await fs.readdir(shardPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.bin')) continue;
          const entryPath = path.join(shardPath, entry.name);

          try {
            if (cutoff) {
              const stat = await fs.stat(entryPath);
              if (stat.mtimeMs < cutoff) {
                await fs.unlink(entryPath);
                deleted++;
              }
            } else {
              await fs.unlink(entryPath);
              deleted++;
            }
          } catch {
            errors++;
          }
        }

        // Try to remove the shard directory if it is empty
        try {
          await fs.rmdir(shardPath);
        } catch {
          // Ignore if directory not empty
        }
      }
    } catch {
      errors++;
    }

    return { deleted, errors };
  }
}
