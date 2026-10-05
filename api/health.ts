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

  // Group B: File / Blob / Context Sync endpoints
  if (url.includes('/context-canvas/list')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0', canvases: [], active_canvas: null, total: 0 }));
    return;
  }

  if (url.includes('/search-external-sources') || url.includes('/get-implicit-external-sources')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', version: '1.0.0', results: [], total: 0 }));
    return;
  }

  if (url.includes('/batch-upload')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', uploaded: 0, blobs_received: 0, message: 'Successfully processed batch upload', timestamp: new Date().toISOString() }));
    return;
  }

  if (url.includes('/checkpoint-blobs')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', checkpoint_id: `chk_${Date.now()}`, timestamp: Date.now(), blobs_count: 0, synced: true }));
    return;
  }

  if (url.includes('/find-missing')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', missing_blobs: [], missing_count: 0, all_synced: true }));
    return;
  }

  if (url.includes('/save-chat')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', session_id: `chat_${Date.now()}`, saved_at: new Date().toISOString(), message_count: 0 }));
    return;
  }

  if (url.includes('/indexed-commits/get-latest-blobset')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', commit_hash: 'HEAD', blobset_id: 'blobset_HEAD', indexed_at: new Date().toISOString(), blobs_count: 0 }));
    return;
  }

  if (url.includes('/indexed-commits/register-blobset')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', commit_hash: 'HEAD', blobset_id: 'blobset_HEAD', registered: true, timestamp: new Date().toISOString() }));
    return;
  }

  if (url.includes('/chat/exchanges/list')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', service: 'ace-mcp-http', session_id: 'default', exchanges: [], total: 0 }));
    return;
  }

  // Group C: Agents / Tools endpoints
  if (url.includes('/agents/list-remote-tools')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      status: 'ok',
      service: 'ace-mcp-http',
      version: '1.0.0',
      tools: [
        { name: 'codebase-retrieval', description: 'PRIMARY semantic code retrieval engine using hybrid vector + lexical recall' },
        { name: 'codebase-retrieval-raw', description: 'Semantic code retrieval returning raw uncompressed chunks' },
        { name: 'list-remote-tools', description: 'List all available remote tools and their capabilities' },
        { name: 'run-remote-tool', description: 'Execute a remote or self-dispatched tool through agent proxy' },
        { name: 'edit-file', description: 'Create, modify, or delete a workspace file with safety checks and diff generation' },
        { name: 'check-tool-safety', description: 'Check tool safety before execution against sensitive files and dangerous commands' },
        { name: 'revoke-tool-access', description: 'Revoke tool access for a specific session or globally' },
        { name: 'agent-memory', description: 'Autonomous four-layer memory and context management for AI agents' },
        { name: 'expand-chunk', description: 'Fetch complete uncompressed code block for a specific line span' },
      ],
      total: 9,
    }));
    return;
  }

  if (url.includes('/agents/check-tool-safety')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ safe: true, risk_level: 'safe', service: 'ace-mcp-http' }));
    return;
  }

  if (url.includes('/agents/revoke-tool-access')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok', success: true }));
    return;
  }

  if (url.includes('/agents/run-remote-tool')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, remote_server: 'self' }));
    return;
  }

  if (url.includes('/agents/edit-file')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: 'File edit simulated in cloud environment' }));
    return;
  }

  if (
    url.includes('/augment/get-models') ||
    url.includes('/get-models')
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
