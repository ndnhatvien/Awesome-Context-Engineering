/**
 * Claude Code Native Hooks Generator
 *
 * Automatically generates native hooks for Claude Code (.claude/settings.json and .claude/hooks/session-start.mjs).
 * Native Cross-platform (Windows, macOS, Linux) without requiring WSL or external python scripts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface SetupHooksResult {
  success: boolean;
  hooksDir: string;
  settingsPath: string;
  createdFiles: string[];
}

export function setupClaudeCodeHooks(repoPath: string): SetupHooksResult {
  const claudeDir = path.join(repoPath, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const createdFiles: string[] = [];

  // 1. 生成 session-start.mjs 钩子脚本
  const sessionStartScriptPath = path.join(hooksDir, 'session-start.mjs');
  const sessionStartContent = `#!/usr/bin/env node
/**
 * ACE Context Engine - Claude Code SessionStart Hook
 * Injects 4-layer working context into Claude Code on session start, resume, or /clear.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();

try {
  // 调用 ace memory compile-json
  const res = spawnSync('npx', ['ace', 'memory', 'compile', repoRoot, '--json'], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
  });

  if (res.status === 0 && res.stdout) {
    const data = JSON.parse(res.stdout);
    const output = {
      additionalContext: data.markdown || '',
    };
    process.stdout.write(JSON.stringify(output));
  } else {
    process.stdout.write(JSON.stringify({ additionalContext: '' }));
  }
} catch {
  process.stdout.write(JSON.stringify({ additionalContext: '' }));
}
`;

  fs.writeFileSync(sessionStartScriptPath, sessionStartContent, 'utf-8');
  createdFiles.push(sessionStartScriptPath);

  // 2. 更新或创建 .claude/settings.json
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  const existingHooks = (settings.hooks || {}) as Record<string, unknown[]>;
  const sessionStartHooks = (existingHooks.SessionStart || []) as Array<{
    matcher?: string;
    command?: string;
  }>;

  const hookCommand = 'node .claude/hooks/session-start.mjs';
  const hasHook = sessionStartHooks.some((h) => h.command?.includes('session-start.mjs'));

  if (!hasHook) {
    sessionStartHooks.push({
      matcher: '.*',
      command: hookCommand,
    });
  }

  settings.hooks = {
    ...existingHooks,
    SessionStart: sessionStartHooks,
  };

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  createdFiles.push(settingsPath);

  logger.info({ repoPath, createdFiles }, 'Claude Code native hooks configured successfully');

  return {
    success: true,
    hooksDir,
    settingsPath,
    createdFiles,
  };
}
