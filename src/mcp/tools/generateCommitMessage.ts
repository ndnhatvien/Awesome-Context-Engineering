/**
 * MCP Tool: Generate Git Commit Message
 *
 * AI-powered commit message generation from staged changes
 */

import { z } from 'zod';
import { generateCommitMessage } from '../../git/commitMessage.js';
import { isGitRepository } from '../../git/diff.js';
import { logger } from '../../utils/logger.js';

export const generateCommitMessageSchema = z.object({
  repo_path: z.string().describe('Path to the git repository'),
  style: z
    .enum(['conventional', 'simple', 'detailed'])
    .optional()
    .describe('Commit message style (default: conventional)'),
  include_body: z
    .boolean()
    .optional()
    .describe('Include detailed body in commit message (default: true)'),
});

export async function handleGenerateCommitMessage(
  args: z.infer<typeof generateCommitMessageSchema>,
) {
  const { repo_path, style = 'conventional', include_body = true } = args;

  logger.info({ repo_path, style }, 'Generating commit message');

  try {
    // Validate git repository
    if (!isGitRepository(repo_path)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${repo_path} is not a git repository`,
          },
        ],
        isError: true,
      };
    }

    // Generate commit message
    const message = await generateCommitMessage(repo_path, {
      style,
      includeBody: include_body,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Generated commit message:\n\n${message}\n\nTo use this message:\n  git commit -m "${message.split('\n')[0]}"`,
        },
      ],
    };
  } catch (error) {
    const err = error as { message?: string };
    logger.error({ error: err.message, repo_path }, 'Failed to generate commit message');

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
