import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { isSupabaseMode } from '../src/config.js';

let cachedHtml: string | null = null;

function getDashboardHtml(): string | null {
  if (cachedHtml) return cachedHtml;
  try {
    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      cachedHtml = fs.readFileSync(htmlPath, 'utf8');
      return cachedHtml;
    }
  } catch {
    // fallback
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];
  if (
    url.includes('/context-canvas/list') ||
    url.includes('/search-external-sources') ||
    url.includes('/augment/get-models') ||
    url.includes('/get-models') ||
    url.includes('/get-implicit-external-sources')
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0' }));
    return;
  }

  // If requested by a web browser, serve the interactive Web Dashboard
  const accept = req.headers?.accept || '';
  if (accept.includes('text/html')) {
    const html = getDashboardHtml();
    if (html) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(html);
      return;
    }
  }

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
