/**
 * SSE Authentication Middleware
 *
 * Handles token-based authentication for SSE connections
 */

import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../auth/tokenManager.js';
import { getUserByToken, initUsersDb } from '../db/users.js';
import { logger } from '../utils/logger.js';

/**
 * Extended Request interface with auth property
 */
export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    tokenId: string;
  };
}

/**
 * Extract bearer token from Authorization header or query param
 */
export function extractBearerToken(req: Request): string | null {
  // Try Authorization header first
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }

  // Fallback to query parameter (for clients that can't set headers)
  const tokenParam = req.query.token as string | undefined;
  if (tokenParam) {
    return tokenParam;
  }

  return null;
}

/**
 * Middleware to authenticate MCP requests
 */
export function authenticateMCP(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for routes that are not under /mcp
  if (!req.path.startsWith('/mcp')) {
    next();
    return;
  }

  const token = extractBearerToken(req);

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'Missing or invalid token. Provide via: Authorization: Bearer <token> header OR ?token=<token> query parameter',
    });
    return;
  }

  // First, check if the token is a user API token from Google OAuth
  let isValidUserToken = false;
  let userIdFromDb: string | undefined;

  try {
    const db = initUsersDb();
    const user = getUserByToken(db, token);
    if (user) {
      isValidUserToken = true;
      userIdFromDb = user.id;
    }
    db.close();
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Error checking user token in database');
  }

  if (isValidUserToken && userIdFromDb) {
    (req as AuthenticatedRequest).auth = {
      userId: userIdFromDb,
      tokenId: token,
    };
    next();
    return;
  }

  // Fallback to legacy token manager for generated service tokens
  const verification = verifyToken(token);

  if (!verification.valid || !verification.userId || !verification.tokenId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
    return;
  }

  // Attach user info to request
  (req as AuthenticatedRequest).auth = {
    userId: verification.userId,
    tokenId: verification.tokenId,
  };

  next();
}

/**
 * Middleware to require authentication (throws if not authenticated)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = (req as AuthenticatedRequest).auth;

  if (!auth || !auth.userId) {
    logger.warn({ path: req.path }, 'Unauthenticated request to protected endpoint');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  next();
}

/**
 * Get authenticated user from request
 */
export function getAuthUser(req: Request): { userId: string; tokenId: string } | null {
  const auth = (req as AuthenticatedRequest).auth;

  if (!auth || !auth.userId) {
    return null;
  }

  return {
    userId: auth.userId,
    tokenId: auth.tokenId,
  };
}
