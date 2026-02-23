# Phase 04: Session Persistence and Knowledge Base - Research

**Researched:** 2026-02-23
**Domain:** PostgreSQL persistence, checkpoint/resume, pgvector semantic search, embedding pipeline, command extraction
**Confidence:** HIGH

## Summary

Phase 04 builds durable agent sessions and a searchable Rhino command knowledge base on top of the existing PostgreSQL + pgvector infrastructure that `packages/database` already provides. The critical discovery is that **every major building block already exists in the codebase**: `@effect/sql-pg` with `SqlClient.withTransaction` for atomic checkpoint+log writes, the `SearchRepo` service with full pgvector HNSW cosine similarity support (`halfvec(3072)`, iterative scan, `efSearch` tuning), the `AiRuntime.embed` function for external embedding generation, and the polymorphic `repo()` factory for CRUD operations with tenant scoping.

The persistence layer requires a new database migration adding three Kargadan-specific tables (`kargadan_sessions`, `kargadan_tool_calls`, `kargadan_checkpoints` -- replacing the current raw SQL approach), a `PersistenceService` that wraps checkpoint+log in a single transaction, and hydration logic in the harness entry point. The knowledge base reuses the existing `search_documents` + `search_embeddings` infrastructure with a new `entityType: 'rhinoCommand'` and a static extraction pipeline that scrapes command data from the Rhino developer documentation and C# plugin source.

**Primary recommendation:** Build atop existing `packages/database` infrastructure (repo factory, SearchRepo, Client.vector, migrations). Do NOT create parallel persistence or search systems in `apps/kargadan/harness`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Every tool call triggers a checkpoint save to PostgreSQL (maximum durability -- resume from exact last tool call)
- Full snapshot per checkpoint: complete loop state + chat history + active context serialized each time (no delta reconstruction on resume)
- Existing in-memory PersistenceTrace is kept as a write-through cache -- fast reads during active sessions, every write also goes to PostgreSQL, restart hydrates from PostgreSQL
- Tool call logging and checkpoint snapshot update happen in the same PostgreSQL transaction -- atomic consistency guaranteed
- Primary audience is developer debugging (full technical detail for diagnosing failures)
- Past sessions listed as a structured table: session ID, start/end time, status (completed/failed/interrupted), tool call count, run ID, error summary if failed -- filterable by status and date range
- Replay trace depth: tool calls with params/result/duration plus loop state transitions -- excludes raw LLM request/response payloads
- Session data persists indefinitely -- no time-based retention policy
- Extraction pipeline: pull command definitions from C# Rhino plugin source/API, transform into a structured static manifest (JSON/YAML), then identify additional metadata fields the agent actually needs
- Metadata per command: parameters with types and defaults, natural language description, usage examples (aliases and related commands are not prioritized)
- Ranking: pure pgvector cosine similarity -- closest embedding wins, no usage frequency boosting
- Embedding model: external API (OpenAI or similar) -- leverages existing AI service infrastructure
- Silent resume: harness detects checkpoint, hydrates state, continues where it left off -- no user prompt, logs record the resume
- No staleness limit: always resume from last checkpoint regardless of age -- user explicitly starts a new session if they want fresh state
- Corruption fallback: log the corruption, start a fresh session, preserve corrupted data for debugging -- no halt or user prompt
- Always resume the most recent session -- past sessions are read-only for replay, not selectable for resume

### Claude's Discretion
- PostgreSQL table schema design for checkpoints, tool call logs, and session metadata
- Embedding dimension and model selection (within the external API constraint)
- Batch size and concurrency for knowledge base seeding
- Exact pgvector index type (IVFFlat vs HNSW) and tuning parameters

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERS-01 | Conversation history, run events, snapshots, and tool call results persist to PostgreSQL -- replacing the in-memory PersistenceTrace | Existing `@effect/sql-pg` + `SqlClient.withTransaction` provides atomic multi-table writes. Repo factory handles CRUD. Migration pattern established in `0001_initial.ts`. |
| PERS-02 | Session resumption restores from the last PostgreSQL checkpoint -- rebuilds loop state, Chat history, and active context without data loss | `CheckpointService.restore()` already queries PostgreSQL; needs upgrade from raw SQL to repo-based access with proper `Model.Class` schema. Silent resume with corruption fallback is a decode-or-fresh-start pattern. |
| PERS-03 | Every tool call is logged with parameters, result, duration, and failure status for audit and replay | New `kargadan_tool_calls` table within the same transaction as checkpoint update. `SqlSchema.void` or repo `put()` for atomic insert. |
| PERS-04 | Past agent sessions are queryable and replayable from the audit trail | New `kargadan_sessions` table with status/date-range filtering via repo `find()` with `preds()`. Replay is a read-only query over `kargadan_tool_calls` joined to session. |
| PERS-05 | Rhino command knowledge base is seeded with command descriptions, parameters, examples, and alias enrichment for accurate RAG retrieval | Reuse existing `search_documents` + `search_embeddings` tables with `entityType: 'rhinoCommand'`. Embedding via `AiRuntime.embed`. Seeding pipeline is a build-time script producing a static JSON manifest, loaded via `SearchRepo.upsertEmbedding`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/sql` | 0.49.0 | SQL abstraction, SqlClient, SqlSchema, Model.Class, withTransaction | Already in workspace catalog; provides typed queries, transaction management, schema validation |
| `@effect/sql-pg` | 0.50.3 | PostgreSQL driver via postgres.js, PgClient layer, PgMigrator | Already in workspace catalog; used by `packages/database/client.ts` for all DB access |
| `effect` | 3.19.18 | Runtime, Schema, Effect.Service, Ref, Match, Option | Core framework; all services built with Effect patterns |
| pgvector extension | 0.8+ | Vector similarity search, halfvec, HNSW index, iterative scan | Already installed in migration `0001_initial.ts`; validated via `hnsw.iterative_scan` check |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/ai-openai` | 0.37.2 | OpenAI embedding model via `OpenAiEmbeddingModel.model` | KB seeding: generate embeddings for Rhino command descriptions via existing `AiRuntime.embed` |
| `packages/database` (internal) | workspace | `repo()` factory, `Client`, `SearchRepo`, `Page`, `Field`, `Model` classes | All persistence CRUD; search document upsert; keyset pagination for session listing |
| `packages/ai` (internal) | workspace | `AiRuntime.embed()`, `AiRegistry` settings | Embedding generation for KB seeding; reuse existing embed infrastructure |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pgvector HNSW | pgvector IVFFlat | IVFFlat has faster build times but worse recall and requires data pre-population. HNSW is already configured in the codebase and works without data. Use HNSW. |
| `text-embedding-3-small` (1536d) | `text-embedding-3-large` (3072d) | 3072d has marginally better quality but 2x storage/index cost. The `search_embeddings` table already uses `halfvec(3072)` with zero-padding, so 1536d fits natively. Use 1536d for cost efficiency on a ~500-command catalog. |
| Separate Kargadan search tables | Reuse `search_documents` + `search_embeddings` | Separate tables would duplicate the entire search infrastructure (FTS, trigram, phonetic, embedding). Reuse existing tables with `entityType: 'rhinoCommand'` and `scopeId: null` (global). |

**Installation:** No new packages required. All dependencies are already in the workspace catalog.

## Architecture Patterns

### Recommended Module Structure

```
apps/kargadan/harness/src/
  persistence/
    checkpoint.ts        # PersistenceService (replaces current CheckpointService)
    models.ts            # Model.Class definitions for kargadan_sessions, kargadan_tool_calls, kargadan_checkpoints
    migrations/
      0002_kargadan.ts   # Kargadan-specific tables (or in packages/database/migrations/)
  knowledge/
    manifest.ts          # Static command manifest schema + loader
    seeder.ts            # KB seeding service: reads manifest, upserts search_documents, generates embeddings
  runtime/
    agent-loop.ts        # Updated to call PersistenceService.persist() per tool call
```

### Pattern 1: Atomic Checkpoint + Tool Call Log

**What:** Every tool call writes both the tool call log row and the checkpoint snapshot in a single PostgreSQL transaction via `SqlClient.withTransaction`.

**When to use:** Every tool call completion (success or failure).

**Example:**
```typescript
// Source: existing codebase pattern from packages/database/factory.ts + packages/database/client.ts
const persist = Effect.fn('Persistence.persist')((input: {
    readonly checkpoint: CheckpointInsert;
    readonly toolCall: ToolCallInsert;
}) =>
    sql.withTransaction(
        sql`INSERT INTO kargadan_tool_calls ${sql.insert(input.toolCall)}`.pipe(
            Effect.andThen(
                sql`INSERT INTO kargadan_checkpoints ${sql.insert(input.checkpoint)}
                    ON CONFLICT (session_id) DO UPDATE SET
                        state = EXCLUDED.state,
                        state_hash = EXCLUDED.state_hash,
                        sequence = EXCLUDED.sequence,
                        updated_at = NOW()`,
            ),
            Effect.provideService(SqlClient.SqlClient, sql),
        ),
    ),
);
```

### Pattern 2: Silent Resume with Corruption Fallback

**What:** On startup, attempt to decode the latest checkpoint. If decode fails (schema migration, corruption), log the error, preserve the raw data, and start a fresh session.

**When to use:** Harness entry point, before agent loop starts.

**Example:**
```typescript
// Source: derived from existing harness.ts restore pattern + CONTEXT.md decisions
const hydrate = (sessionId: string) =>
    persistence.restore(sessionId).pipe(
        Effect.flatMap(
            Option.match({
                onNone: () => Effect.succeed({ fresh: true, state: initialState }),
                onSome: (row) =>
                    S.decodeUnknown(CheckpointStateSchema)(row.state).pipe(
                        Effect.map((state) => ({ fresh: false, state })),
                        Effect.catchAll((decodeError) =>
                            Effect.log('kargadan.checkpoint.corrupt', {
                                error: String(decodeError),
                                sessionId,
                            }).pipe(Effect.as({ fresh: true, state: initialState })),
                        ),
                    ),
            }),
        ),
    );
```

### Pattern 3: KB Seeding via Existing Search Infrastructure

**What:** Insert Rhino command descriptions into `search_documents` with `entityType: 'rhinoCommand'` and `scopeId: null` (global scope). Generate embeddings via `AiRuntime.embed` and upsert into `search_embeddings` via `SearchRepo.upsertEmbedding`.

**When to use:** Build-time or one-time seeding script, re-run when command manifest changes.

**Example:**
```typescript
// Source: derived from packages/ai/src/search.ts refreshEmbeddings pattern
const seedCommand = (command: CommandManifestEntry) =>
    sql`INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
        VALUES ('rhinoCommand', ${command.id}, NULL, ${command.name}, ${command.description},
            ${pg.json({ params: command.params, examples: command.examples })}::jsonb,
            normalize_search_text(${command.name}, ${command.description}, ${pg.json({ params: command.params })}))
        ON CONFLICT (entity_type, entity_id) DO UPDATE SET
            display_text = EXCLUDED.display_text,
            content_text = EXCLUDED.content_text,
            metadata = EXCLUDED.metadata,
            normalized_text = EXCLUDED.normalized_text`;
```

### Pattern 4: Session Listing with Predicate-Based Filtering

**What:** Use the `repo()` factory's `find()` + `preds()` for status/date-range filtering, and `page()` for keyset pagination over session history.

**When to use:** Session list query (PERS-04).

**Example:**
```typescript
// Source: derived from packages/database/factory.ts repo.find + repo.preds pattern
const listSessions = (filter: { status?: string[]; after?: Date; before?: Date }) =>
    sessions.find(sessions.preds({
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.after ? { after: filter.after } : {}),
        ...(filter.before ? { before: filter.before } : {}),
    }));
```

### Anti-Patterns to Avoid

- **Parallel search infrastructure:** Do NOT create a separate `kargadan_command_embeddings` table or custom cosine similarity query. The existing `search_documents` + `search_embeddings` + `SearchRepo` already handle everything including HNSW iterative scan, RRF scoring, and embedding upsert.
- **Raw SQL in services:** The current `CheckpointService` uses raw `sql` template strings. Replace with `Model.Class` + `SqlSchema` for schema validation and type safety, matching the `packages/database/models.ts` pattern.
- **Delta-based reconstruction:** User explicitly chose full snapshots. Do NOT implement event sourcing or delta replay for checkpoint restoration. Each checkpoint is self-contained.
- **Custom embedding pipeline:** Do NOT hand-roll embedding API calls. Use `AiRuntime.embed()` which handles caching, rate limiting, budget tracking, and provider abstraction.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine similarity query | `SearchRepo.search()` with existing RRF pipeline | 10 signal fusion (FTS + trigram + phonetic + semantic), iterative scan tuning, keyset pagination already built |
| Embedding generation | Direct OpenAI API calls | `AiRuntime.embed()` / `AiRuntime.embed(batch)` | Built-in caching, rate limiting, budget tracking, provider fallback, tenant isolation |
| Embedding storage | Custom halfvec table + index | `SearchRepo.upsertEmbedding()` + existing `search_embeddings` table | HNSW index with `m=24, ef_construction=200`, zero-padding to 3072d, `halfvec_cosine_ops` already configured |
| Transaction management | Manual BEGIN/COMMIT | `SqlClient.withTransaction()` | Automatic connection pinning, rollback on failure/interruption, Error propagation |
| CRUD with tenant scoping | Raw SQL queries | `repo()` factory from `packages/database/factory.ts` | Automatic RLS context, OCC, soft-delete, keyset pagination, predicate builder |
| Schema validation | Runtime type checks | `Model.Class` + `S.decodeUnknown()` | Compile-time type inference, automatic camelCase/snake_case transform, variant schemas for insert/select/update |
| Command list extraction | Parsing Rhino docs HTML at runtime | Static JSON manifest built offline from Rhino developer docs + `Command.GetCommandNames()` | Runtime scraping is fragile; static manifest is versioned, testable, and cached |

**Key insight:** The existing `packages/database` and `packages/ai` modules provide production-grade implementations of every infrastructure component this phase needs. The only new code is the Kargadan-specific table schemas, the persistence service composition, and the command manifest extraction pipeline.

## Common Pitfalls

### Pitfall 1: Transaction Scope Mismatch

**What goes wrong:** Tool call log and checkpoint are written as separate SQL statements without `withTransaction`. On crash between the two writes, the checkpoint is stale but the tool call is logged (or vice versa).

**Why it happens:** The current `CheckpointService` writes checkpoint and trace events separately. Developers may continue this pattern.

**How to avoid:** Wrap BOTH the tool call insert AND the checkpoint upsert in a single `sql.withTransaction()` call. The transaction guarantees atomicity -- either both succeed or both roll back.

**Warning signs:** Tool call count in session metadata doesn't match actual `kargadan_tool_calls` rows for that session.

### Pitfall 2: JSONB Column Size Growth

**What goes wrong:** Full snapshot per checkpoint means the `state` JSONB column grows with conversation history. For long sessions (100+ tool calls), the checkpoint row becomes multiple MB.

**Why it happens:** User chose full snapshots (no delta). Conversation history accumulates every turn.

**How to avoid:** Accept the tradeoff (user decision). Use `TOAST` compression (automatic for JSONB > 2KB in PostgreSQL). Monitor checkpoint row size. The `ON CONFLICT DO UPDATE` pattern means only one checkpoint row exists per session (not one per tool call), limiting growth to one row.

**Warning signs:** `pg_total_relation_size('kargadan_checkpoints')` growing faster than session count.

### Pitfall 3: Embedding Dimension Mismatch

**What goes wrong:** Seeding KB with one embedding model/dimension and querying with another produces garbage results. Cosine similarity between vectors of different semantic spaces is meaningless.

**Why it happens:** `AiRegistry` settings can differ between tenants or change over time.

**How to avoid:** Store the `model` and `dimensions` alongside each embedding (already done in `search_embeddings` table). The existing `SearchRepo.search()` filters by `model` and `dimensions` in the WHERE clause. Use a fixed model+dimensions config for the Kargadan KB, independent of per-tenant AI settings.

**Warning signs:** Semantic search returns irrelevant commands; cosine similarity scores are uniformly low.

### Pitfall 4: Missing Index for Session Queries

**What goes wrong:** Session listing queries by status and date range are slow without proper indexes on `kargadan_sessions`.

**Why it happens:** Tables created without indexes for the expected query patterns.

**How to avoid:** Migration must include indexes: `(status, created_at DESC)` for filtered listing, `(session_id)` for checkpoint FK lookup, `(session_id, sequence)` for tool call replay ordering.

**Warning signs:** Sequential scans in `EXPLAIN ANALYZE` for session list queries.

### Pitfall 5: Command Manifest Staleness

**What goes wrong:** The static command manifest becomes outdated as Rhino versions update commands.

**Why it happens:** Static manifests require manual regeneration.

**How to avoid:** Version the manifest (include Rhino target version in the file). Document the regeneration process. The manifest is part of the build -- regeneration is a developer action, not a runtime concern.

**Warning signs:** Agent fails to find commands that exist in the current Rhino version.

## Code Examples

Verified patterns from the existing codebase:

### Model.Class Definition (from packages/database/src/models.ts)

```typescript
// Source: packages/database/src/models.ts pattern
class KargadanSession extends Model.Class<KargadanSession>('KargadanSession')({
    id:         Model.Generated(S.UUID),
    runId:      S.UUID,
    status:     S.Literal('running', 'completed', 'failed', 'interrupted'),
    toolCalls:  S.Int,
    error:      Model.FieldOption(S.String),
    startedAt:  S.DateFromSelf,
    endedAt:    Model.FieldOption(S.DateFromSelf),
    updatedAt:  Model.DateTimeUpdateFromDate,
}) {}
```

### Repo Factory Usage (from packages/database/src/repos.ts pattern)

```typescript
// Source: packages/database/factory.ts repo() pattern
const sessions = yield* repo(KargadanSession, 'kargadan_sessions', {
    pk: { column: 'id', cast: 'uuid' },
    resolve: {
        runId: 'runId',
        status: { field: 'status', many: true },
    },
});
```

### withTransaction for Atomic Persistence (from packages/database/client.ts)

```typescript
// Source: packages/database/client.ts Client.tenant.with pattern + SqlClient.withTransaction
const atomicPersist = (toolCall: ToolCallInsert, checkpoint: CheckpointUpsert) =>
    sql.withTransaction(
        Effect.all([
            SqlSchema.void({
                execute: (row) => sql`INSERT INTO kargadan_tool_calls ${sql.insert(row)}`,
                Request: ToolCallInsertSchema,
            })(toolCall),
            SqlSchema.void({
                execute: (row) => sql`
                    INSERT INTO kargadan_checkpoints ${sql.insert(row)}
                    ON CONFLICT (session_id) DO UPDATE SET
                        state = EXCLUDED.state,
                        sequence = EXCLUDED.sequence,
                        state_hash = EXCLUDED.state_hash,
                        updated_at = NOW()`,
                Request: CheckpointUpsertSchema,
            })(checkpoint),
        ], { discard: true }).pipe(Effect.provideService(SqlClient.SqlClient, sql)),
    );
```

### SearchRepo.upsertEmbedding (from packages/database/src/search.ts)

```typescript
// Source: packages/database/src/search.ts lines 323-328
database.search.upsertEmbedding({
    dimensions: 1536,
    documentHash: command.contentHash,
    embedding: embeddingVector,
    entityId: command.id,
    entityType: 'rhinoCommand',
    model: 'text-embedding-3-small',
    scopeId: null, // global scope
});
```

### Client.vector.withIterativeScan (from packages/database/src/client.ts)

```typescript
// Source: packages/database/src/client.ts lines 216-229
Client.vector.withIterativeScan({
    efSearch: 120,
    maxScanTuples: 40_000,
    mode: 'relaxed_order',
    scanMemMultiplier: 2,
}, searchEffect);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IVFFlat for pgvector | HNSW with iterative scan | pgvector 0.8.0 (2025) | 9.4x latency reduction for filtered queries; no pre-population required for index |
| `vector(N)` storage | `halfvec(N)` storage | pgvector 0.7.0+ | 50% storage reduction with negligible recall impact for high-dimensional embeddings |
| Single-signal search | RRF multi-signal fusion | Already implemented in codebase | 10 signals (FTS + 3 trigram + 3 KNN + fuzzy + phonetic + semantic) fused via Reciprocal Rank Fusion |
| Raw SQL checkpoint writes | `Model.Class` + `SqlSchema` | Phase 04 deliverable | Type-safe insert/select/update with automatic camelCase/snake_case transform |
| In-memory-only PersistenceTrace | Write-through cache with PostgreSQL backend | Phase 04 deliverable | Durability across harness restarts; existing Ref-based trace becomes read cache |

**Deprecated/outdated:**
- IVFFlat: Still supported but HNSW is strictly better for this use case (<1000 vectors, needs zero-data index creation). The codebase already uses HNSW.
- Manual `pg_trgm.similarity_threshold` SET: Now handled automatically in `Client.layerFromConfig` via connection options.

## Open Questions

1. **Command manifest source depth**
   - What we know: `Command.GetCommandNames(english: true, loaded: true)` returns command names. `Command.CommandContextHelpUrl` returns help URL. Basic descriptions available from the Rhino docs HTML reference.
   - What's unclear: Parameter extraction is NOT available via RhinoCommon API. Parameters, types, and defaults would need to be manually curated or scraped from individual command help pages on `docs.mcneel.com`.
   - Recommendation: Start with a manifest containing command names + descriptions (scrapeable). Add parameter metadata iteratively as the agent's usage patterns reveal which commands need richer context. The `metadata` JSONB column in `search_documents` is extensible.

2. **Migration location: apps/kargadan or packages/database?**
   - What we know: The main platform migration is `packages/database/migrations/0001_initial.ts`. Kargadan-specific tables don't belong in the shared platform schema.
   - What's unclear: Whether `@effect/sql-pg` PgMigrator supports multiple migration directories (one per app).
   - Recommendation: Create Kargadan-specific migration in `apps/kargadan/harness/migrations/` with its own `MigratorLive` instance. The harness already has its own `PgClientLayer` with separate connection config.

3. **KB embedding refresh strategy**
   - What we know: The command catalog is static (~500 commands). Embeddings only change when the manifest or embedding model changes.
   - What's unclear: Whether to embed at build time (store vectors in manifest) or at first-run (generate embeddings on harness start).
   - Recommendation: Embed at seeding time (a one-time CLI command), not at harness startup. Store the pre-computed embeddings in the seeding script output. This avoids OpenAI API dependency at harness start and keeps startup fast.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/database/src/search.ts` -- full pgvector integration with HNSW, halfvec, iterative scan
- Existing codebase: `packages/database/src/factory.ts` -- polymorphic repo factory with transactions, OCC, tenant scoping
- Existing codebase: `packages/database/src/client.ts` -- `Client.vector.withIterativeScan`, `SqlClient.withTransaction`
- Existing codebase: `packages/ai/src/runtime.ts` -- `AiRuntime.embed()` with caching, rate limiting, budget tracking
- Existing codebase: `packages/database/migrations/0001_initial.ts` -- pgvector 0.8+ validation, HNSW index config
- Existing codebase: `apps/kargadan/harness/src/persistence/checkpoint.ts` -- current CheckpointService implementation
- Existing codebase: `apps/kargadan/harness/src/runtime/agent-loop.ts` -- current agent loop with PersistenceTrace usage

### Secondary (MEDIUM confidence)
- [pgvector 0.8.0 release notes](https://www.postgresql.org/about/news/pgvector-080-released-2952/) -- iterative scan, halfvec improvements
- [AWS pgvector HNSW vs IVFFlat deep dive](https://aws.amazon.com/blogs/database/optimize-generative-ai-applications-with-pgvector-indexing-a-deep-dive-into-ivfflat-and-hnsw-techniques/) -- HNSW recommended for low-latency, high-recall
- [OpenAI embeddings documentation](https://developers.openai.com/api/docs/guides/embeddings/) -- text-embedding-3-small, 1536 dimensions, cosine similarity
- [Neon halfvec guide](https://neon.com/blog/dont-use-vector-use-halvec-instead-and-save-50-of-your-storage-cost) -- halfvec 50% storage savings, negligible recall impact
- [RhinoCommon Command class](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.command) -- GetCommandNames, CommandContextHelpUrl
- [Rhino command list reference](http://docs.mcneel.com/rhino/8mac/help/en-us/commandlist/command_list.htm) -- ~500 commands, alphabetical, name+description+toolbar

### Tertiary (LOW confidence)
- [LangGraph PostgreSQL checkpoint patterns](https://fast.io/resources/langgraph-persistence/) -- confirms per-step checkpoint + thread_id pattern is standard in agent frameworks (different ecosystem but validates the architectural approach)
- Rhino command parameter extraction -- no programmatic API found in RhinoCommon for extracting parameter schemas; manual curation likely needed for rich metadata

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- every library is already in the workspace catalog and actively used in the codebase
- Architecture: HIGH -- patterns derived directly from existing `packages/database` and `packages/ai` implementations
- Pitfalls: HIGH -- identified from direct code analysis of current `CheckpointService` limitations and existing `SearchRepo` constraints
- KB extraction: MEDIUM -- command names and descriptions are extractable, but parameter-level metadata requires manual curation (no RhinoCommon API for this)

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable -- all dependencies pinned in workspace catalog)
