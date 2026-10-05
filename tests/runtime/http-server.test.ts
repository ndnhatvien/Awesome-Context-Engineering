/**
 * HTTP MCP Server E2E Test
 *
 * Kiểm tra HTTP server có thể khởi động và xử lý requests không
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';
import { createHttpServerApp } from '../../src/mcp/httpServer.js';

const TEST_PORT = 13579; // Port dùng chung cho tất cả tests
const TEST_HOST = '127.0.0.1';

/**
 * Helper: Gửi HTTP request và trả về response
 */
function httpRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: data,
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Helper: Gửi HTTP request và chỉ trả về headers (để test SSE/streaming endpoint)
 */
function httpRequestHeadersOnly(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        req,
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Run tests sequentially to avoid port conflicts
describe('HTTP Server Tests', { concurrency: 1 }, () => {
  test('Health check endpoint trả về status ok', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);

    try {
      const response = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/health',
        method: 'GET',
      });

      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.status, 'ok');
      assert.equal(data.service, 'ace-mcp-http');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  test('Get models endpoint trả về cùng giá trị với /health', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);

    // Đợi server khởi động
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const response = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/get-models',
        method: 'GET',
      });

      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.status, 'ok');
      assert.equal(data.service, 'ace-mcp-http');
      assert.equal(data.version, '1.0.0');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // Đợi port được giải phóng
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('Augment get models endpoint trả về cùng giá trị với /health', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);

    // Đợi server khởi động
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const response = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/augment/get-models',
        method: 'GET',
      });

      assert.equal(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.equal(data.status, 'ok');
      assert.equal(data.service, 'ace-mcp-http');
      assert.equal(data.version, '1.0.0');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // Đợi port được giải phóng
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('context-canvas/list endpoint returns status ok for GET and POST', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const getRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/context-canvas/list',
        method: 'GET',
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(JSON.parse(getRes.body).status, 'ok');

      const postRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/context-canvas/list/',
        method: 'POST',
      });
      assert.equal(postRes.statusCode, 200);
      assert.equal(JSON.parse(postRes.body).status, 'ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('search-external-sources endpoint returns status ok for GET and POST with trailing slash', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const getRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/search-external-sources/',
        method: 'GET',
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(JSON.parse(getRes.body).status, 'ok');

      const postRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/search-external-sources',
        method: 'POST',
      });
      assert.equal(postRes.statusCode, 200);
      assert.equal(JSON.parse(postRes.body).status, 'ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('agents/codebase-retrieval endpoint validates parameters and rejects missing query', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      const res = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/agents/codebase-retrieval',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ repo_path: process.cwd() }),
      );
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.body);
      assert.ok(data.message.includes('information_request'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });
  test('/api/tokens CRUD: tao token, lay danh sach va thu hoi token', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      // 1. POST /api/tokens
      const createRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/api/tokens',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({
          userId: 'test-user',
          description: 'Test Token for MCP',
          expiresInDays: 30,
        }),
      );

      assert.equal(createRes.statusCode, 201);
      const createData = JSON.parse(createRes.body);
      assert.equal(createData.success, true);
      assert.ok(createData.token.startsWith('ace_'));
      assert.ok(createData.tokenId);
      assert.equal(createData.userId, 'test-user');

      // 2. GET /api/tokens
      const listRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/api/tokens?userId=test-user',
        method: 'GET',
      });

      assert.equal(listRes.statusCode, 200);
      const listData = JSON.parse(listRes.body);
      assert.equal(listData.success, true);
      assert.ok(Array.isArray(listData.tokens));
      const found = listData.tokens.find((t: any) => t.id === createData.tokenId);
      assert.ok(found);
      assert.equal(found.description, 'Test Token for MCP');

      // 3. DELETE /api/tokens/:tokenId
      const deleteRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: `/api/tokens/${createData.tokenId}`,
        method: 'DELETE',
      });

      assert.equal(deleteRes.statusCode, 200);
      const deleteData = JSON.parse(deleteRes.body);
      assert.equal(deleteData.success, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('Group B Context Sync endpoints: /batch-upload, /checkpoint-blobs, /find-missing, /save-chat, /indexed-commits, /chat/exchanges/list', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      // 1. /batch-upload
      const uploadRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/batch-upload',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ repo_path: 'default', blobs: [{ hash: 'h1', path: 'file1.ts' }] }),
      );
      assert.equal(uploadRes.statusCode, 200);
      assert.equal(JSON.parse(uploadRes.body).status, 'ok');
      assert.equal(JSON.parse(uploadRes.body).blobs_received, 1);

      // 2. /checkpoint-blobs (POST)
      const chkRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/checkpoint-blobs',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ checkpoint_id: 'chk_1', blobs: ['h1'] }),
      );
      assert.equal(chkRes.statusCode, 200);
      assert.equal(JSON.parse(chkRes.body).status, 'ok');
      assert.equal(JSON.parse(chkRes.body).checkpoint_id, 'chk_1');

      // 3. /find-missing (POST)
      const findRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/find-missing',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ hashes: ['h1', 'h2'] }),
      );
      assert.equal(findRes.statusCode, 200);
      assert.equal(JSON.parse(findRes.body).status, 'ok');
      assert.equal(JSON.parse(findRes.body).all_synced, true);

      // 4. /save-chat (POST)
      const chatRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/save-chat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ session_id: 's1', messages: [{ role: 'user', content: 'test' }] }),
      );
      assert.equal(chatRes.statusCode, 200);
      assert.equal(JSON.parse(chatRes.body).status, 'ok');
      assert.equal(JSON.parse(chatRes.body).session_id, 's1');

      // 5. /indexed-commits/get-latest-blobset (GET)
      const commitGetRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/indexed-commits/get-latest-blobset?commit_hash=abc1234',
        method: 'GET',
      });
      assert.equal(commitGetRes.statusCode, 200);
      assert.equal(JSON.parse(commitGetRes.body).status, 'ok');
      assert.equal(JSON.parse(commitGetRes.body).commit_hash, 'abc1234');

      // 6. /indexed-commits/register-blobset (POST)
      const commitRegRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/indexed-commits/register-blobset',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ commit_hash: 'def5678', files: ['src/a.ts'] }),
      );
      assert.equal(commitRegRes.statusCode, 200);
      assert.equal(JSON.parse(commitRegRes.body).status, 'ok');
      assert.equal(JSON.parse(commitRegRes.body).registered, true);

      // 7. /chat/exchanges/list (GET)
      const exchangesRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/chat/exchanges/list?session_id=s1',
        method: 'GET',
      });
      assert.equal(exchangesRes.statusCode, 200);
      assert.equal(JSON.parse(exchangesRes.body).status, 'ok');
      assert.equal(JSON.parse(exchangesRes.body).session_id, 's1');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('Group C Agents endpoints: /agents/list-remote-tools, /agents/check-tool-safety, /agents/revoke-tool-access, /agents/codebase-retrieval-raw', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      // 1. /agents/list-remote-tools (GET)
      const toolsRes = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/agents/list-remote-tools',
        method: 'GET',
      });
      assert.equal(toolsRes.statusCode, 200);
      const toolsData = JSON.parse(toolsRes.body);
      assert.equal(toolsData.status, 'ok');
      assert.ok(Array.isArray(toolsData.tools));
      assert.ok(toolsData.tools.some((t: any) => t.name === 'codebase-retrieval'));

      // 2. /agents/check-tool-safety (POST)
      const safetyRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/agents/check-tool-safety',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ tool_name: 'codebase-retrieval', parameters: { query: 'test' } }),
      );
      assert.equal(safetyRes.statusCode, 200);
      assert.equal(JSON.parse(safetyRes.body).safe, true);

      // 3. /agents/revoke-tool-access (POST)
      const revokeRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/agents/revoke-tool-access',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ tool_name: 'test-tool', session_id: 'sess-1' }),
      );
      assert.equal(revokeRes.statusCode, 200);
      assert.equal(JSON.parse(revokeRes.body).status, 'ok');

      // 4. /agents/codebase-retrieval-raw (POST validation)
      const rawRes = await httpRequest(
        {
          hostname: TEST_HOST,
          port: TEST_PORT,
          path: '/agents/codebase-retrieval-raw',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ repo_path: process.cwd() }),
      );
      assert.equal(rawRes.statusCode, 400); // Missing information_request
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });

  test('404 cho unknown paths', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);

    try {
      const response = await httpRequest({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/unknown-path',
        method: 'GET',
      });

      assert.equal(response.statusCode, 404);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
