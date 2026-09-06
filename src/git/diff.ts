/**
 * Git diff utilities for commit message generation
 */

import { execSync } from 'node:child_process';

export interface GitDiffResult {
  diff: string;
  stagedFiles: string[];
  stats: {
    insertions: number;
    deletions: number;
    filesChanged: number;
  };
}

/**
 * Get staged diff for commit message generation
 */
export function getStagedDiff(repoPath: string): GitDiffResult {
  try {
    // Get staged files
    const stagedOutput = execSync('git diff --cached --name-only', {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    const stagedFiles = stagedOutput
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);

    if (stagedFiles.length === 0) {
      throw new Error('No staged changes found. Use `git add` first.');
    }

    // Get diff with stats
    const diffOutput = execSync('git diff --cached --stat', {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    // Get detailed diff (limited to avoid token overflow)
    const detailedDiff = execSync('git diff --cached --unified=3', {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 5, // 5MB max
    });

    // Parse stats
    const statsMatch = diffOutput.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );
    const stats = {
      filesChanged: statsMatch ? Number.parseInt(statsMatch[1], 10) : stagedFiles.length,
      insertions: statsMatch?.[2] ? Number.parseInt(statsMatch[2], 10) : 0,
      deletions: statsMatch?.[3] ? Number.parseInt(statsMatch[3], 10) : 0,
    };

    return {
      diff: detailedDiff,
      stagedFiles,
      stats,
    };
  } catch (error) {
    const err = error as { message?: string };
    throw new Error(`Failed to get staged diff: ${err.message}`);
  }
}

/**
 * Check if a directory is a git repository
 */
export function isGitRepository(dirPath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 */
export function getCurrentBranch(repoPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();
  } catch (error) {
    const err = error as { message?: string };
    throw new Error(`Failed to get current branch: ${err.message}`);
  }
}

/**
 * Truncate diff for LLM processing (max 8000 chars)
 */
export function truncateDiff(diff: string, maxChars = 8000): string {
  if (diff.length <= maxChars) {
    return diff;
  }

  // Keep first part and last part
  const half = Math.floor(maxChars / 2);
  const start = diff.slice(0, half);
  const end = diff.slice(-half);

  return `${start}\n\n... (truncated ${diff.length - maxChars} characters) ...\n\n${end}`;
}
