/**
 * Agent Memory Types (Based on Four-Layer Memory Architecture)
 *
 * 1. Working Context: Current task context, compiled on-demand
 * 2. Episodic Memory: Recent decisions, sessions, and events
 * 3. Semantic Memory: Project architecture facts and constraints
 * 4. Procedural Memory: What worked (strategies) and what failed (failures to avoid)
 */

export type MemoryCategory = 'failure' | 'strategy' | 'constraint' | 'decision';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  targetFiles: string[];
  tags: string[];
  priority: number; // 0 to 100
  createdAt: number;
  updatedAt: number;
}

export interface RecordMemoryInput {
  category: MemoryCategory;
  title: string;
  content: string;
  targetFiles?: string[];
  tags?: string[];
  priority?: number;
}

export interface QueryMemoryOptions {
  query?: string;
  category?: MemoryCategory;
  targetFiles?: string[];
  tags?: string[];
  limit?: number;
}

export interface CompileContextOptions {
  task?: string;
  targetFiles?: string[];
  maxChars?: number;
  includeCategories?: MemoryCategory[];
}

export interface CompiledContext {
  markdown: string;
  itemCount: number;
  estimatedTokens: number;
  truncated: boolean;
}
