# 🧠 Awesome Context Engineering (ACE)

> **ACE** is a next-generation semantic retrieval engine designed specifically for AI Code Assistants. Combining Vector Search and AST-based Lexical Search, ACE builds high-precision, token-optimized context packages to enhance AI-powered development workflows.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-22-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)](https://pnpm.io/)

[Vietnamese Documentation](./README_vi.md) | [English Documentation](./README.md)

---

## 🚀 Quick Start

### Local Installation

```bash
# 1. Clone & Install
git clone https://github.com/nhatvien/Awesome-Context-Engineering.git
cd Awesome-Context-Engineering
pnpm install

# 2. Build
pnpm build

# 3. Initialize configuration
ace init

# 4. Configure API Keys (edit ~/.ace/.env)
EMBEDDINGS_API_KEYS=your-embedding-key
RERANK_API_KEYS=your-rerank-key

# 5. Index codebase
ace index .

# 6. Start server
ace mcp-http --port 3000
```

---

## ☁️ Deploy to Fly.io

### 🚀 Quick Deploy (4 commands)

**Simplest method** - Deploy directly from GitHub (no need to clone!):

```bash
# 1. Login to Fly.io
flyctl auth login

# 2. Launch from GitHub
flyctl launch --from https://github.com/nhatvien/Awesome-Context-Engineering

# When prompted:
# - App name: choose or leave blank
# - Region: sin (Singapore) or nearest
# - Postgres: No
# - Redis: No
# - Deploy now: No

# 3. Create volume & configure secrets
flyctl volumes create data --size 1

flyctl secrets set EMBEDDINGS_API_KEYS="your-embedding-key-1,your-key-2"
flyctl secrets set EMBEDDINGS_BASE_URL="https://api.siliconflow.cn/v1"
flyctl secrets set EMBEDDINGS_MODEL="BAAI/bge-m3"

flyctl secrets set RERANK_API_KEYS="your-rerank-key"
flyctl secrets set RERANK_BASE_URL="https://api.jina.ai/v1"
flyctl secrets set RERANK_MODEL="jina-reranker-v2-base-multilingual"

flyctl secrets set ACE_ADMIN_PASSWORD="your-secure-password"

# Optional settings
flyctl secrets set ACE_PROFILE="balanced"
flyctl secrets set LOG_LEVEL="info"
flyctl secrets set OUTPUT_COMPRESSION="standard"

# 4. Deploy!
flyctl deploy

# Open admin dashboard
flyctl open /admin
```

**Done!** 🎉 Your app is running at `https://your-app-name.fly.dev/admin`

> 📖 **Detailed guide in Vietnamese:** [DEPLOY_FLYIO.md](./DEPLOY_FLYIO.md)  
> Includes: account creation, flyctl setup, troubleshooting, app management, pricing

### Quick Commands

```bash
# View status
flyctl status

# View logs
flyctl logs

# Scale RAM
flyctl scale vm shared-cpu-1x --memory 512

# Restart app
flyctl apps restart

# SSH into server
flyctl ssh console
```

### Pricing

Fly.io offers **$5 free credit/month**:
- Shared CPU (512MB): ~$4/month
- 1GB storage: ~$0.15/month
- **Total: Free with $5 credit!** 💰

---

## ✨ Core Features

### 🔍 1. Hybrid Retrieval & RRF Fusion
Combines **Dense Vector Embeddings** with **FTS5 Lexical Search (BM25)** using **Reciprocal Rank Fusion (RRF)**. Handles both semantic intent and exact keyword matching.

### 📊 2. AST-Based Semantic Chunking
Uses **Tree-sitter** to parse files into semantic nodes for 12+ programming languages. Respects logical scopes (classes, functions, methods).

### 🧠 3. Smart Context Expansion (E1/E2/E3)
- **E1 (Neighbor Hops)**: Fetch adjacent chunks in the same file
- **E2 (Breadcrumbs)**: Restore parent context scopes
- **E3 (Import Resolution)**: Parse dependencies across TypeScript, Python, Go, Rust, Java, etc.

### 🎯 4. Impact Graph Analysis
Analyze code change impact with dependency graph:
- **Upstream Impact**: Find affected functions/modules
- **Downstream Dependencies**: Trace function dependencies
- **Change Impact Score**: Assess impact level
- **MCP Tool Integration**: Query via MCP protocol

### 🗜️ 5. Output Compression
Reduce AI response length to save output tokens:
- **4 levels**: off (0%) | lite (~30%) | standard (~65%) | max (~75%)
- **Code-aware**: Code blocks never compressed
- **Runtime control**: Change level in session

### 💰 6. Token/Cost Accounting
Track detailed token savings with dollar estimates:
- **Multi-provider pricing**: 15+ models (Anthropic, OpenAI, Google)
- **7 savings buckets**: Retrieval, compression, output, memory, etc.
- **Real-time tracking**: Dashboard displays savings

### 🤝 7. Multi-Agent Integration
Agent Plugin support (Agent Plugins v1.0.0 standard):
- **Zero-install**: Use uvx to launch on-demand
- **Portable**: Share plugin directory with team
- **Editor support**: VS Code, GitHub Copilot, Cursor, etc.

---

## 🛠️ CLI Commands

| Command | Description |
|---------|-------------|
| `ace init` | Create .env template at ~/.ace/.env |
| `ace init --plugin` | Generate Agent Plugin for zero-install |
| `ace index [path]` | Index codebase (use -f to force rebuild) |
| `ace search` | Interactive command-line search |
| `ace mcp` | Start MCP Server (stdio mode) for IDEs |
| `ace mcp-http` | Start MCP HTTP Server (default port 3000) |
| `ace savings` | Display token savings for current project |
| `ace savings --all` | Token savings for all projects |
| `ace dashboard` | Web dashboard with live charts |
| `ace doctor [path]` | Check index consistency (--repair to fix) |
| `ace feedback [path]` | Analyze implicit feedback |
| `ace impact <target>` | Analyze code change impact |

---

## 🔌 Model Context Protocol (MCP) Integration

### Configuration for Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following:
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

2. **`codebase-impact`**: Impact graph analysis
   - Analyze upstream/downstream dependencies
   - Calculate change impact scores
   - Identify affected modules

3. **`file-retrieval`**: Read and retrieve file contents

4. **`expand_chunk`**: Get full source code for compressed result

5. **`related_context`**: Find code via graph edges (calls, imports)

6. **`session_recall`**: Recall decisions from past sessions

7. **`session_timeline`**: Walk turn summaries for a session

8. **`record_decision`**: Save decision for future sessions

9. **`set_output_compression`**: Adjust response verbosity (off/lite/standard/max)

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
```

### Reranker Configuration
```env
# Multi-key rotation (recommended)
RERANK_API_KEYS=key1,key2,key3
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v2-base-multilingual
RERANK_TOP_N=10
```

### Profile & Logging
```env
# Profile: quality | balanced | performance
ACE_PROFILE=balanced

# Logging
LOG_LEVEL=info  # debug | info | warn | error
```

### Output Compression & Token Accounting
```env
# Output compression level
OUTPUT_COMPRESSION=standard  # off | lite | standard | max

# Token accounting & pricing
PRICING_MODEL=opus  # opus | sonnet | haiku | gpt-4o | gemini-2.5-pro
```

---

## 🏗️ Architecture Pipeline

### Index Pipeline
```
Crawler (gitignore-aware) 
  → Filter (extension whitelist)
  → Processor (xxhash fingerprint)
  → SemanticSplitter (AST-based chunking)
  → Embeddings Generator
  → LanceDB (vector store) + SQLite (FTS5)
```

### Search Pipeline
```
User Query
  → Hybrid Recall (Vector + BM25)
  → RRF Fusion
  → Reranker
  → GraphExpander (E1/E2/E3)
  → SmartTopK
  → ContextPacker
  → Output
```

---

## 🧪 Development & Testing

### Build Commands
```bash
pnpm build          # Compile with sourcemap
pnpm build:release  # Production build
pnpm dev            # Watch mode
```

### Code Quality
```bash
pnpm fmt            # Format with Biome
pnpm tsc --noEmit   # Type check
```

### Testing
```bash
pnpm test           # All tests
pnpm test:e2e:mcp   # E2E smoke test
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

Extended from **CodeRecall** by `alistar.max`.  
Built with TypeScript, Tree-sitter, LanceDB, and Model Context Protocol.

---

**Created with ❤️ by Awesome Context Engineering team**
