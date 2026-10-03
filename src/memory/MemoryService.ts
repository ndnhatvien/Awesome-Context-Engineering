/**
 * Memory Service & Working Context Compiler
 *
 * Implements Four-Layer Memory Architecture for AI Agents:
 * - Layer 1: Working Context (Compiled on-demand with priority-based budgeting)
 * - Layer 2: Episodic Memory (Recent decisions and milestones)
 * - Layer 3: Semantic Memory (Project architecture and constraints)
 * - Layer 4: Procedural Memory (What failed / What worked)
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import type {
  CompileContextOptions,
  CompiledContext,
  MemoryCategory,
  MemoryItem,
  QueryMemoryOptions,
  RecordMemoryInput,
} from './types.js';

interface RawMemoryRow {
  id: string;
  category: string;
  title: string;
  content: string;
  target_files: string;
  tags: string;
  priority: number;
  created_at: number;
  updated_at: number;
}

export class MemoryService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 将数据库行转换为 MemoryItem 结构
   */
  private rowToItem(row: RawMemoryRow): MemoryItem {
    let targetFiles: string[] = [];
    let tags: string[] = [];
    try {
      targetFiles = JSON.parse(row.target_files);
    } catch {
      targetFiles = [];
    }
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }

    return {
      id: row.id,
      category: row.category as MemoryCategory,
      title: row.title,
      content: row.content,
      targetFiles,
      tags,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 记录一条新的记忆（Procedural / Semantic / Episodic）
   */
  recordMemory(input: RecordMemoryInput): MemoryItem {
    const id = `mem_${input.category}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();
    const targetFilesJson = JSON.stringify(input.targetFiles ?? []);
    const tagsJson = JSON.stringify(input.tags ?? []);
    const priority = input.priority ?? (input.category === 'constraint' ? 80 : 50);

    const stmt = this.db.prepare(`
      INSERT INTO agent_memory (id, category, title, content, target_files, tags, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.category,
      input.title,
      input.content,
      targetFilesJson,
      tagsJson,
      priority,
      now,
      now,
    );

    logger.info({ id, category: input.category, title: input.title }, '记录 Agent 记忆成功');

    return {
      id,
      category: input.category,
      title: input.title,
      content: input.content,
      targetFiles: input.targetFiles ?? [],
      tags: input.tags ?? [],
      priority,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 按 ID 查询记忆
   */
  getMemory(id: string): MemoryItem | null {
    const row = this.db.prepare('SELECT * FROM agent_memory WHERE id = ?').get(id) as
      | RawMemoryRow
      | undefined;
    return row ? this.rowToItem(row) : null;
  }

  /**
   * 删除记忆
   */
  deleteMemory(id: string): boolean {
    const res = this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * 列表查询记忆
   */
  listMemories(category?: MemoryCategory, limit = 50): MemoryItem[] {
    let rows: RawMemoryRow[];
    if (category) {
      rows = this.db
        .prepare(
          'SELECT * FROM agent_memory WHERE category = ? ORDER BY priority DESC, created_at DESC LIMIT ?',
        )
        .all(category, limit) as RawMemoryRow[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM agent_memory ORDER BY priority DESC, created_at DESC LIMIT ?')
        .all(limit) as RawMemoryRow[];
    }
    return rows.map((r) => this.rowToItem(r));
  }

  /**
   * 检索与当前任务/文件相关的记忆（FTS + 关联文件加权）
   */
  findRelevantMemories(options: QueryMemoryOptions): MemoryItem[] {
    const { query, category, targetFiles, tags, limit = 10 } = options;

    let candidateRows: RawMemoryRow[] = [];

    if (query && query.trim().length > 0) {
      // 尝试 FTS 检索
      try {
        const sanitized = query.replace(/[^\w\s\u4e00-\u9fa5]/g, ' ').trim();
        const ftsQuery = sanitized.split(/\s+/).filter(Boolean).slice(0, 5).join(' OR ');

        if (ftsQuery) {
          candidateRows = this.db
            .prepare(`
              SELECT m.* FROM agent_memory m
              JOIN agent_memory_fts f ON m.id = f.id
              WHERE agent_memory_fts MATCH ?
              ${category ? 'AND m.category = ?' : ''}
              LIMIT ?
            `)
            .all(
              ...(category ? [ftsQuery, category, limit * 3] : [ftsQuery, limit * 3]),
            ) as RawMemoryRow[];
        }
      } catch (err) {
        logger.debug({ error: (err as Error).message }, 'FTS 记忆检索降级');
      }
    }

    // 若 FTS 无结果或未提供 query，回退到按类别与文件匹配
    if (candidateRows.length === 0) {
      if (category) {
        candidateRows = this.db
          .prepare('SELECT * FROM agent_memory WHERE category = ? ORDER BY priority DESC LIMIT ?')
          .all(category, limit * 3) as RawMemoryRow[];
      } else {
        candidateRows = this.db
          .prepare('SELECT * FROM agent_memory ORDER BY priority DESC LIMIT ?')
          .all(limit * 3) as RawMemoryRow[];
      }
    }

    const items = candidateRows.map((r) => this.rowToItem(r));

    // 计算综合相关性得分
    const scored = items.map((item) => {
      let score = item.priority * 1.0;

      // 关联文件匹配加权
      if (targetFiles && targetFiles.length > 0 && item.targetFiles.length > 0) {
        const hasFileMatch = item.targetFiles.some((tf) =>
          targetFiles.some((f) => f.includes(tf) || tf.includes(f)),
        );
        if (hasFileMatch) {
          score += 50;
        }
      }

      // 标签匹配加权
      if (tags && tags.length > 0 && item.tags.length > 0) {
        const hasTagMatch = item.tags.some((t) => tags.includes(t));
        if (hasTagMatch) {
          score += 30;
        }
      }

      // 强规则约束保障
      if (item.category === 'constraint') {
        score += 40;
      }

      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.item);
  }

  /**
   * 编译 Working Context (Layer 1)
   *
   * 基于优先级阶段化预算修剪（Priority-based Truncation）：
   * - 100: Header & Project Info
   * - 90: Current Task & Target
   * - 80: Constraints & Rules (Semantic Memory)
   * - 70: Known Failures to Avoid (Procedural Memory)
   * - 60: Proven Strategies (Procedural Memory)
   * - 50: Recent Decisions (Episodic Memory)
   */
  compileWorkingContext(options: CompileContextOptions): CompiledContext {
    const { task, targetFiles, maxChars = 6000, includeCategories } = options;

    const sections: Array<{
      name: string;
      priority: number;
      content: string;
    }> = [];

    // Header (100)
    sections.push({
      name: 'header',
      priority: 100,
      content:
        '# 🧠 ACE Working Context (Computed Memory Snapshot)\n> Cache-stable context compiled on-demand. Stale history pruned.',
    });

    // Current Task (90)
    if (task && task.trim()) {
      sections.push({
        name: 'task',
        priority: 90,
        content: `## 🎯 Current Task / Objective\n${task.trim()}`,
      });
    }

    // 检索相关记忆
    const memories = this.findRelevantMemories({
      query: task,
      targetFiles,
      limit: 20,
    });

    // 按类别分组
    const constraints = memories.filter((m) => m.category === 'constraint');
    const failures = memories.filter((m) => m.category === 'failure');
    const strategies = memories.filter((m) => m.category === 'strategy');
    const decisions = memories.filter((m) => m.category === 'decision');

    // Constraints (80)
    if (
      constraints.length > 0 &&
      (!includeCategories || includeCategories.includes('constraint'))
    ) {
      const itemsText = constraints
        .slice(0, 5)
        .map((c) => `- **${c.title}**: ${c.content}`)
        .join('\n');
      sections.push({
        name: 'constraints',
        priority: 80,
        content: `## 🛡️ Project Constraints & Rules (Semantic Memory)\n${itemsText}`,
      });
    }

    // Failures (70)
    if (failures.length > 0 && (!includeCategories || includeCategories.includes('failure'))) {
      const itemsText = failures
        .slice(0, 5)
        .map((f) => {
          const filesHint = f.targetFiles.length > 0 ? ` [${f.targetFiles.join(', ')}]` : '';
          return `- ❌ **${f.title}**${filesHint}: ${f.content}`;
        })
        .join('\n');
      sections.push({
        name: 'failures',
        priority: 70,
        content: `## ⚠️ Known Failures to Avoid (Procedural Memory)\n${itemsText}`,
      });
    }

    // Strategies (60)
    if (strategies.length > 0 && (!includeCategories || includeCategories.includes('strategy'))) {
      const itemsText = strategies
        .slice(0, 4)
        .map((s) => {
          const filesHint = s.targetFiles.length > 0 ? ` [${s.targetFiles.join(', ')}]` : '';
          return `- 💡 **${s.title}**${filesHint}: ${s.content}`;
        })
        .join('\n');
      sections.push({
        name: 'strategies',
        priority: 60,
        content: `## ✨ Proven Strategies & Patterns (Procedural Memory)\n${itemsText}`,
      });
    }

    // Decisions (50)
    if (decisions.length > 0 && (!includeCategories || includeCategories.includes('decision'))) {
      const itemsText = decisions
        .slice(0, 3)
        .map((d) => `- 📝 **${d.title}**: ${d.content}`)
        .join('\n');
      sections.push({
        name: 'decisions',
        priority: 50,
        content: `## 📌 Recent Decisions & Context (Episodic Memory)\n${itemsText}`,
      });
    }

    // 执行优先级预算裁剪
    let totalChars = sections.reduce((acc, s) => acc + s.content.length + 2, 0);
    let truncated = false;

    // 当超出预算时，从最低优先级章节开始移除
    if (totalChars > maxChars) {
      truncated = true;
      // 排序：最低优先级在前
      const sortedByLowest = [...sections].sort((a, b) => a.priority - b.priority);

      for (const section of sortedByLowest) {
        if (totalChars <= maxChars) break;
        // 关键核心章节（>=80）不整章移除
        if (section.priority >= 80) continue;

        const idx = sections.indexOf(section);
        if (idx !== -1) {
          totalChars -= section.content.length + 2;
          sections.splice(idx, 1);
        }
      }

      // 如果依然超出，截断剩余较低优先级章节内容
      if (totalChars > maxChars) {
        for (const section of sections) {
          if (totalChars <= maxChars) break;
          if (section.priority === 100) continue;

          const excess = totalChars - maxChars;
          const allowedLen = Math.max(100, section.content.length - excess);
          if (allowedLen < section.content.length) {
            const cutIndex = section.content.lastIndexOf('\n', allowedLen);
            const trimPoint = cutIndex > 50 ? cutIndex : allowedLen;
            totalChars -= section.content.length - trimPoint;
            section.content = `${section.content.slice(0, trimPoint)}\n[...truncated for budget]`;
          }
        }
      }
    }

    // 按高优先级在前组装 Cache-stable Markdown
    sections.sort((a, b) => b.priority - a.priority);
    const markdown = sections.map((s) => s.content).join('\n\n');
    const estimatedTokens = Math.round(markdown.length / 4);

    return {
      markdown,
      itemCount: memories.length,
      estimatedTokens,
      truncated,
    };
  }

  /**
   * 格式化简要 Memory 块，专用于注入 codebase-retrieval 结果头部
   */
  formatMemoryForContext(memories: MemoryItem[]): string {
    if (memories.length === 0) return '';

    const lines: string[] = ['### 🧠 Agent Memory (Relevant Lessons & Rules)'];

    const failures = memories.filter((m) => m.category === 'failure');
    const strategies = memories.filter((m) => m.category === 'strategy');
    const constraints = memories.filter((m) => m.category === 'constraint');

    if (constraints.length > 0) {
      lines.push('**Project Rules**:');
      for (const c of constraints.slice(0, 3)) {
        lines.push(`- 🛡️ **${c.title}**: ${c.content}`);
      }
    }

    if (failures.length > 0) {
      lines.push('**Avoid Known Mistakes**:');
      for (const f of failures.slice(0, 3)) {
        const hint = f.targetFiles.length > 0 ? ` (${f.targetFiles[0]})` : '';
        lines.push(`- ❌ **${f.title}**${hint}: ${f.content}`);
      }
    }

    if (strategies.length > 0) {
      lines.push('**Verified Strategies**:');
      for (const s of strategies.slice(0, 2)) {
        lines.push(`- 💡 **${s.title}**: ${s.content}`);
      }
    }

    return lines.join('\n');
  }
}
