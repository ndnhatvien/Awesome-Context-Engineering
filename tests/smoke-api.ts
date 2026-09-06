/**
 * Smoke Test: Kiểm tra kết nối API Embedding & Reranker
 *
 * Chạy: npx tsx tests/smoke-api.ts
 */

import '../src/config.js'; // Load .env
import {
  checkEmbeddingEnv,
  checkRerankerEnv,
  getEmbeddingConfig,
  getRerankerConfig,
} from '../src/config.js';

async function testEmbeddingAPI() {
  console.log('\n========================================');
  console.log('🔍 EMBEDDING API TEST');
  console.log('========================================');

  // 1. Check env
  const envCheck = checkEmbeddingEnv();
  if (!envCheck.isValid) {
    console.log('❌ Thiếu biến môi trường:', envCheck.missingVars.join(', '));
    return false;
  }
  console.log('✅ Env vars OK');

  // 2. Get config
  const config = getEmbeddingConfig();
  console.log(`   Base URL : ${config.baseUrl}`);
  console.log(`   Model    : ${config.model}`);
  console.log(`   Dimensions: ${config.dimensions}`);
  console.log(`   API Keys : ${config.apiKeys?.length ?? 1} key(s)`);

  // 3. Call API
  try {
    const url = config.baseUrl.replace(/\/+$/, '');
    const body = {
      model: config.model,
      input: ['Hello world, this is a test embedding request.'],
      encoding_format: 'float',
    };

    console.log(`\n   → POST ${url}`);
    const startMs = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const elapsed = Date.now() - startMs;
    const data = (await res.json()) as any;

    if (!res.ok) {
      console.log(`❌ HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
      return false;
    }

    const embedding = data?.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      console.log('❌ Response không chứa embedding vector:', JSON.stringify(data).slice(0, 300));
      return false;
    }

    console.log(`✅ Embedding API OK (${elapsed}ms)`);
    console.log(`   Vector dimensions: ${embedding.length}`);
    console.log(
      `   First 5 values: [${embedding
        .slice(0, 5)
        .map((v: number) => v.toFixed(6))
        .join(', ')}]`,
    );
    console.log(`   Usage: ${JSON.stringify(data.usage ?? 'N/A')}`);
    return true;
  } catch (err) {
    console.log(`❌ Lỗi kết nối: ${(err as Error).message}`);
    return false;
  }
}

async function testRerankerAPI() {
  console.log('\n========================================');
  console.log('⚡ RERANKER API TEST');
  console.log('========================================');

  // 1. Check env
  const envCheck = checkRerankerEnv();
  if (!envCheck.isValid) {
    console.log('❌ Thiếu biến môi trường:', envCheck.missingVars.join(', '));
    return false;
  }
  console.log('✅ Env vars OK');

  // 2. Get config
  const config = getRerankerConfig();
  console.log(`   Base URL : ${config.baseUrl}`);
  console.log(`   Model    : ${config.model}`);
  console.log(`   Top N    : ${config.topN}`);
  console.log(`   API Keys : ${config.apiKeys?.length ?? 1} key(s)`);

  // 3. Call API
  try {
    const url = config.baseUrl.replace(/\/+$/, '');
    const body = {
      model: config.model,
      query: 'How does user authentication work?',
      documents: [
        'The login function validates email and password using bcrypt.',
        'CSS styles for the homepage banner layout.',
        'JWT tokens are generated after successful authentication.',
        'Database migration script for users table.',
      ],
      top_n: 3,
    };

    console.log(`\n   → POST ${url}`);
    const startMs = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const elapsed = Date.now() - startMs;
    const data = (await res.json()) as any;

    if (!res.ok) {
      console.log(`❌ HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
      return false;
    }

    const results = data?.results;
    if (!results || !Array.isArray(results)) {
      console.log('❌ Response không chứa results:', JSON.stringify(data).slice(0, 300));
      return false;
    }

    console.log(`✅ Reranker API OK (${elapsed}ms)`);
    console.log(`   Results (top ${results.length}):`);
    for (const r of results) {
      const doc = body.documents[r.index];
      console.log(
        `     #${r.index} score=${r.relevance_score?.toFixed(6) ?? 'N/A'} → "${doc.slice(0, 60)}..."`,
      );
    }
    console.log(`   Usage: ${JSON.stringify(data.usage ?? data.meta ?? 'N/A')}`);
    return true;
  } catch (err) {
    console.log(`❌ Lỗi kết nối: ${(err as Error).message}`);
    return false;
  }
}

// Main
async function main() {
  console.log('🚀 ACE API Smoke Test');
  console.log('Kiểm tra kết nối Embedding & Reranker API...');

  const embOk = await testEmbeddingAPI();
  const rerankOk = await testRerankerAPI();

  console.log('\n========================================');
  console.log('📊 KẾT QUẢ');
  console.log('========================================');
  console.log(`   Embedding API : ${embOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Reranker API  : ${rerankOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('========================================\n');

  process.exit(embOk && rerankOk ? 0 : 1);
}

main();
