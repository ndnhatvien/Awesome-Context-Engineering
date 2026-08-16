#!/usr/bin/env node
/**
 * Script tự động fix Augment-BYOK config để dừng indexing loop
 * Cách dùng: node scripts/fix-augment-config.js
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_PATH = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Code',
  'User',
  'globalStorage',
  'augment.vscode-augment',
  'byok-config.json',
);

console.log('=== Augment-BYOK Config Fixer ===\n');

// Check if config exists
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('❌ Không tìm thấy config file:', CONFIG_PATH);
  console.log('\nĐảm bảo Augment extension đã cài đặt và chạy ít nhất 1 lần.');
  process.exit(1);
}

// Backup original
const backupPath = `${CONFIG_PATH}.backup-${Date.now()}`;
console.log(`📦 Backup config hiện tại -> ${path.basename(backupPath)}`);
fs.copyFileSync(CONFIG_PATH, backupPath);

// Read current config
let config;
try {
  const content = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(content);
} catch (err) {
  console.error('❌ Lỗi đọc config:', err.message);
  process.exit(1);
}

console.log('\n🔍 Config hiện tại:');
console.log('  - completionUrl:', config.official?.completionUrl || 'N/A');
console.log('  - apiToken:', config.official?.apiToken ? '(có token)' : '(rỗng)');
console.log('  - ace.enabled:', config.ace?.enabled || false);

// Fix: Remove apiToken to switch to Pure Local Mode
let changed = false;

if (config.official?.apiToken) {
  console.log('\n🔧 Fix: Xóa apiToken để chuyển sang Pure Local Mode...');
  config.official.apiToken = '';
  changed = true;
}

// Optional: Fix completionUrl if it's localhost without /v1
if (config.official?.completionUrl === 'http://localhost:3000') {
  console.log('⚠️  Lưu ý: completionUrl là localhost:3000 (không có /v1)');
  console.log('   Nếu bạn muốn gọi local API, đảm bảo endpoint đúng.');
}

if (!changed) {
  console.log('\n✅ Config đã ổn, không cần thay đổi.');
  process.exit(0);
}

// Write fixed config
try {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log('\n✅ Đã lưu config mới!');
  console.log('\n📋 Config sau khi fix:');
  console.log('  - apiToken: (rỗng) → Pure BYOK Mode');
  console.log('  - Extension sẽ KHÔNG upload context lên cloud');
  console.log('  - Context chỉ index LOCAL trong workspace storage');

  console.log('\n🔄 Tiếp theo:');
  console.log('  1. Restart VSCode');
  console.log(
    '  2. Chạy: D:\\MCP\\Awesome-Context-Engineering\\scripts\\fix-augment-indexing-loop.bat (sau khi đóng VSCode)',
  );
  console.log('  3. Mở lại VSCode → Extension sẽ re-index sạch');

  console.log(`\n💾 Backup file: ${backupPath}`);
  console.log('   (Có thể restore bằng cách copy lại nếu cần)');
} catch (err) {
  console.error('❌ Lỗi ghi config:', err.message);
  console.log('\n🔄 Restore backup:');
  console.log(`   copy "${backupPath}" "${CONFIG_PATH}"`);
  process.exit(1);
}
