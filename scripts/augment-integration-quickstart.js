#!/usr/bin/env node
/**
 * Quick Start Script: Augment BYOK + ACE Integration
 *
 * Hướng dẫn tích hợp nhanh
 */

console.log(`
╔═══════════════════════════════════════════════════════════╗
║  Augment BYOK + ACE Integration Setup                    ║
╚═══════════════════════════════════════════════════════════╝

## Bước 1: Chuẩn bị ACE

cd D:\\MCP\\Awesome-Context-Engineering
pnpm build
pnpm link --global

Test MCP server:
  ace mcp

## Bước 2: Thêm dependencies vào BYOK

cd D:\\MCP\\Augment_BYOK_gagmeng
npm install @modelcontextprotocol/sdk@^1.25.1

## Bước 3: Tạo integration modules

Tạo thư mục:
  mkdir -p payload/extension/out/byok/integrations/ace

Copy các file từ docs/AUGMENT_BYOK_ACE_INTEGRATION.md:
  1. mcp-client.js
  2. context-injector.js
  3. workspace-watcher.js

## Bước 4: Modify BYOK code

File cần sửa:
  1. payload/extension/out/byok/runtime/shim/byok-chat/index.js
     → Import context-injector
     → Hook vào byokChat function

  2. payload/extension/out/byok/config/default-config.js
     → Thêm ace config section

## Bước 5: Build và test

npm run build:vsix
→ Install VSIX vào VS Code
→ Mở folder
→ Test chat với code questions

## Bước 6: Verify

Check logs trong VS Code Output panel:
  - "ACE: Workspace opened"
  - "ACE: Searching codebase"
  - "ACE: Injected context"

## Troubleshooting

Problem: MCP connection failed
→ Check: ace mcp command works
→ Check: PATH includes ace

Problem: No context injected
→ Check: ace.enabled = true
→ Check: workspacePath is set
→ Check: ACE indexing completed

Problem: Search returns nothing
→ Check: EMBEDDINGS_API_KEY configured
→ Run: ace index <path>

## Support

Docs: D:\\MCP\\Awesome-Context-Engineering\\docs\\AUGMENT_BYOK_ACE_INTEGRATION.md
Issues: Check logs in VS Code Output → Augment

`);
