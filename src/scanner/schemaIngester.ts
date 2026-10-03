/**
 * Database Schema & DDL Ingestion
 *
 * Inspired by mnemosyne: ingests SQL DDL definitions (CREATE TABLE, columns,
 * foreign keys, indices) into structured semantic chunks.
 *
 * Enables AI agents to accurately bridge code logic with relational schemas:
 * e.g., "Which code references the users.email column?"
 */

import type Database from 'better-sqlite3';
import type { ProcessedChunk } from '../chunking/types.js';

export interface ColumnDefinition {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue?: string;
  references?: {
    table: string;
    column?: string;
    onDelete?: string;
  };
  comment?: string;
}

export interface IndexDefinition {
  name: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
}

export interface ForeignKeyDefinition {
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete?: string;
}

export interface ParsedTableSchema {
  tableName: string;
  schemaName?: string;
  columns: ColumnDefinition[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyDefinition[];
  indices: IndexDefinition[];
  rawSql: string;
  comment?: string;
}

/**
 * Parses SQL DDL statements from text into structured table schemas.
 */
export function parseSqlSchema(sqlContent: string, _filePath = 'schema.sql'): ParsedTableSchema[] {
  const schemas: Map<string, ParsedTableSchema> = new Map();

  // 1. Extract CREATE TABLE statements
  // Handles: CREATE TABLE [IF NOT EXISTS] [schema.]table_name (...)
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`]?([A-Za-z0-9_]+)["`]?\.)?["`]?([A-Za-z0-9_]+)["`]?\s*\(([\s\S]*?)\)(?:\s*;|\s*$)/gi;

  let match = createTableRegex.exec(sqlContent);
  while (match !== null) {
    const rawSql = match[0].trim();
    const schemaName = match[1];
    const tableName = match[2];
    const body = match[3];

    const columns: ColumnDefinition[] = [];
    const primaryKeys: string[] = [];
    const foreignKeys: ForeignKeyDefinition[] = [];

    // Split body by commas, taking care of parentheses in types like VARCHAR(255) or DECIMAL(10, 2)
    const lines = splitTableBody(body);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Check Table-level PRIMARY KEY
      const pkMatch = line.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) {
        const pkCols = pkMatch[1]
          .split(',')
          .map((c) => c.trim().replace(/["`]/g, ''))
          .filter(Boolean);
        primaryKeys.push(...pkCols);
        for (const col of columns) {
          if (pkCols.includes(col.name)) {
            col.isPrimaryKey = true;
          }
        }
        continue;
      }

      // Check Table-level FOREIGN KEY
      const fkMatch = line.match(
        /^(?:CONSTRAINT\s+["`]?\w+["`]?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["`]?([A-Za-z0-9_]+)["`]?\s*(?:\(([^)]+)\))?(?:\s+ON\s+DELETE\s+([A-Za-z\s]+))?/i,
      );
      if (fkMatch) {
        const fkCols = fkMatch[1].split(',').map((c) => c.trim().replace(/["`]/g, ''));
        const targetTable = fkMatch[2];
        const targetCols = fkMatch[3]
          ? fkMatch[3].split(',').map((c) => c.trim().replace(/["`]/g, ''))
          : [];
        const onDelete = fkMatch[4]?.trim();

        foreignKeys.push({
          columns: fkCols,
          foreignTable: targetTable,
          foreignColumns: targetCols,
          onDelete,
        });
        continue;
      }

      // Check Table-level UNIQUE
      const uniqMatch = line.match(/^(?:CONSTRAINT\s+["`]?\w+["`]?\s+)?UNIQUE\s*\(([^)]+)\)/i);
      if (uniqMatch) {
        const uniqCols = uniqMatch[1].split(',').map((c) => c.trim().replace(/["`]/g, ''));
        for (const col of columns) {
          if (uniqCols.includes(col.name)) {
            col.isUnique = true;
          }
        }
        continue;
      }

      // Otherwise, parse as Column Definition
      // e.g., id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      // e.g., "user_id" INT NOT NULL REFERENCES users(id) ON DELETE CASCADE
      const colMatch = line.match(
        /^["`]?([A-Za-z0-9_]+)["`]?\s+([A-Za-z0-9_]+(?:\s*\([^)]+\))?)(.*)$/i,
      );
      if (colMatch) {
        const colName = colMatch[1];
        const colType = colMatch[2].trim();
        const rest = colMatch[3] || '';
        const restUpper = rest.toUpperCase();

        const isPk = restUpper.includes('PRIMARY KEY');
        if (isPk && !primaryKeys.includes(colName)) {
          primaryKeys.push(colName);
        }

        const isNull = !restUpper.includes('NOT NULL') && !isPk;
        const isUniq = restUpper.includes('UNIQUE');

        let defaultVal: string | undefined;
        const defMatch = rest.match(/DEFAULT\s+([^,\s]+(?:\([^)]*\))?|'[^']*')/i);
        if (defMatch) {
          defaultVal = defMatch[1].trim();
        }

        let ref: ColumnDefinition['references'] | undefined;
        const inlineRefMatch = rest.match(
          /REFERENCES\s+["`]?([A-Za-z0-9_]+)["`]?\s*(?:\(["`]?([A-Za-z0-9_]+)["`]?\))?(?:\s+ON\s+DELETE\s+([A-Za-z\s]+))?/i,
        );
        if (inlineRefMatch) {
          ref = {
            table: inlineRefMatch[1],
            column: inlineRefMatch[2],
            onDelete: inlineRefMatch[3]?.trim(),
          };
          foreignKeys.push({
            columns: [colName],
            foreignTable: inlineRefMatch[1],
            foreignColumns: inlineRefMatch[2] ? [inlineRefMatch[2]] : [],
            onDelete: inlineRefMatch[3]?.trim(),
          });
        }

        columns.push({
          name: colName,
          type: colType,
          isPrimaryKey: isPk,
          isNullable: isNull,
          isUnique: isUniq,
          defaultValue: defaultVal,
          references: ref,
        });
      }
    }

    schemas.set(tableName.toLowerCase(), {
      tableName,
      schemaName,
      columns,
      primaryKeys,
      foreignKeys,
      indices: [],
      rawSql,
    });
    match = createTableRegex.exec(sqlContent);
  }

  // 2. Extract CREATE INDEX statements
  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] idx_name ON table_name (col1, col2)
  const createIndexRegex =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z0-9_]+)["`]?\s+ON\s+["`]?([A-Za-z0-9_]+)["`]?\s*\(([^)]+)\)/gi;

  let indexMatch = createIndexRegex.exec(sqlContent);
  while (indexMatch !== null) {
    const isUnique = !!indexMatch[1];
    const indexName = indexMatch[2];
    const tableName = indexMatch[3];
    const columns = indexMatch[4].split(',').map((c) => c.trim().replace(/["`]/g, ''));

    const tableSchema = schemas.get(tableName.toLowerCase());
    if (tableSchema) {
      tableSchema.indices.push({
        name: indexName,
        tableName,
        columns,
        isUnique,
      });
    }
    indexMatch = createIndexRegex.exec(sqlContent);
  }

  return Array.from(schemas.values());
}

/**
 * Splits the inner body of CREATE TABLE (...) on commas that are not enclosed in parentheses.
 */
function splitTableBody(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenDepth = 0;
  let inSingleQuote = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "'" && (i === 0 || body[i - 1] !== '\\')) {
      inSingleQuote = !inSingleQuote;
    } else if (!inSingleQuote) {
      if (char === '(') {
        parenDepth++;
      } else if (char === ')') {
        parenDepth--;
      } else if (char === ',' && parenDepth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Converts parsed table schemas into semantic ProcessedChunk objects.
 */
export function schemaToChunks(schemas: ParsedTableSchema[], filePath: string): ProcessedChunk[] {
  const chunks: ProcessedChunk[] = [];
  let runningOffset = 0;

  for (const schema of schemas) {
    // Generate clean SQL representation
    const colDefs = schema.columns.map((c) => {
      const parts = [`  ${c.name} ${c.type}`];
      if (c.isPrimaryKey) parts.push('PRIMARY KEY');
      if (!c.isNullable && !c.isPrimaryKey) parts.push('NOT NULL');
      if (c.isUnique) parts.push('UNIQUE');
      if (c.defaultValue) parts.push(`DEFAULT ${c.defaultValue}`);
      if (c.references) {
        parts.push(
          `REFERENCES ${c.references.table}${c.references.column ? `(${c.references.column})` : ''}`,
        );
      }
      return parts.join(' ');
    });

    const indexDefs = schema.indices.map(
      (idx) =>
        `-- Index: ${idx.name} ON (${idx.columns.join(', ')})${idx.isUnique ? ' UNIQUE' : ''}`,
    );

    const fkDefs = schema.foreignKeys.map(
      (fk) =>
        `-- Foreign Key: (${fk.columns.join(', ')}) -> ${fk.foreignTable}(${fk.foreignColumns.join(', ')})`,
    );

    const displayCode = [
      `-- Table: ${schema.tableName} (${schema.columns.length} columns)`,
      `CREATE TABLE ${schema.tableName} (`,
      colDefs.join(',\n'),
      ');',
      ...(fkDefs.length > 0 ? ['', ...fkDefs] : []),
      ...(indexDefs.length > 0 ? ['', ...indexDefs] : []),
    ].join('\n');

    // Generate rich vectorText for embedding and FTS
    const colSummary = schema.columns
      .map((c) => {
        const traits: string[] = [c.type];
        if (c.isPrimaryKey) traits.push('PRIMARY KEY');
        if (!c.isNullable) traits.push('NOT NULL');
        if (c.isUnique) traits.push('UNIQUE');
        if (c.references) traits.push(`REFERENCES ${c.references.table}`);
        return `${c.name} (${traits.join(', ')})`;
      })
      .join(', ');

    const vectorText = [
      `Table Schema: ${schema.tableName}`,
      `Columns: ${colSummary}`,
      schema.foreignKeys.length > 0
        ? `Foreign Keys: ${schema.foreignKeys.map((fk) => `${fk.columns.join(',')} -> ${fk.foreignTable}(${fk.foreignColumns.join(',')})`).join('; ')}`
        : '',
      schema.indices.length > 0
        ? `Indices: ${schema.indices.map((idx) => `${idx.name}(${idx.columns.join(',')})`).join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const startIndex = runningOffset;
    const endIndex = runningOffset + displayCode.length;
    runningOffset = endIndex + 2;
    const nwsSize = displayCode.replace(/\s/g, '').length;

    chunks.push({
      displayCode,
      vectorText,
      nwsSize,
      metadata: {
        filePath,
        contextPath: ['Schema', 'Table', schema.tableName],
        startIndex,
        endIndex,
        rawSpan: { start: startIndex, end: endIndex },
        vectorSpan: { start: 0, end: vectorText.length },
        language: 'sql',
      },
    });
  }

  return chunks;
}

/**
 * Parses SQL content into chunks directly if DDL is present.
 */
export function parseSqlToChunks(sqlContent: string, filePath: string): ProcessedChunk[] {
  const schemas = parseSqlSchema(sqlContent, filePath);
  if (schemas.length === 0) return [];
  return schemaToChunks(schemas, filePath);
}

/**
 * Introspects an active SQLite database instance to extract full table schemas.
 */
export function introspectSqliteDatabase(db: Database.Database): ParsedTableSchema[] {
  const schemas: ParsedTableSchema[] = [];

  interface TableRow {
    name: string;
    sql: string;
  }

  const tables = db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`,
    )
    .all() as TableRow[];

  for (const table of tables) {
    if (!table.sql) continue;

    interface PragmaColumn {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    const pragmaCols = db.prepare(`PRAGMA table_info("${table.name}")`).all() as PragmaColumn[];

    interface PragmaFk {
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }

    const pragmaFks = db.prepare(`PRAGMA foreign_key_list("${table.name}")`).all() as PragmaFk[];

    interface PragmaIndex {
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }

    const pragmaIndices = db.prepare(`PRAGMA index_list("${table.name}")`).all() as PragmaIndex[];

    const columns: ColumnDefinition[] = pragmaCols.map((col) => {
      const isPk = col.pk > 0;
      const fk = pragmaFks.find((f) => f.from === col.name);
      return {
        name: col.name,
        type: col.type || 'TEXT',
        isPrimaryKey: isPk,
        isNullable: col.notnull === 0 && !isPk,
        isUnique: isPk,
        defaultValue: col.dflt_value ?? undefined,
        references: fk
          ? {
              table: fk.table,
              column: fk.to,
              onDelete: fk.on_delete,
            }
          : undefined,
      };
    });

    const foreignKeys: ForeignKeyDefinition[] = pragmaFks.map((fk) => ({
      columns: [fk.from],
      foreignTable: fk.table,
      foreignColumns: [fk.to],
      onDelete: fk.on_delete,
    }));

    const primaryKeys = pragmaCols.filter((c) => c.pk > 0).map((c) => c.name);

    const indices: IndexDefinition[] = pragmaIndices
      .filter((idx) => !idx.name.startsWith('sqlite_autoindex'))
      .map((idx) => {
        interface IndexCol {
          seqno: number;
          cid: number;
          name: string;
        }
        const idxCols = db.prepare(`PRAGMA index_info("${idx.name}")`).all() as IndexCol[];
        return {
          name: idx.name,
          tableName: table.name,
          columns: idxCols.map((c) => c.name),
          isUnique: idx.unique === 1,
        };
      });

    schemas.push({
      tableName: table.name,
      columns,
      primaryKeys,
      foreignKeys,
      indices,
      rawSql: table.sql,
    });
  }

  return schemas;
}
