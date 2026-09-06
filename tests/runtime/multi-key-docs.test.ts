import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_ENV_TEMPLATE } from '../../src/config.js';

const cliTemplateSource = fs.readFileSync('src/index.ts', 'utf8');
const mcpTemplateSource = fs.readFileSync('src/mcp/tools/codebaseRetrieval.ts', 'utf8');

// 统一模板: KEYS 作为默认项，单 key 为注释
assert.match(DEFAULT_ENV_TEMPLATE, /^EMBEDDINGS_API_KEYS=your-api-key-here$/m);
assert.match(DEFAULT_ENV_TEMPLATE, /^#\s*EMBEDDINGS_API_KEY=your-api-key-here$/m);
assert.match(DEFAULT_ENV_TEMPLATE, /^RERANK_API_KEYS=your-api-key-here$/m);
assert.match(DEFAULT_ENV_TEMPLATE, /^#\s*RERANK_API_KEY=your-api-key-here$/m);

// CLI/MCP 不应再维护第二份可漂移的 env 模板。
assert.match(cliTemplateSource, /DEFAULT_ENV_TEMPLATE/);
assert.match(mcpTemplateSource, /DEFAULT_ENV_TEMPLATE/);
