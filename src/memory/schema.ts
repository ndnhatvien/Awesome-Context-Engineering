/**
 * Agent Memory Database Schema
 *
 * Implements persistent storage and FTS5 search for 4-Layer Agent Memory:
 * - agent_memory: Core metadata and content
 * - agent_memory_fts: FTS5 full-text search table
 * - Triggers to keep FTS index synchronized
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export function initMemoryTables(db: Database.Database): void {
  // 1. 创建 agent_memory 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      target_files TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 50,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memory_category ON agent_memory(category);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_priority ON agent_memory(priority DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(created_at DESC);
  `);

  // 2. 初始化 FTS5 表
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        target_files,
        tags,
        tokenize = 'unicode61'
      );
    `);

    // 3. 创建同步触发器
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_agent_memory_insert AFTER INSERT ON agent_memory BEGIN
        INSERT INTO agent_memory_fts(id, title, content, target_files, tags)
        VALUES (new.id, new.title, new.content, new.target_files, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_memory_delete AFTER DELETE ON agent_memory BEGIN
        DELETE FROM agent_memory_fts WHERE id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_agent_memory_update AFTER UPDATE ON agent_memory BEGIN
        DELETE FROM agent_memory_fts WHERE id = old.id;
        INSERT INTO agent_memory_fts(id, title, content, target_files, tags)
        VALUES (new.id, new.title, new.content, new.target_files, new.tags);
      END;
    `);
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      'FTS5 virtual table for agent_memory failed to initialize, falling back to LIKE',
    );
  }
}
