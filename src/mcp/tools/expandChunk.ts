/**
 * expand-chunk MCP Tool
 *
 * 灵感来源于 elara-labs/code-context-engine: "expand_chunk tool"
 * 当 AI Agent 在检索结果中看到骨架压缩的函数或类时，
 * 可通过此工具按需展开指定 Chunk 或文件行区间的完整未经折叠的源码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { generateProjectId, initDb } from '../../db/index.js';
import { SecretScrubber } from '../../security/SecretScrubber.js';
import { logger } from '../../utils/logger.js';

export const expandChunkSchema = z.object({
  repo_path: z
    .string()
    .describe("The absolute path to the repository root (e.g., '/Users/dev/my-project')."),
  chunk_id: z
    .string()
    .optional()
    .describe("The chunk identifier displayed in search results (e.g., 'src/api/client.ts#2')."),
  file_path: z
    .string()
    .optional()
    .describe(
      "Relative path to the file (e.g., 'src/api/client.ts'). Required if chunk_id is omitted.",
    ),
  start_line: z
    .number()
    .int()
    .optional()
    .describe('Optional 1-based start line number to extract.'),
  end_line: z.number().int().optional().describe('Optional 1-based end line number to extract.'),
});

export type ExpandChunkInput = z.infer<typeof expandChunkSchema>;

export async function handleExpandChunk(
  input: ExpandChunkInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { repo_path, chunk_id, file_path, start_line, end_line } = input;

  if (!chunk_id && !file_path) {
    return {
      content: [
        {
          type: 'text',
          text: '❌ Error: Either "chunk_id" or "file_path" must be provided to expand chunk.',
        },
      ],
    };
  }

  let targetFilePath = file_path;
  const targetStartLine = start_line;
  const targetEndLine = end_line;

  // 解析 chunk_id (格式如: "src/utils.ts#3")
  if (chunk_id) {
    const hashIndex = chunk_id.lastIndexOf('#');
    if (hashIndex > 0) {
      targetFilePath = chunk_id.slice(0, hashIndex);
    } else if (!targetFilePath) {
      targetFilePath = chunk_id;
    }
  }

  if (!targetFilePath) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Could not resolve file path from chunk_id: "${chunk_id}"`,
        },
      ],
    };
  }

  // 安全检查：防止路径遍历
  const normalizedRepo = path.resolve(repo_path);
  const absoluteTarget = path.resolve(normalizedRepo, targetFilePath);
  if (!absoluteTarget.startsWith(normalizedRepo)) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ Path traversal detected: "${targetFilePath}" is outside repository.`,
        },
      ],
    };
  }

  let fullContent = '';

  // 优先从 SQLite files 表中读取，以保持缓存一致性，若无则读本地文件
  try {
    const projectId = generateProjectId(normalizedRepo);
    const db = initDb(projectId);
    try {
      const normalizedRelative = targetFilePath.replace(/\\/g, '/');
      const row = db.prepare('SELECT content FROM files WHERE path = ?').get(normalizedRelative) as
        | { content: string }
        | undefined;
      if (row?.content) {
        fullContent = row.content;
      }
    } finally {
      db.close();
    }
  } catch {
    // 降级使用本地磁盘读取
  }

  if (!fullContent) {
    try {
      fullContent = await fs.promises.readFile(absoluteTarget, 'utf-8');
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to read file "${targetFilePath}": ${(err as Error).message}`,
          },
        ],
      };
    }
  }

  // 敏感信息清洗
  const scrubbed = SecretScrubber.scrub(fullContent).cleanText;
  const lines = scrubbed.split('\n');
  const totalLines = lines.length;

  let sliceStart = 1;
  let sliceEnd = totalLines;

  if (targetStartLine && targetStartLine > 0) {
    sliceStart = Math.min(targetStartLine, totalLines);
  }
  if (targetEndLine && targetEndLine >= sliceStart) {
    sliceEnd = Math.min(targetEndLine, totalLines);
  }

  const selectedLines = lines.slice(sliceStart - 1, sliceEnd);
  const formattedCode = selectedLines
    .map((line, idx) => `${String(sliceStart + idx).padStart(4, ' ')} | ${line}`)
    .join('\n');

  logger.debug(
    { file: targetFilePath, lines: `${sliceStart}-${sliceEnd}` },
    'Expanded chunk retrieved',
  );

  return {
    content: [
      {
        type: 'text',
        text: `### 📂 Expanded Chunk: ${targetFilePath} (Lines ${sliceStart}-${sliceEnd} of ${totalLines})\n\n\`\`\`\n${formattedCode}\n\`\`\``,
      },
    ],
  };
}
