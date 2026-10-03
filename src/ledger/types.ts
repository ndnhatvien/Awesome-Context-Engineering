/**
 * Savings Ledger 类型定义
 *
 * 灵感来源于 elara-labs/code-context-engine: "Token Savings Ledger & Multi-Provider Dollar Cost Tracker"
 */

export type SavingsCategory =
  | 'retrieval' // 检索阶段：全文件 vs 相关 chunk
  | 'chunk_compression' // 骨架压缩：完整函数体 vs 签名文档
  | 'memory' // 记忆织入：规避历史反复排查与错误 Token 浪费
  | 'impact'; // 变更影响分析：定向测试定位 vs 全量盲测

export interface SavingsRecord {
  id: string;
  timestamp: number;
  projectId: string;
  query: string;
  category: SavingsCategory;
  baselineTokens: number;
  deliveredTokens: number;
  savedTokens: number;
  costSavedUsd: number;
  details?: Record<string, unknown>;
}

export interface ModelPricing {
  inputPerMillion: number;
}

export const SUPPORTED_MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-sonnet': { inputPerMillion: 3.0 },
  'claude-3-opus': { inputPerMillion: 15.0 },
  'claude-3-5-haiku': { inputPerMillion: 0.8 },
  'gpt-4o': { inputPerMillion: 2.5 },
  'gpt-4o-mini': { inputPerMillion: 0.15 },
  'gemini-2.5-pro': { inputPerMillion: 1.25 },
  'deepseek-v3': { inputPerMillion: 0.14 },
};

export interface SavingsSummary {
  projectId: string;
  totalQueries: number;
  baselineTokens: number;
  deliveredTokens: number;
  savedTokens: number;
  savingsRatio: number; // 例如 0.89 表示 89%
  costSavedUsd: number; // 默认 Sonnet 计算
  costByModel: Record<string, number>;
  breakdownByCategory: Record<
    SavingsCategory,
    {
      savedTokens: number;
      count: number;
      costSavedUsd: number;
    }
  >;
}
