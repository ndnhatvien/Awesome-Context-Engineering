/**
 * Query Parser with Field-Qualified Search
 *
 * Inspired by vibervn-context-engine's field-qualified search
 * Supports filters: kind:, lang:, path:, name:
 */

export interface ParsedQuery {
  /** Natural language part of the query */
  naturalText: string;

  /** Field filters */
  filters: {
    /** Filter by symbol kind (function, class, method, etc.) */
    kind?: string[];
    /** Filter by programming language */
    lang?: string[];
    /** Filter by file path pattern */
    path?: string[];
    /** Filter by symbol name pattern */
    name?: string[];
  };
}

/**
 * Parse query with field-qualified filters
 *
 * Examples:
 * - "authentication logic kind:function lang:typescript"
 * - "path:src/api name:Handler error handling"
 * - "kind:class lang:python path:models"
 */
export function parseQuery(query: string): ParsedQuery {
  const filters: ParsedQuery['filters'] = {};
  const parts: string[] = [];

  // Regex to match field:value patterns
  // Supports: kind:function, lang:typescript, path:src/api, name:Handler
  const fieldPattern = /\b(kind|lang|language|path|name):([^\s]+)/gi;

  let lastIndex = 0;

  while (true) {
    const match = fieldPattern.exec(query);
    if (match === null) break;
    // Add text before this match
    if (match.index > lastIndex) {
      parts.push(query.slice(lastIndex, match.index));
    }

    const field = match[1].toLowerCase();
    const value = match[2];

    // Normalize field names
    const normalizedField = field === 'language' ? 'lang' : field;

    // Add to filters
    if (
      normalizedField === 'kind' ||
      normalizedField === 'lang' ||
      normalizedField === 'path' ||
      normalizedField === 'name'
    ) {
      if (!filters[normalizedField]) {
        filters[normalizedField] = [];
      }
      filters[normalizedField]?.push(value);
    }

    lastIndex = fieldPattern.lastIndex;
  }

  // Add remaining text
  if (lastIndex < query.length) {
    parts.push(query.slice(lastIndex));
  }

  // Clean up natural text
  const naturalText = parts.join(' ').replace(/\s+/g, ' ').trim();

  return {
    naturalText: naturalText || query, // Fallback to original if no natural text
    filters,
  };
}

/**
 * Check if a chunk matches the parsed filters
 */
export function matchesFilters(
  chunk: {
    filePath: string;
    language?: string;
    symbolKind?: string;
    symbolName?: string;
  },
  filters: ParsedQuery['filters'],
): boolean {
  // Check kind filter
  if (filters.kind && filters.kind.length > 0) {
    if (!chunk.symbolKind) return false;
    const kindLower = chunk.symbolKind.toLowerCase();
    const matches = filters.kind.some((k) => kindLower.includes(k.toLowerCase()));
    if (!matches) return false;
  }

  // Check lang filter
  if (filters.lang && filters.lang.length > 0) {
    if (!chunk.language) return false;
    const langLower = chunk.language.toLowerCase();
    const matches = filters.lang.some((l) => langLower.includes(l.toLowerCase()));
    if (!matches) return false;
  }

  // Check path filter (glob-like matching)
  if (filters.path && filters.path.length > 0) {
    const pathMatches = filters.path.some((pattern) => {
      // Simple glob: convert to regex
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\\/g, '/');

      const regex = new RegExp(regexPattern, 'i');
      return regex.test(chunk.filePath.replace(/\\/g, '/'));
    });

    if (!pathMatches) return false;
  }

  // Check name filter
  if (filters.name && filters.name.length > 0) {
    if (!chunk.symbolName) return false;
    const nameLower = chunk.symbolName.toLowerCase();
    const matches = filters.name.some((n) => nameLower.includes(n.toLowerCase()));
    if (!matches) return false;
  }

  return true;
}

/**
 * Format filters for display
 */
export function formatFilters(filters: ParsedQuery['filters']): string {
  const parts: string[] = [];

  if (filters.kind) parts.push(`kind:${filters.kind.join(',')}`);
  if (filters.lang) parts.push(`lang:${filters.lang.join(',')}`);
  if (filters.path) parts.push(`path:${filters.path.join(',')}`);
  if (filters.name) parts.push(`name:${filters.name.join(',')}`);

  return parts.join(' ');
}
