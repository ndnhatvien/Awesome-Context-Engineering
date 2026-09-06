/**
 * Dashboard Analytics Service
 * Provides real-time statistics and metrics for the ACE dashboard
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDataBaseDir } from '../utils/paths.js';

export interface DashboardStats {
  index: {
    totalFiles: number;
    totalChunks: number;
    totalSize: string;
    lastIndexed: string | null;
    languages: Record<string, number>;
  };
  tokens: {
    totalTokens: number;
    activeTokens: number;
    revokedTokens: number;
    recentActivity: Array<{
      userId: string;
      lastUsed: string;
      count: number;
    }>;
  };
  search: {
    totalQueries: number;
    avgResponseTime: number;
    popularQueries: Array<{
      query: string;
      count: number;
      avgScore: number;
    }>;
    recentQueries: Array<{
      query: string;
      timestamp: string;
      resultCount: number;
    }>;
  };
  system: {
    dbSize: string;
    vectorStoreSize: string;
    uptime: string;
    nodeVersion: string;
  };
}

/**
 * Get database statistics
 */
export function getIndexStats(): DashboardStats['index'] {
  const dbPath = path.join(getDataBaseDir(), 'index.db');

  if (!existsSync(dbPath)) {
    return {
      totalFiles: 0,
      totalChunks: 0,
      totalSize: '0 B',
      lastIndexed: null,
      languages: {},
    };
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    // Total files
    const filesResult = db
      .prepare('SELECT COUNT(DISTINCT file_path) as count FROM chunks')
      .get() as { count: number };
    const totalFiles = filesResult.count;

    // Total chunks
    const chunksResult = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as {
      count: number;
    };
    const totalChunks = chunksResult.count;

    // Database size
    const stats = statSync(dbPath);
    const totalSize = formatBytes(stats.size);

    // Last indexed
    const lastIndexedResult = db.prepare('SELECT MAX(indexed_at) as last FROM chunks').get() as {
      last: number | null;
    };
    const lastIndexed = lastIndexedResult.last
      ? new Date(lastIndexedResult.last).toISOString()
      : null;

    // Languages distribution
    const languagesResult = db
      .prepare(`
      SELECT language, COUNT(*) as count 
      FROM chunks 
      GROUP BY language 
      ORDER BY count DESC
    `)
      .all() as Array<{ language: string; count: number }>;

    const languages: Record<string, number> = {};
    for (const row of languagesResult) {
      languages[row.language || 'unknown'] = row.count;
    }

    return {
      totalFiles,
      totalChunks,
      totalSize,
      lastIndexed,
      languages,
    };
  } finally {
    db.close();
  }
}

/**
 * Get token statistics
 */
export function getTokenStats(): DashboardStats['tokens'] {
  const dbPath = path.join(getDataBaseDir(), 'tokens.db');

  if (!existsSync(dbPath)) {
    return {
      totalTokens: 0,
      activeTokens: 0,
      revokedTokens: 0,
      recentActivity: [],
    };
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    // Total tokens
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM tokens').get() as {
      count: number;
    };
    const totalTokens = totalResult.count;

    // Active tokens
    const activeResult = db
      .prepare('SELECT COUNT(*) as count FROM tokens WHERE is_active = 1')
      .get() as { count: number };
    const activeTokens = activeResult.count;

    // Revoked tokens
    const revokedTokens = totalTokens - activeTokens;

    // Recent activity
    const activityResult = db
      .prepare(`
      SELECT user_id, last_used_at, COUNT(*) as count
      FROM tokens
      WHERE last_used_at IS NOT NULL
      GROUP BY user_id
      ORDER BY last_used_at DESC
      LIMIT 10
    `)
      .all() as Array<{ user_id: string; last_used_at: number; count: number }>;

    const recentActivity = activityResult.map((row) => ({
      userId: row.user_id,
      lastUsed: new Date(row.last_used_at).toISOString(),
      count: row.count,
    }));

    return {
      totalTokens,
      activeTokens,
      revokedTokens,
      recentActivity,
    };
  } finally {
    db.close();
  }
}

/**
 * Get search statistics (placeholder - will implement with actual search logging)
 */
export function getSearchStats(): DashboardStats['search'] {
  return {
    totalQueries: 0,
    avgResponseTime: 0,
    popularQueries: [],
    recentQueries: [],
  };
}

/**
 * Get system statistics
 */
export function getSystemStats(): DashboardStats['system'] {
  const dbPath = path.join(getDataBaseDir(), 'index.db');
  const vectorPath = path.join(getDataBaseDir(), 'vectors');

  let dbSize = '0 B';
  if (existsSync(dbPath)) {
    const stats = statSync(dbPath);
    dbSize = formatBytes(stats.size);
  }

  let vectorStoreSize = '0 B';
  if (existsSync(vectorPath)) {
    // Approximate vector store size (would need recursive calculation)
    vectorStoreSize = 'N/A';
  }

  const uptime = formatUptime(process.uptime());
  const nodeVersion = process.version;

  return {
    dbSize,
    vectorStoreSize,
    uptime,
    nodeVersion,
  };
}

/**
 * Get all dashboard statistics
 */
export function getDashboardStats(): DashboardStats {
  return {
    index: getIndexStats(),
    tokens: getTokenStats(),
    search: getSearchStats(),
    system: getSystemStats(),
  };
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format uptime to human-readable string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : '< 1m';
}
