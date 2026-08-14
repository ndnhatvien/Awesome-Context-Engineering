# 🧠 Awesome Context Engineering (ACE)

> **ACE** is a next-generation semantic retrieval engine designed specifically for AI Code Assistants. Combining Vector Search and AST-based Lexical Search, ACE builds high-precision, token-optimized context packages to enhance AI-powered development workflows.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-22-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)](https://pnpm.io/)

[Vietnamese Documentation](./README_vi.md) | [English Documentation](./README.md)

---

## 📊 New Feature Highlights

### 🗜️ Output Compression

Reduce AI model response length to save output tokens. Output tokens typically cost 5x more than input tokens (e.g., Opus: $15/1M input vs $75/1M output).

**4 Compression Levels:**

| Level | Savings | Description |
|------|----------|------|
| `off` | 0% | No compression, full output |
| `lite` | ~30% | Remove filler, hedging, pleasantries |
| `standard` | ~65% | Fragments, drop articles, short synonyms |
| `max` | ~75% | Telegraphic style (similar to "caveman mode") |

**Features:**
- Code blocks, paths, commands are **never** compressed
- Diff-only mode: Show only changed lines, not full file rewrites
- Runtime control: `set_output_compression output_level=max`
- Quality preserved: Technical content remains intact

**Configuration:**
```yaml
compression:
  output: standard  # off | lite | standard | max
  ollama_url: http://localhost:11434  # optional, for LLM-based compression
```

### 💰 Token/Cost Accounting

Track detailed token savings with real dollar estimates.

**7 Savings Buckets:**

| Bucket | Type | Average Savings |
|--------|------|------------------|
| **Retrieval** | Input | 94% (full files → relevant chunks) |
| **Chunk compression** | Input | 89% (chunks → signatures) |
| **Grammar compression** | Input | 13% (remove articles/fillers) |
| **Turn summarization** | Input | Varies (session history) |
| **Progressive disclosure** | Input | Varies (tool payloads) |
| **Output compression** | Output | 25-80% (depends on level) |
| **Memory recall** | Input | Varies (context reuse) |

**Multi-Provider Pricing:**
- Supports 15+ models: Anthropic (opus/sonnet/haiku), OpenAI (gpt-4o/gpt-4-turbo), Google (gemini-2.5-pro)
- Static pricing ships with CCE, live pricing from Anthropic API (cached 7 days)
- Manual override: `pricing.input` / `pricing.output` for custom rates

**Append-Only Ledger:**
- Every token saved is recorded to SQLite ledger
- Persistent, survives restarts
- Dashboard displays real-time charts and trends

**Usage:**
```bash
ace savings              # Current project
ace savings --all        # All projects
ace dashboard            # Web UI with donut charts
```

**Configuration:**
```yaml
pricing:
  model: opus              # opus | sonnet | haiku | gpt-4o | gemini-2.5-pro
  # input: 15.0            # override $/1M input tokens
  # output: 75.0           # override $/1M output tokens
```

### 🤝 Multi-Agent Integration

Agent Plugin support for zero-install distribution. Based on **Agent Plugins v1.0.0** standard supported by Amazon, Cursor, Microsoft, OpenAI, Vercel.

**Why Agent Plugin?**
- **Zero-install**: Users don't need to pre-install ACE, `uvx` fetches on-demand
- **Portable**: Share one folder with team, works instantly
- **Auto-discovery**: MCP server automatically finds project root
- **Editor-agnostic**: VS Code, GitHub Copilot, ChatGPT, Codex, Cursor, Kiro

**Plugin Directory Structure:**
```
.ace/plugin/
├── plugin.json              # Agent Plugins v1.0.0 manifest
├── mcp.json                 # MCP server config (uvx + stdio)
├── skills/
│   └── code-context/
│       ├── SKILL.md         # Agent instructions (frontmatter + body)
│       └── references/
│           └── tools.md     # Per-tool parameter docs
└── LICENSE
```

**Generate Plugin:**
```bash
ace init --plugin                          # Generate at .ace/plugin/
ace init --plugin --plugin-dir ~/plugins/ace  # Custom location
ace init --agent claude --plugin           # Both: agent config + plugin
```

**Comparison: --agent vs --plugin:**

| | `--agent` (default) | `--plugin` |
|---|---------------------|------------|
| **Install method** | Writes editor-specific config files | Generates portable plugin directory |
| **Zero-install** | No, ACE must be on PATH | Yes, uvx fetches on-demand |
| **Updates** | Stale until `ace init` re-run | Stale until `ace init --plugin` re-run |
| **Best for** | Personal machine | Team sharing / distribution |

Both can be used together: `--agent` for editor MCP config, `--plugin` for portable alternative.

---

## 🔍 Comparison with Alternatives

| Feature | ACE | Cursor | Aider | Continue | Greptile |
|----------|-----|--------|-------|----------|----------|
| **Hybrid Search** | ✓ Vector + BM25 + RRF | Text-based | Text-based | Vector only | Vector + keyword |
| **AST Chunking** | ✓ Tree-sitter 12+ langs | ✗ | ✗ | ✗ | ✓ Limited |
| **Graph Expansion** | ✓ E1/E2/E3 | ✗ | ✗ | ✗ | Basic imports |
| **Impact Analysis** | ✓ Upstream/downstream | ✗ | ✗ | ✗ | ✗ |
| **Output Compression** | ✓ 4 levels (0-75%) | ✗ | ✗ | ✗ | ✗ |
| **Token Accounting** | ✓ 7 buckets + $ estimates | Basic | ✗ | ✗ | ✗ |
| **Multi-Agent Plugin** | ✓ Agent Plugins v1.0.0 | ✗ | ✗ | ✗ | ✗ |
| **Session Memory** | ✓ Cross-session recall | ✗ | ✗ | ✗ | ✗ |
| **Self-Healing Index** | ✓ Auto-repair | ✗ | ✗ | ✗ | ✗ |
| **Local/Open Source** | ✓ MIT | Closed | ✓ Apache | ✓ Apache | Closed API |
| **Zero-install** | ✓ Plugin mode | ✗ | ✗ | ✗ | ✗ |

**Savings Comparison:**
- **Output compression tools** (e.g., Caveman): Save 20-75% on output tokens. Output is 5-15% of bill ⇒ **Net savings ~11%**
- **ACE**: Saves 94% on input tokens (retrieval). Input is 85-95% of bill ⇒ **Net savings ~80%** + output compression bonus

---

## 📖 Table of Contents
- [🚀 Quick Start](#-quick-start)
- [✨ Core Features](#-core-features)
- [🛠️ CLI Commands](#️-cli-commands)
- [🔌 Model Context Protocol (MCP) Integration](#-model-context-protocol-mcp-integration)
- [🏗️ Architecture Pipeline](#️-architecture-pipeline)
- [🔧 Configuration & Environment Variables](#-configuration--environment-variables)
- [🧪 Development & Testing](#-development--testing)
- [📄 License](#-license)

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/ndnhatvien/Awesome-Context-Engineering.git
cd Awesome-Context-Engineering
pnpm install
```

### 2. Build Project
```bash
pnpm build
```

### 3. Link CLI (optional - for global usage)
```bash
pnpm link --global
```

### 4. Initialize Configuration
```bash
ace init
```
Creates configuration file at `~/.ace/.env`.

### 5. Configure API Keys
Open `~/.ace/.env` and add API keys:
```env
EMBEDDINGS_API_KEYS=your-embedding-key-1,your-embedding-key-2
RERANK_API_KEYS=your-reranker-key
ACE_PROFILE=balanced  # quality | balanced | performance
LOG_LEVEL=info        # debug | info | warn | error
```

### 6. Index Codebase
```bash
ace index .
# or force rebuild
ace index . -f
```

### 7. Start MCP Server
```bash
# Stdio mode (for Claude Desktop)
ace mcp

# HTTP mode (for web clients, default port 3000)
ace mcp-http --port 3000
```

---

## ✨ Core Features

### 🔍 1. Hybrid Retrieval & RRF Fusion
Combines **Dense Vector Embeddings** with **FTS5 Lexical Search (BM25)** using **Reciprocal Rank Fusion (RRF)**. Handles both semantic intent and exact keyword matching simultaneously.

### 📊 2. AST-Based Semantic Chunking
Uses **Tree-sitter** to parse files into semantic nodes for 12+ programming languages. Respects logical scopes (classes, functions, methods) to avoid code fragmentation.

### 🧠 3. Smart Context Expansion (E1/E2/E3)
- **E1 (Neighbor Hops)**: Fetch adjacent chunks in the same file
- **E2 (Breadcrumbs)**: Restore parent context scopes (namespace, class declarations)
- **E3 (Import Resolution)**: Parse dependencies and references across TypeScript, Python, Go, Rust, Java, Kotlin, PHP, Ruby, Swift, Dart, C/C++

### 🎯 4. Impact Graph Analysis **[NEW]**
Analyze code change impact with dependency graph:
- **Upstream Impact**: Find functions/modules affected when changing a symbol
- **Downstream Dependencies**: Trace dependencies of a function
- **Change Impact Score**: Assess impact level based on fan-out and coupling
- **MCP Tool Integration**: Query impact graph via MCP protocol

### 🔧 5. Language Runtime Plugin System
Flexible plugin architecture with pnpm workspace monorepo:
- **Built-in Runtime**: JS/TS, Python, Go (tree-sitter 25)
- **Plugin Packages**: Kotlin, Java, Rust, PHP, Ruby, Swift (dynamic load)
- **Registry System**: Automatic fallback when plugin unavailable

### 🛡️ 6. Self-Healing Index
Automatic index error detection and repair:
- **Hash-based Change Detection**: Detect file changes via xxhash
- **Monotonic Updates**: Add new version before deleting old, avoid gaps
- **Doctor Command**: `ace doctor . --repair` fixes orphaned chunks
- **Feedback Loop**: `ace feedback .` analyzes implicit feedback

### 📦 7. Smart TopK with Multi-Guard Strategy
Prevent low-score results from flooding context:
- **Anchor & Floor**: Dual threshold protection
- **Delta Guard**: Avoid outlier Top1 scenarios
- **Safe Harbor**: Ensure minimum recall
- **Hard Cap**: Token budget protection

### 🗜️ 8. Output Compression **[NEW]**
Reduce AI response length to save output tokens:
- **4 levels**: off (0%) | lite (~30%) | standard (~65%) | max (~75%)
- **Code-aware**: Code blocks, paths, commands never compressed
- **Diff-only mode**: Show only changed lines instead of full file rewrites
- **Runtime control**: Change compression level in session: `set_output_level output_level=max`
- **Smart compression**: Remove filler, hedging, articles while preserving technical content

### 💰 9. Token/Cost Accounting **[NEW]**
Track detailed token savings with dollar estimates:
- **Multi-provider pricing**: Supports 15+ models (Anthropic, OpenAI, Google)
- **7 savings buckets**: Retrieval, compression, output, memory, grammar, summarization, progressive disclosure
- **Append-only ledger**: Persistent storage, survives restarts
- **Real-time tracking**: Dashboard displays savings in real-time
- **Per-project analytics**: `ace savings` for current project, `ace savings --all` for all projects

### 🤝 10. Multi-Agent Integration **[NEW]**
Agent Plugin support for zero-install distribution:
- **Agent Plugins v1.0.0**: Open standard supported by Amazon, Cursor, Microsoft, OpenAI, Vercel
- **Zero-install**: Use `uvx` to launch CCE on-demand, no pre-install needed
- **Portable**: Generate plugin directory shareable with team
- **Editor support**: VS Code, GitHub Copilot, ChatGPT, Codex, Cursor, Kiro
- **Auto-discovery**: MCP server automatically finds project root via `.context-engine.yaml` or `.git/`

---

## 🛠️ CLI Commands

| Command | Description |
|------|-------|
| `ace init` | Create `.env` template at `~/.ace/.env` |
| `ace init --plugin` | Generate Agent Plugin for VS Code, Cursor, etc. (zero-install) |
| `ace index [path]` | Index codebase (use `-f` to force rebuild) |
| `ace search` | Interactive command-line search |
| `ace mcp` | Start MCP Server (stdio mode) for IDE clients |
| `ace mcp-http` | Start MCP HTTP Server (default port 3000) |
| `ace savings` | Display token savings with dollar estimates for current project |
| `ace savings --all` | Token savings for all projects |
| `ace dashboard` | Web dashboard with live charts, file health, session history |
| `ace doctor [path]` | Check index consistency, use `--repair` to auto-fix |
| `ace feedback [path]` | Analyze implicit feedback (`--days 7 --top 10`) |
| `ace tune <dataset>` | Offline auto-tuning (`--target mrr --k 1,3,5`) |

---

## 🔌 Model Context Protocol (MCP) Integration

### Configuration for Claude Desktop

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the following configuration:
```json
{
  "mcpServers": {
    "awesome-context-engineering": {
      "command": "ace",
      "args": ["mcp"]
    }
  }
}
```

### Available MCP Tools

1. **`codebase-retrieval`**: Semantic search across codebase
   - Hybrid search (vector + lexical)
   - Smart context expansion (E1/E2/E3)
   - Token-aware packing

2. **`codebase-impact`** **[NEW]**: Impact graph analysis
   - Analyze upstream/downstream dependencies
   - Calculate change impact scores
   - Identify affected modules

3. **`file-retrieval`**: Read and retrieve file contents

4. **`expand_chunk`** **[NEW]**: Get full source code for a compressed result

5. **`related_context`** **[NEW]**: Find code via graph edges (calls, imports)

6. **`session_recall`** **[NEW]**: Recall decisions from past sessions

7. **`session_timeline`** **[NEW]**: Walk turn summaries for a session

8. **`session_event`** **[NEW]**: Inspect raw tool input/output for specific event

9. **`record_decision`** **[NEW]**: Save decision for future sessions

10. **`record_code_area`** **[NEW]**: Record files worked on in session

11. **`set_output_compression`** **[NEW]**: Adjust response verbosity (off / lite / standard / max)

### MCP HTTP Server & Agent Routes **[NEW]**

Start HTTP server to expose RESTful API:
```bash
ace mcp-http --port 3000
```

**Agent Routes** (`/api/agents/*`):
- `POST /api/agents/research`: Research agent with web search + synthesis
- `POST /api/agents/code-review`: Code review agent
- `POST /api/agents/architecture`: Architecture design agent

Example request:
```bash
curl -X POST http://localhost:3000/api/agents/research \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does RRF fusion work?",
    "projectPath": "/path/to/project"
  }'
```

---

## 🏗️ Architecture Pipeline

### Index Pipeline
```
Crawler (gitignore-aware) 
  → Filter (extension whitelist + IGNORE_PATTERNS)
  → Processor (xxhash fingerprint + change detection)
  → SemanticSplitter (AST-based chunking with Tree-sitter)
  → Embeddings Generator (batch + rate limiting + key rotation)
  → LanceDB (vector store) + SQLite (FTS5 + metadata)
```

### Search Pipeline
```
User Query
  → Hybrid Recall (Vector Search + BM25 FTS)
  → RRF Fusion (reciprocal rank fusion)
  → Reranker (cross-encoder reranking)
  → GraphExpander (E1: neighbors, E2: breadcrumbs, E3: imports)
  → SmartTopK (multi-guard quality filtering)
  → ContextPacker (same-file merging + token budget)
  → Packaged Context Output
```

### Impact Graph Pipeline **[NEW]**
```
Source Files
  → Language Extractors (TS/JS, Python, Go, etc.)
  → Symbol Extractor (functions, classes, imports)
  → Graph Builder (nodes: symbols, edges: dependencies)
  → Graph Indexer (SQLite storage)
  → Impact Analyzer (upstream/downstream traversal)
  → Change Impact Score Calculation
```

### Monorepo Structure
```
packages/
├── lang-typescript/    # TypeScript/JavaScript plugin
├── lang-rust/          # Rust plugin
├── lang-kotlin/        # Kotlin plugin
└── lang-java/          # Java plugin

src/
├── config.ts           # Environment config loader (must import first!)
├── search/             # Search service + GraphExpander + ContextPacker
├── chunking/           # SemanticSplitter + runtime registry
├── graph/              # Impact graph service + extractors [NEW]
├── mcp/                # MCP servers (stdio + HTTP) + agent routes [NEW]
├── api/                # Embedding/Reranker clients with rate limiting
├── vectorStore/        # LanceDB adapter
├── db/                 # SQLite + FTS5
└── scanner/            # File crawler + filter + processor
```

---

## 🔧 Configuration & Environment Variables

Configuration file: `~/.ace/.env`

### Embedding Configuration
```env
# Multi-key rotation (recommended)
EMBEDDINGS_API_KEYS=key1,key2,key3
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDINGS_MODEL=BAAI/bge-m3
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_MAX_CONCURRENCY=5

# Legacy single-key (still supported)
EMBEDDINGS_API_KEY=single-key
```

### Reranker Configuration
```env
# Multi-key rotation (recommended)
RERANK_API_KEYS=key1,key2,key3
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v2-base-multilingual
RERANK_TOP_N=10

# Legacy single-key
RERANK_API_KEY=single-key
```

### Profile & Logging
```env
# Profile: quality (high quality) | balanced (balanced) | performance (fast)
ACE_PROFILE=balanced
CODE_RECALL_PROFILE=balanced  # Legacy name, still supported

# Logging
LOG_LEVEL=info  # debug | info | warn | error
# Debug logs → ~/.ace/logs/app.YYYY-MM-DD.log
```

### Output Compression & Token Accounting **[NEW]**
```env
# Output compression level
OUTPUT_COMPRESSION=standard  # off | lite | standard | max

# Token accounting & pricing
PRICING_MODEL=opus  # opus | sonnet | haiku | gpt-4o | gemini-2.5-pro | ...
# PRICING_INPUT=15.0   # override $/1M input tokens
# PRICING_OUTPUT=75.0  # override $/1M output tokens

# Ollama URL for LLM-based compression (optional)
OLLAMA_URL=http://localhost:11434
# CCE_OLLAMA_URL=http://nas.local:11434  # Remote Ollama
```

### Multi-Agent Plugin **[NEW]**
```env
# Agent Plugin configuration
PLUGIN_ENABLED=true
PLUGIN_DIR=~/.ace/plugin  # or custom location

# Agent Plugin will automatically:
# - Generate plugin.json (Agent Plugins v1.0.0 manifest)
# - Generate mcp.json (MCP server config with uvx)
# - Generate SKILL.md (agent instructions)
# - Support zero-install distribution
```

### File Filtering
```env
# Add patterns to ignore
IGNORE_PATTERNS=*.log,*.tmp,node_modules

# Add patterns to include
INCLUDE_PATTERNS=*.config.js,*.config.ts
```

### Config Loading Priority
1. **Development mode** (`NODE_ENV=development/dev`): `cwd/.env` → `~/.ace/.env`
2. **Production mode** (default): only load `~/.ace/.env`
3. **MCP mode**: auto-detect via `process.argv[2] === 'mcp'`

⚠️ **Important**: `src/config.ts` must be imported first (see `src/index.ts` line 3). All modules read config via getter functions (`getEmbeddingConfig()`, `getRerankerConfig()`), **never directly read `process.env`**.

---

## 🧪 Development & Testing

### Build Commands
```bash
pnpm build                # Compile with sourcemap (development)
pnpm build:release        # Compile without sourcemap (production)
pnpm dev                  # Watch mode development
```

### Code Quality
```bash
pnpm fmt                           # Biome format + auto-fix
pnpm exec -- biome check ./src     # Check only (CI)
pnpm tsc --noEmit                  # Type check (CI)
```

### Testing
```bash
# All tests
pnpm test                          # Language parsers + runtime tests
pnpm test:unit:all                 # test + benchmark tests

# Runtime tests
pnpm test:runtime                  # Run registry.test.ts
tsx tests/runtime/graph-service.test.ts   # Run specific test

# E2E & Benchmark
pnpm test:e2e:mcp                  # MCP end-to-end smoke test
pnpm test:benchmark                # Offline benchmark + auto-tuning
```

### Benchmark & Tuning
```bash
pnpm benchmark:offline    # Recall@K / MRR / nDCG evaluation
pnpm benchmark:tune       # Auto-tuning with RRF replay
```

### Local Development Setup
```bash
# 1. Clone repo
git clone https://github.com/ndnhatvien/Awesome-Context-Engineering.git
cd Awesome-Context-Engineering

# 2. Install dependencies (Node.js 22 + pnpm)
pnpm install

# 3. Build packages
pnpm build

# 4. Link CLI globally (optional)
pnpm link --global

# 5. Run tests
pnpm test

# 6. Start development
pnpm dev
```

### CI Pipeline
```bash
biome check → tsc --noEmit → pnpm build → pnpm test
```

Node version is fixed by `.node-version` (22).  
CI uses `pnpm install --frozen-lockfile`.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

Extended and rebranded from original **CodeRecall** by `alistar.max`.  
Built with TypeScript, Tree-sitter, LanceDB, and Model Context Protocol.

---

**Created with ❤️ by Awesome Context Engineering team**
