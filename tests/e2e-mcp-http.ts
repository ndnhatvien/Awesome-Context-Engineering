/**
 * E2E Test: Gọi MCP HTTP Server qua localhost
 *
 * Test toàn bộ pipeline: HTTP → Auth → Embedding → Rerank → Response
 */

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('🚀 ACE MCP HTTP E2E Test');
  console.log(`   Server: ${BASE_URL}`);
  console.log('');

  // 1. Health check
  console.log('① Health Check...');
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = (await healthRes.json()) as any;
    if (health.status === 'ok') {
      console.log(`   ✅ Server OK: ${health.service} v${health.version}`);
      console.log(`   Embedding: ${health.embeddingModel} @ ${health.embeddingBaseUrl}`);
      console.log(`   Reranker: ${health.rerankModel} @ ${health.rerankBaseUrl}`);
    } else {
      console.log('   ❌ Server not healthy:', health);
      process.exit(1);
    }
  } catch (err) {
    console.log(`   ❌ Cannot connect to ${BASE_URL}: ${(err as Error).message}`);
    console.log('   → Hãy chạy: node dist/index.js mcp-http --port 3000');
    process.exit(1);
  }

  // 2. Create admin token
  console.log('\n② Tạo Admin Token...');

  // Login as admin first to get session cookie
  const loginRes = await fetch(`${BASE_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=admin123',
    redirect: 'manual',
  });

  const cookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.startsWith('ace_session='));

  if (!sessionCookie) {
    console.log(
      '   ❌ Admin login failed (no session cookie). Kiểm tra ACE_ADMIN_PASSWORD trong .env',
    );
    process.exit(1);
  }
  console.log('   ✅ Admin login OK');

  // Create API token
  const tokenRes = await fetch(`${BASE_URL}/admin/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie.split(';')[0],
    },
    body: JSON.stringify({ userId: 'e2e-test', description: 'E2E smoke test' }),
  });
  const tokenData = (await tokenRes.json()) as any;

  if (!tokenData.success) {
    console.log('   ❌ Token creation failed:', tokenData);
    process.exit(1);
  }
  const API_TOKEN = tokenData.token;
  console.log(`   ✅ Token created: ${API_TOKEN.slice(0, 15)}...`);

  // 3. List tools (MCP)
  console.log('\n③ MCP: List Tools...');
  const listToolsRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: 1,
    }),
  });
  const listToolsData = (await listToolsRes.json()) as any;

  if (listToolsData.result?.tools) {
    const toolNames = listToolsData.result.tools.map((t: any) => t.name);
    console.log(`   ✅ ${toolNames.length} tools: ${toolNames.join(', ')}`);
  } else {
    console.log('   ⚠️ Unexpected response:', JSON.stringify(listToolsData).slice(0, 200));
  }

  // 4. Call codebase-retrieval (FULL PIPELINE: Embedding + Rerank)
  console.log('\n④ MCP: codebase-retrieval (Full Pipeline: Index → Embed → FTS → Rerank)...');
  console.log('   Đang chạy... (lần đầu có thể mất 30-60s để index)');

  const startMs = Date.now();
  const retrievalRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'codebase-retrieval',
        arguments: {
          repo_path: 'D:\\MCP\\Awesome-Context-Engineering',
          information_request:
            'How does the search pipeline work? Trace the flow from query to results.',
          technical_terms: ['SearchService', 'rerank', 'hybridRetrieve'],
        },
      },
      id: 2,
    }),
  });

  const elapsed = Date.now() - startMs;
  const retrievalData = (await retrievalRes.json()) as any;

  if (retrievalData.result?.content?.[0]?.text) {
    const text = retrievalData.result.content[0].text;
    const lines = text.split('\n');
    const summaryLine = lines[0] || '';

    console.log(`   ✅ codebase-retrieval OK (${elapsed}ms)`);
    console.log(`   ${summaryLine}`);

    // Count files and segments
    const fileMatches = text.match(/## .+\.(ts|js|py|go|rs)/g);
    console.log(`   Code segments returned: ${fileMatches?.length ?? 0}`);
    console.log(`   Response size: ${text.length} chars`);

    // Show first 3 file paths
    if (fileMatches) {
      console.log('   Top files:');
      for (const m of fileMatches.slice(0, 3)) {
        console.log(`     ${m}`);
      }
    }
  } else if (retrievalData.result?.content?.[0]?.text?.includes('环境变量未配置')) {
    console.log('   ❌ API Keys chưa cấu hình trong server .env');
    console.log(`   ${retrievalData.result.content[0].text.slice(0, 200)}`);
  } else if (retrievalData.error) {
    console.log(`   ❌ MCP Error: ${JSON.stringify(retrievalData.error).slice(0, 300)}`);
  } else {
    console.log(`   ⚠️ Unexpected: ${JSON.stringify(retrievalData).slice(0, 300)}`);
  }

  // 5. Call detect-tasks
  console.log('\n⑤ MCP: detect-tasks...');
  const tasksRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'detect-tasks',
        arguments: {
          repo_path: 'D:\\MCP\\Awesome-Context-Engineering',
        },
      },
      id: 3,
    }),
  });
  const tasksData = (await tasksRes.json()) as any;

  if (tasksData.result?.content?.[0]?.text) {
    const text = tasksData.result.content[0].text;
    const firstLines = text.split('\n').slice(0, 3).join('\n');
    console.log('   ✅ detect-tasks OK');
    console.log(`   ${firstLines}`);
  } else {
    console.log(`   ⚠️ Response: ${JSON.stringify(tasksData).slice(0, 200)}`);
  }

  // 6. Cleanup: revoke test token
  console.log('\n⑥ Cleanup: Revoke test token...');
  await fetch(`${BASE_URL}/admin/tokens/${tokenData.tokenId}`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie.split(';')[0] },
  });
  console.log('   ✅ Token revoked');

  // Summary
  console.log('\n========================================');
  console.log('📊 E2E TEST HOÀN TẤT');
  console.log('========================================');
  console.log(`   Tổng thời gian: ${Date.now() - startMs + elapsed}ms`);
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
