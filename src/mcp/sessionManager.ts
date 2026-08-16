/**
 * SSE Session Manager for MCP HTTP Server
 *
 * Manages persistent SSE connections with authentication and lifecycle
 */

import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { logger } from '../utils/logger.js';

export interface Session {
  id: string;
  userId: string;
  tokenId: string;
  createdAt: number;
  lastActivity: number;
  sseResponse?: Response;
  isConnected: boolean;
}

export interface CreateSessionOptions {
  userId: string;
  tokenId: string;
}

/**
 * Session store - in-memory for now
 * In production, consider Redis or similar for multi-instance deployments
 */
class SessionManager {
  private sessions = new Map<string, Session>();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds
  private cleanupInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    this.startCleanupTimer();
    this.startHeartbeatTimer();
  }

  /**
   * Create a new session
   */
  createSession(options: CreateSessionOptions): Session {
    const session: Session = {
      id: this.generateSessionId(),
      userId: options.userId,
      tokenId: options.tokenId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isConnected: false,
    };

    this.sessions.set(session.id, session);
    logger.info({ sessionId: session.id, userId: session.userId }, 'Session created');

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - session.lastActivity > this.SESSION_TIMEOUT) {
      this.destroySession(sessionId);
      return undefined;
    }

    return session;
  }

  /**
   * Update session activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Attach SSE response to session
   */
  attachSSE(sessionId: string, res: Response): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      logger.warn({ sessionId }, 'Attempted to attach SSE to non-existent session');
      return false;
    }

    // Disconnect previous SSE if exists
    if (session.sseResponse && session.isConnected) {
      this.sendSSE(sessionId, 'reconnect', { reason: 'New connection established' });
      session.sseResponse.end();
    }

    session.sseResponse = res;
    session.isConnected = true;
    session.lastActivity = Date.now();

    logger.info({ sessionId }, 'SSE attached to session');

    // Handle client disconnect
    res.on('close', () => {
      if (session.isConnected) {
        session.isConnected = false;
        logger.info({ sessionId }, 'SSE disconnected');
      }
    });

    return true;
  }

  /**
   * Send SSE event to session
   */
  sendSSE(sessionId: string, event: string, data: unknown): boolean {
    const session = this.sessions.get(sessionId);

    if (!session || !session.sseResponse || !session.isConnected) {
      return false;
    }

    try {
      const payload = JSON.stringify(data);
      session.sseResponse.write(`event: ${event}\n`);
      session.sseResponse.write(`data: ${payload}\n\n`);
      return true;
    } catch (err) {
      logger.error({ sessionId, error: (err as Error).message }, 'Failed to send SSE');
      return false;
    }
  }

  /**
   * Broadcast message to all sessions of a user
   */
  broadcastToUser(userId: string, event: string, data: unknown): number {
    let sent = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.userId === userId && session.isConnected) {
        if (this.sendSSE(sessionId, event, data)) {
          sent++;
        }
      }
    }
    return sent;
  }

  /**
   * Destroy session
   */
  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    // Close SSE connection if active
    if (session.sseResponse && session.isConnected) {
      try {
        this.sendSSE(sessionId, 'close', { reason: 'Session destroyed' });
        session.sseResponse.end();
      } catch {
        // Ignore errors on cleanup
      }
    }

    this.sessions.delete(sessionId);
    logger.info({ sessionId }, 'Session destroyed');

    return true;
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): Session[] {
    const userSessions: Session[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }
    return userSessions;
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    connectedSessions: number;
  } {
    let connected = 0;
    for (const session of this.sessions.values()) {
      if (session.isConnected) {
        connected++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.size, // All in map are considered active
      connectedSessions: connected,
    };
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      this.destroySession(sessionId);
    }

    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'Cleaned up expired sessions');
    }
  }

  /**
   * Send heartbeat to all connected sessions
   */
  private sendHeartbeat(): void {
    let sent = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isConnected) {
        if (this.sendSSE(sessionId, 'heartbeat', { timestamp: Date.now() })) {
          sent++;
        }
      }
    }

    if (sent > 0) {
      logger.debug({ count: sent }, 'Heartbeat sent to sessions');
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000); // Every minute
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeatTimer(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop all timers (for graceful shutdown)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Disconnect all sessions
    for (const sessionId of this.sessions.keys()) {
      this.destroySession(sessionId);
    }

    logger.info('Session manager shutdown complete');
  }

  /**
   * Generate a secure random session ID
   */
  private generateSessionId(): string {
    return `sess_${randomBytes(32).toString('base64url')}`;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

/**
 * Setup graceful shutdown
 */
process.on('SIGTERM', () => {
  sessionManager.shutdown();
});

process.on('SIGINT', () => {
  sessionManager.shutdown();
});
