import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Get the user data directory from paths
function getUsersDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dbDir = path.join(home, '.ace');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, 'ace_users.db');
}

export interface User {
  id: string;
  email: string;
  google_id: string;
  api_token: string;
  config_settings: string; // JSON string
  created_at: number;
}

export function initUsersDb(): Database.Database {
  const dbPath = getUsersDbPath();
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      google_id TEXT UNIQUE NOT NULL,
      api_token TEXT UNIQUE NOT NULL,
      config_settings TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_api_token ON users(api_token);
  `);

  return db;
}

export function generateApiToken(): string {
  return `ace_${crypto.randomBytes(24).toString('hex')}`;
}

export function getUserByEmail(db: Database.Database, email: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
}

export function getUserByToken(db: Database.Database, token: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE api_token = ?').get(token) as User | undefined;
}

export function createUser(db: Database.Database, email: string, googleId: string): User {
  const id = crypto.randomUUID();
  const apiToken = generateApiToken();
  const createdAt = Date.now();
  const defaultSettings = JSON.stringify({});

  db.prepare(`
    INSERT INTO users (id, email, google_id, api_token, config_settings, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, email, googleId, apiToken, defaultSettings, createdAt);

  return {
    id,
    email,
    google_id: googleId,
    api_token: apiToken,
    config_settings: defaultSettings,
    created_at: createdAt,
  };
}

export function regenerateUserToken(db: Database.Database, userId: string): string {
  const newToken = generateApiToken();
  db.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(newToken, userId);
  return newToken;
}

export function updateUserSettings(db: Database.Database, userId: string, settings: string): void {
  db.prepare('UPDATE users SET config_settings = ? WHERE id = ?').run(settings, userId);
}
