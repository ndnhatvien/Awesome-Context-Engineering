import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import '../src/config.js';

interface CreateTokenBody {
  userId?: string;
  description?: string;
  expiresInDays?: number;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function generateSafeToken(): string {
  return `ace_${randomBytes(32).toString('base64url')}`;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown; query?: Record<string, string> },
  res: ServerResponse,
): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, apikey, x-embeddings-api-key, x-rerank-api-key',
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // /api/tokens or /api/tokens/:id
  const pathTokenId = pathParts.length > 2 ? pathParts[2] : null;

  res.setHeader('Content-Type', 'application/json');

  // 1. POST: Create a new token
  if (req.method === 'POST') {
    try {
      let body: CreateTokenBody = {};
      if (req.body && typeof req.body === 'object') {
        body = req.body as CreateTokenBody;
      } else {
        const raw = await readBody(req);
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = {};
          }
        }
      }

      const userId = body.userId?.trim() || 'developer';
      const description = body.description?.trim();
      const expiresInDays = body.expiresInDays ? Number(body.expiresInDays) : undefined;
      const createdAt = Date.now();
      const expiresAt = expiresInDays ? createdAt + expiresInDays * 86400000 : null;

      // Attempt to persist in tokenManager if SQLite is available
      try {
        const { createToken } = await import('../src/auth/tokenManager.js');
        const created = createToken({
          userId,
          description,
          expiresInDays,
        });

        res.statusCode = 201;
        res.end(
          JSON.stringify({
            success: true,
            token: created.token,
            tokenId: created.id,
            userId,
            description,
            createdAt,
            expiresAt,
          }),
        );
        return;
      } catch {
        // Fallback for purely serverless environments where SQLite native binary is absent
        const token = generateSafeToken();
        const tokenId = randomBytes(16).toString('hex');

        res.statusCode = 201;
        res.end(
          JSON.stringify({
            success: true,
            token,
            tokenId,
            userId,
            description,
            createdAt,
            expiresAt,
            isEphemeral: true,
          }),
        );
        return;
      }
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: (err as Error).message || 'Failed to create token' }));
      return;
    }
  }

  // 2. GET: List tokens
  if (req.method === 'GET') {
    const userId = url.searchParams.get('userId') || 'developer';
    try {
      const { listTokens } = await import('../src/auth/tokenManager.js');
      const tokens = listTokens(userId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, tokens }));
      return;
    } catch {
      // Fallback empty list if db not available
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, tokens: [] }));
      return;
    }
  }

  // 3. DELETE: Revoke a token
  if (req.method === 'DELETE') {
    const tokenId = pathTokenId || url.searchParams.get('tokenId') || url.searchParams.get('id');
    if (!tokenId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Token ID is required to revoke' }));
      return;
    }

    try {
      const { revokeToken } = await import('../src/auth/tokenManager.js');
      const success = revokeToken(tokenId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success }));
      return;
    } catch {
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}
