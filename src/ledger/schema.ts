/**
 * Savings Ledger 数据库表结构
 */

import type Database from 'better-sqlite3';

export function initSavingsTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings_ledger (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      query TEXT NOT NULL,
      category TEXT NOT NULL,
      baseline_tokens INTEGER NOT NULL,
      delivered_tokens INTEGER NOT NULL,
      saved_tokens INTEGER NOT NULL,
      cost_saved_usd REAL NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_savings_proj_time 
      ON savings_ledger(project_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_savings_category 
      ON savings_ledger(category);
  `);
}
