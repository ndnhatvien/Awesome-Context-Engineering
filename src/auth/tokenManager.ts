/**
 * Token Manager for User Access
 *
 * Manages API tokens for users to access ACE services
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path, { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { getDataBaseDir } from '../utils/paths.js';

export interface Token {
  id: string;
  token: string;
  tokenHash: string;
  userId: string;
  description?: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
}

export interface CreateTokenOptions {
  userId: string;
  description?: string;
  expiresInDays?: number;
}

/**
 * Initialize tokens database
 */
function initTokensDb(): Database.Database {
  const dbPath = path.join(getDataBaseDir(), 'tokens.db');
  const dbDir = dirname(dbPath);

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Create tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      last_used_at INTEGER,
      is_active INTEGER DEFAULT 1
    );
    
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_tokens_active ON tokens(is_active);
  `);

  return db;
}

/**
 * Generate a secure random token
 */
export function generateToken(): string {
  return `ace_${randomBytes(32).toString('base64url')}`;
}

/**
 * Hash token for storage
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new token
 */
export function createToken(options: CreateTokenOptions): { token: string; id: string } {
  const db = initTokensDb();

  const token = generateToken();
  const tokenHash = hashToken(token);
  const id = randomBytes(16).toString('hex');
  const createdAt = Date.now();
  const expiresAt = options.expiresInDays
    ? createdAt + options.expiresInDays * 24 * 60 * 60 * 1000
    : null;

  const stmt = db.prepare(`
    INSERT INTO tokens (id, token_hash, user_id, description, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, tokenHash, options.userId, options.description || null, createdAt, expiresAt);
  db.close();

  return { token, id };
}

/**
 * Verify a token and return user info
 */
export function verifyToken(token: string): { valid: boolean; userId?: string; tokenId?: string } {
  try {
    const db = initTokensDb();
    const tokenHash = hashToken(token);

    const stmt = db.prepare(`
      SELECT id, user_id, expires_at, is_active 
      FROM tokens 
      WHERE token_hash = ?
    `);

    const row = stmt.get(tokenHash) as
      | {
          id: string;
          user_id: string;
          expires_at: number | null;
          is_active: number;
        }
      | undefined;

    if (!row) {
      db.close();
      return { valid: false };
    }

    // Check if active
    if (!row.is_active) {
      db.close();
      return { valid: false };
    }

    // Check expiration
    if (row.expires_at && Date.now() > row.expires_at) {
      db.close();
      return { valid: false };
    }

    // Update last used timestamp
    const updateStmt = db.prepare(`
      UPDATE tokens SET last_used_at = ? WHERE id = ?
    `);
    updateStmt.run(Date.now(), row.id);

    db.close();

    return {
      valid: true,
      userId: row.user_id,
      tokenId: row.id,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * List all tokens for a user
 */
export function listTokens(userId: string): Token[] {
  const db = initTokensDb();

  const stmt = db.prepare(`
    SELECT id, user_id, description, created_at, expires_at, last_used_at
    FROM tokens
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC
  `);

  const rows = stmt.all(userId) as Array<{
    id: string;
    user_id: string;
    description: string | null;
    created_at: number;
    expires_at: number | null;
    last_used_at: number | null;
  }>;
  db.close();

  return rows.map((row) => ({
    id: row.id,
    token: '***', // Never return actual token
    tokenHash: '***',
    userId: row.user_id,
    description: row.description,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * Revoke a token
 */
export function revokeToken(tokenId: string): boolean {
  const db = initTokensDb();

  const stmt = db.prepare(`
    UPDATE tokens SET is_active = 0 WHERE id = ?
  `);

  const result = stmt.run(tokenId);
  db.close();

  return result.changes > 0;
}

/**
 * Clean up expired tokens
 */
export function cleanupExpiredTokens(): number {
  const db = initTokensDb();

  const stmt = db.prepare(`
    DELETE FROM tokens 
    WHERE expires_at IS NOT NULL AND expires_at < ?
  `);

  const result = stmt.run(Date.now());
  db.close();

  return result.changes;
}
