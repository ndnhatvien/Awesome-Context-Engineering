/**
 * Agent Memory Tool
 *
 * Implements Four-Layer Memory Architecture for AI Agents:
 * - record_failure: Record mistakes/bugs to avoid repeating them
 * - record_strategy: Record proven strategies and patterns that worked
 * - record_constraint: Record project rules, conventions, and constraints
 * - query: Search memory for relevant lessons, patterns, and rules
 * - compile_context: Compile fresh working context with priority-based budgeting
 * - setup_hooks: Configure native Claude Code hooks for auto context injection
 */

import { z } from 'zod';
import { generateProjectId, initDb } from '../../db/index.js';
import { setupClaudeCodeHooks } from '../../memory/hooksGenerator.js';
import { MemoryService } from '../../memory/MemoryService.js';
import type { MemoryCategory } from '../../memory/types.js';
import { logger } from '../../utils/logger.js';
import { normalizeRepoPath } from './codebaseRetrieval.js';

export const agentMemorySchema = z.object({
  repo_path: z.string().describe('The absolute path to the repository root'),
  action: z
    .enum([
      'record_failure',
      'record_strategy',
      'record_constraint',
      'record_decision',
      'query',
      'compile_context',
      'setup_hooks',
    ])
    .describe('Action to perform on Agent Memory'),
  title: z.string().optional().describe('Short descriptive title (required when recording memory)'),
  content: z
    .string()
    .optional()
    .describe('Detailed content, error description, or solution (required when recording memory)'),
  target_files: z
    .array(z.string())
    .optional()
    .describe('List of related file paths or symbol identifiers'),
  tags: z.array(z.string()).optional().describe('Keywords or tags for categorization'),
  priority: z.number().min(0).max(100).optional().describe('Priority weight (0-100)'),
  query: z.string().optional().describe('Search term for query action'),
  task: z.string().optional().describe('Current task/goal for compile_context action'),
  max_chars: z
    .number()
    .optional()
    .describe('Max character budget for compiled context (default 6000)'),
});

export type AgentMemoryInput = z.infer<typeof agentMemorySchema>;

export async function handleAgentMemory(
  args: AgentMemoryInput,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const {
    repo_path,
    action,
    title,
    content,
    target_files,
    tags,
    priority,
    query,
    task,
    max_chars,
  } = args;

  const normalizedRepoPath = normalizeRepoPath(repo_path);
  const projectId = generateProjectId(normalizedRepoPath);
  const db = initDb(projectId);
  const memoryService = new MemoryService(db);

  try {
    switch (action) {
      case 'record_failure':
      case 'record_strategy':
      case 'record_constraint':
      case 'record_decision': {
        if (!title || !content) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: `title` and `content` are required when recording memory.',
              },
            ],
            isError: true,
          };
        }

        const categoryMap: Record<string, MemoryCategory> = {
          record_failure: 'failure',
          record_strategy: 'strategy',
          record_constraint: 'constraint',
          record_decision: 'decision',
        };

        const category = categoryMap[action];
        const item = memoryService.recordMemory({
          category,
          title,
          content,
          targetFiles: target_files,
          tags,
          priority,
        });

        const icon =
          category === 'failure'
            ? '❌'
            : category === 'strategy'
              ? '💡'
              : category === 'constraint'
                ? '🛡️'
                : '📝';

        return {
          content: [
            {
              type: 'text',
              text: `✅ ${icon} Memory recorded [${item.category.toUpperCase()}]: **${item.title}** (ID: \`${item.id}\`)\n\n${item.content}`,
            },
          ],
        };
      }

      case 'query': {
        const results = memoryService.findRelevantMemories({
          query,
          targetFiles: target_files,
          tags,
          limit: 15,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No relevant memories found for the given criteria.',
              },
            ],
          };
        }

        const lines = [`# 🧠 Agent Memory Query Results (${results.length} items)`, ''];
        for (const m of results) {
          const icon =
            m.category === 'failure'
              ? '❌'
              : m.category === 'strategy'
                ? '💡'
                : m.category === 'constraint'
                  ? '🛡️'
                  : '📝';
          const fileHint = m.targetFiles.length > 0 ? ` (Files: ${m.targetFiles.join(', ')})` : '';
          lines.push(`### ${icon} [${m.category.toUpperCase()}] ${m.title}${fileHint}`);
          lines.push(m.content);
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }

      case 'compile_context': {
        const compiled = memoryService.compileWorkingContext({
          task,
          targetFiles: target_files,
          maxChars: max_chars ?? 6000,
        });

        return {
          content: [
            {
              type: 'text',
              text: `${compiled.markdown}\n\n---\n*Metadata: ${compiled.itemCount} items incorporated | ~${compiled.estimatedTokens} tokens | Truncated: ${compiled.truncated}*`,
            },
          ],
        };
      }

      case 'setup_hooks': {
        const result = setupClaudeCodeHooks(normalizedRepoPath);
        return {
          content: [
            {
              type: 'text',
              text: `✅ Claude Code native hooks configured successfully!\n\nCreated/Updated files:\n${result.createdFiles.map((f) => `- \`${f}\``).join('\n')}\n\nNow run \`/hooks\` inside Claude Code to approve the SessionStart hook.`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${action}` }],
          isError: true,
        };
    }
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, action }, 'Agent Memory operation failed');
    return {
      content: [{ type: 'text', text: `Error executing agent-memory: ${error.message}` }],
      isError: true,
    };
  } finally {
    db.close();
  }
}
