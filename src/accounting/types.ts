/**
 * Token/Cost Accounting Types
 *
 * Defines types for tracking token savings and costs across different buckets.
 */

export type SavingsBucket =
  | 'retrieval'
  | 'chunk_compression'
  | 'grammar_compression'
  | 'turn_summarization'
  | 'progressive_disclosure'
  | 'output_compression'
  | 'memory_recall';

export interface SavingsEntry {
  id?: number;
  projectId: string;
  sessionId: string;
  timestamp: number;
  bucket: SavingsBucket;
  tokensBaseline: number;
  tokensActual: number;
  tokensSaved: number;
  dollarsSaved: number;
  model: string;
}

export interface SavingsSummary {
  projectId: string;
  totalTokensSaved: number;
  totalDollarsSaved: number;
  byBucket: Map<SavingsBucket, BucketSummary>;
  byModel: Map<string, ModelSummary>;
  sessionCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface BucketSummary {
  bucket: SavingsBucket;
  tokensSaved: number;
  dollarsSaved: number;
  percentage: number;
}

export interface ModelSummary {
  model: string;
  tokensSaved: number;
  dollarsSaved: number;
  queriesCount: number;
}

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  startedAt: number;
  endedAt: number | null;
  model: string;
  totalTokensSaved: number;
  totalDollarsSaved: number;
  eventCount: number;
}
