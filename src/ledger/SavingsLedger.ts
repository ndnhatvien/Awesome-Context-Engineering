/**
 * SavingsLedger - Token 节约与多模型成本追踪服务
 *
 * 灵感来源于 elara-labs/code-context-engine:
 * "Actual tokens served vs full-file baseline, broken down by buckets with dollar costs"
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  type ModelPricing,
  type SavingsCategory,
  type SavingsRecord,
  type SavingsSummary,
  SUPPORTED_MODEL_PRICING,
} from './types.js';

export class SavingsLedger {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 估算代码文本的 Token 数量（业界通用经验值：代码约为 3.8 字符 / Token）
   */
  public static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    // 对代码进行轻量分词辅助估算
    return Math.max(1, Math.ceil(text.length / 3.8));
  }

  /**
   * 计算指定 Token 节省量对应的美元价值
   */
  public static calculateCostUsd(tokens: number, modelName = 'claude-3-5-sonnet'): number {
    const pricing: ModelPricing =
      SUPPORTED_MODEL_PRICING[modelName] || SUPPORTED_MODEL_PRICING['claude-3-5-sonnet'];
    return (tokens / 1_000_000) * pricing.inputPerMillion;
  }

  /**
   * 记录一次 Token 节约事件
   */
  public record(input: {
    projectId: string;
    query: string;
    category: SavingsCategory;
    baselineTokens: number;
    deliveredTokens: number;
    details?: Record<string, unknown>;
  }): SavingsRecord {
    const id = `sav_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const timestamp = Date.now();
    const savedTokens = Math.max(0, input.baselineTokens - input.deliveredTokens);
    const costSavedUsd = SavingsLedger.calculateCostUsd(savedTokens);

    const stmt = this.db.prepare(`
      INSERT INTO savings_ledger (
        id, timestamp, project_id, query, category,
        baseline_tokens, delivered_tokens, saved_tokens, cost_saved_usd, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      timestamp,
      input.projectId,
      input.query,
      input.category,
      input.baselineTokens,
      input.deliveredTokens,
      savedTokens,
      costSavedUsd,
      input.details ? JSON.stringify(input.details) : null,
    );

    return {
      id,
      timestamp,
      projectId: input.projectId,
      query: input.query,
      category: input.category,
      baselineTokens: input.baselineTokens,
      deliveredTokens: input.deliveredTokens,
      savedTokens,
      costSavedUsd,
      details: input.details,
    };
  }

  /**
   * 获取项目的 Token 节约统计摘要
   */
  public getSummary(projectId?: string, days = 30): SavingsSummary {
    const sinceTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

    let querySql = `
      SELECT 
        category,
        COUNT(*) as query_count,
        SUM(baseline_tokens) as total_baseline,
        SUM(delivered_tokens) as total_delivered,
        SUM(saved_tokens) as total_saved,
        SUM(cost_saved_usd) as total_cost
      FROM savings_ledger
      WHERE timestamp >= ?
    `;
    const params: unknown[] = [sinceTimestamp];

    if (projectId) {
      querySql += ' AND project_id = ?';
      params.push(projectId);
    }
    querySql += ' GROUP BY category';

    interface RowType {
      category: SavingsCategory;
      query_count: number;
      total_baseline: number;
      total_delivered: number;
      total_saved: number;
      total_cost: number;
    }

    const rows = this.db.prepare(querySql).all(...params) as RowType[];

    let totalQueries = 0;
    let baselineTokens = 0;
    let deliveredTokens = 0;
    let savedTokens = 0;

    const breakdownByCategory: Record<
      SavingsCategory,
      { savedTokens: number; count: number; costSavedUsd: number }
    > = {
      retrieval: { savedTokens: 0, count: 0, costSavedUsd: 0 },
      chunk_compression: { savedTokens: 0, count: 0, costSavedUsd: 0 },
      memory: { savedTokens: 0, count: 0, costSavedUsd: 0 },
      impact: { savedTokens: 0, count: 0, costSavedUsd: 0 },
    };

    for (const r of rows) {
      totalQueries += r.query_count;
      baselineTokens += r.total_baseline;
      deliveredTokens += r.total_delivered;
      savedTokens += r.total_saved;

      if (breakdownByCategory[r.category]) {
        breakdownByCategory[r.category] = {
          savedTokens: r.total_saved,
          count: r.query_count,
          costSavedUsd: r.total_cost,
        };
      }
    }

    const savingsRatio = baselineTokens > 0 ? savedTokens / baselineTokens : 0;
    const costSavedUsd = SavingsLedger.calculateCostUsd(savedTokens, 'claude-3-5-sonnet');

    // 计算各模型对应的节约金额
    const costByModel: Record<string, number> = {};
    for (const [model] of Object.entries(SUPPORTED_MODEL_PRICING)) {
      costByModel[model] = SavingsLedger.calculateCostUsd(savedTokens, model);
    }

    return {
      projectId: projectId || 'all',
      totalQueries,
      baselineTokens,
      deliveredTokens,
      savedTokens,
      savingsRatio,
      costSavedUsd,
      costByModel,
      breakdownByCategory,
    };
  }

  /**
   * 格式化终端精美报表（包含 ASCII/Unicode 条形图）
   */
  public static formatTerminalReport(
    summary: SavingsSummary,
    preferredModel = 'claude-3-5-sonnet',
  ): string {
    const formatNumber = (num: number): string => {
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
      return num.toLocaleString();
    };

    const percentage = (summary.savingsRatio * 100).toFixed(1);
    const cost = (summary.costByModel[preferredModel] ?? summary.costSavedUsd).toFixed(2);

    const makeBar = (ratio: number, width = 14): string => {
      const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
      return '▰'.repeat(filled) + '▱'.repeat(width - filled);
    };

    const lines: string[] = [];
    lines.push('\n━━━━ ⚡ ACE Token Savings & Cost Ledger (CCE Engine) ━━━━\n');
    lines.push(
      `  Project:           ${summary.projectId} (${summary.totalQueries} recorded queries)`,
    );
    lines.push(
      `  Baseline Tokens:   ${formatNumber(summary.baselineTokens)} (reading full source files)`,
    );
    lines.push(
      `  Delivered Tokens:  ${formatNumber(summary.deliveredTokens)} (compact chunks & context)`,
    );
    lines.push(
      `  Total Saved:       ${formatNumber(summary.savedTokens)} tokens (${percentage}% reduction)`,
    );
    lines.push(`  Cost Saved:        $${cost} (based on ${preferredModel})\n`);

    lines.push('  Breakdown by Layer:');
    const categories: Array<{ key: SavingsCategory; label: string }> = [
      { key: 'retrieval', label: 'Retrieval (Full vs Chunks)' },
      { key: 'chunk_compression', label: 'Skeleton Compression' },
      { key: 'memory', label: 'Procedural Memory' },
      { key: 'impact', label: 'Impact Graph & Slicing' },
    ];

    for (const cat of categories) {
      const data = summary.breakdownByCategory[cat.key];
      const ratio = summary.savedTokens > 0 ? data.savedTokens / summary.savedTokens : 0;
      const pct = (ratio * 100).toFixed(1);
      const catCost = (
        (data.savedTokens / 1_000_000) *
        (SUPPORTED_MODEL_PRICING[preferredModel]?.inputPerMillion ?? 3.0)
      ).toFixed(2);
      lines.push(
        `    ${cat.label.padEnd(26)} ${makeBar(ratio)}  ${pct.padStart(5)}%  ${formatNumber(data.savedTokens).padStart(7)} ($${catCost}) · ${data.count} calls`,
      );
    }

    lines.push('\n  Cost Estimates Across Providers:');
    lines.push(
      `    Claude 3.5 Sonnet:  $${(summary.costByModel['claude-3-5-sonnet'] ?? 0).toFixed(2)}`,
    );
    lines.push(
      `    Claude 3 Opus:      $${(summary.costByModel['claude-3-opus'] ?? 0).toFixed(2)}`,
    );
    lines.push(`    GPT-4o:             $${(summary.costByModel['gpt-4o'] ?? 0).toFixed(2)}`);
    lines.push(
      `    Gemini 2.5 Pro:     $${(summary.costByModel['gemini-2.5-pro'] ?? 0).toFixed(2)}`,
    );
    lines.push(`    DeepSeek V3:        $${(summary.costByModel['deepseek-v3'] ?? 0).toFixed(2)}`);
    lines.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return lines.join('\n');
  }
}
