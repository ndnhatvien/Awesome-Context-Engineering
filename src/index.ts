#!/usr/bin/env node
// 配置必须最先加载（包含环境变量初始化）
import './config.js';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cac from 'cac';
import { DEFAULT_ENV_TEMPLATE } from './config.js';
import { generateProjectId } from './db/index.js';
import { type ScanStats, scan } from './scanner/index.js';
import {
  inspectChunkIndexConsistency,
  repairChunkIndexConsistency,
} from './search/chunkIndexConsistency.js';
import { logger } from './utils/logger.js';
import { getConfigBaseDir } from './utils/paths.js';

// 读取 package.json 获取版本号
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

const cli = cac('ace');

// 自定义版本输出，只显示版本号
if (process.argv.includes('-v') || process.argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}

cli.command('init', 'Initialize ACE configuration').action(async () => {
  const configDir = getConfigBaseDir();
  const envFile = path.join(configDir, '.env');

  logger.info('Starting ACE initialization...');

  // Create config directory
  try {
    await fs.mkdir(configDir, { recursive: true });
    logger.info(`Created config directory: ${configDir}`);
  } catch (err) {
    const error = err as { code?: string; message?: string; stack?: string };
    if (error.code !== 'EEXIST') {
      logger.error(
        { err, stack: error.stack },
        `Failed to create config directory: ${error.message}`,
      );
      process.exit(1);
    }
    logger.info(`Config directory already exists: ${configDir}`);
  }

  // Check if .env file already exists
  try {
    await fs.access(envFile);
    logger.warn(`.env file already exists: ${envFile}`);
    logger.info('Initialization complete!');
    return;
  } catch {
    // File doesn't exist, continue with creation
  }

  // Write default .env configuration
  try {
    await fs.writeFile(envFile, DEFAULT_ENV_TEMPLATE);
    logger.info(`Created .env file: ${envFile}`);
  } catch (err) {
    const error = err as { message?: string; stack?: string };
    logger.error({ err, stack: error.stack }, `Failed to create .env file: ${error.message}`);
    process.exit(1);
  }

  logger.info('Next steps:');
  logger.info(`   1. Edit config file: ${envFile}`);
  logger.info('   2. Add your API keys and other settings');
  logger.info('Initialization complete!');
});

cli
  .command('index [path]', 'Scan codebase and build index')
  .option('-f, --force', 'Force reindex')
  .action(async (targetPath: string | undefined, options: { force?: boolean }) => {
    const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();
    const projectId = generateProjectId(rootPath);

    logger.info(`开始扫描: ${rootPath}`);
    logger.info(`项目 ID: ${projectId}`);
    if (options.force) {
      logger.info('强制重新索引: 是');
    }

    const startTime = Date.now();

    try {
      const { withLock } = await import('./utils/lock.js');

      // 进度日志节流：只在 30%、60%、90% 时输出（100% 由扫描完成日志代替）
      let lastLoggedPercent = 0;
      const stats: ScanStats = await withLock(
        projectId,
        'index',
        async () =>
          scan(rootPath, {
            force: options.force,
            onProgress: (current, total, message) => {
              if (total !== undefined) {
                const percent = Math.floor((current / total) * 100);
                if (percent >= lastLoggedPercent + 30 && percent < 100) {
                  logger.info(`索引进度: ${percent}% - ${message || ''}`);
                  lastLoggedPercent = Math.floor(percent / 30) * 30;
                }
              }
            },
          }),
        10 * 60 * 1000,
      );

      process.stdout.write('\n');

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`索引完成 (${duration}s)`);
      logger.info(
        `总数:${stats.totalFiles} 新增:${stats.added} 修改:${stats.modified} 未变:${stats.unchanged} 删除:${stats.deleted} 跳过:${stats.skipped} 错误:${stats.errors}`,
      );
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `索引失败: ${error.message}`);
      process.exit(1);
    }
  });

cli.command('mcp', '启动 MCP 服务器 (stdio)').action(async () => {
  // 动态导入并启动 MCP 服务器
  const { startMcpServer } = await import('./mcp/server.js');
  try {
    await startMcpServer();
  } catch (err) {
    const error = err as { message?: string; stack?: string };
    logger.error(
      { error: error.message, stack: error.stack },
      `MCP 服务器启动失败: ${error.message}`,
    );
    process.exit(1);
  }
});

cli
  .command('mcp-http', '启动 MCP HTTP 服务器')
  .option('--port <port>', 'HTTP 端口号', { default: '3000' })
  .option('--host <host>', '监听地址', { default: '127.0.0.1' })
  .action(async (options: { port?: string; host?: string }) => {
    const port = parseInt(options.port || '3000', 10);
    const host = options.host || '127.0.0.1';

    if (Number.isNaN(port) || port < 1 || port > 65535) {
      logger.error(`无效的端口号: ${options.port}`);
      process.exit(1);
    }

    const { startHttpServer } = await import('./mcp/httpServer.js');
    try {
      await startHttpServer(port, host);
      logger.info(`MCP HTTP 服务器已启动在 http://${host}:${port}/mcp`);
      logger.info(`Health check: http://${host}:${port}/health`);
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error(
        { error: error.message, stack: error.stack },
        `HTTP 服务器启动失败: ${error.message}`,
      );
      process.exit(1);
    }
  });

cli
  .command('search-context', '本地检索（参数对齐 MCP）')
  .option('--repo-path <path>', '代码库根目录（默认当前目录）')
  .option('--information-request <text>', '自然语言问题描述（必填）')
  .option('--technical-terms <terms>', '精确术语（逗号分隔）')
  .option('--source-code-only', '仅检索源码语言（排除 markdown/json/yaml 等）')
  .option('--include-languages <langs>', '仅包含指定语言（逗号分隔）')
  .option('--exclude-languages <langs>', '排除指定语言（逗号分隔）')
  .option('--zen', '使用 MCP Zen 配置（默认开启）')
  .action(
    async (options: {
      repoPath?: string;
      informationRequest?: string;
      technicalTerms?: string;
      sourceCodeOnly?: boolean;
      includeLanguages?: string;
      excludeLanguages?: string;
      zen?: boolean;
    }) => {
      const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
      const informationRequest = options.informationRequest;
      if (!informationRequest) {
        logger.error('缺少 --information-request');
        process.exit(1);
      }

      const technicalTerms = (options.technicalTerms || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      // CLI 与工具层统一逗号分隔协议，确保本地检索与 MCP 参数口径一致。
      const includeLanguages = (options.includeLanguages || '')
        .split(',')
        .map((lang) => lang.trim())
        .filter(Boolean);
      const excludeLanguages = (options.excludeLanguages || '')
        .split(',')
        .map((lang) => lang.trim())
        .filter(Boolean);

      const useZen = options.zen !== false;

      const { handleCodebaseRetrieval } = await import('./mcp/tools/codebaseRetrieval.js');

      const response = await handleCodebaseRetrieval(
        {
          repo_path: repoPath,
          information_request: informationRequest,
          technical_terms: technicalTerms.length > 0 ? technicalTerms : undefined,
          source_code_only: options.sourceCodeOnly,
          include_languages: includeLanguages.length > 0 ? includeLanguages : undefined,
          exclude_languages: excludeLanguages.length > 0 ? excludeLanguages : undefined,
        },
        useZen ? undefined : {},
      );

      const text = response.content.map((item) => item.text).join('\n');
      process.stdout.write(`${text}\n`);
      if (response.isError) {
        process.exit(1);
      }
    },
  );

cli
  .command('tune <dataset>', '离线自动调参（RRF 回放）')
  .option('--target <metric>', '优化目标（mrr / recall@k / ndcg@k）', { default: 'mrr' })
  .option('--k <values>', '指标 K 列表（逗号分隔）', { default: '1,3,5' })
  .option('--top <n>', '输出前 N 组候选', { default: '5' })
  .option('--grid <json>', '参数网格 JSON（可选）')
  .action(
    async (
      dataset: string,
      options: {
        target?: string;
        k?: string;
        top?: string;
        grid?: string;
      },
    ) => {
      try {
        const { loadAutoTuneDataset } = await import('./search/eval/autoTuneDataset.js');
        const { runAutoTune } = await import('./search/eval/autoTune.js');

        const kValues = (options.k || '1,3,5')
          .split(',')
          .map((token) => Number(token.trim()))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value));

        if (kValues.length === 0) {
          throw new Error('--k 参数无效，应为正整数列表（如 1,3,5）');
        }

        let parsedGrid: unknown;
        if (options.grid) {
          parsedGrid = JSON.parse(options.grid);
        }

        const cases = await loadAutoTuneDataset(dataset);
        const result = runAutoTune(cases, {
          target: options.target || 'mrr',
          kValues,
          topN: Number(options.top || '5'),
          grid:
            parsedGrid && typeof parsedGrid === 'object' && !Array.isArray(parsedGrid)
              ? (parsedGrid as { wVec?: number[]; rrfK0?: number[]; fusedTopM?: number[] })
              : undefined,
        });

        logger.info(`自动调参完成: candidates=${result.totalCandidates}, target=${result.target}`);
        logger.info(
          `最佳参数: wVec=${result.best.config.wVec}, wLex=${result.best.config.wLex}, rrfK0=${result.best.config.rrfK0}, fusedTopM=${result.best.config.fusedTopM}, score=${result.best.targetScore.toFixed(6)}`,
        );

        process.stdout.write('=== Auto Tune Leaderboard ===\n');
        result.leaderboard.forEach((item, index) => {
          process.stdout.write(
            `${index + 1}. score=${item.targetScore.toFixed(6)} | wVec=${item.config.wVec}, wLex=${item.config.wLex}, rrfK0=${item.config.rrfK0}, fusedTopM=${item.config.fusedTopM}\n`,
          );
        });
      } catch (err) {
        const error = err as { message?: string; stack?: string };
        logger.error({ err, stack: error.stack }, `自动调参失败: ${error.message}`);
        process.exit(1);
      }
    },
  );

cli
  .command('feedback [path]', '查看检索隐式反馈闭环摘要')
  .option('--days <n>', '统计最近 N 天（默认 7）', { default: '7' })
  .option('--top <n>', '展示前 N 个高复用文件（默认 10）', { default: '10' })
  .action(async (targetPath: string | undefined, options: { days?: string; top?: string }) => {
    const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();
    const projectId = generateProjectId(rootPath);

    const days = Math.max(1, Math.floor(Number(options.days || '7')));
    const top = Math.max(1, Math.floor(Number(options.top || '10')));

    try {
      const { initDb } = await import('./db/index.js');
      const { getFeedbackSummary } = await import('./search/feedbackLoop.js');

      const db = initDb(projectId);
      try {
        const summary = getFeedbackSummary(db, { days, top });

        logger.info(
          `反馈摘要: events=${summary.totalEvents}, zeroHitRate=${summary.zeroHitRate.toFixed(4)}, implicitSuccessRate=${summary.implicitSuccessRate.toFixed(4)}, positiveSignals=${summary.positiveSignals}, negativeSignals=${summary.negativeSignals}`,
        );

        process.stdout.write('=== Retrieval Feedback Summary ===\n');
        process.stdout.write(`projectId: ${projectId}\n`);
        process.stdout.write(`days: ${days}\n`);
        process.stdout.write(`totalEvents: ${summary.totalEvents}\n`);
        process.stdout.write(`zeroHitRate: ${summary.zeroHitRate.toFixed(6)}\n`);
        process.stdout.write(`implicitSuccessRate: ${summary.implicitSuccessRate.toFixed(6)}\n`);
        process.stdout.write(`positiveSignals: ${summary.positiveSignals}\n`);
        process.stdout.write(`negativeSignals: ${summary.negativeSignals}\n`);

        if (summary.topFiles.length > 0) {
          process.stdout.write('--- topFiles ---\n');
          summary.topFiles.forEach((item, index) => {
            process.stdout.write(
              `${index + 1}. ${item.filePath} | hits=${item.hitCount} | weight=${item.totalWeight.toFixed(4)}\n`,
            );
          });
        }
      } finally {
        db.close();
      }
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `反馈摘要查询失败: ${error.message}`);
      process.exit(1);
    }
  });

cli
  .command('doctor [path]', '检查向量索引与 chunks_fts 一致性')
  .option('--repair', '删除 chunks_fts 中无对应向量的孤儿记录')
  .action(async (targetPath: string | undefined, options: { repair?: boolean }) => {
    const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();
    const projectId = generateProjectId(rootPath);

    logger.info(`开始一致性检查: ${rootPath}`);
    logger.info(`项目 ID: ${projectId}`);

    try {
      const report = await inspectChunkIndexConsistency(projectId);

      logger.info(
        `一致性报告: vector=${report.vectorCount}, chunks_fts=${report.ftsCount}, missingInFts=${report.missingInFts.length}, missingInVector=${report.missingInVector.length}`,
      );

      if (report.missingInFts.length > 0) {
        logger.warn(
          `检测到 ${report.missingInFts.length} 条向量记录未进入 chunks_fts（建议执行 ace index --force 或增量索引）`,
        );
      }

      if (report.missingInVector.length > 0) {
        logger.warn(`检测到 ${report.missingInVector.length} 条 chunks_fts 孤儿记录`);
      }

      if (options.repair) {
        const fix = await repairChunkIndexConsistency(projectId);
        logger.info(`修复完成: 已删除 ${fix.removedFromFts} 条 chunks_fts 孤儿记录`);
      }
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `一致性检查失败: ${error.message}`);
      process.exit(1);
    }
  });

cli
  .command('git-msg [path]', '生成 AI 驱动的 Git 提交消息')
  .option('--style <style>', '消息风格: conventional, simple, detailed', {
    default: 'conventional',
  })
  .option('--no-body', '不包含详细消息体')
  .action(async (targetPath: string | undefined, options: { style?: string; body?: boolean }) => {
    const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();

    logger.info(`生成提交消息: ${rootPath}`);

    try {
      const { generateCommitMessage } = await import('./git/commitMessage.js');
      const { isGitRepository } = await import('./git/diff.js');

      if (!isGitRepository(rootPath)) {
        logger.error(`${rootPath} 不是 Git 仓库`);
        process.exit(1);
      }

      const style = (options.style as 'conventional' | 'simple' | 'detailed') || 'conventional';
      const includeBody = options.body !== false;

      const message = await generateCommitMessage(rootPath, {
        style,
        includeBody,
      });

      logger.info('生成的提交消息:');
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(message);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('使用此消息:');
      console.log(`  git commit -m "${message.split('\n')[0]}"`);
      console.log('');
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `生成提交消息失败: ${error.message}`);
      process.exit(1);
    }
  });

cli
  .command('tasks [path]', '检测项目中的可运行任务')
  .action(async (targetPath: string | undefined) => {
    const rootPath = targetPath ? path.resolve(targetPath) : process.cwd();

    logger.info(`检测任务: ${rootPath}`);

    try {
      const { detectProjectTasks } = await import('./mcp/tools/detectTasks.js');

      const tasks = detectProjectTasks(rootPath);

      if (tasks.length === 0) {
        logger.warn('未找到任何任务');
        console.log('');
        console.log('支持的文件: package.json, Makefile, justfile, deno.json, Cargo.toml');
        process.exit(0);
      }

      console.log('');
      console.log(`━━━━ 检测到 ${tasks.length} 个任务 ━━━━`);
      console.log('');

      // Group by type
      const grouped = tasks.reduce(
        (acc, task) => {
          if (!acc[task.type]) acc[task.type] = [];
          acc[task.type].push(task);
          return acc;
        },
        {} as Record<string, typeof tasks>,
      );

      for (const [type, typeTasks] of Object.entries(grouped)) {
        console.log(`【${type.toUpperCase()}】 (${typeTasks[0].file})`);
        for (const task of typeTasks) {
          const name = task.name.padEnd(35);
          const desc = task.description || task.command;
          console.log(`  ${name} ${desc}`);
        }
        console.log('');
      }

      console.log('运行任务:');
      console.log(`  ${tasks[0].command}`);
      console.log('');
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `检测任务失败: ${error.message}`);
      process.exit(1);
    }
  });

cli
  .command('token create <userId>', '创建新的 API 访问 token')
  .option('--description <desc>', 'Token 描述')
  .option('--expires-in <days>', 'Token 有效期（天）')
  .action(async (userId: string, options: { description?: string; expiresIn?: string }) => {
    try {
      const { createToken } = await import('./auth/tokenManager.js');

      const expiresInDays = options.expiresIn ? parseInt(options.expiresIn, 10) : undefined;

      const { token, id } = createToken({
        userId,
        description: options.description,
        expiresInDays,
      });

      console.log('');
      console.log('━━━━ Token Created ━━━━');
      console.log('');
      console.log(`Token ID: ${id}`);
      console.log(`User ID:  ${userId}`);
      console.log(`Token:    ${token}`);
      console.log('');
      console.log('⚠️  Save this token securely - it will not be shown again!');
      console.log('');
      console.log('使用示例:');
      console.log(`  curl -H "Authorization: Bearer ${token}" http://localhost:3000/mcp/session`);
      console.log('');
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `创建 token 失败: ${error.message}`);
      process.exit(1);
    }
  });

cli.command('token list <userId>', '列出用户的所有 token').action(async (userId: string) => {
  try {
    const { listTokens } = await import('./auth/tokenManager.js');

    const tokens = listTokens(userId);

    if (tokens.length === 0) {
      console.log('');
      console.log(`用户 ${userId} 没有活跃的 token`);
      console.log('');
      process.exit(0);
    }

    console.log('');
    console.log(`━━━━ Active Tokens for ${userId} ━━━━`);
    console.log('');

    for (const token of tokens) {
      const createdDate = new Date(token.createdAt).toISOString();
      const expiresDate = token.expiresAt ? new Date(token.expiresAt).toISOString() : 'Never';
      const lastUsed = token.lastUsedAt ? new Date(token.lastUsedAt).toISOString() : 'Never';

      console.log(`ID:          ${token.id}`);
      console.log(`Description: ${token.description || 'N/A'}`);
      console.log(`Created:     ${createdDate}`);
      console.log(`Expires:     ${expiresDate}`);
      console.log(`Last used:   ${lastUsed}`);
      console.log('');
    }
  } catch (err) {
    const error = err as { message?: string; stack?: string };
    logger.error({ err, stack: error.stack }, `列出 token 失败: ${error.message}`);
    process.exit(1);
  }
});

cli.command('token revoke <tokenId>', '撤销 token').action(async (tokenId: string) => {
  try {
    const { revokeToken } = await import('./auth/tokenManager.js');

    const revoked = revokeToken(tokenId);

    if (revoked) {
      console.log('');
      console.log(`✓ Token ${tokenId} 已撤销`);
      console.log('');
    } else {
      console.log('');
      console.log(`✗ Token ${tokenId} 不存在或已被撤销`);
      console.log('');
      process.exit(1);
    }
  } catch (err) {
    const error = err as { message?: string; stack?: string };
    logger.error({ err, stack: error.stack }, `撤销 token 失败: ${error.message}`);
    process.exit(1);
  }
});

cli.command('token cleanup', '清理过期的 token').action(async () => {
  try {
    const { cleanupExpiredTokens } = await import('./auth/tokenManager.js');

    const cleaned = cleanupExpiredTokens();

    console.log('');
    console.log(`✓ 清理了 ${cleaned} 个过期 token`);
    console.log('');
  } catch (err) {
    const error = err as { message?: string; stack?: string };
    logger.error({ err, stack: error.stack }, `清理 token 失败: ${error.message}`);
    process.exit(1);
  }
});

cli
  .command('impact <target>', '分析代码变更的影响范围')
  .option('--depth <n>', '分析深度', { default: '2' })
  .option('--json', '输出 JSON 格式')
  .action(async (target: string, options: { depth?: string; json?: boolean }) => {
    const rootPath = process.cwd();
    const projectId = generateProjectId(rootPath);

    const depth = Math.max(1, Math.floor(Number(options.depth || '2')));

    try {
      const { initDb } = await import('./db/index.js');
      const { ImpactGraphService } = await import('./graph/ImpactGraphService.js');

      const db = initDb(projectId);
      try {
        const service = new ImpactGraphService(db);
        const result = await service.analyzeImpact([target], {
          depth,
          includePaths: !options.json,
        });

        if (options.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          console.log('');
          console.log(`━━━━ Impact Analysis: ${target} ━━━━`);
          console.log('');

          if (result.warnings.length > 0) {
            console.log('⚠️  Warnings:');
            for (const warning of result.warnings) {
              console.log(`  ${warning}`);
            }
            console.log('');
          }

          if (result.directTests.length > 0) {
            console.log(`【Direct Tests】 (${result.directTests.length})`);
            for (const test of result.directTests.slice(0, 10)) {
              const score = test.score.toFixed(3);
              const name = test.testName ? `"${test.testName}"` : path.basename(test.filePath);
              console.log(`  ${score}  ${name}`);
              console.log(`       ${test.filePath}:${test.depth}`);
            }
            console.log('');
          }

          if (result.indirectTests.length > 0) {
            console.log(`【Indirect Tests】 (${result.indirectTests.length})`);
            for (const test of result.indirectTests.slice(0, 10)) {
              const score = test.score.toFixed(3);
              const name = test.testName ? `"${test.testName}"` : path.basename(test.filePath);
              console.log(`  ${score}  ${name}`);
              console.log(`       ${test.filePath}:${test.depth}`);
            }
            console.log('');
          }

          if (result.affectedFiles.length > 0) {
            console.log(`【Affected Files】 (${result.affectedFiles.length})`);
            for (const file of result.affectedFiles.slice(0, 10)) {
              const score = file.score.toFixed(3);
              console.log(`  ${score}  ${file.filePath}`);
            }
            console.log('');
          }

          if (result.impactPaths.length > 0) {
            console.log('【Impact Paths】');
            for (const impactPath of result.impactPaths) {
              console.log(`  ${impactPath.description}`);
              console.log(`    ${impactPath.path.join(' → ')}`);
            }
            console.log('');
          }
        }
      } finally {
        db.close();
      }
    } catch (err) {
      const error = err as { message?: string; stack?: string };
      logger.error({ err, stack: error.stack }, `影响分析失败: ${error.message}`);
      process.exit(1);
    }
  });

cli
  .command('affected <target...>', '查找受影响的测试和文件')
  .option('--depth <n>', '分析深度', { default: '2' })
  .option('--json', '输出 JSON 格式')
  .option('--tests-only', '仅显示测试文件')
  .action(
    async (targets: string[], options: { depth?: string; json?: boolean; testsOnly?: boolean }) => {
      const rootPath = process.cwd();
      const projectId = generateProjectId(rootPath);

      const depth = Math.max(1, Math.floor(Number(options.depth || '2')));

      try {
        const { initDb } = await import('./db/index.js');
        const { ImpactGraphService } = await import('./graph/ImpactGraphService.js');

        const db = initDb(projectId);
        try {
          const service = new ImpactGraphService(db);
          const result = await service.analyzeImpact(targets, {
            depth,
            testsOnly: options.testsOnly,
            includePaths: false,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            console.log('');
            console.log(`━━━━ Affected by: ${targets.join(', ')} ━━━━`);
            console.log('');

            if (result.warnings.length > 0) {
              console.log('⚠️  Warnings:');
              for (const warning of result.warnings) {
                console.log(`  ${warning}`);
              }
              console.log('');
            }

            const allTests = [...result.directTests, ...result.indirectTests];
            if (allTests.length > 0) {
              console.log(`【Affected Tests】 (${allTests.length})`);
              for (const test of allTests.slice(0, 20)) {
                const score = test.score.toFixed(3);
                const direct = test.isDirect ? '[direct]' : '[indirect]';
                const name = test.testName ? `"${test.testName}"` : path.basename(test.filePath);
                console.log(`  ${score}  ${direct}  ${name}`);
                console.log(`       ${test.filePath}`);
                console.log(`       ${test.reason}`);
              }
              console.log('');
            } else {
              console.log('No affected tests found.');
              console.log('');
            }

            if (!options.testsOnly && result.affectedFiles.length > 0) {
              console.log(`【Affected Files】 (${result.affectedFiles.length})`);
              for (const file of result.affectedFiles.slice(0, 15)) {
                const score = file.score.toFixed(3);
                console.log(`  ${score}  ${file.filePath}`);
              }
              console.log('');
            }

            if (allTests.length === 0 && result.affectedFiles.length === 0) {
              console.log('💡 Tip: The graph may not be indexed yet. Run "ace index" first.');
              console.log('');
            }
          }
        } finally {
          db.close();
        }
      } catch (err) {
        const error = err as { message?: string; stack?: string };
        logger.error({ err, stack: error.stack }, `查找受影响目标失败: ${error.message}`);
        process.exit(1);
      }
    },
  );

cli.help();
cli.parse();
