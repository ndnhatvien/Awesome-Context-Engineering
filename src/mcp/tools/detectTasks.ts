/**
 * MCP Tool: Detect Project Tasks
 *
 * Automatically detect runnable tasks from project files
 * (package.json, Makefile, Justfile, etc.)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

export const detectTasksSchema = z.object({
  repo_path: z.string().describe('Path to the project root'),
});

export interface DetectedTask {
  name: string;
  command: string;
  file: string;
  type: 'npm' | 'pnpm' | 'yarn' | 'make' | 'just' | 'deno' | 'cargo' | 'gradle';
  description?: string;
}

/**
 * Detect tasks from package.json
 */
function detectNpmTasks(rootPath: string): DetectedTask[] {
  const pkgPath = path.join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const tasks: DetectedTask[] = [];

    // Detect package manager
    const hasPnpmLock = existsSync(path.join(rootPath, 'pnpm-lock.yaml'));
    const hasYarnLock = existsSync(path.join(rootPath, 'yarn.lock'));
    const runner = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm';

    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      tasks.push({
        name: `${runner}:${name}`,
        command: `${runner} run ${name}`,
        file: 'package.json',
        type: runner as 'npm' | 'pnpm' | 'yarn',
        description: cmd,
      });
    }

    return tasks;
  } catch {
    return [];
  }
}

/**
 * Detect tasks from Makefile
 */
function detectMakeTasks(rootPath: string): DetectedTask[] {
  const makefilePath = path.join(rootPath, 'Makefile');
  if (!existsSync(makefilePath)) return [];

  try {
    const content = readFileSync(makefilePath, 'utf-8');
    const tasks: DetectedTask[] = [];

    // Match target definitions: target: dependencies
    const targetRegex = /^([a-zA-Z0-9_-]+):\s*([^#\n]*)?(?:#\s*(.*))?$/gm;

    while (true) {
      const match = targetRegex.exec(content);
      if (match === null) break;
      const [, name, deps, comment] = match;
      // Skip internal targets (starting with .)
      if (name.startsWith('.')) continue;

      tasks.push({
        name: `make:${name}`,
        command: `make ${name}`,
        file: 'Makefile',
        type: 'make',
        description: comment?.trim() || deps?.trim(),
      });
    }

    return tasks;
  } catch {
    return [];
  }
}

/**
 * Detect tasks from Justfile
 */
function detectJustTasks(rootPath: string): DetectedTask[] {
  const justfilePath = path.join(rootPath, 'justfile');
  const altPath = path.join(rootPath, 'Justfile');
  const filePath = existsSync(justfilePath) ? justfilePath : existsSync(altPath) ? altPath : null;

  if (!filePath) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const tasks: DetectedTask[] = [];

    // Match recipe definitions: name param1 param2:
    const recipeRegex = /^([a-zA-Z0-9_-]+)(?:\s+[^:]*)?:\s*(?:#\s*(.*))?$/gm;

    while (true) {
      const match = recipeRegex.exec(content);
      if (match === null) break;
      const [, name, comment] = match;
      // Skip internal recipes (starting with _)
      if (name.startsWith('_')) continue;

      tasks.push({
        name: `just:${name}`,
        command: `just ${name}`,
        file: 'justfile',
        type: 'just',
        description: comment?.trim(),
      });
    }

    return tasks;
  } catch {
    return [];
  }
}

/**
 * Detect tasks from deno.json
 */
function detectDenoTasks(rootPath: string): DetectedTask[] {
  const denoPath = path.join(rootPath, 'deno.json');
  const altPath = path.join(rootPath, 'deno.jsonc');
  const filePath = existsSync(denoPath) ? denoPath : existsSync(altPath) ? altPath : null;

  if (!filePath) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    // Remove comments for JSONC support
    const cleanContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const config = JSON.parse(cleanContent) as { tasks?: Record<string, string> };
    const tasks: DetectedTask[] = [];

    for (const [name, cmd] of Object.entries(config.tasks || {})) {
      tasks.push({
        name: `deno:${name}`,
        command: `deno task ${name}`,
        file: 'deno.json',
        type: 'deno',
        description: cmd,
      });
    }

    return tasks;
  } catch {
    return [];
  }
}

/**
 * Detect tasks from Cargo.toml
 */
function detectCargoTasks(rootPath: string): DetectedTask[] {
  const cargoPath = path.join(rootPath, 'Cargo.toml');
  if (!existsSync(cargoPath)) return [];

  // Common cargo commands
  const commonTasks = [
    { name: 'cargo:build', command: 'cargo build', description: 'Build the project' },
    { name: 'cargo:test', command: 'cargo test', description: 'Run tests' },
    { name: 'cargo:run', command: 'cargo run', description: 'Run the project' },
    { name: 'cargo:check', command: 'cargo check', description: 'Check compilation' },
    { name: 'cargo:clippy', command: 'cargo clippy', description: 'Run linter' },
    { name: 'cargo:fmt', command: 'cargo fmt', description: 'Format code' },
  ];

  return commonTasks.map((t) => ({ ...t, file: 'Cargo.toml', type: 'cargo' as const }));
}

/**
 * Main task detection function
 */
export function detectProjectTasks(rootPath: string): DetectedTask[] {
  const tasks: DetectedTask[] = [];

  tasks.push(...detectNpmTasks(rootPath));
  tasks.push(...detectMakeTasks(rootPath));
  tasks.push(...detectJustTasks(rootPath));
  tasks.push(...detectDenoTasks(rootPath));
  tasks.push(...detectCargoTasks(rootPath));

  return tasks;
}

/**
 * MCP tool handler
 */
export async function handleDetectTasks(args: z.infer<typeof detectTasksSchema>) {
  const { repo_path } = args;

  logger.info({ repo_path }, 'Detecting project tasks');

  try {
    const tasks = detectProjectTasks(repo_path);

    if (tasks.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No tasks found in this project.\n\nSupported files: package.json, Makefile, justfile, deno.json, Cargo.toml',
          },
        ],
      };
    }

    // Format output
    const output = [
      `Found ${tasks.length} tasks in ${repo_path}:\n`,
      ...tasks.map((t) => `  ${t.name.padEnd(30)} ${t.description || t.command}`),
      '\nTo run a task, use:',
      '  MCP: run-task tool',
      '  CLI: ace run-task <name>',
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  } catch (error) {
    const err = error as { message?: string };
    logger.error({ error: err.message, repo_path }, 'Failed to detect tasks');

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
}
