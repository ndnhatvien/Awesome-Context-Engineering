/**
 * AI-powered commit message generation
 *
 * Inspired by NotepadAI's auto-commit-message feature
 */

import { getRerankerClient } from '../api/reranker.js';
import { logger } from '../utils/logger.js';
import type { GitDiffResult } from './diff.js';
import { getStagedDiff, truncateDiff } from './diff.js';

export interface CommitMessageOptions {
  /** Maximum length of commit message */
  maxLength?: number;
  /** Include detailed body */
  includeBody?: boolean;
  /** Commit message style */
  style?: 'conventional' | 'simple' | 'detailed';
}

/**
 * Generate commit message from staged changes using AI
 */
export async function generateCommitMessage(
  repoPath: string,
  options: CommitMessageOptions = {},
): Promise<string> {
  const { maxLength = 200, includeBody = true, style = 'conventional' } = options;

  // Get staged diff
  const diffResult = getStagedDiff(repoPath);

  // Check if we have changes
  if (diffResult.stagedFiles.length === 0) {
    throw new Error('No staged changes found');
  }

  // Truncate diff to avoid token overflow
  const truncatedDiff = truncateDiff(diffResult.diff, 8000);

  // Build prompt based on style
  const prompt = buildPrompt(diffResult, truncatedDiff, style);

  // Generate using reranker API (which supports text generation)
  // Note: This is a workaround - ideally we'd use a dedicated LLM endpoint
  // But reranker can work for simple text generation tasks
  try {
    const _rerankerClient = getRerankerClient();

    // Use reranker's underlying API for generation
    // This is hacky but works if the endpoint supports completion
    const message = await generateWithAPI(prompt, maxLength);

    // Format the message
    const formatted = formatCommitMessage(message, diffResult, style, includeBody);

    logger.info(
      {
        files: diffResult.stagedFiles.length,
        style,
        length: formatted.length,
      },
      'Generated commit message',
    );

    return formatted;
  } catch (error) {
    const err = error as { message?: string };
    logger.error({ error: err.message }, 'Failed to generate commit message');

    // Fallback to rule-based generation
    return generateFallbackMessage(diffResult, style);
  }
}

/**
 * Build prompt for commit message generation
 */
function buildPrompt(diffResult: GitDiffResult, diff: string, style: string): string {
  const { stagedFiles, stats } = diffResult;

  const styleGuide =
    style === 'conventional'
      ? `Use Conventional Commits format (type(scope): description):
Types: feat, fix, docs, style, refactor, test, chore
Examples:
- feat(auth): add JWT token validation
- fix(api): handle null pointer in user service
- docs(readme): update installation instructions`
      : style === 'detailed'
        ? 'Write a detailed commit message with a clear summary and explanation of what changed and why.'
        : 'Write a concise, clear commit message describing what changed.';

  return `You are a senior developer writing a commit message.

Files changed: ${stats.filesChanged}
Insertions: ${stats.insertions}
Deletions: ${stats.deletions}

Changed files:
${stagedFiles.map((f) => `  - ${f}`).join('\n')}

Git diff:
\`\`\`diff
${diff}
\`\`\`

${styleGuide}

Write ONLY the commit message, no explanation or extra text.
Keep it under 72 characters for the first line.
`;
}

/**
 * Generate text using API
 *
 * TODO: Replace with proper LLM API call when available
 */
async function generateWithAPI(prompt: string, maxLength: number): Promise<string> {
  // This is a placeholder - actual implementation would call an LLM API
  // For now, we'll use the reranker's base URL to attempt generation

  const baseUrl = process.env.RERANK_BASE_URL?.replace('/rerank', '/chat/completions');
  const apiKey = process.env.RERANK_API_KEYS?.split(',')[0];

  if (!baseUrl || !apiKey) {
    throw new Error('LLM API not configured');
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'Qwen/Qwen2.5-7B-Instruct', // SiliconFlow model
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: maxLength,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0].message.content.trim();
}

/**
 * Format commit message according to style
 */
function formatCommitMessage(
  message: string,
  diffResult: GitDiffResult,
  style: string,
  includeBody: boolean,
): string {
  // Remove markdown formatting if present
  message = message.replace(/```.*?```/gs, '').trim();

  // Split into lines
  const lines = message.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return generateFallbackMessage(diffResult, style);
  }

  // Ensure first line is not too long
  let firstLine = lines[0];
  if (firstLine.length > 72) {
    firstLine = `${firstLine.slice(0, 69)}...`;
  }

  if (!includeBody || lines.length === 1) {
    return firstLine;
  }

  // Add body if requested and available
  const body = lines.slice(1).join('\n');
  return `${firstLine}\n\n${body}`;
}

/**
 * Generate fallback commit message using rules
 */
function generateFallbackMessage(diffResult: GitDiffResult, style: string): string {
  const { stagedFiles, stats } = diffResult;

  // Determine primary file type
  const extensions = stagedFiles.map((f) => f.split('.').pop()?.toLowerCase()).filter(Boolean);
  const primaryExt = mode(extensions) || 'file';

  // Determine commit type
  const hasNewFiles = stats.insertions > stats.deletions * 2;
  const hasDeletions = stats.deletions > stats.insertions * 2;
  const isTest = stagedFiles.some((f) => f.includes('test') || f.includes('spec'));
  const isDocs = stagedFiles.some((f) => f.includes('README') || f.includes('.md'));

  let type = 'chore';
  if (hasNewFiles) type = 'feat';
  else if (hasDeletions) type = 'refactor';
  else if (isTest) type = 'test';
  else if (isDocs) type = 'docs';
  else type = 'fix';

  // Generate scope
  const scope = inferScope(stagedFiles);

  // Generate description
  const fileCount = stats.filesChanged;
  const action = hasNewFiles
    ? 'add'
    : hasDeletions
      ? 'remove'
      : isTest
        ? 'update tests for'
        : 'update';

  const description =
    fileCount === 1 ? `${action} ${stagedFiles[0]}` : `${action} ${fileCount} ${primaryExt} files`;

  if (style === 'conventional') {
    return scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`;
  }

  return description.charAt(0).toUpperCase() + description.slice(1);
}

/**
 * Infer scope from file paths
 */
function inferScope(files: string[]): string | null {
  // Find common directory
  if (files.length === 1) {
    const parts = files[0].split('/');
    return parts.length > 1 ? parts[0] : null;
  }

  const dirs = files.map((f) => f.split('/')[0]);
  const commonDir = mode(dirs);

  // Common scopes
  const scopeMap: Record<string, string> = {
    src: 'core',
    tests: 'test',
    docs: 'docs',
    scripts: 'build',
    api: 'api',
    ui: 'ui',
    lib: 'lib',
  };

  return commonDir && scopeMap[commonDir] ? scopeMap[commonDir] : commonDir;
}

/**
 * Find most common element in array
 */
function mode<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;

  const counts = new Map<T, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  let maxCount = 0;
  let modeItem: T | null = null;

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      modeItem = item;
    }
  }

  return modeItem;
}
