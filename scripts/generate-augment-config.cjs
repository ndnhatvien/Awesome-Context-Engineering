#!/usr/bin/env node
/**
 * Auto-generate Augment BYOK config với ACE integration
 *
 * Usage:
 *   node scripts/generate-augment-config.cjs
 *   node scripts/generate-augment-config.cjs --anthropic-key sk-ant-xxx
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    anthropicKey: null,
    openaiKey: null,
    provider: 'anthropic',
    outputPath: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--anthropic-key':
        config.anthropicKey = args[++i];
        break;
      case '--openai-key':
        config.openaiKey = args[++i];
        config.provider = 'openai';
        break;
      case '--provider':
        config.provider = args[++i];
        break;
      case '--output':
        config.outputPath = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
Auto-generate Augment BYOK config with ACE integration

Usage:
  node scripts/generate-augment-config.cjs [options]

Options:
  --anthropic-key <key>    Anthropic API key (sk-ant-...)
  --openai-key <key>       OpenAI API key (sk-...)
  --provider <name>        Provider to use (anthropic|openai)
  --output <path>          Output path (default: ~/.augment/byok-config.json)
  --help, -h              Show this help

Examples:
  # Interactive (will prompt for API key)
  node scripts/generate-augment-config.cjs

  # With Anthropic key
  node scripts/generate-augment-config.cjs --anthropic-key sk-ant-xxx

  # With OpenAI key
  node scripts/generate-augment-config.cjs --openai-key sk-xxx

  # Custom output path
  node scripts/generate-augment-config.cjs --output ./byok-config.json
`);
}

// Prompt for input
function prompt(question) {
  return new Promise((resolve) => {
    const readline = require('node:readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

// Get ACE dist path
function getAceDistPath() {
  const distPath = path.join(__dirname, '..', 'dist', 'index.js');
  const absolutePath = path.resolve(distPath);

  if (!fs.existsSync(absolutePath)) {
    console.warn('⚠️  Warning: ACE dist/index.js not found at:', absolutePath);
    console.warn('   Run `pnpm build` first!');
  }

  // Escape backslashes for Windows
  return absolutePath.replace(/\\/g, '\\\\');
}

// Generate config object
function generateConfig(options) {
  const aceDistPath = getAceDistPath();

  const config = {
    version: 1,
    ace: {
      enabled: true,
      mcpServerPath: 'node',
      mcpServerArgs: [aceDistPath, 'mcp'],
      autoIndex: false,
      injectContext: true,
    },
    providers: [],
  };

  // Add Anthropic provider
  if (options.provider === 'anthropic' && options.anthropicKey) {
    config.providers.push({
      id: 'anthropic',
      name: 'Claude',
      apiKey: options.anthropicKey,
      models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    });
  }

  // Add OpenAI provider
  if (options.provider === 'openai' && options.openaiKey) {
    config.providers.push({
      id: 'openai',
      name: 'OpenAI',
      apiKey: options.openaiKey,
      models: ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
    });
  }

  // Fallback: placeholder
  if (config.providers.length === 0) {
    config.providers.push({
      id: 'anthropic',
      name: 'Claude',
      apiKey: 'YOUR_API_KEY_HERE',
      models: ['claude-3-5-sonnet-20241022'],
    });
  }

  return config;
}

// Get default output path
function getDefaultOutputPath() {
  const homeDir = os.homedir();
  const augmentDir = path.join(homeDir, '.augment');
  return path.join(augmentDir, 'byok-config.json');
}

// Ensure directory exists
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('✅ Created directory:', dir);
  }
}

// Write config file
function writeConfig(config, outputPath) {
  ensureDir(outputPath);

  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(outputPath, json, 'utf8');

  console.log('\n✅ Config file generated successfully!');
  console.log('📁 Location:', outputPath);
  console.log('\n📝 Content:');
  console.log(json);
}

// Main
async function main() {
  console.log('🔧 Augment BYOK + ACE Config Generator\n');

  const args = parseArgs();

  // Prompt for API key if not provided
  if (!args.anthropicKey && !args.openaiKey) {
    console.log('Choose provider:');
    console.log('  1. Anthropic (Claude)');
    console.log('  2. OpenAI (GPT)');
    const providerChoice = await prompt('\nEnter choice (1 or 2): ');

    if (providerChoice === '1' || providerChoice.toLowerCase().includes('anthrop')) {
      args.provider = 'anthropic';
      args.anthropicKey = await prompt('Enter Anthropic API key (sk-ant-...): ');
    } else if (providerChoice === '2' || providerChoice.toLowerCase().includes('openai')) {
      args.provider = 'openai';
      args.openaiKey = await prompt('Enter OpenAI API key (sk-...): ');
    } else {
      console.error('❌ Invalid choice');
      process.exit(1);
    }
  }

  // Generate config
  const config = generateConfig(args);

  // Get output path
  const outputPath = args.outputPath || getDefaultOutputPath();

  // Write config
  writeConfig(config, outputPath);

  console.log('\n🎯 Next steps:');
  console.log('  1. Open VS Code');
  console.log('  2. Ctrl+Shift+P → "Developer: Reload Window"');
  console.log('  3. Ctrl+Shift+P → "BYOK: Enable"');
  console.log('  4. Open a code folder and chat!');
  console.log('\n📖 See docs/AUGMENT_MANUAL_CONFIG.md for details');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
