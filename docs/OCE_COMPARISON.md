# OCE (OpenContextEngine) — Tài liệu & So sánh với ACE (repo hiện tại)

> Tìm hiểu repo `/home/nhatvien/Projects/oce` (OpenContextEngine) và đối chiếu với repo hiện tại
> **Awesome Context Engineering (ACE)**, cùng là engine cấp ngữ cảnh mã nguồn cho AI coding agent.

---

## 1. OCE là gì

**OpenContextEngine (oce)** là dịch vụ code retrieval **ACE-compatible**, self-hosted, viết bằng
**Python (FastAPI, Python ≥ 3.11)**. Đây là bản "refactor kế thừa" của dịch vụ ACE gốc (dòng thảo
luận linux.do), được tách server / client riêng.

- **Server**: `github.com/oce-ai/oce` (repo này)
- **Client**: `github.com/oce-ai/oce-client` (scan + upload + retrieve + MCP stdio)
- **License**: Apache-2.0 · **Version**: 0.2.0
- **Quản lý dependency**: `uv` (uv.lock, pyproject.toml), Python 3.13.5, tree-sitter 0.25.2

### Cấu trúc repo

```
src/oce/
├── api/            FastAPI: router (data-plane), admin_router (admin), middleware, schemas
├── application/    CQRS: service, command/query bus, container (composition root), worker, uow
├── domain/         DDD: blob/chain/chunk + services (retrieval, indexing, reranker, selector...)
├── infrastructure/ AST chunking (cAST), embed/openai, llm, milvus3, persistence, queue/redis, metrics
├── shared/         config (pydantic-settings), database (SQLite/PG adapter), logging, metrics
├── alembic/        migrations schema
├── main.py         ASGI entry (FastAPI lifespan)
└── cli.py          oce init / serve / version (argparse)
```

Kiến trúc **DDD/CQRS**, phụ thuộc hướng vào trong: `shared <- domain <- application <- api`;
`infrastructure` chỉ được lắp bởi composition root (`application/container.py`), router không
orchestrate business logic.

### Pipeline chính

**Indexing** (`domain/services/indexing.py`)
`Ingest (chunk + metadata, PENDING)` → lưu raw vào `blob_staging` → `embed_pending` (chunk + vector +
write-back, mark READY). Chunking chỉ được bật trong worker / lúc embed, thiết kế **lazy embed** để
upload nhẹ. Cơ chế content-addressed (SHA-256), blob status: PENDING → READY / FAILED. Có path-index
(viết song song sau khi embed xong).

**Retrieval** (`domain/services/retrieval.py`)
```
embed_query → recall (dense + exact symbol, concurrent)
→ weighted RRF fuse → base rerank → source-priority
→ LLM rerank (optional) → promote symbol endpoints → confidence floor → CoverageSelector
```
Kèm các nhánh đặc biệt:
- **Intent classification** (LLM) chọn retrieval strategy (path-boost / có rewrite / có LLM rerank).
- **Path-boost branch**: trả lời câu hỏi dạng "file ... ở đâu" bằng path index (Milvus), merge với
  content hits theo chunk granularity (backfill chunk đầu tiên nếu content không phủ file).
- **Query decomposition** (`HeuristicQueryPlanner`): giữ câu hỏi gốc + facet câu phụ (giới hạn
  max_queries), mỗi sub-query recall riêng rồi RRF.

**Selector** (`domain/services/selector/coverage_selector.py`)
Greedy bin-packing 2 pass:
1. pass 1 ưu tiên **phủ kho (1 file 1 hit)**, pass 2 lấp đầy.
2. Chặn overlap theo line-range (overlap_threshold=0.6), giới hạn `max_per_path`, hard `max_chars`
   budget (32000), `top_k` là soft limit.

### Lưu trữ

| Tầng | Personal mode (0 dependency) | Service mode |
|------|------------------------------|--------------|
| Metadata + symbol_occurrences + model_credentials + metrics | SQLite (aiosqlite) | PostgreSQL 16 |
| Dense vector + path index | Milvus Lite (file nhúng) | Milvus 3.0 |
| Task queue | worker tắt | Redis |

### API

- **3 tầng auth**: Public (`/health`, `/version`), Data-plane (`Bearer API_KEY`), Admin (`/admin/*`
  với `ADMIN_API_KEY`, fallback API_KEY).
- **Data-plane (ACE-compatible)**: `/find-missing`, `/batch-upload`,
  `/agents/codebase-retrieval`, `/agents/blob-status`, `/checkpoint-blobs`.
- **Admin**: credentials CRUD + hot-reload, queue (dump/reset/requeue-stale), GC, stats/metrics.
- Admin panel web tách riêng: `oce-ai.github.io/oce-admin` (CORS allowlist `CORS_ORIGINS`).

### Điểm nổi bật của OCE

- **Model credentials** tập trung một bảng `model_credentials` theo `kind`
  (embed/rerank/llm_rerank/query_rewrite/intent), active + priority thấp nhất thắng, hot-reload
  không restart. Secret chỉ lộ 4 ký tự cuối.
- **Monitoring** song song không chặn main path: call/token/resource + retrieval audit, cleanup nền.
- **Tách server/client rõ ràng**; client tự scan workspace, upload delta, checkpoint công việc.
- Ý tưởng phòng chống lỗi tốt: không `mark_ready` khi tắt embed (giữ staging), SQLite lock conflict
  được xử lý (fix mới nhất), `compat.py` cô lập lifecycle tree-sitter.

---

## 2. So sánh nhanh

| Khía cạnh | **ACE (repo hiện tại)** | **OCE (../oce)** |
|---|---|---|
| Ngôn ngữ / runtime | TypeScript ESM, Node 22, pnpm | Python 3.11+, FastAPI, uv |
| Version / License | 0.2.0 · MIT | 0.2.0 · Apache-2.0 |
| Quy mô | ~89 file TS / ~20k LOC `src` | ~130 file PY / ~14.5k LOC `src` |
| Client giao diện | CLI `ace` (cac) + MCP stdio + MCP HTTP | CLI `oce` (serve) + HTTP API + client riêng |
| MCP | stdio + HTTP (StreamableHTTPServerTransport) | stdio qua `oce-client-mcp` (repo khác) |
| Vector store | LanceDB (bảng chia theo projectId) | Milvus 3.0 / Milvus Lite |
| Metadata | SQLite + FTS5 (per-project) | PostgreSQL / SQLite (Alembic) |
| Task queue | — (index đồng bộ + file lock) | Redis (service mode) + worker tuỳ chọn |
| Chunking | SemanticSplitter, runtime plugin tree-sitter (lazy load, đa runtime) | cAST/tree-sitter (astchunk) + fallback Recursive |
| Recall | dense (vector) + lexical (FTS5 chunk/file) + **exact symbol** (symbol_occurrences) + **path index (lexical FTS)** | dense (Milvus + vector path index) + exact symbol (symbol_occurrences) + path index |
| Fuse | RRF `wVec/wLex`,`rrfK0` + merge exact-symbol hits | weighted RRF `rrf_k`, query decomposition |
| Rerank | Reranker API (đa key luân phiên) + **source-priority sau rerank** | base rerank (OpenAI-compatible) + LLM rerank tuỳ chọn |
| Cắt / chọn | SmartTopK (Anchor&Floor + Safe Harbor + Delta Guard) + **CoverageSelector (coverage-first)** | confidence floor + CoverageSelector (coverage-first, overlap suppression) |
| Mở rộng ngữ cảnh | GraphExpander E1/E2/E3 (neighbor/breadcrumb/import, 12 resolver) | — (không có import expansion; bù bằng LLM rerank + intent) |
| Đóng gói | ContextPacker (merge interval + budget) | CoverageSelector (bin-packing + char budget) |
| Intent / rewrite | — (queryParser field-filter + queryChannels) | Intent classification (LLM) + query rewrite + heuristic planner |
| LLM trong search | Chỉ rerank | Rerank + intent + rewrite + symbol promotion |
| Eval / tunning | Offline benchmark + `ace tune` (RRF replay) | Benchmark tách repo `oce-benchmark` (HTTP) |
| Feedback loop | Có (implicit, `ace feedback`) | Không (có metrics/token/resource audit) |
| Ngoài lề | git-msg, tasks, token manager, admin dashboard, Fly.io deploy | Admin API + admin panel, credentials registry, GC |
| Graph/impact | ImpactGraphService (TS/JS) | — |

---

## 3. So sánh pipeline tương đương

### 3.1 Chunking

- **ACE**: `SemanticSplitter` + runtime plugin loading (`RuntimeRegistry`, `PluginLoader`) — lười
  `import()` các npm package tree-sitter (TypeScript/Kotlin/Java/Rust) ngoài builtin runtime
  (JS/Python/Go). Có Dual-Text, Gap-Aware merge, `ParserPool`.
- **OCE**: `CastChunker` (astchunk) dùng tree-sitter qua `compat.py`, chia theo AST window
  (non-whitespace budget), fallback `RecursiveCharacterTextSplitter`; chunker riêng cho
  markdown/jsp/vue/svelte. Tối đa 6000 chars/chunk.

→ Cách tiếp cận giống nhau (AST-boundary), khác ở **cách đóng gói runtime**: ACE dùng plugin npm
loading động, OCE nhúng một bộ grammar qua `tree-sitter-language-pack` + compat layer.

### 3.2 Recall

- **ACE**: 3 kênh — vector (LanceDB) + lexical (FTS5 chunk-level; nếu thiếu dùng file-level FTS +
  token overlap drill-down) + **exact symbol** (`symbol_occurrences` index-time, query query biến
  thể camel/snake/去分隔符, merge vào topK) + **path boost** (lexical FTS cột `path`, trả lời
  "file nằm ở đâu" không tốn embedding). RRF 2 nguồn.
- **OCE**: 3 kênh — dense (Milvus) + exact symbol (`symbol_occurrences`) + path index (Milvus
  vector). Fuse weighted RRF nhiều query.

→ ACE đã port đủ 2 channel "cứng" của OCE (exact symbol + path), nhưng giữ thêm lexical FTS kim
tuyến BM25 mà OCE đã bỏ — path-index của ACE là lexical thuần (chi phí 0 embedding), của OCE là vector.

### 3.3 Rerank & chọn

- **ACE**: rerank qua API ngoài (multi-key), áp **source-priority** (docs/tests giảm điểm) sau
  rerank, rồi **Smart TopK** dùng ngưỡng động (ratio + delta) + Safe Harbor + Hard Cap, sau đó
  GraphExpander mở rộng, **ContextPacker** đóng gói — đóng gói có thể dùng **coverage-first** thay
  cho budget thuần.
- **OCE**: base rerank + LLM rerank tuỳ chọn, source-priority (docs/tests giảm điểm), confidence
  floor, sau đó **CoverageSelector** (bin-packing bảo đảm phủ repo).

→ ACE đã port source-priority + coverage-selector của OCE; khác biệt lớn còn lại: ACE **mở rộng**
(neighbor/breadcrumb/import) rồi mới chọn, OCE **chọn bộ tối ưu coverage** không mở rộng import.

### 3.4 Tư duy thiết kế khác biệt

| | ACE | OCE |
|---|---|---|
| Kiến trúc | Thư viện/CLI liền mạch, cấu hình qua env, state lưu trong project dir | Dịch vụ client-server tách rời, DDD/CQRS, migration |
| Người dùng | Một máy / agent đọc local workspace | Nhiều người / máy dùng chung 1 index (multi-tenant) |
| Context-expansion | GraphExpander chủ động thêm code liên quan | LLM intent/rerank + coverage để agent tự chọn |
| Dữ liệu | Content-addressed per file theo projectId, index từ filesystem | Blob SHA-256, client quản lý checkpoint working-set |

---

## 4. Điểm mạnh - điểm yếu

### ACE mạnh hơn OCE
- **Bao phủ import**: E2 breadcrumb + E3 import resolver 12 ngôn ngữ → context đầy đủ hơn cho các
  symbol phụ thuộc.
- **Token-optimized threading**: `extractAroundHit`, `truncateMiddle`, `applyPreRerankPerFileCap`,
  SmartTopK đa lớp — chú trọng không phá token budget.
- **Có eval chuẩn ngay trong repo**: `ace tune` (auto-tune RRF) + offline benchmark (Recall@K/MRR/
  nDCG) + feedback loop.
- **Đơn giản khi chạy**: 0 dependency ngoài (SQLite + LanceDB), `ace index .` + MCP 1 lệnh.

### OCE mạnh hơn ACE
- **Độ chính xác "cứng"**: exact symbol recall + path index + LLM intent/rewrite → hiệu quả với
  câu hỏi "định nghĩa ở đâu", "file nào", tiếng Trung/Anh (path rewrite).
- **Vận hành đa người**: admin API + metrics monitoring + credentials hot-reload + GC + queue;
  Docker Compose có sẵn.
- **Robustness indexing**: lazy embed, staging khôi phục khi tắt/bật embedding, không READY khi chưa
  có vector, xử lý SQLite lock.
- **Kiến trúc testable**: DDD, protocols, composition root rõ ràng; 71 test file chia tầng.

---

## 5. Khả năng học hỏi lẫn nhau

Ý tưởng ACE có thể mượn từ OCE:
1. ~~**Exact symbol channel**~~ — ✅ đã port (`src/search/symbols.ts` + bảng `symbol_occurrences`).
2. ~~**Intent classification + path index**~~ — path index ✅ (`src/search/pathIndex.ts`, lexical
   FTS); intent classification (LLM) giữ làm hướng mở rộng tương lai.
3. **Lazy embed / staging** để upload lớn không bị tắc embedding.
4. ~~**Source-priority + coverage selector**~~ — ✅ đã port (`src/search/sourcePriority.ts` +
   `src/search/coverage.ts` trong ContextPacker).

Ý tưởng OCE có thể mượn từ ACE:
1. **GraphExpander E3 (import)** — OCE hiện không mở rộng theo dependency graph.
2. **Benchmark trong repo + auto-tune** — OCE tách hẳn `oce-benchmark`.
3. **Feedback loop** — OCE mới có metrics thô, chưa có implicit signal.
4. **Zip/token budget theo từng file** cách chủ động hơn out-of-the-box.

---

## 7. Trạng thái port (OCE → ACE)

Đã port 4/5 tính năng core (bỏ Intent classification do cần LLM + bảng credentials riêng):

| Tính năng | File mới | Điểm khác biệt so với OCE |
|---|---|---|
| Exact Symbol Recall | `src/search/symbols.ts` | Lưu `symbol_occurrences` lúc index với `chunk_id`, biến thể camel/snake/去分隔符; query tên không cần regex lại |
| Path Index + Filename queries | `src/search/pathIndex.ts` | **Lexical thuần** (FTS cột `path` + LIKE backfill), chi phí 0 embedding; boost product bằng backward BM25 + backfill chunk đầu |
| Source Priority Ranking | `src/search/sourcePriority.ts` | Bản test/docs factor (0.3/0.5) áp sau rerank, gọn hơn OCE (0.3/0.5 full) |
| Coverage-first Selector | `src/search/coverage.ts` | Greedy 2-pass overlap 0.6 trong `ContextPacker.pack`, gated `coverageEnabled`; tái dùng budget/per-file cap |

Trục các feature đều nằm trong `DEFAULT_CONFIG` (`src/search/config.ts`) — tắt/bật qua env,
tương thích `ACE_PROFILE`. Test: `tests/runtime/oce-port.test.ts` (12 case).

### Đánh giá live (`pnpm run benchmark:live`)

Benchmark replay thuần (`benchmark:offline`) không chạy SearchService thật nên không đo được
cải thiện. Live benchmark index 1 repo golden thật (`tests/benchmark/fixtures/golden-repo`), gọi
`buildContextPack()` cho từng query và so sánh **4 OCE feature tắt mở** trên ground-truth:

| Chỉ số | Feature OFF | Feature ON |
|---|---|---|
| MRR | 0.8214 | 0.9048 |
| Recall@1 | 0.7143 | 0.8571 |
| Recall@3 | 0.8571 | 1.0000 |
| nDCG@5 | 0.8659 | 0.9286 |

Ví dụ: `symbol-voidPayment` từ vị trí #1 lên #0 (exact symbol recall), query mơ hồ "payment flow"
từ #3 lên #2 (source-priority kéo src lên trên docs/tests).

### Benchmark trên code OCE (index bằng ACE)

Để so sánh với OCE theo phạm vi local, ta dùng **ACE index chính code OCE**
(`/home/nhatvien/Projects/oce`, 130 file Python) với dataset 8 query dựa trên symbol/path thật
của OCE (`src/oce/domain/services/retrieval.py`, `coverage_selector.py`, `path_search.py`, `cli.py`...):

| Chi số | Feature OFF | Feature ON |
|---|---|---|
| MRR | 0.8125 | 0.8750 |
| Recall@1 | 0.7500 | 0.7500 |
| Recall@3 | 0.8750 | 1.0000 |
| nDCG@5 | 0.8289 | 0.9077 |

Path boost của ACE thắng rõ trên "file nằm ở đâu": `oce-path-retrieval` từ không-đạt lên #1,
`oce-path-path-search` từ #1 lên #0. Lưu ý đây là **ACE index + ACE SearchService** trên cùng code
của OCE — để so trực tiếp với OCE service thật (Milvus/uv) cần dựng hạ tầng OCE, ngoài phạm vi local.

Lệnh: `pnpm run benchmark:live:golden -- --force` và `pnpm run benchmark:live:oce -- --force`.

### Cross-engine benchmark thật: ACE vs OCE service (uv + Milvus Lite)

Đã dựng **OCE service hoàn chỉnh** (`uv run python -m oce.cli serve --data-dir
/tmp/opencode/oce-data --port 8986`, Python 3.12, SQLite + Milvus Lite, embed jina
`jina-embeddings-v5-omni-small`) và chạy cùng dataset 7 query / golden-repo
(`tests/benchmark/fixtures/live-benchmark.jsonl`) qua client
`/tmp/opencode/oce_benchmark.py` (scan → checkpoint → batch-upload → retrieve → score).

| Chỉ số | **ACE** (jina rerank) | **OCE** (không rerank) | **OCE + jina rerank** |
|---|---|---|---|
| MRR | **0.9048** | 0.7500 | 0.8333 |
| Recall@1 | **0.8571** | 0.5714 | 0.7143 |
| Recall@3 | 1.0000 | 0.8571 | 1.0000 |
| Recall@5 | 1.0000 | 1.0000 | 1.0000 |
| nDCG@5 | **0.9286** | 0.8132 | 0.8758 |

Đối xử công bằng: cột "OCE không rerank" chạy với **LLM rerank / intent / query-decomposition tắt**
(không có LLM API key lúc đó); cột "OCE + jina rerank" bật **base rerank** (`RERANK_ENABLED=true`,
endpoint `https://api.jina.ai/v1/rerank`, model `jina-reranker-v3`) — cùng chính Jina cross-encoder
reanker ACE dùng, cùng key. Sau khi có rerank, OCE Recall@3 bắt kịp ACE (1.0) nhưng vẫn thấp hơn ở
Recall@1 (−0.14) và MRR (−0.07) — phần thiếu chủ yếu là **ACE nhờ exact-symbol recall** (kênh
`symbol_occurrences`) + rerank đưa đúng file lên top-1 nhiều hơn. Có thể nâng tiếp bằng
`LLM_API_KEY` (LLM rerank, đắt hơn) nhưng base jina reranker đã là so sánh cùng loại model.

Client benchmark để ngoài repo (`/tmp/opencode/oce_benchmark.py`) vì phụ thuộc môi trường OCE
(httpx từ venv OCE); giữ trong repo nếu muốn tái hiện: cần `uv sync` + `oce serve` đang chạy.

## 8. Kết luận

ACE và OCE giải cùng một bài toán (cấp ngữ cảnh code cho AI agent, API ACE-compatible) nhưng chọn
biên kiến trúc khác nhau: **ACE = thư viện/CLI local, nhẹ, chủ động mở rộng + tối ưu token**;
**OCE = dịch vụ client-server đa người, DDD, chính xác nhờ symbol/path/intent, vận hành mạnh**.
Chúng bổ trợ hơn là cạnh tranh — ACE phù hợp single-dev local, OCE phù hợp team chia sẻ index.