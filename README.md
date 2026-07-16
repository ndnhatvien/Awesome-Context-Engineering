# 🧠 Awesome Context Engineering (ACE)

> **ACE** là một semantic retrieval engine thế hệ mới được thiết kế đặc biệt cho AI Code Assistants. Kết hợp Vector Search và AST-based Lexical Search, ACE xây dựng context packages chính xác cao, tối ưu token để tăng cường quy trình phát triển AI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-22-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange)](https://pnpm.io/)

---

## 📖 Mục lục
- [🚀 Bắt đầu nhanh](#-bắt-đầu-nhanh)
- [✨ Tính năng chính](#-tính-năng-chính)
- [🛠️ Lệnh CLI](#️-lệnh-cli)
- [🔌 Tích hợp Model Context Protocol (MCP)](#-tích-hợp-model-context-protocol-mcp)
- [🏗️ Kiến trúc Pipeline](#️-kiến-trúc-pipeline)
- [🔧 Cấu hình & Biến môi trường](#-cấu-hình--biến-môi-trường)
- [🧪 Development & Testing](#-development--testing)
- [📄 License](#-license)

---

## 🚀 Bắt đầu nhanh

### 1. Clone & Cài đặt
```bash
git clone https://github.com/ndnhatvien/Awesome-Context-Engineering.git
cd Awesome-Context-Engineering
pnpm install
```

### 2. Build dự án
```bash
pnpm build
```

### 3. Link CLI (optional - để sử dụng global)
```bash
pnpm link --global
```

### 4. Khởi tạo cấu hình
```bash
ace init
```
Tạo file cấu hình tại `~/.ace/.env`.

### 5. Cấu hình API Keys
Mở `~/.ace/.env` và thêm API keys:
```env
EMBEDDINGS_API_KEYS=your-embedding-key-1,your-embedding-key-2
RERANK_API_KEYS=your-reranker-key
ACE_PROFILE=balanced  # quality | balanced | performance
LOG_LEVEL=info        # debug | info | warn | error
```

### 6. Index codebase
```bash
ace index .
# hoặc force rebuild
ace index . -f
```

### 7. Khởi động MCP Server
```bash
# Stdio mode (cho Claude Desktop)
ace mcp

# HTTP mode (cho web clients, mặc định port 3000)
ace mcp-http --port 3000
```

---

## ✨ Tính năng chính

### 🔍 1. Hybrid Retrieval & RRF Fusion
Kết hợp **Dense Vector Embeddings** với **FTS5 Lexical Search (BM25)** sử dụng **Reciprocal Rank Fusion (RRF)**. Xử lý đồng thời semantic intent và exact keyword matching.

### 📊 2. AST-Based Semantic Chunking
Sử dụng **Tree-sitter** để parse file thành các semantic nodes cho 12+ ngôn ngữ lập trình. Tôn trọng logical scopes (classes, functions, methods) để tránh cắt xén code.

### 🧠 3. Smart Context Expansion (E1/E2/E3)
- **E1 (Neighbor Hops)**: Lấy các chunks liền kề trong cùng file
- **E2 (Breadcrumbs)**: Khôi phục parent context scopes (namespace, class declarations)
- **E3 (Import Resolution)**: Parse dependencies và references qua TypeScript, Python, Go, Rust, Java, Kotlin, PHP, Ruby, Swift, Dart, C/C++

### 🎯 4. Impact Graph Analysis **[NEW]**
Phân tích ảnh hưởng của code changes với dependency graph:
- **Upstream Impact**: Tìm các functions/modules bị ảnh hưởng khi thay đổi một symbol
- **Downstream Dependencies**: Trace dependencies của một function
- **Change Impact Score**: Đánh giá mức độ ảnh hưởng dựa trên fan-out và coupling
- **MCP Tool Integration**: Truy vấn impact graph qua MCP protocol

### 🔧 5. Language Runtime Plugin System
Kiến trúc plugin linh hoạt với pnpm workspace monorepo:
- **Built-in Runtime**: JS/TS, Python, Go (tree-sitter 25)
- **Plugin Packages**: Kotlin, Java, Rust, PHP, Ruby, Swift (dynamic load)
- **Registry System**: Tự động fallback khi plugin không khả dụng

### 🛡️ 6. Self-Healing Index
Cơ chế tự động phát hiện và sửa lỗi index:
- **Hash-based Change Detection**: Phát hiện file changes qua xxhash
- **Monotonic Updates**: Thêm version mới trước khi xóa cũ, tránh gaps
- **Doctor Command**: `ace doctor . --repair` sửa orphaned chunks
- **Feedback Loop**: `ace feedback .` phân tích implicit feedback

### 📦 7. Smart TopK với Multi-Guard Strategy
Ngăn chặn low-score results tràn vào context:
- **Anchor & Floor**: Dual threshold protection
- **Delta Guard**: Tránh outlier Top1 scenarios
- **Safe Harbor**: Đảm bảo minimum recall
- **Hard Cap**: Token budget protection

---

## 🛠️ Lệnh CLI

| Lệnh | Mô tả |
|------|-------|
| `ace init` | Tạo file `.env` template tại `~/.ace/.env` |
| `ace index [path]` | Index codebase (dùng `-f` để force rebuild) |
| `ace search` | Interactive command-line search |
| `ace mcp` | Khởi động MCP Server (stdio mode) cho IDE clients |
| `ace mcp-http` | Khởi động MCP HTTP Server (default port 3000) |
| `ace doctor [path]` | Kiểm tra tính nhất quán index, dùng `--repair` để tự động sửa |
| `ace feedback [path]` | Phân tích implicit feedback (`--days 7 --top 10`) |
| `ace tune <dataset>` | Offline auto-tuning (`--target mrr --k 1,3,5`) |

---

## 🔌 Tích hợp Model Context Protocol (MCP)

### Cấu hình cho Claude Desktop

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Thêm cấu hình sau:
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

### MCP Tools có sẵn

1. **`codebase-retrieval`**: Semantic search qua codebase
   - Hybrid search (vector + lexical)
   - Smart context expansion (E1/E2/E3)
   - Token-aware packing

2. **`codebase-impact`** **[NEW]**: Impact graph analysis
   - Analyze upstream/downstream dependencies
   - Calculate change impact scores
   - Identify affected modules

3. **`file-retrieval`**: Đọc và lấy nội dung file

### MCP HTTP Server & Agent Routes **[NEW]**

Khởi động HTTP server để expose RESTful API:
```bash
ace mcp-http --port 3000
```

**Agent Routes** (`/api/agents/*`):
- `POST /api/agents/research`: Research agent với web search + synthesis
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

## 🏗️ Kiến trúc Pipeline

### Index Pipeline
```
Crawler (gitignore-aware) 
  → Filter (extension whitelist + IGNORE_PATTERNS)
  → Processor (xxhash fingerprint + change detection)
  → SemanticSplitter (AST-based chunking với Tree-sitter)
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
├── config.ts           # Environment config loader (phải import đầu tiên!)
├── search/             # Search service + GraphExpander + ContextPacker
├── chunking/           # SemanticSplitter + runtime registry
├── graph/              # Impact graph service + extractors **[NEW]**
├── mcp/                # MCP servers (stdio + HTTP) + agent routes **[NEW]**
├── api/                # Embedding/Reranker clients với rate limiting
├── vectorStore/        # LanceDB adapter
├── db/                 # SQLite + FTS5
└── scanner/            # File crawler + filter + processor
```

---

## 🔧 Cấu hình & Biến môi trường

File cấu hình: `~/.ace/.env`

### Embedding Configuration
```env
# Multi-key rotation (khuyến nghị)
EMBEDDINGS_API_KEYS=key1,key2,key3
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDINGS_MODEL=BAAI/bge-m3
EMBEDDINGS_DIMENSIONS=1024
EMBEDDINGS_MAX_CONCURRENCY=5

# Legacy single-key (vẫn được hỗ trợ)
EMBEDDINGS_API_KEY=single-key
```

### Reranker Configuration
```env
# Multi-key rotation (khuyến nghị)
RERANK_API_KEYS=key1,key2,key3
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v2-base-multilingual
RERANK_TOP_N=10

# Legacy single-key
RERANK_API_KEY=single-key
```

### Profile & Logging
```env
# Profile: quality (chất lượng cao) | balanced (cân bằng) | performance (nhanh)
ACE_PROFILE=balanced
CODE_RECALL_PROFILE=balanced  # Tên cũ, vẫn được hỗ trợ

# Logging
LOG_LEVEL=info  # debug | info | warn | error
# Debug logs → ~/.ace/logs/app.YYYY-MM-DD.log
```

### File Filtering
```env
# Thêm patterns để ignore
IGNORE_PATTERNS=*.log,*.tmp,node_modules

# Thêm patterns để include
INCLUDE_PATTERNS=*.config.js,*.config.ts
```

### Config Loading Priority
1. **Development mode** (`NODE_ENV=development/dev`): `cwd/.env` → `~/.ace/.env`
2. **Production mode** (default): chỉ load `~/.ace/.env`
3. **MCP mode**: auto-detect qua `process.argv[2] === 'mcp'`

⚠️ **Quan trọng**: `src/config.ts` phải được import đầu tiên (xem `src/index.ts` line 3). Tất cả modules đọc config qua getter functions (`getEmbeddingConfig()`, `getRerankerConfig()`), **cấm trực tiếp đọc `process.env`**.

---

## 🧪 Development & Testing

### Build Commands
```bash
pnpm build                # Compile với sourcemap (development)
pnpm build:release        # Compile không có sourcemap (production)
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
# Toàn bộ tests
pnpm test                          # Language parsers + runtime tests
pnpm test:unit:all                 # test + benchmark tests

# Runtime tests
pnpm test:runtime                  # Chạy registry.test.ts
tsx tests/runtime/graph-service.test.ts   # Chạy test cụ thể

# E2E & Benchmark
pnpm test:e2e:mcp                  # MCP end-to-end smoke test
pnpm test:benchmark                # Offline benchmark + auto-tuning
```

### Benchmark & Tuning
```bash
pnpm benchmark:offline    # Recall@K / MRR / nDCG evaluation
pnpm benchmark:tune       # Auto-tuning với RRF replay
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

Node version được cố định bởi `.node-version` (22).  
CI sử dụng `pnpm install --frozen-lockfile`.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

Extended and rebranded from original **CodeRecall** by `alistar.max`.  
Built with TypeScript, Tree-sitter, LanceDB, and Model Context Protocol.

---

**Created with ❤️ by Awesome Context Engineering team**
