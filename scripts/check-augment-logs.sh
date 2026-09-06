#!/usr/bin/env bash

# Quick check Augment BYOK + ACE logs trong VS Code Output

echo "🔍 Checking Augment BYOK + ACE Integration Logs"
echo "════════════════════════════════════════════════════════"
echo ""

# Check config file
CONFIG_FILE="$HOME/.augment/byok-config.json"
if [ -f "$CONFIG_FILE" ]; then
    echo "✅ Config file exists: $CONFIG_FILE"
    echo "   ACE enabled: $(grep -o '"enabled":\s*true' "$CONFIG_FILE" | wc -l)"
    echo ""
else
    echo "❌ Config file NOT found: $CONFIG_FILE"
    echo "   Run: node scripts/generate-augment-config.cjs"
    echo ""
fi

# Check ACE MCP server
ACE_DIST="dist/index.js"
if [ -f "$ACE_DIST" ]; then
    echo "✅ ACE MCP server exists: $ACE_DIST"
    echo ""
else
    echo "❌ ACE NOT built: $ACE_DIST"
    echo "   Run: pnpm build"
    echo ""
fi

# Instructions for viewing logs
echo "📋 How to view logs in VS Code:"
echo "════════════════════════════════════════════════════════"
echo ""
echo "1. Open VS Code"
echo "2. Press: Ctrl+Shift+U (Windows/Linux) or Cmd+Shift+U (Mac)"
echo "3. In Output panel, select dropdown: 'Augment'"
echo "4. Look for these logs:"
echo ""
echo "   ✅ [INFO] BYOK enabled"
echo "   ✅ [INFO] ACE: Connecting to MCP server"
echo "   ✅ [INFO] ACE: Connected successfully"
echo "   ✅ [INFO] ACE: Searching codebase"
echo "   ✅ [INFO] ACE: Injecting context { chunks: N }"
echo ""
echo "5. If you see errors:"
echo "   ❌ [ERROR] spawn ... ENOENT → Check mcpServerPath in config"
echo "   ❌ [WARN] ACE search failed → Check workspace path"
echo ""

# Check recent ACE logs (if LOG_LEVEL=debug)
ACE_LOG_DIR="$HOME/.ace/logs"
if [ -d "$ACE_LOG_DIR" ]; then
    LATEST_LOG=$(ls -t "$ACE_LOG_DIR"/app.*.log 2>/dev/null | head -1)
    if [ -n "$LATEST_LOG" ]; then
        echo "📄 Latest ACE log file:"
        echo "   $LATEST_LOG"
        echo ""
        echo "   Last 10 lines:"
        tail -10 "$LATEST_LOG" | sed 's/^/   /'
        echo ""
    fi
fi

echo "════════════════════════════════════════════════════════"
echo "💡 Tips:"
echo "   • No logs? Make sure Augment extension is installed"
echo "   • Wrong channel? Select 'Augment' from dropdown (not 'Extension Host')"
echo "   • No ACE logs? Check config: enabled: true, injectContext: true"
echo "   • Test manually: node dist/index.js mcp"
echo ""
