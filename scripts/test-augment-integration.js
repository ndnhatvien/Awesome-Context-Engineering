#!/usr/bin/env node
/**
 * Test ACE Integration
 *
 * Test MCP client và context injection
 */

const path = require('node:path');

// Set up paths
const byokRoot = path.join(__dirname, '..', '..', 'Augment_BYOK_gagmeng');
const integrationPath = path.join(byokRoot, 'payload/extension/out/byok/integrations/ace');

console.log('Testing ACE Integration...\n');

async function testMCPClient() {
  console.log('1. Testing MCP Client Connection...');

  try {
    const { getAceClient } = require(path.join(integrationPath, 'mcp-client.js'));

    const client = getAceClient({
      mcpServerPath: 'ace',
      mcpServerArgs: ['mcp'],
    });

    await client.connect();
    console.log('   ✅ MCP Client connected\n');

    console.log('2. Testing Codebase Search...');
    const result = await client.searchCodebase(
      'How does authentication work?',
      'D:/MCP/Awesome-Context-Engineering',
      {
        source_code_only: true,
      },
    );

    if (result.error) {
      console.log('   ⚠️  Search returned error:', result.error);
    } else {
      console.log('   ✅ Search successful');
      console.log('   Chunks returned:', result.chunks.length);
      if (result.chunks.length > 0) {
        console.log('   First chunk preview:', result.chunks[0].content.slice(0, 200));
      }
    }

    await client.close();
    console.log('\n   ✅ MCP Client closed');
  } catch (err) {
    console.error('   ❌ MCP Client test failed:', err.message);
    throw err;
  }
}

async function testContextInjector() {
  console.log('\n3. Testing Context Injector...');

  try {
    const { extractQueryFromRequest, extractTechnicalTerms, formatSearchResults } = require(
      path.join(integrationPath, 'context-injector.js'),
    );

    // Test query extraction
    const request = {
      message: 'How does the authentication module handle JWT tokens?',
    };

    const query = extractQueryFromRequest(request);
    console.log('   ✅ Query extracted:', `${query.slice(0, 50)}...`);

    // Test technical terms extraction
    const terms = extractTechnicalTerms(query);
    console.log('   ✅ Technical terms:', terms.join(', '));

    // Test formatting
    const mockChunks = [
      { content: 'function authenticate(token) { ... }' },
      { content: 'class JWTHandler { ... }' },
    ];

    const formatted = formatSearchResults(mockChunks);
    console.log('   ✅ Formatted results:', formatted.length, 'bytes');
  } catch (err) {
    console.error('   ❌ Context Injector test failed:', err.message);
    throw err;
  }
}

async function testWorkspaceWatcher() {
  console.log('\n4. Testing Workspace Watcher...');

  try {
    const { onWorkspaceOpened, getIndexedWorkspaces, resetWorkspaces } = require(
      path.join(integrationPath, 'workspace-watcher.js'),
    );

    resetWorkspaces();

    await onWorkspaceOpened('D:/MCP/Awesome-Context-Engineering', {
      enabled: true,
      autoIndex: true,
    });

    const indexed = getIndexedWorkspaces();
    console.log('   ✅ Indexed workspaces:', indexed);

    resetWorkspaces();
  } catch (err) {
    console.error('   ❌ Workspace Watcher test failed:', err.message);
    throw err;
  }
}

async function main() {
  try {
    await testMCPClient();
    await testContextInjector();
    await testWorkspaceWatcher();

    console.log('\n✅ All tests passed!');
    console.log('\nNext steps:');
    console.log('  1. Build BYOK VSIX: cd D:/MCP/Augment_BYOK_gagmeng && npm run build:vsix');
    console.log('  2. Install VSIX in VS Code');
    console.log('  3. Enable ACE in BYOK Config Panel');
    console.log('  4. Test with real workspace');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Tests failed:', err.message);
    process.exit(1);
  }
}

main();
