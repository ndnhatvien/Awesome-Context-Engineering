/**
 * Codebase Impact MCP Tool
 *
 * Analyzes impact of code changes through graph traversal.
 * Predicts affected files/tests and explains dependency paths.
 */

import { z } from 'zod';
import { generateProjectId, initDb } from '../../db/index.js';
import { ImpactGraphService } from '../../graph/ImpactGraphService.js';
import { logger } from '../../utils/logger.js';

export const codebaseImpactSchema = z.object({
  repo_path: z.string(),
  target: z.union([z.string(), z.array(z.string())]),
  mode: z.enum(['impact', 'affected']).optional().default('affected'),
  depth: z.number().int().min(1).max(10).optional().default(2),
  tests_only: z.boolean().optional().default(false),
  include_paths: z.boolean().optional().default(false),
});

export type CodebaseImpactInput = z.infer<typeof codebaseImpactSchema>;

export async function handleCodebaseImpact(
  input: CodebaseImpactInput,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { repo_path, target, mode, depth, tests_only, include_paths } = input;

  logger.info({ repo_path, target, mode, depth }, 'codebase-impact 工具调用');

  try {
    const projectId = generateProjectId(repo_path);
    const db = initDb(projectId);

    try {
      const service = new ImpactGraphService(db);
      const targets = Array.isArray(target) ? target : [target];

      const result = await service.analyzeImpact(targets, {
        depth,
        testsOnly: tests_only,
        includePaths: include_paths,
      });

      // Format output based on mode
      const lines: string[] = [];

      lines.push('# Impact Analysis');
      lines.push('');

      if (result.warnings.length > 0) {
        lines.push('## Warnings');
        for (const warning of result.warnings) {
          lines.push(`- ${warning}`);
        }
        lines.push('');
      }

      // Show resolved targets
      if (result.resolvedTargets.length > 0) {
        lines.push('## Resolved Targets');
        for (const resolved of result.resolvedTargets) {
          if (resolved.notFound) {
            lines.push(`- ❌ ${resolved.input} (not found)`);
          } else {
            lines.push(
              `- ✓ ${resolved.input} → ${resolved.filePath}${resolved.kind !== 'file' ? `:${resolved.kind}` : ''}`,
            );
          }
        }
        lines.push('');
      }

      // Direct tests
      if (result.directTests.length > 0) {
        lines.push(`## Direct Tests (${result.directTests.length})`);
        lines.push('');
        for (const test of result.directTests.slice(0, 20)) {
          lines.push(`### ${test.testName || test.filePath}`);
          lines.push(`- **File**: \`${test.filePath}\``);
          lines.push(`- **Score**: ${test.score.toFixed(3)}`);
          lines.push(`- **Depth**: ${test.depth}`);
          lines.push(`- **Reason**: ${test.reason}`);
          lines.push('');
        }
      }

      // Indirect tests
      if (result.indirectTests.length > 0) {
        lines.push(`## Indirect Tests (${result.indirectTests.length})`);
        lines.push('');
        for (const test of result.indirectTests.slice(0, 20)) {
          lines.push(`### ${test.testName || test.filePath}`);
          lines.push(`- **File**: \`${test.filePath}\``);
          lines.push(`- **Score**: ${test.score.toFixed(3)}`);
          lines.push(`- **Depth**: ${test.depth}`);
          lines.push(`- **Reason**: ${test.reason}`);
          lines.push('');
        }
      }

      // Affected files
      if (!tests_only && result.affectedFiles.length > 0) {
        lines.push(`## Affected Files (${result.affectedFiles.length})`);
        lines.push('');
        for (const file of result.affectedFiles.slice(0, 30)) {
          lines.push(
            `- \`${file.filePath}\` (score: ${file.score.toFixed(3)}, depth: ${file.depth})`,
          );
        }
        lines.push('');
      }

      // Impact paths
      if (include_paths && result.impactPaths.length > 0) {
        lines.push('## Impact Paths');
        lines.push('');
        for (const impactPath of result.impactPaths) {
          lines.push(`### ${impactPath.description}`);
          lines.push(`\`\`\`
${impactPath.path.join(' → ')}
\`\`\``);
          lines.push('');
        }
      }

      // Summary
      if (
        result.directTests.length === 0 &&
        result.indirectTests.length === 0 &&
        result.affectedFiles.length === 0
      ) {
        lines.push('## Summary');
        lines.push('');
        lines.push('No affected tests or files found.');
        lines.push('');
        lines.push(
          '💡 **Tip**: The impact graph may not be indexed yet. Run `ace index` to build the graph.',
        );
        lines.push('');
      }

      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n'),
          },
        ],
      };
    } finally {
      db.close();
    }
  } catch (error) {
    const err = error as { message?: string; stack?: string };
    logger.error({ error: err.message, stack: err.stack }, 'codebase-impact 工具失败');
    return {
      content: [
        {
          type: 'text',
          text: `Error analyzing impact: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
}
