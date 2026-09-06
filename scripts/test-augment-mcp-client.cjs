#!/usr/bin/env node

/**
 * Test Augment MCP Client Integration
 *
 * Verify rằng mcp-client.js có thể connect và call ACE MCP server
 */

const path = require('node:path');

// Mock log functions
global.info = (...args) => console.log('[INFO]', ...args);
global.warn = (...args) => console.warn('[WARN]', ...args);

// Mock infra/log module
const mockLogPath = path.join(__dirname, '../node_modules', 'augment-mock-log.js');
require('node:module')._cache[mockLogPath] = {
  exports: {
    info: global.info,
    warn: global.warn,
  },
};

// Override require to return mock for infra/log
const Module = require('node:module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id.includes('infra/log')) {
    return {
      info: global.info,
      warn: global.warn,
    };
  }
  return originalRequire.apply(this, arguments);
};

async function testMCPClient() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 Testing Augment MCP Client Integration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Import MCP client
    const mcpClientPath = path.join(
      __dirname,
      '../../Augment_BYOK_gagmeng/payload/extension/out/byok/integrations/ace/mcp-client.js',
    );

    console.log('📦 Loading MCP client from:', mcpClientPath);
    const { getAceClient } = require(mcpClientPath);

    // Test 1: Create client
    console.log('\n✅ Test 1: Create client instance');

    // Use node to run ACE from dist
    const acePath = 'node';
    const aceArgs = [path.join(__dirname, '../dist/index.js'), 'mcp'];

    const client = getAceClient({
      mcpServerPath: acePath,
      mcpServerArgs: aceArgs,
    });
    console.log('   Client created:', !!client);

    // Test 2: Connect to MCP server
    console.log('\n✅ Test 2: Connect to MCP server');
    await client.connect();
    console.log('   Connected:', client.isConnected);

    // Test 3: Search codebase
    console.log('\n✅ Test 3: Search codebase');
    const repoPath = path.join(__dirname, '..');
    const query = 'MCP server implementation';

    console.log('   Query:', query);
    console.log('   Repo:', repoPath);

    const result = await client.searchCodebase(query, repoPath, {
      source_code_only: true,
      technical_terms: ['MCP', 'server'],
    });

    console.log('   Result chunks:', result.chunks?.length || 0);
    console.log('   Has error:', !!result.error);

    if (result.chunks && result.chunks.length > 0) {
      const preview = result.chunks[0].content.slice(0, 200);
      console.log('   Preview:', `${preview.replace(/\n/g, ' ').slice(0, 150)}...`);
    }

    // Test 4: Close connection
    console.log('\n✅ Test 4: Close connection');
    await client.close();
    console.log('   Closed:', !client.isConnected);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All tests passed!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testMCPClient().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
