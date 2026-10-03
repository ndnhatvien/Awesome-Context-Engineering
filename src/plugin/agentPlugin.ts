/**
 * Agent Plugin Generator
 *
 * 遵循 Agent Plugins 开放规范 (https://agent-plugins.org v1.0.0)
 * 灵感来源于 elara-labs/code-context-engine: "Agent Plugin support (cce init --plugin)"
 * 自动生成 portable plugin 目录，支持 VS Code, Cursor, GitHub Copilot, OpenAI Codex, ChatGPT, Kiro 零配置自动加载。
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface AgentPluginOptions {
  projectPath: string;
  pluginDir?: string;
  version?: string;
}

export interface SetupPluginResult {
  pluginDir: string;
  filesCreated: string[];
}

export function setupAgentPlugin(options: AgentPluginOptions): SetupPluginResult {
  const { projectPath, version = '0.2.0' } = options;
  const targetDir = options.pluginDir
    ? path.resolve(options.pluginDir)
    : path.resolve(projectPath, '.ace/plugin');

  const skillsDir = path.join(targetDir, 'skills', 'code-context');
  const filesCreated: string[] = [];

  // 确保目录存在
  fs.mkdirSync(skillsDir, { recursive: true });

  // 1. plugin.json
  const pluginJsonPath = path.join(targetDir, 'plugin.json');
  const pluginJson = {
    $schema: 'https://agent-plugins.org/v1/schema.json',
    name: 'awesome-context-engineering',
    version,
    description:
      'High-performance semantic code search and AI context engine with 90%+ token savings and persistent agent memory',
    skills: ['./skills/code-context'],
    mcp: './mcp.json',
    homepage: 'https://github.com/nv876620-design/ace-recall',
  };
  fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2), 'utf-8');
  filesCreated.push(pluginJsonPath);

  // 2. mcp.json
  const mcpJsonPath = path.join(targetDir, 'mcp.json');
  const mcpJson = {
    mcpServers: {
      ace: {
        command: 'ace',
        args: ['mcp'],
      },
    },
  };
  fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2), 'utf-8');
  filesCreated.push(mcpJsonPath);

  // 3. skills/code-context/SKILL.md
  const skillMdPath = path.join(skillsDir, 'SKILL.md');
  const skillMd = `---
name: code-context
description: Search codebase semantically and recall architecture lessons with 90%+ token savings.
---

# Awesome Context Engineering (ACE) Skill

Always prefer ACE semantic search over reading full files from disk.

## Guidelines
1. **Semantic Search First**: Call \`codebase-retrieval\` with your semantic goal instead of reading entire files.
2. **Progressive Detail**: When functions appear skeletonized, use \`expand-chunk\` with the \`chunk_id\` only on the exact parts you need to edit.
3. **Procedural Memory**: Consult and update \`agent-memory\` when encountering tricky bugs or establishing project constraints.
4. **Impact Analysis**: Call \`codebase-impact\` before making non-trivial modifications to shared functions or classes.
`;
  fs.writeFileSync(skillMdPath, skillMd, 'utf-8');
  filesCreated.push(skillMdPath);

  logger.info({ pluginDir: targetDir, filesCreated }, 'Agent Plugin generated successfully');

  return {
    pluginDir: targetDir,
    filesCreated,
  };
}
