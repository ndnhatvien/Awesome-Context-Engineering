#!/usr/bin/env node

/**
 * Quick Setup Script - ACE MCP + Augment-BYOK
 *
 * Tự động generate config cho Augment-BYOK với ACE MCP server
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ACE MCP + Augment-BYOK - Quick Setup                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Get API key
  console.log('📝 Step 1: API Key\n');
  const provider = await prompt('Choose provider (1=Anthropic, 2=OpenAI): ');

  let providerId, providerType, apiKey, models, defaultModel;

  if (provider === '1' || provider.toLowerCase() === 'anthropic') {
    providerId = 'anthropic';
    providerType = 'anthropic';
    apiKey = await prompt('Enter Anthropic API key (sk-ant-...): ');
    models = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
    defaultModel = 'claude-3-5-sonnet-20241022';
  } else {
    providerId = 'openai';
    providerType = 'openai_compatible';
    apiKey = await prompt('Enter OpenAI API key (sk-...): ');
    models = ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
    defaultModel = 'gpt-4-turbo';
  }

  // Get ACE path
  console.log('\n📂 Step 2: ACE Path\n');
  const acePath = path.join(__dirname, '..', 'dist', 'index.js');
  const aceExists = fs.existsSync(acePath);

  console.log(`Default: ${acePath}`);
  console.log(`Status: ${aceExists ? '✅ Found' : '❌ Not found'}`);

  if (!aceExists) {
    console.error('\n❌ ACE not built!');
    console.error('Run: cd D:\\MCP\\Awesome-Context-Engineering && pnpm build\n');
    rl.close();
    process.exit(1);
  }

  const customPath = await prompt('\nUse custom path? (Enter to use default, or type path): ');
  const finalPath = customPath.trim() || acePath;

  // Get inject position
  console.log('\n⚙️  Step 3: Inject Mode\n');
  console.log('1. replace  - Skip Augment indexing, use ONLY ACE (Recommended)');
  console.log('2. before   - ACE → Augment context → LLM (additive)');
  console.log('3. after    - Augment context → ACE → LLM (supplementary)');

  const modeChoice = await prompt('\nChoose mode (1-3, default=1): ');
  const injectPosition = modeChoice === '2' ? 'before' : modeChoice === '3' ? 'after' : 'replace';

  // Generate config
  console.log('\n🔧 Generating config...\n');

  const config = {
    version: 1,
    mcp: {
      enabled: true,
      injectPosition: injectPosition,
      servers: [
        {
          name: 'ace',
          command: 'node',
          args: [
            finalPath.replace(/\\/g, '\\\\'), // Escape backslashes for Windows
            'mcp',
          ],
          env: {},
        },
      ],
    },
    providers: [
      {
        id: providerId,
        type: providerType,
        baseUrl:
          providerId === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
        apiKey: apiKey,
        models: models,
        defaultModel: defaultModel,
      },
    ],
    routing: {
      rules: {
        '/chat': { mode: 'byok' },
        '/chat-stream': { mode: 'byok' },
      },
    },
  };

  // Write to Augment-BYOK repo
  const augmentByokPath = path.join(
    __dirname,
    '..',
    '..',
    'Augment-BYOK',
    '.augment-byok.config.json',
  );
  const augmentByokDir = path.dirname(augmentByokPath);

  if (!fs.existsSync(augmentByokDir)) {
    console.error(`❌ Augment-BYOK repo not found at: ${augmentByokDir}`);
    console.error('Expected: D:\\MCP\\Augment-BYOK\n');
    rl.close();
    process.exit(1);
  }

  fs.writeFileSync(augmentByokPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`✅ Config written to: ${augmentByokPath}\n`);

  // Write copy to ACE repo for backup
  const backupPath = path.join(__dirname, 'augment-byok-config-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`✅ Backup written to: ${backupPath}\n`);

  // Summary
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Configuration Summary                                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Provider:        ${providerId} (${providerType})`);
  console.log(`API Key:         ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`);
  console.log(`Models:          ${models.join(', ')}`);
  console.log(`Default Model:   ${defaultModel}`);
  console.log('MCP Server:      ace');
  console.log(`MCP Command:     node ${finalPath}`);
  console.log(`Inject Position: ${injectPosition}`);
  console.log('');

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Next Steps                                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('1. Build VSIX:');
  console.log('   cd D:\\MCP\\Augment-BYOK');
  console.log('   npm run build:vsix');
  console.log('');
  console.log('2. Install VSIX in VS Code:');
  console.log('   Extensions → Install from VSIX');
  console.log('   → Select: dist/augment.vscode-augment.*-byok.*.vsix');
  console.log('');
  console.log('3. Import config in VS Code:');
  console.log('   Ctrl+Shift+P → BYOK: Import Config');
  console.log(`   → Select: ${augmentByokPath}`);
  console.log('');
  console.log('4. Enable BYOK:');
  console.log('   Ctrl+Shift+P → BYOK: Enable');
  console.log('');
  console.log('5. Test:');
  console.log('   Open code folder → Chat about code');
  console.log('   Check: Output → Augment-BYOK for [mcp] logs');
  console.log('');
  console.log('📖 Full guide: AUGMENT_BYOK_MCP_READY.md');
  console.log('');

  rl.close();
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  rl.close();
  process.exit(1);
});
