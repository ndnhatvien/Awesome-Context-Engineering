#!/usr/bin/env bash

# Demo script: Khởi động HTTP server và test endpoints

set -e

PORT=3002
HOST="127.0.0.1"

echo "=== ACE HTTP Server Demo ==="
echo ""
echo "Đang khởi động HTTP server tại http://${HOST}:${PORT}"
echo ""

# Khởi động server trong background
pnpm exec node dist/index.js mcp-http --port $PORT --host $HOST &
SERVER_PID=$!

# Đợi server khởi động
sleep 3

echo "✓ Server đã khởi động (PID: $SERVER_PID)"
echo ""

# Test health check
echo "1. Test health check endpoint:"
echo "   GET http://${HOST}:${PORT}/health"
curl -s "http://${HOST}:${PORT}/health"
echo ""
echo ""

# Test get-models
echo "2. Test get-models endpoint:"
echo "   GET http://${HOST}:${PORT}/get-models"
curl -s "http://${HOST}:${PORT}/get-models"
echo ""
echo ""

# Test augment/get-models
echo "3. Test augment/get-models endpoint:"
echo "   GET http://${HOST}:${PORT}/augment/get-models"
curl -s "http://${HOST}:${PORT}/augment/get-models"
echo ""
echo ""

# Test MCP endpoint (list tools)
echo "4. Test MCP endpoint (list tools):"
echo "   POST http://${HOST}:${PORT}/mcp"
curl -s -X POST "http://${HOST}:${PORT}/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }' 2>/dev/null || echo "   (MCP protocol requires proper handshake)"
echo ""

echo "5. Server logs:"
echo "   Xem logs tại ~/.ace/logs/app.*.log"
echo ""

echo "Nhấn Ctrl+C để dừng server..."
echo ""

# Đợi user interrupt
trap "echo ''; echo 'Đang dừng server...'; kill $SERVER_PID 2>/dev/null || true; exit 0" INT TERM

wait $SERVER_PID
