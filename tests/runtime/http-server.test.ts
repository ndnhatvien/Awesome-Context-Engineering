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
