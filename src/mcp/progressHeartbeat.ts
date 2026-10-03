/**
 * MCP Tool Progress & Heartbeat Manager
 *
 * 解决长耗时工具（如 codebase-retrieval / file-retrieval）导致 session 终止和 client abort 的问题：
 * 1. rmcp session worker 在 300s event-loop 静默（无消息）后超时断开连接
 * 2. Claude Code 在 300s 未收到 progress notification 后强制 abort 工具调用
 *
 * 解决方案：
 * - 并发心跳 ticker：在工具执行期间定期发送 progress notification（重置 keep-alive 与 progress 计时器）
 * - 伪造 Fallback Token：当客户端未传递 progressToken 时，自动生成合成 token，确保心跳仍能在 session 上传输
 * - 容错处理：心跳发送失败时停止后续通知，但绝不影响或中断工具本身的正常执行
 */

import { getMcpHeartbeatIntervalMs } from '../config.js';
import { logger } from '../utils/logger.js';

export type ProgressCallback = (
  current: number,
  total?: number,
  message?: string,
) => Promise<void> | void;

export interface ProgressNotificationExtra {
  _meta?: { progressToken?: unknown };
  sendNotification?: (notification: {
    method: string;
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

export interface ProgressHeartbeatOptions {
  /**
   * 心跳间隔（毫秒），默认由 getMcpHeartbeatIntervalMs() 提供（默认 15,000ms / 15s）
   */
  intervalMs?: number;
  /**
   * 客户端未提供 progressToken 时合成 token 的前缀
   * 默认: 'fallback-heartbeat'
   */
  fallbackTokenPrefix?: string;
  /**
   * 工具名称，用于日志记录
   */
  toolName?: string;
}

export interface ResolvedProgressToken {
  progressToken: string | number;
  isFabricated: boolean;
}

/**
 * 解析或合成 progressToken
 * 当客户端未提供有效的 string 或 number progressToken 时，合成一个 fallback token
 */
export function resolveProgressToken(
  rawToken?: unknown,
  fallbackTokenPrefix = 'fallback-heartbeat',
): ResolvedProgressToken {
  if (typeof rawToken === 'string' || typeof rawToken === 'number') {
    return {
      progressToken: rawToken,
      isFabricated: false,
    };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    progressToken: `${fallbackTokenPrefix}-${uniqueSuffix}`,
    isFabricated: true,
  };
}

/**
 * 包装工具执行，提供并发进度心跳与容错通知
 *
 * @param extra MCP SDK 提供的 RequestHandlerExtra
 * @param work 实际执行的工具逻辑，接收 onProgress 回调
 * @param options 心跳与配置选项
 */
export async function executeWithProgressHeartbeat<T>(
  extra: ProgressNotificationExtra | undefined,
  work: (onProgress: ProgressCallback) => Promise<T>,
  options?: ProgressHeartbeatOptions,
): Promise<T> {
  const toolName = options?.toolName ?? 'mcp-tool';
  const rawToken = extra?._meta?.progressToken;
  const { progressToken, isFabricated } = resolveProgressToken(
    rawToken,
    options?.fallbackTokenPrefix,
  );

  const intervalMs = options?.intervalMs ?? getMcpHeartbeatIntervalMs();

  let isHeartbeatActive = true;
  let lastProgress = 0;
  let lastTotal: number | undefined;
  let lastMessage: string | undefined;
  const startTime = Date.now();
  let timer: NodeJS.Timeout | undefined;

  // 内部通知发送函数：发送失败时停止心跳，但不抛出异常中断工具
  const sendNotification = async (
    progress: number,
    total?: number,
    message?: string,
  ): Promise<void> => {
    if (!isHeartbeatActive || typeof extra?.sendNotification !== 'function') {
      return;
    }

    try {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress,
          ...(total !== undefined ? { total } : {}),
          ...(message !== undefined ? { message } : {}),
        },
      });
    } catch (err) {
      // Tick send failures stop further notifications but never fail the tool
      isHeartbeatActive = false;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      logger.debug(
        { error: (err as Error)?.message, tool: toolName, progressToken, isFabricated },
        '发送进度通知失败，停止后续心跳通知（不影响工具主流程）',
      );
    }
  };

  // 提供给工具调用的 onProgress 回调
  const onProgress: ProgressCallback = async (
    current: number,
    total?: number,
    message?: string,
  ) => {
    lastProgress = current;
    lastTotal = total;
    lastMessage = message;
    await sendNotification(current, total, message);
  };

  // 启动并发心跳定时器
  if (typeof extra?.sendNotification === 'function') {
    timer = setInterval(async () => {
      if (!isHeartbeatActive) {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
        return;
      }

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const heartbeatMsg = lastMessage
        ? `${lastMessage} (${elapsedSec}s elapsed)`
        : `Executing ${toolName} (${elapsedSec}s elapsed)...`;

      await sendNotification(lastProgress, lastTotal, heartbeatMsg);
    }, intervalMs);

    // 允许 Node 在无其他事件时正常退出
    timer.unref?.();
  }

  try {
    return await work(onProgress);
  } finally {
    isHeartbeatActive = false;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }
}
