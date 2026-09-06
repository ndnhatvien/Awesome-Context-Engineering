/**
 * SSE Session Management Test
 *
 * Tests the session lifecycle and authentication
 */

import { strict as assert } from 'node:assert';
import { createToken, revokeToken } from '../../src/auth/tokenManager.js';
import { sessionManager } from '../../src/mcp/sessionManager.js';

console.log('Testing SSE Session Management...\n');

// Test 1: Token generation
console.log('[1/6] Testing token generation...');
const { token: token1, id: tokenId1 } = createToken({
  userId: 'test-user-1',
  description: 'Test token',
  expiresInDays: 1,
});
assert.ok(token1.startsWith('ace_'), 'Token should start with ace_');
assert.ok(tokenId1.length > 0, 'Token ID should be non-empty');
console.log('✓ Token generated:', tokenId1);

// Test 2: Session creation
console.log('[2/6] Testing session creation...');
const session1 = sessionManager.createSession({
  userId: 'test-user-1',
  tokenId: tokenId1,
});
assert.ok(session1.id.startsWith('sess_'), 'Session ID should start with sess_');
assert.strictEqual(session1.userId, 'test-user-1', 'User ID should match');
assert.strictEqual(session1.isConnected, false, 'Initially not connected');
console.log('✓ Session created:', session1.id);

// Test 3: Session retrieval
console.log('[3/6] Testing session retrieval...');
const retrieved = sessionManager.getSession(session1.id);
assert.ok(retrieved, 'Session should exist');
assert.strictEqual(retrieved?.id, session1.id, 'Session ID should match');
console.log('✓ Session retrieved');

// Test 4: Multiple sessions per user
console.log('[4/6] Testing multiple sessions...');
const session2 = sessionManager.createSession({
  userId: 'test-user-1',
  tokenId: tokenId1,
});
const userSessions = sessionManager.getUserSessions('test-user-1');
assert.strictEqual(userSessions.length, 2, 'User should have 2 sessions');
console.log('✓ Multiple sessions:', userSessions.length);

// Test 5: Session stats
console.log('[5/6] Testing session stats...');
const stats = sessionManager.getStats();
assert.strictEqual(stats.totalSessions, 2, 'Should have 2 total sessions');
assert.strictEqual(stats.connectedSessions, 0, 'No sessions connected yet');
console.log('✓ Stats:', stats);

// Test 6: Session destruction
console.log('[6/6] Testing session destruction...');
const destroyed1 = sessionManager.destroySession(session1.id);
assert.strictEqual(destroyed1, true, 'Session should be destroyed');
const notFound = sessionManager.getSession(session1.id);
assert.strictEqual(notFound, undefined, 'Session should not exist');
const statsAfter = sessionManager.getStats();
assert.strictEqual(statsAfter.totalSessions, 1, 'Should have 1 session left');
console.log('✓ Session destroyed');

// Test 7: Token revocation
console.log('[7/7] Testing token revocation...');
const revoked = revokeToken(tokenId1);
assert.strictEqual(revoked, true, 'Token should be revoked');
console.log('✓ Token revoked');

// Cleanup
sessionManager.destroySession(session2.id);

// 清除单例内的清理/心跳定时器，避免脚本结束后进程仍被 interval 挂起
sessionManager.shutdown();

console.log('\n✅ All tests passed!');
console.log('\nSession lifecycle verified:');
console.log('  1. Token generation');
console.log('  2. Session creation');
console.log('  3. Session retrieval');
console.log('  4. Multiple sessions per user');
console.log('  5. Session statistics');
console.log('  6. Session destruction');
console.log('  7. Token revocation');
