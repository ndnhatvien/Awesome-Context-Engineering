/**
 * Admin Authentication for Web UI
 *
 * Provides simple admin password protection for the HTTP server
 */

import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AdminAuthConfig {
  /** Admin password (plain text or hashed) */
  password?: string;
  /** Whether authentication is enabled */
  enabled: boolean;
}

/**
 * Hash password using SHA-256
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Verify admin password
 */
export function verifyAdminPassword(providedPassword: string, storedPassword: string): boolean {
  // If stored password looks like a hash (64 hex chars), compare hashes
  if (/^[a-f0-9]{64}$/i.test(storedPassword)) {
    return hashPassword(providedPassword) === storedPassword.toLowerCase();
  }

  // Otherwise, compare plain text
  return providedPassword === storedPassword;
}

/**
 * Get admin auth config from environment
 */
export function getAdminAuthConfig(): AdminAuthConfig {
  const password = process.env.ACE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin';

  return {
    password,
    enabled: true,
  };
}

/**
 * Express middleware for admin authentication
 */
export function createAdminAuthMiddleware() {
  const config = getAdminAuthConfig();

  if (!config.enabled) {
    // No authentication required
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check and public endpoints
    if (req.path === '/health' || req.path === '/api/health') {
      return next();
    }

    // Check for Authorization header (Basic Auth)
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith('Basic ') && config.password) {
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      if (username === 'admin' && verifyAdminPassword(password, config.password)) {
        return next();
      }
    }

    // Check for session-based auth (simple token in cookie)
    const sessionToken = req.cookies?.ace_session;
    if (sessionToken && config.password && verifySessionToken(sessionToken, config.password)) {
      return next();
    }

    // Authentication failed
    res.set('WWW-Authenticate', 'Basic realm="ACE Admin"');
    res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide admin credentials',
    });
  };
}

/**
 * Generate session token
 */
export function generateSessionToken(password: string): string {
  const timestamp = Date.now();
  const payload = `${password}:${timestamp}`;
  return Buffer.from(payload).toString('base64');
}

/**
 * Verify session token
 */
export function verifySessionToken(token: string, adminPassword: string): boolean {
  try {
    const payload = Buffer.from(token, 'base64').toString('ascii');
    const [password, timestampStr] = payload.split(':');

    if (!verifyAdminPassword(password, adminPassword)) {
      return false;
    }

    // Check token age (valid for 24 hours)
    const timestamp = parseInt(timestampStr, 10);
    const age = Date.now() - timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    return age < maxAge;
  } catch {
    return false;
  }
}
