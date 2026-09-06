/**
 * Savings Ledger
 *
 * Append-only ledger for tracking token savings across sessions.
 * All savings entries are persisted to SQLite database.
 */

import type { Database } from 'better-sqlite3';
import type {
  BucketSummary,
  ModelSummary,
  SavingsBucket,
  SavingsEntry,
  SavingsSummary,
  SessionSummary,
} from './types.js';

/**
 * Initialize savings ledger tables
 *
 * @param db SQLite database instance
 */
export function initSavingsLedger(db: Database): void {
  // Savings ledger table
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      bucket TEXT NOT NULL,
      tokens_baseline INTEGER NOT NULL,
      tokens_actual INTEGER NOT NULL,
      tokens_saved INTEGER NOT NULL,
      dollars_saved REAL NOT NULL,
      model TEXT NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_savings_project_timestamp 
      ON savings_ledger(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_savings_session 
      ON savings_ledger(session_id);
    CREATE INDEX IF NOT EXISTS idx_savings_bucket 
      ON savings_ledger(bucket);
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS savings_sessions (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      model TEXT NOT NULL,
      total_tokens_saved INTEGER DEFAULT 0,
      total_dollars_saved REAL DEFAULT 0
    );
    
    CREATE INDEX IF NOT EXISTS idx_sessions_project 
      ON savings_sessions(project_id);
  `);
}

/**
 * Record a savings entry
 *
 * @param db SQLite database instance
 * @param entry Savings entry (without id)
 * @returns Entry ID
 */
export function recordSavings(db: Database, entry: Omit<SavingsEntry, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO savings_ledger (
      project_id, session_id, timestamp, bucket,
      tokens_baseline, tokens_actual, tokens_saved,
      dollars_saved, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    entry.projectId,
    entry.sessionId,
    entry.timestamp,
    entry.bucket,
    entry.tokensBaseline,
    entry.tokensActual,
    entry.tokensSaved,
    entry.dollarsSaved,
    entry.model,
  );

  return result.lastInsertRowid as number;
}

/**
 * Get savings summary for a project
 *
 * @param db SQLite database instance
 * @param projectId Project ID
 * @param since Optional timestamp to filter from (ms)
 * @returns Savings summary
 */
export function getSavingsSummary(db: Database, projectId: string, since?: number): SavingsSummary {
  const whereClause = since ? 'WHERE project_id = ? AND timestamp >= ?' : 'WHERE project_id = ?';
  const params = since ? [projectId, since] : [projectId];

  // Get total savings
  const totalRow = db
    .prepare(
      `
    SELECT 
      SUM(tokens_saved) as total_tokens,
      SUM(dollars_saved) as total_dollars,
      MIN(timestamp) as first_ts,
      MAX(timestamp) as last_ts,
      COUNT(DISTINCT session_id) as session_count
    FROM savings_ledger
    ${whereClause}
  `,
    )
    .get(...params) as {
    total_tokens: number;
    total_dollars: number;
    first_ts: number;
    last_ts: number;
    session_count: number;
  };

  const totalTokensSaved = totalRow.total_tokens || 0;
  const totalDollarsSaved = totalRow.total_dollars || 0;

  // Get by bucket
  const bucketRows = db
    .prepare(
      `
    SELECT 
      bucket,
      SUM(tokens_saved) as tokens_saved,
      SUM(dollars_saved) as dollars_saved
    FROM savings_ledger
    ${whereClause}
    GROUP BY bucket
  `,
    )
    .all(...params) as Array<{
    bucket: SavingsBucket;
    tokens_saved: number;
    dollars_saved: number;
  }>;

  const byBucket = new Map<SavingsBucket, BucketSummary>();
  for (const row of bucketRows) {
    byBucket.set(row.bucket, {
      bucket: row.bucket,
      tokensSaved: row.tokens_saved,
      dollarsSaved: row.dollars_saved,
      percentage:
        totalTokensSaved > 0 ? Math.round((row.tokens_saved / totalTokensSaved) * 100) : 0,
    });
  }

  // Get by model
  const modelRows = db
    .prepare(
      `
    SELECT 
      model,
      SUM(tokens_saved) as tokens_saved,
      SUM(dollars_saved) as dollars_saved,
      COUNT(*) as queries_count
    FROM savings_ledger
    ${whereClause}
    GROUP BY model
  `,
    )
    .all(...params) as Array<{
    model: string;
    tokens_saved: number;
    dollars_saved: number;
    queries_count: number;
  }>;

  const byModel = new Map<string, ModelSummary>();
  for (const row of modelRows) {
    byModel.set(row.model, {
      model: row.model,
      tokensSaved: row.tokens_saved,
      dollarsSaved: row.dollars_saved,
      queriesCount: row.queries_count,
    });
  }

  return {
    projectId,
    totalTokensSaved,
    totalDollarsSaved,
    byBucket,
    byModel,
    sessionCount: totalRow.session_count || 0,
    firstTimestamp: totalRow.first_ts || Date.now(),
    lastTimestamp: totalRow.last_ts || Date.now(),
  };
}

/**
 * Start a new session
 *
 * @param db SQLite database instance
 * @param sessionId Session ID
 * @param projectId Project ID
 * @param model Model name
 */
export function startSession(
  db: Database,
  sessionId: string,
  projectId: string,
  model: string,
): void {
  db.prepare(
    `
    INSERT INTO savings_sessions (session_id, project_id, started_at, model)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO NOTHING
  `,
  ).run(sessionId, projectId, Date.now(), model);
}

/**
 * End a session
 *
 * @param db SQLite database instance
 * @param sessionId Session ID
 */
export function endSession(db: Database, sessionId: string): void {
  // Calculate totals
  const totals = db
    .prepare(
      `
    SELECT 
      SUM(tokens_saved) as total_tokens,
      SUM(dollars_saved) as total_dollars
    FROM savings_ledger
    WHERE session_id = ?
  `,
    )
    .get(sessionId) as {
    total_tokens: number;
    total_dollars: number;
  };

  // Update session
  db.prepare(
    `
    UPDATE savings_sessions
    SET ended_at = ?,
        total_tokens_saved = ?,
        total_dollars_saved = ?
    WHERE session_id = ?
  `,
  ).run(Date.now(), totals.total_tokens || 0, totals.total_dollars || 0, sessionId);
}

/**
 * Get session summary
 *
 * @param db SQLite database instance
 * @param sessionId Session ID
 * @returns Session summary or null if not found
 */
export function getSessionSummary(db: Database, sessionId: string): SessionSummary | null {
  const row = db
    .prepare(
      `
    SELECT 
      session_id,
      project_id,
      started_at,
      ended_at,
      model,
      total_tokens_saved,
      total_dollars_saved,
      (SELECT COUNT(*) FROM savings_ledger WHERE session_id = ?) as event_count
    FROM savings_sessions
    WHERE session_id = ?
  `,
    )
    .get(sessionId, sessionId) as
    | {
        session_id: string;
        project_id: string;
        started_at: number;
        ended_at: number | null;
        model: string;
        total_tokens_saved: number;
        total_dollars_saved: number;
        event_count: number;
      }
    | undefined;

  if (!row) return null;

  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: row.model,
    totalTokensSaved: row.total_tokens_saved,
    totalDollarsSaved: row.total_dollars_saved,
    eventCount: row.event_count,
  };
}

/**
 * List all sessions for a project
 *
 * @param db SQLite database instance
 * @param projectId Project ID
 * @param limit Maximum number of sessions to return
 * @returns Array of session summaries
 */
export function listSessions(db: Database, projectId: string, limit = 50): SessionSummary[] {
  const rows = db
    .prepare(
      `
    SELECT 
      s.session_id,
      s.project_id,
      s.started_at,
      s.ended_at,
      s.model,
      s.total_tokens_saved,
      s.total_dollars_saved,
      COUNT(l.id) as event_count
    FROM savings_sessions s
    LEFT JOIN savings_ledger l ON s.session_id = l.session_id
    WHERE s.project_id = ?
    GROUP BY s.session_id
    ORDER BY s.started_at DESC
    LIMIT ?
  `,
    )
    .all(projectId, limit) as Array<{
    session_id: string;
    project_id: string;
    started_at: number;
    ended_at: number | null;
    model: string;
    total_tokens_saved: number;
    total_dollars_saved: number;
    event_count: number;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    projectId: row.project_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    model: row.model,
    totalTokensSaved: row.total_tokens_saved,
    totalDollarsSaved: row.total_dollars_saved,
    eventCount: row.event_count,
  }));
}
