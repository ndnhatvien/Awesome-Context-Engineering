---
name: ace-search
description: >-
  Semantic code search for ANY non-trivial code exploration task. Use as the
  DEFAULT when you need to find code by describing functionality, understand how a
  feature is implemented, locate relevant source files, or explore project architecture.
  Use for queries like "find where X happens", "how is X implemented", "where is the X logic",
  "explore X module", "understand X flow", "locate X code", or any natural-language
  question about codebase structure. Only skip when you know the exact file path (use
  Read) or need literal text matching (use grep).
---

# ACE 语义搜索

## 核心原则

**默认直接搜索，不做前置检查。** 环境和索引在绝大多数情况下已就绪。只有搜索实际失败（报错、无结果、明显异常）时才进入故障排查。

## 快速参考

```bash
# 最常用：纯语义搜索
ace search --information-request "How is the user authentication flow implemented"

# 仅搜索源码（排除 markdown/json/yaml/toml/xml 等非代码文件）
ace search --information-request "Error handling patterns" --source-code-only

```

## CLI 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--information-request <text>` | 是 | 自然语言描述代码功能/逻辑/行为 |
| `--technical-terms <terms>` | 否 | 精准术语，逗号分隔。**仅在 100% 确定符号存在时使用** |
| `--source-code-only` | 否 | 排除 docs(config) 类文件，仅搜索源码 |
| `--include-languages <langs>` | 否 | 语言白名单，可与 `--source-code-only` 组合（取交集） |
| `--exclude-languages <langs>` | 否 | 语言黑名单，可与 `--source-code-only` 组合 |
| `--repo-path <path>` | 否 | 仓库根目录，默认当前目录 |

## 搜索策略

```
已知文件路径？→ 直接用 Read 工具读文件
探索性搜索？  → 仅用 --information-request
确定某符号存在且想提升其权重？→ 加上 --technical-terms
只关心业务逻辑代码？→ 加上 --source-code-only
需要跨文件追踪？→ 多次搜索逐步缩小范围
```

### --technical-terms 使用原则

**同时满足以下两个条件才加：**

1. 你已通过其他方式（刚读过文件、用户指出）确定某类名/函数名/常量确实存在
2. 想利用它提升该符号相关结果的排名

不确定就留空 —— 纯语义搜索已足够强大。加 `--technical-terms` 不会排除纯语义匹配的结果，只是通过 RRF 加权（向量 0.6 / 词法 0.4）调整排序。

### 文件分类与过滤

ACE 将文件分为三类：

| 类别 | 扩展名 | 说明 |
|------|--------|------|
| code | ts, js, py, go, rust, java, kotlin, swift, c#, cpp, c, ruby, php, dart, lua, r, shell, powershell, sql, html, css, scss, sass, less, vue, svelte | 源码 |
| docs | markdown | 文档 |
| config | json, yaml, toml, xml | 配置 |

- `--source-code-only`：排除 docs + config，保留 code
- `--include-languages`：白名单，可与 `--source-code-only` 组合（取交集）
- `--exclude-languages`：黑名单，可与 `--source-code-only` 组合

> 索引无需手动处理。`ace search` 入口自动调用 `ensureIndexed()`：首次全量索引、后续增量索引。仅当自动索引失败时才需人工介入。

## 常见错误

| 错误 | 正确 |
|------|------|
| 猜测符号填入 `--technical-terms` | 不确定就留空 |
| 同时用 `--source-code-only` 和 `--include-languages` | 两者可组合，取交集 |
| 每次搜索前检查环境/索引 | 直接搜索，失败再排查 |

## 故障排查

**只在搜索报错、返回空、或明显异常时使用。**

### 环境变量缺失

若提示配置缺失：
```bash
ace init               # 创建 ~/.ace/.env
vim ~/.ace/.env        # 填写 API Key
```

最小配置：
```env
EMBEDDINGS_API_KEYS=sk-xxx
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDINGS_MODEL=BAAI/bge-m3
RERANK_API_KEYS=sk-xxx
RERANK_BASE_URL=https://api.siliconflow.cn/v1/rerank
RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

### 索引异常

仅当日志/报错出现 scan 失败、写入失败、锁超时时才人工介入：
```bash
ace index               # 手动触发索引
ace index . --force     # 强制重建
ace doctor .            # 审计向量索引与 FTS 一致性
ace doctor . --repair   # 修复孤儿记录
```

### 辅助命令

```bash
ace doctor .                      # 索引健康检查
ace feedback . --days 7 --top 10  # 检索反馈摘要
```

## 高级使用
```bash
# 限定语言
ace search --information-request "Database migration logic" --include-languages "typescript,sql"

# 组合过滤：源码中去掉脚本语言
ace search --information-request "Build pipeline entry points" --source-code-only --exclude-languages "shell,powershell"
```
