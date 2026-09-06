# ACE Impact Graph MVP Design

## Summary

This spec defines an **Impact Graph** MVP for ACE, inspired by useful ideas from CodeGraph while fitting ACE's existing retrieval/indexing architecture. The MVP adds a local SQLite-backed graph sidecar that answers one practical question well:

> If this file or symbol changes, which source files and tests are likely affected?

The initial scope is intentionally narrow: TypeScript/JavaScript only, no watcher, no route framework modeling, and no TypeScript type checker. The graph complements ACE's vector/FTS retrieval pipeline; it does not replace `codebase-retrieval`.

## Goals

- Add pre-indexed structural impact data to ACE's per-project local SQLite database.
- Support TypeScript/JavaScript affected-test discovery first.
- Expose the capability through both CLI and MCP.
- Reuse ACE's existing scanner, incremental indexing, locks, project IDs, SQLite DB, and Tree-sitter runtime patterns.
- Keep failures best-effort: graph extraction should not break vector indexing.

## Non-goals

- No TypeScript compiler/type-checker integration.
- No daemon, watcher, or auto-sync in the MVP.
- No route/framework-specific nodes yet.
- No cross-language graph extraction yet.
- No graph expansion inside `codebase-retrieval` yet.
- No separate CodeGraph-compatible database format.

## Architecture

Add a new graph subsystem under `src/graph/`:

```text
src/graph/
  schema.ts
  types.ts
  indexer.ts
  ImpactGraphService.ts
  extractors/
    tsJsExtractor.ts
```

High-level flow:

```text
ace index .
  -> scanner/process files
  -> SemanticSplitter chunks as today
  -> graph extractor for changed TS/JS files
  -> upsert graph nodes/edges into SQLite

ace affected <target>
  -> resolve target to file/symbol node
  -> traverse reverse imports/calls/test links
  -> rank affected tests/files
  -> output human-readable or JSON

MCP codebase-impact
  -> calls same ImpactGraphService
  -> returns compact structured result for agents
```

The graph is a **sidecar local index** stored in the same project SQLite DB already used by ACE. It does not add another database, service, or always-running process.

## SQLite data model

The MVP adds three tables. `initDb()` should call graph schema initialization so every project DB is migrated idempotently.

### `graph_nodes`

Stores files, symbols, and tests.

Node kinds for MVP:

- `file`
- `function`
- `class`
- `method`
- `import`
- `test`

Fields:

```text
id TEXT PRIMARY KEY
kind TEXT NOT NULL
name TEXT NOT NULL
file_path TEXT NOT NULL
start_line INTEGER
end_line INTEGER
breadcrumb TEXT
signature TEXT
language TEXT NOT NULL
file_hash TEXT NOT NULL
metadata_json TEXT
```

Recommended indexes:

```text
idx_graph_nodes_file_path(file_path)
idx_graph_nodes_kind(kind)
idx_graph_nodes_name(name)
idx_graph_nodes_hash(file_hash)
```

Stable ID examples:

```text
file:src/foo.ts
symbol:src/foo.ts:Foo.bar:L10-L30
test:tests/foo.test.ts:login handles token:L12-L20
```

IDs must be stable enough for one indexed file version and deterministic across re-indexes of unchanged content. If a symbol moves, its line-based ID may change; this is acceptable for the MVP because old nodes are removed per file update.

### `graph_edges`

Stores directed relationships between nodes.

Edge kinds for MVP:

- `contains`
- `imports`
- `calls`
- `references`
- `test_covers`

Fields:

```text
id TEXT PRIMARY KEY
from_id TEXT NOT NULL
to_id TEXT NOT NULL
kind TEXT NOT NULL
file_path TEXT NOT NULL
confidence TEXT NOT NULL -- exact | heuristic | unresolved
metadata_json TEXT
file_hash TEXT NOT NULL
```

Recommended indexes:

```text
idx_graph_edges_from(from_id)
idx_graph_edges_to(to_id)
idx_graph_edges_kind(kind)
idx_graph_edges_file_path(file_path)
idx_graph_edges_hash(file_hash)
```

Edges may point to unresolved synthetic IDs when exact resolution is unavailable. This is intentional: unresolved/name-only edges still help explain why a result is heuristic and leave room for later resolver improvements.

### `graph_index_state`

Tracks graph freshness per file.

Fields:

```text
file_path TEXT PRIMARY KEY
file_hash TEXT NOT NULL
indexed_at INTEGER NOT NULL
language TEXT NOT NULL
node_count INTEGER NOT NULL
edge_count INTEGER NOT NULL
status TEXT NOT NULL -- indexed | skipped | error
error_message TEXT
```

This table lets `ace affected` detect missing or stale graph data and produce an actionable message.

## Index lifecycle

Graph indexing should align with ACE's current self-healing file lifecycle.

For each `ProcessResult`:

- `added` / `modified` and language is TypeScript/JavaScript:
  - delete existing graph nodes/edges/state for that file path;
  - run TS/JS graph extraction;
  - insert new nodes/edges;
  - write `graph_index_state.status = indexed`.
- `deleted`:
  - delete graph nodes/edges/state for that file path.
- `unchanged`:
  - skip if `graph_index_state.file_hash === files.hash`;
  - otherwise enqueue graph extraction without requiring vector re-embedding.
- `skipped` / unsupported language:
  - optionally write `status = skipped`, with zero node/edge counts.
- extractor/parser error:
  - write `status = error`, preserve the vector indexing path, and log a warning.

Graph extraction must be best-effort. A graph failure must not make `ace index` fail if file scanning/vector indexing otherwise succeeded.

## TS/JS extractor design

`ImpactGraphTsJsExtractor` should reuse ACE's existing Tree-sitter runtime strategy rather than adding another parser dependency.

Inputs:

```ts
{
  filePath: string;
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx';
  source: string;
  fileHash: string;
}
```

Output:

```ts
{
  nodes: GraphNode[];
  edges: GraphEdge[];
  diagnostics: GraphExtractionDiagnostic[];
}
```

### Extracted nodes

Always create a file node.

Create symbol nodes for:

- function declarations;
- class declarations;
- methods;
- exported const/function/class declarations when statically visible;
- default export declarations when statically visible.

Create test nodes for common JS test functions:

- `describe(...)`
- `it(...)`
- `test(...)`
- `specify(...)`

Test node metadata should include the detected framework function name and the literal test label when available.

### Extracted edges

- `contains`: file -> symbol/test.
- `imports`: file -> resolved imported file when possible; otherwise file -> unresolved import node.
- `calls`: enclosing function/method/test -> called symbol name.
- `test_covers`: test -> source file/symbol by heuristic.

### Resolution levels

The MVP uses three resolution levels:

1. **Exact relative import resolution**: resolve `./foo`, `../bar`, and extensionless TS/JS imports to indexed file paths.
2. **Same-file symbol resolution**: resolve call names to symbols declared in the same file.
3. **Imported-symbol heuristic**: if a test imports `{ foo } from '../src/foo'`, link the test to symbol `foo` in the resolved file when present; otherwise link to the resolved file.

No TypeScript type checker is used in the MVP.

## Impact traversal

The graph service should live in `src/graph/ImpactGraphService.ts`.

Supported target forms:

```bash
ace affected src/api/embedding.ts
ace affected src/api/embedding.ts:EmbeddingClient
ace affected EmbeddingClient
ace impact src/api/embedding.ts --depth 2
```

Resolution order:

1. If target matches a file path, resolve to that file node.
2. If target contains `path:symbol`, resolve the file first, then symbol nodes in that file by name/breadcrumb.
3. Otherwise search graph nodes by exact name, then partial name as fallback.

Traversal starts from resolved nodes and walks:

- reverse `imports`: files importing the changed file;
- reverse `calls`: callers of a changed symbol;
- `test_covers`: tests directly associated with a file/symbol;
- `contains`: transitions between file and symbol scope when needed.

Default limits:

```text
depth = 2
maxNodes = 200
```

The traversal must maintain a visited set to avoid cycles.

## Result model and ranking

The service returns:

```ts
interface ImpactAnalysisResult {
  inputTargets: string[];
  resolvedTargets: GraphResolvedTarget[];
  directTests: AffectedTest[];
  indirectTests: AffectedTest[];
  affectedFiles: AffectedFile[];
  impactPaths: ImpactPath[];
  warnings: string[];
}
```

Ranking should be simple and explainable:

```text
score = confidence weight
      * depth decay
      + test proximity bonus
      + exact import/call bonus
      + path convention bonus
```

Suggested weights:

- exact edge: `1.0`
- heuristic edge: `0.65`
- unresolved/name-only edge: `0.35`
- depth decay: multiply by `0.75` for each hop
- test file bonus: `+0.2`

Direct exact tests must sort above indirect or heuristic tests.

Each result should include a short reason string, for example:

```text
tests/api/embedding-client.test.ts
reason: imports src/api/embedding.ts and calls EmbeddingClient.embedBatch
```

## CLI interface

Add two commands in `src/index.ts`:

```bash
ace impact <target> [--depth 2] [--json]
ace affected <target...> [--depth 2] [--json] [--tests-only]
```

Examples:

```bash
ace affected src/api/embedding.ts --tests-only
ace affected src/api/embedding.ts src/indexer/index.ts --json
ace impact EmbeddingClient --depth 3
```

If graph data is missing or stale, CLI should not silently return empty results. It should include a warning such as:

```text
Impact graph is missing or stale. Run: ace index .
```

The command should not auto-run full indexing in the MVP, because that may invoke embedding APIs unexpectedly.

## MCP interface

Add a separate MCP tool:

```text
codebase-impact
```

Input schema:

```ts
{
  repo_path: string;
  target: string | string[];
  mode?: 'impact' | 'affected';
  depth?: number;
  tests_only?: boolean;
  include_paths?: boolean;
}
```

Keep this separate from `codebase-retrieval` because the intent is different:

- `codebase-retrieval` locates relevant code snippets.
- `codebase-impact` predicts affected files/tests and explains dependency paths.

The MCP output should be compact and structured enough for agents to consume, with grouped direct tests, indirect tests, affected files, impact paths, and warnings.

## Testing plan

Add runtime tests for the MVP.

### Schema tests

- Graph tables are created by initialization.
- Schema initialization is idempotent.
- Required indexes exist or queries behave as expected.

### Extractor fixture tests

Use small TS/JS fixture files to verify extraction of:

- imports and exports;
- functions, classes, methods;
- `describe`, `it`, `test`, `specify` test nodes;
- call edges from enclosing functions/tests.

### Graph lifecycle tests

- Added file inserts graph nodes/edges/state.
- Modified file removes old graph rows and inserts new hash rows.
- Deleted file removes graph rows and state.
- Unsupported language is skipped safely.
- Extractor error records state `error` without throwing through the indexing pipeline.

### Traversal/ranking tests

- Changed source file finds a directly importing test.
- Depth-2 import chain finds an indirect test.
- Cycle in imports/calls does not infinite-loop.
- Direct exact tests rank above indirect heuristic tests.

### CLI/MCP tests

- `ace affected fixture/src/foo.ts --json` returns valid JSON.
- `codebase-impact` returns direct/indirect test groups for a fixture project.

## Implementation order

1. Add graph types and SQLite schema.
2. Add graph indexer delete/upsert helpers.
3. Add TS/JS extractor fixture tests and extractor.
4. Integrate graph indexing into the existing index lifecycle.
5. Add `ImpactGraphService` traversal and ranking.
6. Add CLI commands.
7. Add MCP tool.
8. Add end-to-end smoke tests and documentation snippets.

## Open decisions resolved for MVP

- First language scope: TypeScript/JavaScript only.
- Primary value: affected tests/change impact.
- User-facing surfaces: CLI and MCP.
- Storage: existing project SQLite DB.
- Auto-indexing in affected command: no, warn instead.
- Integration with retrieval: deferred.
