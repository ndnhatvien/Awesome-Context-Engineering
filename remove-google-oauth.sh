#!/bin/bash
# Script to remove Google OAuth Settings from the UI

echo "Removing Google OAuth Settings from dist/httpServer-OXAD3DKX.js..."

# Backup the original file
cp dist/httpServer-OXAD3DKX.js dist/httpServer-OXAD3DKX.js.backup

# Remove Google OAuth Settings section from HTML (lines 2585-2606)
sed -i '/Google OAuth Settings/,/^          <div class="card-subtitle">.*Security Settings/{ /Security Settings/!d; }' dist/httpServer-OXAD3DKX.js

echo "✓ Google OAuth Settings removed from UI"
echo "Backup saved to: dist/httpServer-OXAD3DKX.js.backup"
echo ""
echo "Note: This modifies the built file. To make permanent changes,"
echo "you need to update the source file src/mcp/httpServer.ts (currently missing)"
