import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeWithProgressHeartbeat,
  resolveProgressToken,
} from '../../src/mcp/progressHeartbeat.js';

test('resolveProgressToken: 保留客户端提供的 string 和 number token', () => {
  const strRes = resolveProgressToken('custom-client-token');
  assert.equal(strRes.progressToken, 'custom-client-token');
  assert.equal(strRes.isFabricated, false);

  const numRes = resolveProgressToken(12345);
  assert.equal(numRes.progressToken, 12345);
  assert.equal(numRes.isFabricated, false);
});

test('resolveProgressToken: 客户端省略 progressToken 时合成 fallback token', () => {
  const res1 = resolveProgressToken(undefined);
  assert.equal(res1.isFabricated, true);
  assert.ok(typeof res1.progressToken === 'string');
  assert.ok((res1.progressToken as string).startsWith('fallback-heartbeat-'));

  const res2 = resolveProgressToken(null, 'custom-prefix');
  assert.equal(res2.isFabricated, true);
  assert.ok((res2.progressToken as string).startsWith('custom-prefix-'));
});

test('executeWithProgressHeartbeat: 客户端传递 token 时正常发送通知并返回结果', async () => {
  const notifications: any[] = [];
  const extra = {
    _meta: { progressToken: 'client-token-99' },
    sendNotification: async (notif: any) => {
      notifications.push(notif);
    },
  };

  const result = await executeWithProgressHeartbeat(
    extra,
    async (onProgress) => {
      await onProgress(50, 100, 'Halfway done');
      return { success: true };
    },
    { toolName: 'test-tool' },
  );

  assert.deepEqual(result, { success: true });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'notifications/progress');
  assert.equal(notifications[0].params.progressToken, 'client-token-99');
  assert.equal(notifications[0].params.progress, 50);
  assert.equal(notifications[0].params.total, 100);
  assert.equal(notifications[0].params.message, 'Halfway done');
});

test('executeWithProgressHeartbeat: 客户端省略 token 时使用合成 token 发送通知', async () => {
  const notifications: any[] = [];
  const extra = {
    sendNotification: async (notif: any) => {
      notifications.push(notif);
    },
  };

  const result = await executeWithProgressHeartbeat(
    extra,
    async (onProgress) => {
      await onProgress(20, 100, 'Starting work');
      return 'completed';
    },
    { toolName: 'fallback-test' },
  );

  assert.equal(result, 'completed');
  assert.equal(notifications.length, 1);
  assert.ok(String(notifications[0].params.progressToken).startsWith('fallback-heartbeat-'));
  assert.equal(notifications[0].params.progress, 20);
});

test('executeWithProgressHeartbeat: 并发心跳 ticker 定期发送 keep-alive 通知', async () => {
  const notifications: any[] = [];
  const extra = {
    _meta: { progressToken: 'heartbeat-test' },
    sendNotification: async (notif: any) => {
      notifications.push(notif);
    },
  };

  // 设置短间隔 25ms，工作耗时 90ms，应该触发多次心跳
  await executeWithProgressHeartbeat(
    extra,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 90));
      return 'done';
    },
    { intervalMs: 25, toolName: 'slow-retrieval' },
  );

  // 必须至少产生 2 次心跳
  assert.ok(
    notifications.length >= 2,
    `Expected at least 2 heartbeats, got ${notifications.length}`,
  );
  for (const notif of notifications) {
    assert.equal(notif.method, 'notifications/progress');
    assert.equal(notif.params.progressToken, 'heartbeat-test');
    assert.ok(notif.params.message.includes('slow-retrieval'));
  }
});

test('executeWithProgressHeartbeat: 心跳发送失败时停止后续通知且不中断工具执行', async () => {
  let sendCallCount = 0;
  const extra = {
    _meta: { progressToken: 'resilient-test' },
    sendNotification: async () => {
      sendCallCount++;
      throw new Error('Connection closed / Broken pipe');
    },
  };

  // 心跳发送虽然抛出异常，但工具本身必须成功完成
  const result = await executeWithProgressHeartbeat(
    extra,
    async (onProgress) => {
      await onProgress(10, 100, 'Attempt 1');
      // 等待心跳触发
      await new Promise((resolve) => setTimeout(resolve, 60));
      return 'tool-success';
    },
    { intervalMs: 20, toolName: 'broken-pipe-test' },
  );

  assert.equal(result, 'tool-success');
  // 首次失败后停止后续心跳通知，sendCallCount 应该是 1
  assert.equal(sendCallCount, 1);
});

test('executeWithProgressHeartbeat: 工具本身抛出异常时正确清理并向外冒泡', async () => {
  const extra = {
    _meta: { progressToken: 'error-test' },
    sendNotification: async () => {},
  };

  await assert.rejects(
    async () => {
      await executeWithProgressHeartbeat(
        extra,
        async () => {
          throw new Error('Tool execution error');
        },
        { intervalMs: 20, toolName: 'failing-tool' },
      );
    },
    { message: 'Tool execution error' },
  );
});
