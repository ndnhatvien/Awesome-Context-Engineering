# Hướng dẫn Triển khai ACE trên Vercel + Supabase

Tài liệu này hướng dẫn từng bước để triển khai **ACE (Awesome Context Engineering)** thành một **Cloud-native Remote MCP & Semantic Retrieval Service** trên nền tảng **Vercel** (Compute / Serverless API) và **Supabase** (PostgreSQL + `pgvector` Storage).

---

## 1. Tổng quan Kiến trúc

```
[Claude Code / Cursor / AI Agents]
               │
               │ Remote MCP (Streamable HTTP / JSON-RPC)
               ▼
┌──────────────────────────────────────────────┐
│ Vercel Serverless Functions                  │
│                                              │
│  ├── /api/mcp        (MCP Protocol Handler)  │
│  ├── /api/search     (REST Retrieval API)    │
│  └── /api/health     (Health Check)          │
└──────────────────────┬───────────────────────┘
                       │ PostgREST + pgvector
                       ▼
┌──────────────────────────────────────────────┐
│ Supabase (PostgreSQL 15+)                    │
│                                              │
│  ├── Extension: vector (1024-dim HNSW Index) │
│  ├── Extension: pg_trgm (Full-text GIN)      │
│  ├── Table: code_chunks                      │
│  ├── Table: agent_memories (4-Layer Memory)  │
│  ├── Table: token_savings_ledger             │
│  └── RPC: match_code_chunks                  │
└──────────────────────────────────────────────┘
```

---

## 2. Bước 1: Khởi tạo Cơ sở Dữ liệu Supabase

1. Truy cập [database.new](https://database.new) và tạo một project Supabase mới.
2. Mở tab **SQL Editor** trong Supabase Dashboard.
3. Sao chép toàn bộ nội dung tập tin migration:
   `supabase/migrations/20261003_init_ace_schema.sql`
4. Dán vào SQL Editor và nhấn **Run** (Ctrl + Enter).
   - Lệnh này kích hoạt extension `vector` (`pgvector`) và `pg_trgm`.
   - Tạo bảng `code_chunks`, `agent_memories`, `token_savings_ledger`.
   - Tạo hàm RPC `match_code_chunks` và `hybrid_search_chunks` tối ưu cosine search.
5. Vào **Project Settings** -> **API**:
   - Sao chép **Project URL** (ví dụ: `https://xyzcompany.supabase.co`).
   - Sao chép **service_role secret key** (khóa này dùng cho serverless backend để đọc/ghi vector).

---

## 3. Bước 2: Thiết lập Biến Môi trường trên Vercel

Khi deploy lên Vercel, hãy cấu hình các biến môi trường sau trong **Project Settings** -> **Environment Variables**:

| Biến Môi trường | Giá trị mẫu / Mô tả | Bắt buộc |
| :--- | :--- | :---: |
| `SUPABASE_URL` | `https://your-project.supabase.co` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` (Secret Service Role Key) | ✅ |
| `ACE_STORAGE_MODE` | `supabase` | ✅ |
| `EMBEDDINGS_API_KEYS` | Khóa API Embedding (SiliconFlow / OpenAI / Voyage) | ✅ |
| `EMBEDDINGS_BASE_URL` | `https://api.siliconflow.cn/v1/embeddings` | ✅ |
| `EMBEDDINGS_MODEL` | `BAAI/bge-m3` | ✅ |
| `EMBEDDINGS_DIMENSIONS` | `1024` | ✅ |
| `RERANK_API_KEYS` | Khóa API Reranker (SiliconFlow / Cohere / Jina) | ✅ |
| `RERANK_BASE_URL` | `https://api.siliconflow.cn/v1/rerank` | ✅ |
| `RERANK_MODEL` | `BAAI/bge-reranker-v2-m3` | ✅ |
| `NODE_ENV` | `production` | ✅ |

*(Tham khảo tập tin `.env.vercel.example` để xem danh sách đầy đủ)*

---

## 4. Bước 3: Triển khai lên Vercel

### Cách 1: Triển khai qua Vercel CLI

```bash
# 1. Cài đặt Vercel CLI (nếu chưa có)
npm install -g vercel

# 2. Đăng nhập và liên kết dự án
vercel login
vercel link

# 3. Triển khai Production
vercel --prod
```

### Cách 2: Triển khai qua GitHub Integration

1. Push mã nguồn lên GitHub repository.
2. Vào [vercel.com/new](https://vercel.com/new) và chọn repository của bạn.
3. Thêm các biến môi trường từ Bước 2.
4. Nhấn **Deploy**.

Sau khi deploy xong, bạn sẽ có URL dạng:
`https://your-ace-app.vercel.app`

---

## 5. Bước 4: Kiểm tra và Kết nối AI Clients

### 1. Kiểm tra trạng thái hoạt động:
```bash
curl https://your-ace-app.vercel.app/api/health
```
Phản hồi:
```json
{
  "status": "ok",
  "engine": "ACE (Awesome Context Engineering)",
  "version": "0.2.0",
  "cloudReady": true,
  "storage": "supabase"
}
```

### 2. Kết nối với Claude Code:
Thêm vào cấu hình MCP (`~/.claude.json` hoặc lệnh CLI):
```bash
claude mcp add --transport http ace https://your-ace-app.vercel.app/api/mcp
```

### 3. Kết nối với Cursor / Windsurf / Antigravity:
Trong `mcpServers` settings:
```json
{
  "mcpServers": {
    "ace-cloud": {
      "url": "https://your-ace-app.vercel.app/api/mcp",
      "transport": "http"
    }
  }
}
```

### 4. Gọi trực tiếp qua REST API:
```bash
curl -X POST https://your-ace-app.vercel.app/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How does the authentication session validation work?",
    "project_id": "my-project",
    "cost_aware_ranking": true
  }'
```
