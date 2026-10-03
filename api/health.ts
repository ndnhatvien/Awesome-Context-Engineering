import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSupabaseMode } from '../src/config.js';

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;

  res.end(
    JSON.stringify({
      status: 'ok',
      engine: 'ACE (Awesome Context Engineering)',
      version: '0.2.0',
      cloudReady: true,
      storage: isSupabaseMode() ? 'supabase' : 'local',
      timestamp: new Date().toISOString(),
    }),
  );
}
