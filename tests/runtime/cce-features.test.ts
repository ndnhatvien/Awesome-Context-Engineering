import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { skeletonizeCode } from '../../src/chunking/skeletonizer.js';
import { SavingsLedger } from '../../src/ledger/SavingsLedger.js';
import { initSavingsTables } from '../../src/ledger/schema.js';
import { handleExpandChunk } from '../../src/mcp/tools/expandChunk.js';
import { setupAgentPlugin } from '../../src/plugin/agentPlugin.js';
import { SecretScrubber } from '../../src/security/SecretScrubber.js';

test('SecretScrubber: 自动识别并擦除多种敏感凭据', () => {
  const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const fakeGh = ['ghp_', '123456789012345678901234567890123456'].join('');
  const fakeSlack = [
    'xoxb',
    '-123456789012-123456789012-',
    'abcdefghijklmnopqrstuvwx',
  ].join('');
  const fakeAi = ['sk', '-proj-abc123456789012345678901234567890'].join('');
  const fakeJwt = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0',
    '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  ].join('');
  const fakePrivKey = [
    '-----BEGIN RSA PRIVATE KEY-----',
    '\\nMIIEowIBAAKCAQEA0\\n',
    '-----END RSA PRIVATE KEY-----',
  ].join('');

  const sensitiveCode = `
    const awsKey = "${fakeAws}";
    const githubToken = "${fakeGh}";
    const slackToken = "${fakeSlack}";
    const openaiKey = "${fakeAi}";
    const jwtToken = "${fakeJwt}";
    const privateKey = "${fakePrivKey}";
  `;

  assert.equal(SecretScrubber.containsSecrets(sensitiveCode), true);

  const result = SecretScrubber.scrub(sensitiveCode);
  assert.equal(result.redactedCount >= 6, true);
  assert.ok(result.detectedTypes.includes('AWS_ACCESS_KEY'));
  assert.ok(result.detectedTypes.includes('GITHUB_PAT'));
  assert.ok(result.detectedTypes.includes('SLACK_TOKEN'));
  assert.ok(result.detectedTypes.includes('AI_PROVIDER_KEY'));
  assert.ok(result.detectedTypes.includes('JWT_TOKEN'));
  assert.ok(result.detectedTypes.includes('PRIVATE_KEY'));

  assert.ok(!result.cleanText.includes(fakeAws));
  assert.ok(!result.cleanText.includes(fakeGh));
  assert.ok(result.cleanText.includes('[REDACTED_AWS_ACCESS_KEY]'));
  assert.ok(result.cleanText.includes('[REDACTED_GITHUB_TOKEN]'));
});

test('AST Skeletonizer: 渐进式折叠函数体并保留接口签名', () => {
  const tsCode = `
export class PaymentProcessor {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Process customer transaction */
  public async executePayment(orderId: string, amount: number): Promise<boolean> {
    const payload = { orderId, amount };
    const validated = await this.validateOrder(payload);
    if (!validated) {
      throw new Error("Invalid order");
    }
    const gateway = await this.connectGateway();
    const result = await gateway.charge(amount);
    await this.logTransaction(orderId, result);
    return result.success;
  }
}
  `.trim();

  const skelResult = skeletonizeCode(tsCode, 'typescript', {
    minLines: 8,
    chunkId: 'src/payment.ts#10',
  });

  assert.equal(skelResult.isSkeletonized, true);
  assert.ok(skelResult.hiddenLines > 0);
  assert.ok(skelResult.code.includes('public async executePayment'));
  assert.ok(skelResult.code.includes('Use expand-chunk(chunk_id: "src/payment.ts#10") to view'));
  assert.ok(!skelResult.code.includes('const gateway = await this.connectGateway()'));

  // 短函数不应被压缩
  const shortCode = `function add(a: number, b: number) {\n  return a + b;\n}`;
  const shortResult = skeletonizeCode(shortCode, 'typescript', { minLines: 10 });
  assert.equal(shortResult.isSkeletonized, false);
});

test('expand-chunk MCP Tool: 按需提取指定代码行区间与防遍历安全检查', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-expand-test-'));
  const testFile = path.join(tmpDir, 'test.ts');
  const fileLines = [
    'line 1',
    'line 2',
    'line 3',
    'line 4',
    'line 5',
    'line 6',
    'line 7',
    'line 8',
    'line 9',
    'line 10',
  ];
  fs.writeFileSync(testFile, fileLines.join('\n'), 'utf-8');

  try {
    // 正常展开行区间 3-6
    const res = await handleExpandChunk({
      repo_path: tmpDir,
      file_path: 'test.ts',
      start_line: 3,
      end_line: 6,
    });

    assert.ok(res.content[0].text.includes('Expanded Chunk: test.ts (Lines 3-6'));
    assert.ok(res.content[0].text.includes('line 3'));
    assert.ok(res.content[0].text.includes('line 6'));
    assert.ok(!res.content[0].text.includes('line 1'));
    assert.ok(!res.content[0].text.includes('line 10'));

    // 路径遍历检测
    const traversalRes = await handleExpandChunk({
      repo_path: tmpDir,
      file_path: '../outside.ts',
    });
    assert.ok(traversalRes.content[0].text.includes('Path traversal detected'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SavingsLedger: Token 节约账本与多模型成本估算', () => {
  const db = new Database(':memory:');
  initSavingsTables(db);

  const ledger = new SavingsLedger(db);

  // 1. Token 估算
  const code = 'function test() {\n  return "hello world";\n}';
  const tokens = SavingsLedger.estimateTokens(code);
  assert.ok(tokens > 5 && tokens < 20);

  // 2. 记录节约事件
  const rec1 = ledger.record({
    projectId: 'test_proj',
    query: 'find payment service',
    category: 'retrieval',
    baselineTokens: 10000,
    deliveredTokens: 1200,
  });
  assert.equal(rec1.savedTokens, 8800);
  assert.ok(rec1.costSavedUsd > 0);

  const rec2 = ledger.record({
    projectId: 'test_proj',
    query: 'read auth class',
    category: 'chunk_compression',
    baselineTokens: 5000,
    deliveredTokens: 500,
  });
  assert.equal(rec2.savedTokens, 4500);

  // 3. 查询统计摘要
  const summary = ledger.getSummary('test_proj');
  assert.equal(summary.totalQueries, 2);
  assert.equal(summary.baselineTokens, 15000);
  assert.equal(summary.deliveredTokens, 1700);
  assert.equal(summary.savedTokens, 13300);
  assert.ok(summary.savingsRatio > 0.85);

  assert.ok(summary.costByModel['claude-3-5-sonnet'] > 0);
  assert.ok(summary.costByModel['claude-3-opus'] > summary.costByModel['claude-3-5-sonnet']);

  // 4. 终端报表格式化
  const report = SavingsLedger.formatTerminalReport(summary);
  assert.ok(report.includes('Token Savings & Cost Ledger'));
  assert.ok(report.includes('Retrieval (Full vs Chunks)'));
  assert.ok(report.includes('Skeleton Compression'));
});

test('Agent Plugin Generator: 生成遵循 agent-plugins.org v1.0.0 的规范插件', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-plugin-test-'));

  try {
    const result = setupAgentPlugin({
      projectPath: tmpDir,
      version: '0.2.0',
    });

    assert.ok(fs.existsSync(path.join(result.pluginDir, 'plugin.json')));
    assert.ok(fs.existsSync(path.join(result.pluginDir, 'mcp.json')));
    assert.ok(fs.existsSync(path.join(result.pluginDir, 'skills/code-context/SKILL.md')));

    const pluginJson = JSON.parse(
      fs.readFileSync(path.join(result.pluginDir, 'plugin.json'), 'utf-8'),
    );
    assert.equal(pluginJson.$schema, 'https://agent-plugins.org/v1/schema.json');
    assert.equal(pluginJson.name, 'awesome-context-engineering');

    const mcpJson = JSON.parse(
      fs.readFileSync(path.join(result.pluginDir, 'mcp.json'), 'utf-8'),
    );
    assert.ok(mcpJson.mcpServers.ace);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
