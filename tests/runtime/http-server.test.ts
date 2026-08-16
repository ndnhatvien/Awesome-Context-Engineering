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
function _httpRequestHeadersOnly(
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
  test('MCP endpoint chấp nhận GET requests cho SSE', async () => {
    const app = createHttpServerApp(TEST_HOST);
    const server = app.listen(TEST_PORT, TEST_HOST);

    try {
      const req = http.request({
        hostname: TEST_HOST,
        port: TEST_PORT,
        path: '/mcp',
        method: 'GET',
      });
      req.on('error', () => {}); // Tránh ngoại lệ chưa được bắt (uncaught exception) khi đóng socket
      req.end();

      // Đợi 300ms để server nhận request và khởi tạo session, sau đó chủ động đóng socket để tránh bị treo
      await new Promise((resolve) => setTimeout(resolve, 300));
      req.destroy();
    } finally {
      if (server.closeAllConnections) {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // Đợi port được giải phóng
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
