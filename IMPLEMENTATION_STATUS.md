# Implementation Status - New Features

This document outlines what exists in the codebase and what needs to be implemented for the three new features documented in README.md.

---

## Current Implementation Status

### ✅ Already Implemented

#### MCP Tools (4 tools currently available)
1. **`codebase-retrieval`** ✓ - Hybrid search with semantic + lexical
   - File: `src/mcp/tools/codebaseRetrieval.ts`
   - Features: Vector search, BM25, RRF fusion, language filtering, path filtering
   
2. **`codebase-impact`** ✓ - Impact graph analysis
   - File: `src/mcp/tools/codebaseImpact.ts`
   - Features: Dependency graph traversal, affected tests/files analysis
   
3. **`generate-commit-message`** ✓ - AI-powered commit messages
   - File: `src/mcp/tools/generateCommitMessage.ts`
   
4. **`detect-tasks`** ✓ - Detect runnable tasks in project
   - File: `src/mcp/tools/detectTasks.ts`

#### Infrastructure
- ✓ MCP Server (stdio): `src/mcp/server.ts`
- ✓ MCP HTTP Server: `src/mcp/httpServer.ts`
- ✓ Agent Routes: `src/mcp/agentRoutes.ts`
- ✓ Session Manager: `src/mcp/sessionManager.ts`
- ✓ Impact Graph Service: `src/graph/ImpactGraphService.ts`
- ✓ Search Service: `src/search/SearchService.ts`
- ✓ SQLite Database: `src/db/index.ts`
- ✓ Vector Store: `src/vectorStore/index.ts`

---

## 🗜️ Feature 1: Output Compression

### Status: ❌ NOT IMPLEMENTED

### What Needs to Be Built

#### 1. Compression Engine (`src/compression/`)
Create new directory with:

**`src/compression/engine.ts`**
- Function: `compressText(text: string, level: CompressionLevel): string`
- 4 levels: `off | lite | standard | max`
- Grammar rules:
  - **lite**: Remove filler words (actually, basically, just, really, very)
  - **standard**: Drop articles (a, an, the), use fragments, short synonyms
  - **max**: Telegraphic style, minimal syntax
- **Code-aware**: Preserve code blocks, paths, commands using regex detection

**`src/compression/detector.ts`**
- Detect code blocks: ` ```...``` `, inline code: `` `...` ``
- Detect file paths: `/path/to/file`, `./relative/path`
- Detect commands: starts with `$`, `npm`, `pnpm`, `ace`, etc.

**`src/compression/types.ts`**
```typescript
export type CompressionLevel = 'off' | 'lite' | 'standard' | 'max';

export interface CompressionConfig {
  output: CompressionLevel;
  preserveCode: boolean;
  preservePaths: boolean;
  preserveCommands: boolean;
}

export interface CompressionStats {
  originalLength: number;
  compressedLength: number;
  savings: number;
  level: CompressionLevel;
}
```

#### 2. MCP Tool Integration

**Add to `src/mcp/tools/setOutputCompression.ts`**
```typescript
export const setOutputCompressionSchema = z.object({
  output_level: z.enum(['off', 'lite', 'standard', 'max']),
});

export async function handleSetOutputCompression(
  input: z.infer<typeof setOutputCompressionSchema>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Update session-level compression config
  // Store in SessionManager
  // Return confirmation message
}
```

**Update `src/mcp/server.ts`**
- Add tool to TOOLS array
- Register handler in switch statement

#### 3. Response Middleware

**`src/mcp/middleware/responseCompressor.ts`**
- Intercept all MCP tool responses
- Apply compression based on session config
- Track compression stats for accounting

#### 4. Configuration

**Add to `src/config.ts`**
```typescript
export interface CompressionConfig {
  output: CompressionLevel;
  ollamaUrl?: string;
}

export function getCompressionConfig(): CompressionConfig {
  return {
    output: (process.env.OUTPUT_COMPRESSION as CompressionLevel) || 'standard',
    ollamaUrl: process.env.OLLAMA_URL || process.env.CCE_OLLAMA_URL,
  };
}
```

**Add to `.env` template**
```env
# Output Compression
OUTPUT_COMPRESSION=standard  # off | lite | standard | max
OLLAMA_URL=http://localhost:11434
```

#### 5. Testing

**`tests/compression/engine.test.ts`**
- Test each compression level
- Verify code blocks are preserved
- Verify paths are preserved
- Verify commands are preserved
- Measure compression ratios

---

## 💰 Feature 2: Token/Cost Accounting

### Status: ⚠️ PARTIALLY IMPLEMENTED

### What Exists
- ✓ Feedback loop infrastructure: `src/search/feedbackLoop.ts`
- ✓ SQLite database with events table
- ✓ `recordRetrievalEvent()` function tracks queries

### What Needs to Be Built

#### 1. Token Counting (`src/accounting/`)

**`src/accounting/tokenCounter.ts`**
```typescript
import { encoding_for_model } from 'tiktoken';

export function countTokens(text: string, model: string = 'gpt-4'): number {
  const enc = encoding_for_model(model);
  const tokens = enc.encode(text);
  enc.free();
  return tokens.length;
}

export function estimateTokens(text: string): number {
  // Fast approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}
```

**`src/accounting/savingsLedger.ts`**
```typescript
export interface SavingsEntry {
  id: number;
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

export type SavingsBucket = 
  | 'retrieval'
  | 'chunk_compression'
  | 'grammar_compression'
  | 'turn_summarization'
  | 'progressive_disclosure'
  | 'output_compression'
  | 'memory_recall';

// SQLite table: savings_ledger
// CREATE TABLE savings_ledger (
//   id INTEGER PRIMARY KEY,
//   project_id TEXT NOT NULL,
//   session_id TEXT NOT NULL,
//   timestamp INTEGER NOT NULL,
//   bucket TEXT NOT NULL,
//   tokens_baseline INTEGER NOT NULL,
//   tokens_actual INTEGER NOT NULL,
//   tokens_saved INTEGER NOT NULL,
//   dollars_saved REAL NOT NULL,
//   model TEXT NOT NULL
// );

export function recordSavings(
  db: Database,
  entry: Omit<SavingsEntry, 'id'>
): number {
  // Insert into savings_ledger table
  // Return entry ID
}

export function getSavingsSummary(
  db: Database,
  projectId: string,
  since?: number
): SavingsSummary {
  // Aggregate by bucket
  // Calculate totals
  // Return summary object
}
```

#### 2. Pricing Data (`src/accounting/pricing.ts`)

**Static pricing table:**
```typescript
export interface ModelPricing {
  model: string;
  provider: 'anthropic' | 'openai' | 'google';
  inputPer1M: number;   // $ per 1M tokens
  outputPer1M: number;  // $ per 1M tokens
}

export const PRICING_TABLE: ModelPricing[] = [
  // Anthropic
  { model: 'opus', provider: 'anthropic', inputPer1M: 15, outputPer1M: 75 },
  { model: 'sonnet', provider: 'anthropic', inputPer1M: 3, outputPer1M: 15 },
  { model: 'haiku', provider: 'anthropic', inputPer1M: 0.25, outputPer1M: 1.25 },
  
  // OpenAI
  { model: 'gpt-4o', provider: 'openai', inputPer1M: 2.5, outputPer1M: 10 },
  { model: 'gpt-4-turbo', provider: 'openai', inputPer1M: 10, outputPer1M: 30 },
  
  // Google
  { model: 'gemini-2.5-pro', provider: 'google', inputPer1M: 1.25, outputPer1M: 5 },
  // ... add more models
];

export function getPricing(model: string): ModelPricing | null {
  return PRICING_TABLE.find(p => p.model === model) || null;
}

export function calculateCost(
  tokens: number,
  type: 'input' | 'output',
  model: string
): number {
  const pricing = getPricing(model);
  if (!pricing) return 0;
  
  const rate = type === 'input' ? pricing.inputPer1M : pricing.outputPer1M;
  return (tokens / 1_000_000) * rate;
}
```

**Live pricing fetcher:**
```typescript
export async function fetchLivePricing(): Promise<ModelPricing[]> {
  // Fetch from Anthropic API
  // Cache for 7 days
  // Fallback to static table
}
```

#### 3. CLI Commands

**`src/cli/commands/savings.ts`**
```typescript
export async function savingsCommand(options: {
  all?: boolean;
  days?: number;
  format?: 'text' | 'json';
}) {
  if (options.all) {
    // Load all projects from ~/.ace/projects.json
    // Aggregate savings across all
  } else {
    // Current project only
  }
  
  // Display:
  // - Total tokens saved by bucket
  // - Total dollars saved
  // - Breakdown by model
  // - Time-series chart (last N days)
}
```

**`src/cli/commands/dashboard.ts`**
```typescript
export async function dashboardCommand(options: {
  port?: number;
}) {
  // Start Express server
  // Serve dashboard HTML/JS
  // Expose REST API:
  //   GET /api/projects - List all projects
  //   GET /api/projects/:id/savings - Get savings for project
  //   GET /api/projects/:id/sessions - List sessions
  //   GET /api/sessions/:id/events - List events for session
}
```

#### 4. Dashboard UI (`src/dashboard/`)

**`src/dashboard/public/index.html`**
- Donut charts using Chart.js or D3.js
- Savings by bucket visualization
- Time-series line chart
- Project selector dropdown
- Model selector dropdown

**`src/dashboard/server.ts`**
- Express server
- REST API endpoints
- Static file serving
- WebSocket for real-time updates (optional)

#### 5. Integration Hooks

**Update `src/mcp/tools/codebaseRetrieval.ts`**
```typescript
// After search completes, record savings
const baselineTokens = estimateFullFileTokens(contextPack.files);
const actualTokens = countTokens(formattedResponse.text);
const saved = baselineTokens - actualTokens;

recordSavings(db, {
  projectId,
  sessionId: getCurrentSessionId(),
  timestamp: Date.now(),
  bucket: 'retrieval',
  tokensBaseline: baselineTokens,
  tokensActual: actualTokens,
  tokensSaved: saved,
  dollarsSaved: calculateCost(saved, 'input', getCurrentModel()),
  model: getCurrentModel(),
});
```

**Update compression middleware**
```typescript
// After compression, record savings
recordSavings(db, {
  bucket: 'output_compression',
  tokensBaseline: originalTokens,
  tokensActual: compressedTokens,
  // ...
});
```

#### 6. Configuration

**Add to `src/config.ts`**
```typescript
export interface PricingConfig {
  model: string;
  inputOverride?: number;
  outputOverride?: number;
}

export function getPricingConfig(): PricingConfig {
  return {
    model: process.env.PRICING_MODEL || 'opus',
    inputOverride: process.env.PRICING_INPUT ? parseFloat(process.env.PRICING_INPUT) : undefined,
    outputOverride: process.env.PRICING_OUTPUT ? parseFloat(process.env.PRICING_OUTPUT) : undefined,
  };
}
```

#### 7. Database Schema

**Add to `src/db/index.ts`**
```sql
CREATE TABLE IF NOT EXISTS savings_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  bucket TEXT NOT NULL,
  tokens_baseline INTEGER NOT NULL,
  tokens_actual INTEGER NOT NULL,
  tokens_saved INTEGER NOT NULL,
  dollars_saved REAL NOT NULL,
  model TEXT NOT NULL,
  INDEX idx_project_timestamp (project_id, timestamp),
  INDEX idx_session (session_id),
  INDEX idx_bucket (bucket)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  model TEXT NOT NULL,
  total_tokens_saved INTEGER DEFAULT 0,
  total_dollars_saved REAL DEFAULT 0
);
```

---

## 🤝 Feature 3: Multi-Agent Integration

### Status: ❌ NOT IMPLEMENTED

### What Needs to Be Built

#### 1. Plugin Generator (`src/plugin/`)

**`src/plugin/generator.ts`**
```typescript
export interface PluginGeneratorOptions {
  pluginDir: string;
  projectPath: string;
  skillName?: string;
}

export async function generatePlugin(options: PluginGeneratorOptions): Promise<void> {
  const { pluginDir, projectPath, skillName = 'code-context' } = options;
  
  // 1. Create directory structure
  // .ace/plugin/
  // ├── plugin.json
  // ├── mcp.json
  // ├── skills/
  // │   └── code-context/
  // │       ├── SKILL.md
  // │       └── references/
  // │           └── tools.md
  // └── LICENSE
  
  // 2. Generate plugin.json (Agent Plugins v1.0.0 manifest)
  await generatePluginManifest(pluginDir);
  
  // 3. Generate mcp.json (MCP server config with uvx)
  await generateMcpConfig(pluginDir);
  
  // 4. Generate SKILL.md (agent instructions)
  await generateSkillMarkdown(pluginDir, skillName);
  
  // 5. Generate tools.md (per-tool documentation)
  await generateToolsReference(pluginDir, skillName);
  
  // 6. Copy LICENSE
  await copyLicense(pluginDir);
}
```

**`src/plugin/templates/plugin.json.ts`**
```typescript
export function generatePluginManifest(pluginDir: string): PluginManifest {
  return {
    version: '1.0.0',
    name: 'awesome-context-engineering',
    description: 'Semantic code retrieval engine for AI assistants',
    author: 'Awesome Context Engineering team',
    homepage: 'https://github.com/ndnhatvien/Awesome-Context-Engineering',
    license: 'MIT',
    skills: [
      {
        name: 'code-context',
        path: './skills/code-context/SKILL.md',
      },
    ],
    mcp: {
      config: './mcp.json',
    },
  };
}
```

**`src/plugin/templates/mcp.json.ts`**
```typescript
export function generateMcpConfig(): McpConfig {
  return {
    command: 'uvx',
    args: ['--from', 'awesome-context-engineering', 'ace', 'mcp'],
    env: {
      // Auto-discover project root
    },
  };
}
```

**`src/plugin/templates/SKILL.md.ts`**
```typescript
export function generateSkillMarkdown(): string {
  return `---
name: code-context
description: Semantic code retrieval and impact analysis
tools:
  - codebase-retrieval
  - codebase-impact
  - expand_chunk
  - related_context
  - session_recall
  - session_timeline
  - session_event
  - record_decision
  - record_code_area
  - set_output_compression
---

# Code Context Engineering

This skill provides semantic code search and impact analysis for AI-powered development.

## When to Use

- "Find code that handles authentication"
- "What tests are affected if I change this function?"
- "Show me the full source of this code block"
- "What files depend on this module?"

## Key Capabilities

### Hybrid Search
Combines vector embeddings with lexical search (BM25) for high-precision retrieval.

### Impact Analysis
Traces dependency graphs to predict affected tests and files.

### Session Memory
Recalls decisions and context across sessions to avoid repetition.

## Best Practices

1. **Start with codebase-retrieval**: Always search before making assumptions
2. **Use technical_terms for precision**: Add known class/function names to narrow results
3. **Check impact before changes**: Use codebase-impact to see blast radius
4. **Record decisions**: Use record_decision to persist architecture choices

## Tools Reference

See [tools.md](./references/tools.md) for detailed parameter documentation.
`;
}
```

**`src/plugin/templates/tools.md.ts`**
```typescript
export function generateToolsReference(): string {
  return `# Tools Reference

## codebase-retrieval

Semantic search across codebase.

### Parameters

- **repo_path** (required): Absolute path to repository
- **information_request** (required): Natural language description of what you're looking for
- **technical_terms** (optional): Array of known identifiers to filter by
- **response_mode** (optional): 'overview' (default) or 'raw'
- **include_globs** (optional): File path patterns to include
- **exclude_globs** (optional): File path patterns to exclude
- **source_code_only** (optional): Exclude docs/config files
- **include_languages** (optional): Language whitelist
- **exclude_languages** (optional): Language blacklist

### Example

\`\`\`json
{
  "repo_path": "/home/user/project",
  "information_request": "How is user authentication handled?",
  "technical_terms": ["AuthService", "login"]
}
\`\`\`

[... continue for all tools ...]
`;
}
```

#### 2. CLI Integration

**Add to `src/cli/commands/init.ts`**
```typescript
export async function initCommand(options: {
  agent?: string;
  plugin?: boolean;
  pluginDir?: string;
}) {
  // Existing init logic...
  
  if (options.plugin) {
    const pluginDir = options.pluginDir || path.join(process.cwd(), '.ace', 'plugin');
    await generatePlugin({ pluginDir, projectPath: process.cwd() });
    console.log(`✓ Plugin generated at: ${pluginDir}`);
    console.log('\nShare this directory with your team for zero-install setup!');
  }
  
  if (options.agent) {
    // Generate editor-specific config...
  }
}
```

#### 3. Auto-Discovery

**`src/plugin/discovery.ts`**
```typescript
export function findProjectRoot(startDir: string): string | null {
  let current = startDir;
  
  while (true) {
    // Check for .context-engine.yaml
    if (fs.existsSync(path.join(current, '.context-engine.yaml'))) {
      return current;
    }
    
    // Check for .git/
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    
    // Move up one directory
    const parent = path.dirname(current);
    if (parent === current) {
      return null; // Reached root
    }
    current = parent;
  }
}

// Update MCP server to use auto-discovery
export function autoDiscoverRepoPath(): string {
  const discovered = findProjectRoot(process.cwd());
  if (discovered) {
    logger.info({ path: discovered }, 'Auto-discovered project root');
    return discovered;
  }
  return process.cwd();
}
```

#### 4. Documentation

**Create `docs/AGENT_PLUGINS.md`**
- Explain Agent Plugins v1.0.0 standard
- Show comparison: --agent vs --plugin
- Provide examples for different editors
- Troubleshooting guide

---

## Implementation Priority

### Phase 1: Token Accounting (High Value)
1. ✅ Implement token counting
2. ✅ Create savings ledger schema
3. ✅ Add recording hooks to existing tools
4. ✅ Build `ace savings` command
5. ✅ Create dashboard UI

**Estimated effort**: 2-3 days

### Phase 2: Output Compression (Medium Value)
1. ✅ Implement compression engine
2. ✅ Add MCP tool
3. ✅ Create response middleware
4. ✅ Add configuration
5. ✅ Write tests

**Estimated effort**: 2 days

### Phase 3: Multi-Agent Integration (Nice to Have)
1. ✅ Implement plugin generator
2. ✅ Add CLI commands
3. ✅ Create auto-discovery
4. ✅ Write documentation

**Estimated effort**: 1-2 days

---

## Testing Plan

### Output Compression Tests
```bash
pnpm test:compression
```
- Test each compression level
- Verify code preservation
- Measure compression ratios
- Test edge cases (empty strings, all-code, all-text)

### Token Accounting Tests
```bash
pnpm test:accounting
```
- Test token counting accuracy
- Test ledger operations (insert, query, aggregate)
- Test pricing calculations
- Test multi-project summaries

### Plugin Generator Tests
```bash
pnpm test:plugin
```
- Test manifest generation
- Test directory structure
- Test auto-discovery
- Test uvx integration

---

## Dependencies to Add

```json
{
  "dependencies": {
    "tiktoken": "^1.0.10",        // Token counting (OpenAI tokenizer)
    "chart.js": "^4.4.0",          // Dashboard charts
    "express": "^4.18.2",          // Dashboard server
    "ws": "^8.14.2"                // WebSocket for live updates (optional)
  },
  "devDependencies": {
    "@types/express": "^4.17.20",
    "@types/ws": "^8.5.8"
  }
}
```

---

## Files to Create

```
src/
├── compression/
│   ├── engine.ts          ❌ NEW
│   ├── detector.ts        ❌ NEW
│   └── types.ts           ❌ NEW
├── accounting/
│   ├── tokenCounter.ts    ❌ NEW
│   ├── savingsLedger.ts   ❌ NEW
│   ├── pricing.ts         ❌ NEW
│   └── types.ts           ❌ NEW
├── plugin/
│   ├── generator.ts       ❌ NEW
│   ├── discovery.ts       ❌ NEW
│   └── templates/
│       ├── plugin.json.ts ❌ NEW
│       ├── mcp.json.ts    ❌ NEW
│       ├── SKILL.md.ts    ❌ NEW
│       └── tools.md.ts    ❌ NEW
├── dashboard/
│   ├── server.ts          ❌ NEW
│   └── public/
│       ├── index.html     ❌ NEW
│       ├── app.js         ❌ NEW
│       └── styles.css     ❌ NEW
├── mcp/
│   ├── middleware/
│   │   └── responseCompressor.ts ❌ NEW
│   └── tools/
│       ├── setOutputCompression.ts       ❌ NEW
│       ├── expandChunk.ts                ❌ NEW
│       ├── relatedContext.ts             ❌ NEW
│       ├── sessionRecall.ts              ❌ NEW
│       ├── sessionTimeline.ts            ❌ NEW
│       ├── sessionEvent.ts               ❌ NEW
│       ├── recordDecision.ts             ❌ NEW
│       └── recordCodeArea.ts             ❌ NEW
└── cli/
    └── commands/
        ├── savings.ts     ❌ NEW
        └── dashboard.ts   ❌ NEW

tests/
├── compression/
│   └── engine.test.ts     ❌ NEW
├── accounting/
│   ├── tokenCounter.test.ts   ❌ NEW
│   ├── savingsLedger.test.ts  ❌ NEW
│   └── pricing.test.ts        ❌ NEW
└── plugin/
    └── generator.test.ts  ❌ NEW

docs/
└── AGENT_PLUGINS.md       ❌ NEW
```

---

## Summary

**Current Status:**
- ✅ 4 MCP tools working
- ✅ Basic infrastructure in place
- ✅ Documentation updated

**To Implement:**
- ❌ 7 new MCP tools (session memory, compression, expansion)
- ❌ Output compression system
- ❌ Token accounting system
- ❌ Dashboard UI
- ❌ CLI commands (savings, dashboard)
- ❌ Plugin generator
- ❌ Auto-discovery

**Total Estimated Effort:** 5-7 days for full implementation

**Recommended Approach:**
1. Start with Token Accounting (highest value, enables measurement)
2. Add Output Compression (complements accounting)
3. Finish with Plugin Generator (nice-to-have for distribution)
