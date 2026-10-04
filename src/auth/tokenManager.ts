/**
 * Token Manager for User Access
 *
 * Manages API tokens for users to access ACE services.
 * Supports SQLite (better-sqlite3) with seamless JSON file/memory fallback
 * when native SQLite bindings are unavailable (e.g. Node 22 on Windows or serverless).
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

interface StoredToken {
  id: string;
  token_hash: string;
  user_id: string;
  description?: string | null;
  created_at: number;
  expires_at?: number | null;
  last_used_at?: number | null;
  is_active: number;
}

// In-memory fallback cache
const memoryTokens: Map<string, StoredToken> = new Map();
let sqliteAvailable: boolean | null = null;

function getFallbackTokensPath(): string {
  return path.join(getDataBaseDir(), 'tokens.json');
}

function readFallbackTokens(): StoredToken[] {
  try {
    const filePath = getFallbackTokensPath();
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch {
    // ignore
  }
  return Array.from(memoryTokens.values());
}

function writeFallbackTokens(tokens: StoredToken[]): void {
  try {
    for (const t of tokens) {
      memoryTokens.set(t.id, t);
    }
    const filePath = getFallbackTokensPath();
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf8');
  } catch {
    // Memory cache persists even if filesystem is read-only
  }
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

function isSqliteUsable(): boolean {
  if (sqliteAvailable !== null) return sqliteAvailable;
  try {
    const db = initTokensDb();
    db.close();
    sqliteAvailable = true;
    return true;
  } catch {
    sqliteAvailable = false;
    return false;
  }
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
  const token = generateToken();
  const tokenHash = hashToken(token);
  const id = randomBytes(16).toString('hex');
  const createdAt = Date.now();
  const expiresAt = options.expiresInDays
    ? createdAt + options.expiresInDays * 24 * 60 * 60 * 1000
    : null;

  if (isSqliteUsable()) {
    try {
      const db = initTokensDb();
      const stmt = db.prepare(`
        INSERT INTO tokens (id, token_hash, user_id, description, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, tokenHash, options.userId, options.description || null, createdAt, expiresAt);
      db.close();
      return { token, id };
    } catch {
      sqliteAvailable = false;
    }
  }

  // Fallback to JSON/memory store
  const allTokens = readFallbackTokens();
  allTokens.push({
    id,
    token_hash: tokenHash,
    user_id: options.userId,
    description: options.description || null,
    created_at: createdAt,
    expires_at: expiresAt,
    last_used_at: null,
    is_active: 1,
  });
  writeFallbackTokens(allTokens);

  return { token, id };
}

/**
 * Verify a token and return user info
 */
export function verifyToken(token: string): { valid: boolean; userId?: string; tokenId?: string } {
  const tokenHash = hashToken(token);

  if (isSqliteUsable()) {
    try {
      const db = initTokensDb();
      const stmt = db.prepare(`
        SELECT id, user_id, expires_at, is_active 
        FROM tokens 
        WHERE token_hash = ?
      `);

      const row = stmt.get(tokenHash) as any;

      if (!row) {
        db.close();
        return { valid: false };
      }

      if (!row.is_active) {
        db.close();
        return { valid: false };
      }

      if (row.expires_at && Date.now() > row.expires_at) {
        db.close();
        return { valid: false };
      }

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
      sqliteAvailable = false;
    }
  }

  // Fallback verification
  const tokens = readFallbackTokens();
  const found = tokens.find((t) => t.token_hash === tokenHash && t.is_active === 1);
  if (!found) {
    return { valid: false };
  }

  if (found.expires_at && Date.now() > found.expires_at) {
    return { valid: false };
  }

  found.last_used_at = Date.now();
  writeFallbackTokens(tokens);

  return {
    valid: true,
    userId: found.user_id,
    tokenId: found.id,
  };
}

/**
 * List all tokens for a user
 */
export function listTokens(userId: string): Token[] {
  if (isSqliteUsable()) {
    try {
      const db = initTokensDb();
      const stmt = db.prepare(`
        SELECT id, user_id, description, created_at, expires_at, last_used_at
        FROM tokens
        WHERE user_id = ? AND is_active = 1
        ORDER BY created_at DESC
      `);

      const rows = stmt.all(userId) as any[];
      db.close();

      return rows.map((row) => ({
        id: row.id,
        token: '***',
        tokenHash: '***',
        userId: row.user_id,
        description: row.description,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
      }));
    } catch {
      sqliteAvailable = false;
    }
  }

  // Fallback listing
  const tokens = readFallbackTokens();
  return tokens
    .filter((t) => t.user_id === userId && t.is_active === 1)
    .sort((a, b) => b.created_at - a.created_at)
    .map((row) => ({
      id: row.id,
      token: '***',
      tokenHash: '***',
      userId: row.user_id,
      description: row.description || undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at || undefined,
      lastUsedAt: row.last_used_at || undefined,
    }));
}

/**
 * Revoke a token
 */
export function revokeToken(tokenId: string): boolean {
  if (isSqliteUsable()) {
    try {
      const db = initTokensDb();
      const stmt = db.prepare(`
        UPDATE tokens SET is_active = 0 WHERE id = ?
      `);
      const result = stmt.run(tokenId);
      db.close();
      return result.changes > 0;
    } catch {
      sqliteAvailable = false;
    }
  }

  // Fallback revoking
  const tokens = readFallbackTokens();
  let changed = false;
  for (const t of tokens) {
    if (t.id === tokenId) {
      t.is_active = 0;
      changed = true;
    }
  }
  if (changed) {
    writeFallbackTokens(tokens);
  }
  return changed;
}

/**
 * Clean up expired tokens
 */
export function cleanupExpiredTokens(): number {
  if (isSqliteUsable()) {
    try {
      const db = initTokensDb();
      const stmt = db.prepare(`
        DELETE FROM tokens 
        WHERE expires_at IS NOT NULL AND expires_at < ?
      `);
      const result = stmt.run(Date.now());
      db.close();
      return result.changes;
    } catch {
      sqliteAvailable = false;
    }
  }

  // Fallback cleanup
  const tokens = readFallbackTokens();
  const now = Date.now();
  const initialLength = tokens.length;
  const filtered = tokens.filter((t) => !t.expires_at || t.expires_at >= now);
  if (filtered.length !== initialLength) {
    writeFallbackTokens(filtered);
  }
  return initialLength - filtered.length;
}
