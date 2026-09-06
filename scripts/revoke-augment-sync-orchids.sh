#!/bin/bash
# Script để revoke Augment sync permission cho workspace Orchids-2api
# và xóa toàn bộ workspace storage

set -e

WORKSPACE_STORAGE="/c/Users/ndnvi/AppData/Roaming/Code/User/workspaceStorage/a072ce2d5477b04276f60d17498b663f"

echo "=== Revoke Augment Sync Permission cho Orchids-2api ==="
echo ""
echo "CẢNH BÁO: Script này sẽ XÓA TOÀN BỘ workspace storage cho workspace này"
echo "  - Orchids-2api: $WORKSPACE_STORAGE"
echo "  - Bao gồm: cache, settings, agent edits, checkpoints"
echo ""
echo "PHẢI ĐÓNG TẤT CẢ VSCode TRƯỚC KHI CHẠY!"
echo ""
read -p "Bạn đã đóng VSCode chưa? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Hủy bỏ. Hãy đóng VSCode rồi chạy lại script."
    exit 1
fi

if [ ! -d "$WORKSPACE_STORAGE" ]; then
    echo "✅ Workspace storage không tồn tại hoặc đã bị xóa."
    echo "   Orchids-2api sẽ không còn sync permission sau khi mở VSCode lại."
    exit 0
fi

# Backup
BACKUP_DIR="${WORKSPACE_STORAGE}.backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo "📦 Backup workspace storage -> $(basename $BACKUP_DIR)"
cp -r "$WORKSPACE_STORAGE" "$BACKUP_DIR"

# Delete workspace storage
echo ""
echo "🗑️  Xóa workspace storage..."
rm -rf "$WORKSPACE_STORAGE"

echo ""
echo "✅ Đã xóa workspace storage cho Orchids-2api!"
echo ""
echo "📋 Kết quả:"
echo "  - Sync permission: Revoked (workspace storage đã xóa)"
echo "  - Cache: Cleared"
echo "  - Checkpoints: Cleared (281MB)"
echo "  - Backup: $BACKUP_DIR"
echo ""
echo "🔄 Tiếp theo:"
echo "  1. Mở VSCode"
echo "  2. Mở workspace Orchids-2api"
echo "  3. Khi Augment hỏi 'Sync this folder?'"
echo "     → Chọn 'NOT NOW' hoặc 'Don't ask again for this folder'"
echo ""
echo "Nếu vẫn thấy indexing loop, close workspace Orchids-2api hoàn toàn."
