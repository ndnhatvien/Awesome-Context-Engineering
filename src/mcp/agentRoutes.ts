/**
 * Agent Orchestration Routes
 *
 * 提供 AI Agent 编排能力的 REST API 端点：
 * - POST /check-tool-safety   — 检查工具安全性
 * - POST /revoke-tool-access  — 撤销工具访问权限
 * - POST /edit-file           — 编辑工作区文件
 * - POST /run-remote-tool     — 代理远程工具调用
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest } from './sseAuth.js';

// ===========================================
// 安全规则定义
// ===========================================

/** 系统敏感路径（跨平台） */
const SENSITIVE_PATHS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/root',
  '/proc',
  '/sys',
  '/dev',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];

/** 用户级敏感路径模式 */
const SENSITIVE_PATH_PATTERNS = ['.ssh', '.gnupg', '.aws', '.kube', '.docker'];

/** 高风险配置文件 */
const SENSITIVE_CONFIG_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  'package.json',
  'tsconfig.json',
  'docker-compose.yml',
  'Dockerfile',
  '.gitignore',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
];

/** 危险命令模式 */
const DANGEROUS_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'format',
  'shutdown',
  'reboot',
  'mkfs',
  'dd if=',
  'chmod 777 /',
  ':(){:|:&};:',
  'del /f /s /q C:',
  'rd /s /q C:',
];

// ===========================================
// 撤销访问权限的内存存储
// ===========================================

/** sessionId → 被撤销的工具名称集合 */
const revokedToolsMap = new Map<string, Set<string>>();

/**
 * 检查指定 session 的工具是否已被撤销
 */
function isToolRevoked(sessionId: string, toolName: string): boolean {
  const revokedTools = revokedToolsMap.get(sessionId);
  if (!revokedTools) return false;
  // 如果集合中包含 '*'，表示所有工具都被撤销
  return revokedTools.has('*') || revokedTools.has(toolName);
}

/**
 * 获取请求中的 session ID（从 header 或 auth 中提取）
 */
function getSessionId(req: Request): string {
  const auth = (req as AuthenticatedRequest).auth;
  return (req.headers['x-session-id'] as string) || auth?.tokenId || auth?.userId || 'default';
}

// ===========================================
// 安全检查逻辑
// ===========================================

interface SafetyCheckResult {
  safe: boolean;
  risk_level: 'safe' | 'warning' | 'denied';
  reason?: string;
  restrictions?: string[];
}

/**
 * 核心安全检查函数（内部使用）
 */
function checkToolSafety(
  toolName: string,
  args: Record<string, unknown>,
  repoPath?: string,
): SafetyCheckResult {
  const restrictions: string[] = [];

  // 检查文件路径相关操作的安全性
  const filePath = (args.file_path as string) || (args.path as string) || '';
  const fullPath = filePath && repoPath ? path.resolve(repoPath, filePath) : filePath;

  // 1. 路径遍历检查
  if (filePath?.includes('..')) {
    return {
      safe: false,
      risk_level: 'denied',
      reason: 'Path traversal detected: ".." is not allowed in file paths',
      restrictions: ['path_traversal_blocked'],
    };
  }

  // 2. 检查路径是否在 repo_path 范围内
  if (repoPath && fullPath && !fullPath.startsWith(path.resolve(repoPath))) {
    return {
      safe: false,
      risk_level: 'denied',
      reason: `File path "${filePath}" resolves outside the workspace "${repoPath}"`,
      restrictions: ['outside_workspace'],
    };
  }

  // 3. 系统敏感路径检查
  const normalizedPath = fullPath.replace(/\\/g, '/').toLowerCase();
  for (const sensitivePath of SENSITIVE_PATHS) {
    const normalizedSensitive = sensitivePath.replace(/\\/g, '/').toLowerCase();
    if (normalizedPath.startsWith(normalizedSensitive)) {
      return {
        safe: false,
        risk_level: 'denied',
        reason: `Access to system-sensitive path "${sensitivePath}" is denied`,
        restrictions: ['system_path_blocked'],
      };
    }
  }

  // 4. 用户级敏感路径检查
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (normalizedPath.includes(`/${pattern}/`) || normalizedPath.includes(`/${pattern}`)) {
      return {
        safe: false,
        risk_level: 'denied',
        reason: `Access to sensitive user directory "${pattern}" is denied`,
        restrictions: ['user_sensitive_path_blocked'],
      };
    }
  }

  // 5. 危险命令检查（run-command / run-remote-tool）
  const command = (args.command as string) || '';
  if (command) {
    const normalizedCmd = command.toLowerCase().trim();
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (normalizedCmd.includes(dangerous.toLowerCase())) {
        return {
          safe: false,
          risk_level: 'denied',
          reason: `Dangerous command pattern detected: "${dangerous}"`,
          restrictions: ['dangerous_command_blocked'],
        };
      }
    }

    // sudo 警告
    if (normalizedCmd.startsWith('sudo ')) {
      restrictions.push('sudo_usage');
    }
  }

  // 6. 配置文件修改警告
  if ((toolName === 'edit-file' || toolName === 'delete-file') && filePath) {
    const basename = path.basename(filePath);
    if (SENSITIVE_CONFIG_FILES.includes(basename)) {
      restrictions.push(`modifying_config_file:${basename}`);
      return {
        safe: true,
        risk_level: 'warning',
        reason: `Modifying sensitive config file "${basename}". Proceed with caution.`,
        restrictions,
      };
    }
  }

  // 7. delete-file 特殊检查
  if (toolName === 'delete-file') {
    restrictions.push('file_deletion');
    if (!repoPath) {
      return {
        safe: false,
        risk_level: 'denied',
        reason: 'repo_path is required for delete-file operations',
        restrictions: ['missing_repo_path'],
      };
    }
    return {
      safe: true,
      risk_level: 'warning',
      reason: 'File deletion requires confirmation',
      restrictions,
    };
  }

  return {
    safe: true,
    risk_level: 'safe',
    reason:
      restrictions.length > 0 ? `Allowed with restrictions: ${restrictions.join(', ')}` : undefined,
    restrictions: restrictions.length > 0 ? restrictions : undefined,
  };
}

// ===========================================
// 路由工厂
// ===========================================

/**
 * 创建 Agent 编排路由
 * 所有路由需要外层 requireAuth 中间件保护
 */
export function createAgentRoutes(): Router {
  const router = Router();

  // -------------------------------------------
  // POST /check-tool-safety
  // -------------------------------------------
  router.post('/check-tool-safety', (req: Request, res: Response) => {
    const { tool_name, arguments: toolArgs, repo_path } = req.body || {};

    if (!tool_name || typeof tool_name !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: tool_name (string)',
      });
    }

    const args = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};
    const result = checkToolSafety(tool_name, args as Record<string, unknown>, repo_path);

    logger.info({ tool: tool_name, risk_level: result.risk_level }, 'Agent safety check');

    return res.json(result);
  });

  // -------------------------------------------
  // POST /revoke-tool-access
  // -------------------------------------------
  router.post('/revoke-tool-access', (req: Request, res: Response) => {
    const { session_id, tool_name, reason } = req.body || {};
    const targetSessionId = session_id || getSessionId(req);
    const toolToRevoke = tool_name || '*';

    // 获取或创建该 session 的撤销集合
    let revokedSet = revokedToolsMap.get(targetSessionId);
    if (!revokedSet) {
      revokedSet = new Set<string>();
      revokedToolsMap.set(targetSessionId, revokedSet);
    }

    const toolsRevoked: string[] = [];
    if (toolToRevoke === '*') {
      revokedSet.add('*');
      toolsRevoked.push('* (all tools)');
    } else {
      revokedSet.add(toolToRevoke);
      toolsRevoked.push(toolToRevoke);
    }

    logger.warn(
      { sessionId: targetSessionId, tools: toolsRevoked, reason },
      'Agent tool access revoked',
    );

    return res.json({
      revoked: true,
      session_id: targetSessionId,
      tools_revoked: toolsRevoked,
      message: `Tool access revoked for session "${targetSessionId}": ${toolsRevoked.join(', ')}`,
    });
  });

  // -------------------------------------------
  // POST /edit-file
  // -------------------------------------------
  router.post('/edit-file', async (req: Request, res: Response) => {
    const { repo_path, file_path, action, content, patches, dry_run } = req.body || {};
    const sessionId = getSessionId(req);

    // 1. 参数验证
    if (!repo_path || typeof repo_path !== 'string') {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Missing required field: repo_path' });
    }
    if (!file_path || typeof file_path !== 'string') {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Missing required field: file_path' });
    }
    if (!action || !['create', 'overwrite', 'patch'].includes(action)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid action. Must be "create", "overwrite", or "patch"',
      });
    }

    // 2. 检查 revoked tools
    if (isToolRevoked(sessionId, 'edit-file')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Tool "edit-file" access has been revoked for this session',
      });
    }

    // 3. 安全检查
    const safetyCheck = checkToolSafety('edit-file', { file_path }, repo_path);
    if (safetyCheck.risk_level === 'denied') {
      return res.status(403).json({
        error: 'Forbidden',
        message: safetyCheck.reason,
        risk_level: safetyCheck.risk_level,
      });
    }

    // 4. 解析绝对路径
    const absolutePath = path.resolve(repo_path, file_path);

    // 双重检查：确保解析后的路径在 repo_path 内
    if (!absolutePath.startsWith(path.resolve(repo_path))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Resolved file path is outside the workspace',
      });
    }

    try {
      let oldContent = '';
      let newContent = '';
      let fileExists = false;

      // 读取现有文件（如果存在）
      try {
        oldContent = await fs.readFile(absolutePath, 'utf-8');
        fileExists = true;
      } catch {
        // 文件不存在
      }

      // 根据 action 生成新内容
      switch (action) {
        case 'create':
          if (fileExists && !dry_run) {
            return res.status(409).json({
              error: 'Conflict',
              message: `File "${file_path}" already exists. Use "overwrite" action to replace.`,
            });
          }
          newContent = content || '';
          break;

        case 'overwrite':
          newContent = content || '';
          break;

        case 'patch': {
          if (!fileExists) {
            return res.status(404).json({
              error: 'Not Found',
              message: `File "${file_path}" does not exist. Use "create" action to create.`,
            });
          }
          if (!patches || !Array.isArray(patches) || patches.length === 0) {
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Patches array is required for "patch" action',
            });
          }

          const lines = oldContent.split('\n');
          // 按 start_line 降序排序，从后往前应用 patch 避免行号偏移
          interface PatchItem {
            start_line?: number;
            end_line?: number;
            replacement?: string;
          }
          const sortedPatches = [...patches].sort(
            (a: PatchItem, b: PatchItem) => (b.start_line || 0) - (a.start_line || 0),
          );

          for (const p of sortedPatches) {
            const startLine = Math.max(1, p.start_line || 1);
            const endLine = Math.min(lines.length, p.end_line || startLine);
            const replacement = p.replacement || '';
            const replacementLines = replacement.split('\n');
            // 行号转为 0-indexed
            lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
          }
          newContent = lines.join('\n');
          break;
        }
      }

      // 生成简易 diff 预览
      const diffPreview = generateSimpleDiff(file_path, oldContent, newContent);

      // 如果是 dry_run，只返回预览
      if (dry_run) {
        return res.json({
          success: true,
          file_path,
          action,
          dry_run: true,
          diff_preview: diffPreview,
          message: 'Dry run completed. No changes written.',
        });
      }

      // 确保目录存在
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(absolutePath, newContent, 'utf-8');

      const bytesWritten = Buffer.byteLength(newContent, 'utf-8');

      logger.info(
        {
          file: file_path,
          action,
          bytesWritten,
          warning: safetyCheck.risk_level === 'warning',
        },
        'Agent file edit completed',
      );

      return res.json({
        success: true,
        file_path,
        action,
        bytes_written: bytesWritten,
        diff_preview: diffPreview,
        warning: safetyCheck.risk_level === 'warning' ? safetyCheck.reason : undefined,
        message: `File "${file_path}" ${action === 'create' ? 'created' : action === 'overwrite' ? 'overwritten' : 'patched'} successfully`,
      });
    } catch (err) {
      const error = err as { message?: string; stack?: string; code?: string };
      logger.error(
        { error: error.message, stack: error.stack, file: file_path },
        'Agent file edit failed',
      );

      return res.status(500).json({
        error: 'Internal Server Error',
        message: `Failed to ${action} file: ${error.message}`,
      });
    }
  });

  // -------------------------------------------
  // POST /run-remote-tool
  // -------------------------------------------
  router.post('/run-remote-tool', async (req: Request, res: Response) => {
    const { target_url, target_token, tool_name, arguments: toolArgs, timeout_ms } = req.body || {};
    const sessionId = getSessionId(req);

    // 1. 参数验证
    if (!tool_name || typeof tool_name !== 'string') {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Missing required field: tool_name' });
    }

    // 2. 检查 revoked tools
    if (isToolRevoked(sessionId, 'run-remote-tool')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Tool "run-remote-tool" access has been revoked for this session',
      });
    }

    // 3. 安全检查
    const args = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};
    const safetyCheck = checkToolSafety(tool_name, args as Record<string, unknown>);
    if (safetyCheck.risk_level === 'denied') {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Safety check failed for tool "${tool_name}": ${safetyCheck.reason}`,
      });
    }

    const timeout = Math.min(Math.max(timeout_ms || 30000, 1000), 120000); // 1s ~ 120s
    const startTime = Date.now();

    // 4. 判断是否为自调用（self-dispatch）
    const isSelfDispatch = !target_url || target_url === 'self';

    if (isSelfDispatch) {
      // 自调用：内部分发工具调用
      try {
        const { codebaseRetrievalSchema, handleCodebaseRetrieval } = await import(
          './tools/codebaseRetrieval.js'
        );
        const { detectTasksSchema, handleDetectTasks } = await import('./tools/detectTasks.js');
        const { generateCommitMessageSchema, handleGenerateCommitMessage } = await import(
          './tools/generateCommitMessage.js'
        );

        let result: unknown;

        switch (tool_name) {
          case 'codebase-retrieval': {
            const parsed = codebaseRetrievalSchema.parse(args);
            result = await handleCodebaseRetrieval(parsed, undefined, undefined);
            break;
          }
          case 'generate-commit-message': {
            const parsed = generateCommitMessageSchema.parse(args);
            result = await handleGenerateCommitMessage(parsed);
            break;
          }
          case 'detect-tasks': {
            const parsed = detectTasksSchema.parse(args);
            result = await handleDetectTasks(parsed);
            break;
          }
          default:
            return res.status(404).json({
              error: 'Not Found',
              message: `Unknown tool for self-dispatch: "${tool_name}"`,
            });
        }

        const latencyMs = Date.now() - startTime;
        logger.info(
          { tool: tool_name, latencyMs, mode: 'self' },
          'Agent remote tool self-dispatch',
        );

        return res.json({
          success: true,
          result,
          remote_server: 'self',
          latency_ms: latencyMs,
        });
      } catch (err) {
        const error = err as { message?: string };
        const latencyMs = Date.now() - startTime;
        return res.status(500).json({
          success: false,
          remote_server: 'self',
          latency_ms: latencyMs,
          error: `Self-dispatch failed: ${error.message}`,
        });
      }
    }

    // 5. 远程代理调用
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const rpcPayload = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: tool_name,
          arguments: args,
        },
        id: `agent-proxy-${Date.now()}`,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (target_token) {
        headers.Authorization = `Bearer ${target_token}`;
      }

      const response = await fetch(target_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(rpcPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { tool: tool_name, target: target_url, status: response.status, latencyMs },
          'Remote tool call failed',
        );
        return res.status(502).json({
          success: false,
          remote_server: target_url,
          latency_ms: latencyMs,
          error: `Remote server returned ${response.status}: ${errorText.slice(0, 500)}`,
        });
      }

      const rpcResponse = (await response.json()) as {
        result?: unknown;
        error?: unknown;
      };

      logger.info(
        { tool: tool_name, target: target_url, latencyMs, mode: 'remote' },
        'Agent remote tool proxy completed',
      );

      return res.json({
        success: !rpcResponse.error,
        result: rpcResponse.result || rpcResponse.error,
        remote_server: target_url,
        latency_ms: latencyMs,
      });
    } catch (err) {
      const error = err as { name?: string; message?: string };
      const latencyMs = Date.now() - startTime;

      if (error.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          remote_server: target_url,
          latency_ms: latencyMs,
          error: `Request timed out after ${timeout}ms`,
        });
      }

      logger.error(
        { error: error.message, tool: tool_name, target: target_url },
        'Remote tool proxy error',
      );

      return res.status(502).json({
        success: false,
        remote_server: target_url,
        latency_ms: latencyMs,
        error: `Proxy error: ${error.message}`,
      });
    }
  });

  return router;
}

// ===========================================
// 辅助函数
// ===========================================

/**
 * 生成简易 diff 预览（非完整 unified diff，但足以展示变更）
 */
function generateSimpleDiff(filePath: string, oldContent: string, newContent: string): string {
  if (!oldContent && newContent) {
    // 新文件
    const lines = newContent.split('\n');
    return `--- /dev/null\n+++ ${filePath}\n${lines.map((l) => `+${l}`).join('\n')}`;
  }

  if (oldContent === newContent) {
    return '(no changes)';
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // 简单逐行对比（适用于小文件预览）
  const maxLen = Math.max(oldLines.length, newLines.length);
  let changeStart = -1;
  let removedLines: string[] = [];
  let addedLines: string[] = [];

  const flushHunk = () => {
    if (removedLines.length > 0 || addedLines.length > 0) {
      diffLines.push(`@@ -${changeStart + 1} +${changeStart + 1} @@`);
      for (const l of removedLines) diffLines.push(`-${l}`);
      for (const l of addedLines) diffLines.push(`+${l}`);
      removedLines = [];
      addedLines = [];
      changeStart = -1;
    }
  };

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      flushHunk();
    } else {
      if (changeStart === -1) changeStart = i;
      if (oldLine !== undefined) removedLines.push(oldLine);
      if (newLine !== undefined) addedLines.push(newLine);
    }
  }
  flushHunk();

  return diffLines.join('\n');
}

// 导出辅助函数用于测试
export { checkToolSafety, isToolRevoked, revokedToolsMap, getSessionId };
