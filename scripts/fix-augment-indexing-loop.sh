#!/bin/bash
# Script để fix Augment-BYOK indexing loop cho workspace Orchids-2api
# Nguyên nhân: 282MB cache checkpoint-documents với server.exe đã bị xóa

set -e

AUGMENT_WORKSPACE_STORAGE="/c/Users/ndnvi/AppData/Roaming/Code/User/workspaceStorage/a072ce2d5477b04276f60d17498b663f/Augment.vscode-augment"

echo "=== Fix Augment-BYOK Indexing Loop ==="
echo ""
echo "Vấn đề phát hiện:"
echo "  - Workspace: d:\\MCP\\Orchids-2api"
echo "  - Cache size: 282MB (checkpoint-documents với server.exe)"
echo "  - Triệu chứng: Sync timeout 300s với 288 files, 0 uploaded"
echo ""

if [ ! -d "$AUGMENT_WORKSPACE_STORAGE" ]; then
    echo "❌ Không tìm thấy workspace storage: $AUGMENT_WORKSPACE_STORAGE"
    exit 1
fi

# Backup trước khi xóa
BACKUP_DIR="/c/Users/ndnvi/AppData/Roaming/Code/User/workspaceStorage/a072ce2d5477b04276f60d17498b663f/Augment.vscode-augment.backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Backup hiện tại -> $BACKUP_DIR"
cp -r "$AUGMENT_WORKSPACE_STORAGE" "$BACKUP_DIR"

# Xóa các thư mục cache lớn
echo ""
echo "🧹 Xóa cache checkpoint-documents (281MB)..."
rm -rf "$AUGMENT_WORKSPACE_STORAGE/augment-user-assets/checkpoint-documents"

echo "🧹 Xóa mtime-cache.json..."
rm -f "$AUGMENT_WORKSPACE_STORAGE"/*/mtime-cache.json

echo ""
echo "✅ Đã xóa cache. Khởi động lại VSCode để extension re-index sạch."
echo ""
echo "Nếu vấn đề vẫn tiếp diễn:"
echo "  1. Mở VSCode Command Palette (Ctrl+Shift+P)"
echo "  2. Chạy: 'Augment: Disable Syncing for This Folder'"
echo "  3. Hoặc close workspace Orchids-2api"
