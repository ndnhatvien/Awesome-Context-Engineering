/**
 * Exact Symbol Recall - 精确符号召回
 *
 * 移植自 OCE 的 symbol_occurrences + ExactSearchStore 机制：
 * - 索引期：从每个 chunk 的 display_code 用多语言规则抽取符号声明，
 *   展开变体（camelCase/snake_case/去分隔符）后写入 symbol_occurrences 表。
 * - 检索期：从 query 提取代码标识符，对符号表做 NOCASE 精确匹配，
 *   把命中 chunk 以高基准分并入候选，让"精确符号"优先进入 rerank 窗口。
 *
 * MVP（best-effort）：规则基于正则，非全量 AST；覆盖主流语言声明写法。
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { segmentQuery } from './fts.js';

export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'type'
  | 'module';

/** symbol_occurrences 表的一行 */
export interface SymbolRow {
  symbolName: string;
  kind: SymbolKind;
  filePath: string;
  chunkId: string;
  language: string;
}

/** 符号抽取规则：`^` 锚定行首，第一捕获组为符号名 */
interface ExtractionRule {
  re: RegExp;
  kind: SymbolKind;
}

// ===========================================
// 多语言声明抽取规则
// ===========================================

const TS_JS_RULES: ExtractionRule[] = [
  {
    re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    kind: 'function',
  },
  { re: /^(?:export\s+)?default\s+class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^(?:export\s+)?(?:abstract\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  { re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  {
    re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    kind: 'function',
  },
];

const RULES: Record<string, ExtractionRule[]> = {
  typescript: TS_JS_RULES,
  javascript: TS_JS_RULES,
  python: [
    { re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class' },
  ],
  go: [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: 'function' },
    { re: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: 'struct' },
    { re: /^type\s+([A-Za-z_]\w*)\s+interface\b/, kind: 'interface' },
  ],
  rust: [
    { re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct' },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: 'trait' },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: 'type' },
    { re: /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: 'module' },
  ],
  java: [
    {
      re: /^(?:(?:public|private|protected|static|final|abstract|sealed|synchronized)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/,
      kind: 'class',
    },
  ],
  c_sharp: [
    {
      re: /^(?:(?:public|private|protected|internal|static|readonly|sealed|abstract|partial)\s+)*(?:class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/,
      kind: 'class',
    },
  ],
  cpp: [{ re: /^(?:(?:struct|class|enum|union)\s+)([A-Za-z_]\w*)/, kind: 'class' }],
  c: [{ re: /^(?:(?:struct|enum|union)\s+)([A-Za-z_]\w*)/, kind: 'class' }],
  kotlin: [
    { re: /^fun\s+([A-Za-z_]\w*)/, kind: 'function' },
    {
      re: /^(?:data\s+|sealed\s+|abstract\s+|open\s+|final\s+|public\s+|private\s+|internal\s+)*(?:class|interface|enum\s+class|object)\s+([A-Za-z_]\w*)/,
      kind: 'class',
    },
    {
      re: /^(?:data\s+|sealed\s+|abstract\s+|open\s+|final\s+)*enum\s+class\s+([A-Za-z_]\w*)/,
      kind: 'enum',
    },
  ],
  swift: [
    {
      re: /^(?:public|private|internal|fileprivate|open)?\s*(?:static\s+)?func\s+([A-Za-z_]\w*)/,
      kind: 'function',
    },
    {
      re: /^(?:public|private|internal|fileprivate|open)?\s*(?:final\s+)?(?:class|struct|enum|protocol)\s+([A-Za-z_]\w*)/,
      kind: 'class',
    },
  ],
  php: [
    { re: /^function\s+([A-Za-z_]\w*)\s*\(/, kind: 'function' },
    { re: /^(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/, kind: 'class' },
    { re: /^(?:interface|trait)\s+([A-Za-z_]\w*)/, kind: 'interface' },
  ],
  ruby: [
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class' },
    { re: /^module\s+([A-Za-z_]\w*)/, kind: 'module' },
    { re: /^def\s+(?:self\.)?([A-Za-z_]\w*)/, kind: 'method' },
  ],
  dart: [
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class' },
    { re: /^enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^mixin\s+([A-Za-z_]\w*)/, kind: 'class' },
    { re: /^typedef\s+([A-Za-z_]\w*)\s*=/, kind: 'type' },
  ],
};

/** 未知语言兜底规则（覆盖主流关键字式声明） */
const FALLBACK_RULES: ExtractionRule[] = [
  { re: /^(?:export\s+)?(?:async\s+)?(?:function|def|fn|fun)\s+([A-Za-z_]\w*)/, kind: 'function' },
  {
    re: /^(?:export\s+)?(?:class|interface|enum|struct|trait|record)\s+([A-Za-z_]\w*)/,
    kind: 'class',
  },
];

/** 每行跳过注释前缀 */
const COMMENT_PREFIXES = ['//', '/*', '*', '#'];
/** 每 chunk 最多抽取的符号数（防止极小 chunk 注入海量符号） */
const MAX_SYMBOLS_PER_CHUNK = 50;

// ===========================================
// 符号名变体扩展
// ===========================================

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function toCamelCase(value: string): string {
  return value.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 展开符号名变体，保证 camelCase/snake_case/去分隔符等写法都能命中：
 * SearchService → searchservice / search_service / searchService
 */
export function expandSymbolVariants(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name);
  variants.add(name.toLowerCase());

  if (/[a-z][A-Z]/.test(name)) {
    variants.add(toSnakeCase(name));
  }
  if (name.includes('_')) {
    variants.add(toCamelCase(name));
  }
  const stripped = name.replace(/[._-]/g, '').toLowerCase();
  if (stripped.length > 0) variants.add(stripped);

  return Array.from(variants).filter((v) => v.length > 0);
}

// ===========================================
// 索引期：从 chunk 抽取符号
// ===========================================

/**
 * 从 chunk 的 display_code 抽取符号声明并展开变体，生成 symbol_occurrences 行
 */
export function extractChunkSymbols(
  displayCode: string,
  language: string,
  filePath: string,
  chunkId: string,
): SymbolRow[] {
  const rules = RULES[language] ?? FALLBACK_RULES;
  if (!displayCode || rules.length === 0) return [];

  const rows: SymbolRow[] = [];

  for (const rawLine of displayCode.split('\n')) {
    if (rows.length >= MAX_SYMBOLS_PER_CHUNK) break;
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (COMMENT_PREFIXES.some((p) => line.startsWith(p))) continue;

    for (const rule of rules) {
      const m = line.match(rule.re);
      const symbolName = m?.[1];
      if (symbolName) {
        for (const name of expandSymbolVariants(symbolName)) {
          rows.push({
            symbolName: name,
            kind: rule.kind,
            filePath,
            chunkId,
            language,
          });
        }
        break; // 一行只记一个符号（best-effort）
      }
    }
  }

  return rows;
}

// ===========================================
// 表结构初始化与 CRUD
// ===========================================

/** 初始化 symbol_occurrences 表与索引 */
export function initSymbolTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_occurrences (
      symbol_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      language TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbol_occurrences(symbol_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbol_occurrences(file_path)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_symbols_chunk ON symbol_occurrences(chunk_id)');
}

/** 检查 symbol_occurrences 表是否已初始化 */
export function isSymbolTableInitialized(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='symbol_occurrences'`)
    .get();
  return !!row;
}

/** 批量 upsert 符号（按文件先删后插，保证文件级一致性） */
export function batchUpsertSymbols(db: Database.Database, rows: SymbolRow[]): void {
  if (rows.length === 0) return;

  const files = Array.from(new Set(rows.map((r) => r.filePath)));
  const deleteStmt = db.prepare('DELETE FROM symbol_occurrences WHERE file_path = ?');
  const insertStmt = db.prepare(
    `INSERT INTO symbol_occurrences(symbol_name, kind, file_path, chunk_id, language)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const transaction = db.transaction((items: SymbolRow[]) => {
    for (const file of files) {
      deleteStmt.run(file);
    }
    for (const item of items) {
      insertStmt.run(item.symbolName, item.kind, item.filePath, item.chunkId, item.language);
    }
  });

  transaction(rows);
}

/** 删除指定文件的全部符号 */
export function batchDeleteFileSymbols(db: Database.Database, filePaths: string[]): void {
  if (filePaths.length === 0) return;
  const stmt = db.prepare('DELETE FROM symbol_occurrences WHERE file_path = ?');
  const transaction = db.transaction((paths: string[]) => {
    for (const p of paths) stmt.run(p);
  });
  transaction(filePaths);
}

// ===========================================
// 检索期：精确符号匹配
// ===========================================

/** 查询式中的常见停用词（过滤自然语言词，保留代码标识符） */
const STOP_WORDS = new Set([
  'the',
  'is',
  'are',
  'which',
  'where',
  'what',
  'how',
  'find',
  'show',
  'list',
  'get',
  'set',
  'file',
  'files',
  'code',
  'using',
  'with',
  'from',
  'this',
  'that',
  'does',
  'do',
  'and',
  'or',
  'for',
  'to',
  'why',
  'when',
  'should',
  'about',
  'into',
  'like',
  'please',
  'can',
  'you',
  'use',
  'used',
  'implement',
  'search',
  'query',
  'main',
  'common',
  'default',
]);

/**
 * 从 query 提取可能的代码标识符
 *
 * 复用 segmentQuery 的分词与变体，再过滤自然语言词与号文散件，
 * 仅保留形如 SearchService / api_key / graphexpander 的标识符候选。
 */
export function extractSymbolIdentifiers(query: string): string[] {
  const identifiers: string[] = [];
  const seen = new Set<string>();

  for (const token of segmentQuery(query)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) continue;
    if (token.length < 2) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    identifiers.push(token);
    if (identifiers.length >= 8) break;
  }

  return identifiers;
}

/** 符号检索结果（已按 chunk 去重） */
export interface SymbolHit {
  symbolName: string;
  kind: SymbolKind;
  filePath: string;
  chunkId: string;
  language: string;
}

/**
 * 对标识符集合做精确匹配（NOCASE）
 *
 * @param perIdentLimit 每个标识符最多返回的命中行数
 */
export function searchSymbolOccurrences(
  db: Database.Database,
  identifiers: string[],
  perIdentLimit: number,
): SymbolHit[] {
  if (identifiers.length === 0) return [];

  const stmt = db.prepare(
    `SELECT symbol_name, kind, file_path, chunk_id, language
     FROM symbol_occurrences
     WHERE symbol_name = ? COLLATE NOCASE
     LIMIT ?`,
  );

  type SymbolRowRaw = {
    symbol_name: string;
    kind: SymbolKind;
    file_path: string;
    chunk_id: string;
    language: string;
  };

  const rawHits = ([] as SymbolRowRaw[]).concat(
    ...identifiers.map((ident) => stmt.all(ident, perIdentLimit) as SymbolRowRaw[]),
  );

  const hits: SymbolHit[] = [];
  const seenChunks = new Set<string>();
  for (const row of rawHits) {
    if (seenChunks.has(row.chunk_id)) continue;
    seenChunks.add(row.chunk_id);
    hits.push({
      symbolName: row.symbol_name,
      kind: row.kind,
      filePath: row.file_path,
      chunkId: row.chunk_id,
      language: row.language,
    });
  }

  logger.debug({ identifiers, hitCount: hits.length }, 'Exact Symbol Recall 检索');

  return hits;
}
