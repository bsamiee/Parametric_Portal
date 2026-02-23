# Phase 04: Session Persistence and Knowledge Base - Research

**Researched:** 2026-02-23
**Domain:** PostgreSQL persistence, @effect/sql Model.Class, @effect/ai Chat persistence, pgvector semantic search, embedding pipeline, command extraction
**Confidence:** HIGH

## Summary

Phase 04 builds durable agent sessions and a searchable Rhino command knowledge base on the existing PostgreSQL + pgvector + Effect infrastructure. The deep investigation reveals that the Effect ecosystem provides purpose-built primitives for every persistence concern: `Chat.exportJson` / `Chat.fromJson` for conversation history serialization, `@effect/experimental` `BackingPersistence` as the backing store for `Chat.Persistence` (which wraps persisted chats with automatic save-after-generate), `SqlClient.withTransaction` for atomic multi-table writes, `Model.Class` with field modifiers (`Generated`, `FieldOption`, `DateTimeUpdateFromDate`) for typed table models, and `SqlSchema.findAll` / `SqlSchema.single` / `SqlSchema.void` for typed query execution. The `SearchRepo` service in `packages/database` provides full pgvector HNSW cosine similarity with 10-signal RRF fusion, `halfvec(3072)`, and iterative scan support. `AiRuntime.embed` handles embedding generation with caching, rate limiting, budget tracking, and provider fallback.

The critical architectural insight is that `Chat.Persistence` from `@effect/ai` expects a `BackingPersistence` from `@effect/experimental`. Rather than hand-rolling checkpoint serialization, the harness should implement a PostgreSQL-backed `BackingPersistence` layer that stores chat state via `@effect/sql`, then provide it to `Chat.layerPersisted`. This gives the harness `Chat.Persisted` instances with built-in `exportJson` / `fromJson` and automatic save-after-generate -- eliminating custom conversation history serialization. The checkpoint table stores the serialized chat JSON alongside loop state and tool call sequences in a single transaction.

**Primary recommendation:** Wire `Chat.Persistence` through a PostgreSQL-backed `BackingPersistence`, use `Model.Class` for all Kargadan tables, reuse `SearchRepo` + `AiRuntime.embed` for the knowledge base, and wrap every tool call persistence in `SqlClient.withTransaction`.

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
| PERS-01 | Conversation history, run events, snapshots, and tool call results persist to PostgreSQL -- replacing the in-memory PersistenceTrace | `Chat.exportJson` serializes conversation history; `SqlClient.withTransaction` provides atomic multi-table writes; `Model.Class` replaces raw SQL with typed schemas; `BackingPersistence` backs `Chat.Persistence` |
| PERS-02 | Session resumption restores from the last PostgreSQL checkpoint -- rebuilds loop state, Chat history, and active context without data loss | `Chat.fromJson` restores conversation from serialized JSON; `SqlSchema.findOne` loads latest checkpoint; decode-or-fresh-start pattern for corruption fallback; `Chat.Persistence.getOrCreate` handles session hydration |
| PERS-03 | Every tool call is logged with parameters, result, duration, and failure status for audit and replay | `Model.Class` with `Generated` fields for auto-timestamps; `SqlSchema.void` for insert-only writes; same `withTransaction` as checkpoint update guarantees atomicity |
| PERS-04 | Past agent sessions are queryable and replayable from the audit trail | `SqlSchema.findAll` for session listing with predicate filtering; `SqlSchema.findOne` for single session lookup; join over `kargadan_tool_calls` for replay trace |
| PERS-05 | Rhino command knowledge base is seeded with command descriptions, parameters, examples, and alias enrichment for accurate RAG retrieval | Reuse `search_documents` + `search_embeddings` with `entityType: 'rhinoCommand'`; `AiRuntime.embed` for vector generation; `SearchRepo.upsertEmbedding` for storage; `AiEmbeddingModel.makeDataLoader` for batched embedding requests |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/sql` | 0.49.0 | `SqlClient.withTransaction`, `SqlSchema.findAll`/`single`/`findOne`/`void`, `Model.Class` with field modifiers (`Generated`, `FieldOption`, `DateTimeUpdateFromDate`) | Already in workspace catalog; provides typed queries, transaction management, automatic camelCase/snake_case transform, variant schemas for insert/select/update |
| `@effect/sql-pg` | 0.50.3 | `PgClient.layerConfig`, `PgMigrator.fromFileSystem` for Kargadan-specific migrations | Already in workspace catalog; harness has its own PgClientLayer at `harness.ts:72-77` |
| `@effect/ai` | 0.33.2 | `Chat.exportJson`/`fromJson` for conversation serialization, `Chat.Persistence`/`Chat.layerPersisted` for managed persistent chats, `Tool.make`/`Toolkit.make` for KB tool definitions, `AiEmbeddingModel.makeDataLoader` for batched embeddings | Already in workspace catalog; `Chat.Persistence` eliminates custom history serialization |
| `@effect/experimental` | 0.58.0 | `BackingPersistence` interface for `Chat.Persistence` backing store, `ResultPersistence` for Exit caching | Already in workspace catalog; required dependency of `Chat.layerPersisted` |
| `effect` | 3.19.18 | Runtime, Schema, Effect.Service, Ref, Match, Option, Data.TaggedEnum, Data.TaggedError | Core framework; all services built with Effect patterns |
| pgvector extension | 0.8+ | Vector similarity search, halfvec, HNSW index, iterative scan | Already installed in migration `0001_initial.ts`; validated via `hnsw.iterative_scan` check |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/ai-openai` | 0.37.2 | `OpenAiEmbeddingModel` for KB embedding generation via `AiRuntime.embed` | KB seeding: generate embeddings for Rhino command descriptions |
| `packages/database` (internal) | workspace | `repo()` factory, `Client`, `SearchRepo`, `Page`, `Field`, existing `Model.Class` patterns in `models.ts` | All persistence CRUD; search document upsert; keyset pagination for session listing |
| `packages/ai` (internal) | workspace | `AiRuntime.embed()` (overloaded: single string or batch array), `AiRegistry` for provider+dimension settings | Embedding generation for KB seeding; reuse existing embed pipeline with caching, rate limiting, budget |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Chat.Persistence` + `BackingPersistence` | Manual `Chat.exportJson` + raw SQL storage | Manual approach works but misses auto-save-after-generate, managed getOrCreate, and TTL support. Use `Chat.Persistence` for the full lifecycle. |
| pgvector HNSW | pgvector IVFFlat | IVFFlat has faster build times but worse recall and requires data pre-population. HNSW is already configured in the codebase and works without data. Use HNSW. |
| `text-embedding-3-small` (1536d) | `text-embedding-3-large` (3072d) | 3072d has marginally better quality but 2x storage/index cost. The `search_embeddings` table uses `halfvec(3072)` with zero-padding, so 1536d fits natively. Use 1536d for cost efficiency on ~500 commands. |
| Separate Kargadan search tables | Reuse `search_documents` + `search_embeddings` | Separate tables would duplicate the entire search infrastructure. Reuse existing tables with `entityType: 'rhinoCommand'` and `scopeId: null` (global). |
| `Model.makeRepository` (built-in) | Custom `repo()` factory from `packages/database` | `Model.makeRepository` provides basic CRUD (insert, update, findById, delete) but lacks the polymorphic predicate builder, OCC, soft-delete, keyset pagination, and tenant scoping from the existing `repo()` factory. Use `repo()` for consistency with the rest of the codebase. |

**Installation:** No new packages required. All dependencies are already in the workspace catalog (`pnpm-workspace.yaml`).

## Existing Code Map

### Files That Will Be Modified

| File | Current Role | Phase 04 Change |
|------|-------------|-----------------|
| `apps/kargadan/harness/src/persistence/checkpoint.ts` | Raw SQL CheckpointService with `sql` template strings, in-memory Ref store | Replace with `Model.Class`-based PersistenceService using `SqlSchema`/`withTransaction`; keep Ref as write-through cache |
| `apps/kargadan/harness/src/runtime/agent-loop.ts` | Agent loop with `CheckpointService.appendTransition`/`snapshot`/`replay` calls | Update to call new PersistenceService atomically per tool call |
| `apps/kargadan/harness/src/harness.ts` | Entry point composing `ServicesLayer` with `PgClientLayer`; calls `checkpoint.restore`/`save` | Add Kargadan migrator layer; update restore logic to use `Chat.fromJson` for conversation hydration; add corruption fallback |

### Files That Provide Reusable Infrastructure (DO NOT MODIFY)

| File | What It Provides | How Phase 04 Uses It |
|------|-----------------|---------------------|
| `packages/database/src/client.ts` | `Client.vector.withIterativeScan`, `Client.layerFromConfig`, `Client.listen` (LISTEN/NOTIFY) | Iterative scan for KB queries; harness PgClientLayer uses same config pattern |
| `packages/database/src/factory.ts` | `repo()` factory: `by`/`find`/`one`/`page`/`put`/`set`/`preds`/`withTransaction` | Session listing, tool call querying, predicate-based filtering |
| `packages/database/src/search.ts` | `SearchRepo.search()` (10-signal RRF), `SearchRepo.upsertEmbedding()`, `SearchRepo.embeddingSources()` | KB command search (cosine similarity), embedding storage, source enumeration for re-embedding |
| `packages/database/src/models.ts` | 14 `Model.Class` definitions demonstrating field modifier patterns | Reference pattern for Kargadan model definitions |
| `packages/database/src/migrator.ts` | `MigratorLive` with `PgMigrator.fromFileSystem` | Pattern for Kargadan-specific migrator with separate migration directory |
| `packages/ai/src/runtime.ts` | `AiRuntime.embed(string)` → `number[]`, `AiRuntime.embed(string[])` → `number[][]` | KB embedding generation via existing provider pipeline |
| `packages/ai/src/search.ts` | `SearchService.refreshEmbeddings` pattern: embeddingSources → embed batch → upsertEmbedding | Blueprint for KB seeding pipeline |
| `packages/ai/src/registry.ts` | `AiRegistry.layers(settings)` returns embedding + language layers; `_SettingsSchema.embedding` has `model: 'text-embedding-3-small'`, `dimensions: 1536` | Default embedding model and dimensions for KB |

### New Files to Create

| File | Purpose |
|------|---------|
| `apps/kargadan/harness/src/persistence/models.ts` | `Model.Class` definitions for `kargadan_sessions`, `kargadan_tool_calls`, `kargadan_checkpoints` |
| `apps/kargadan/harness/migrations/0001_kargadan.ts` | Kargadan-specific PostgreSQL migration: tables, indexes, constraints |
| `apps/kargadan/harness/src/knowledge/manifest.ts` | Static command manifest schema + JSON loader |
| `apps/kargadan/harness/src/knowledge/seeder.ts` | KB seeding service: reads manifest, upserts search_documents, generates embeddings |

## External Lib API Reference

### @effect/ai: Chat Persistence

**Source:** [Context7 /tim-smart/effect-io-ai](https://github.com/tim-smart/effect-io-ai) + [raw source Chat.ts](https://github.com/Effect-TS/effect/tree/main/packages/ai/ai/src/Chat.ts)
**Confidence:** HIGH

```typescript
// Chat.Service -- conversation with Ref-based history
interface Service {
    readonly history: Ref.Ref<Prompt.Prompt>
    readonly export: Effect.Effect<unknown, AiError.AiError>
    readonly exportJson: Effect.Effect<string, AiError.MalformedOutput>
    readonly generateText: <Options, Tools>(options: ...) => Effect.Effect<...>
    readonly streamText: <Options, Tools>(options: ...) => Stream.Stream<...>
    readonly generateObject: <A, I, R, Options, Tools>(options: ...) => Effect.Effect<...>
}

// Chat.Persisted -- extends Service with id + auto-save
interface Persisted extends Service {
    readonly id: string
    readonly save: Effect.Effect<void, AiError.MalformedOutput | PersistenceBackingError>
}

// Constructors
const empty: Effect.Effect<Service>
const fromPrompt: (prompt: Prompt.RawInput) => Effect.Effect<Service>
const fromJson: (data: string) => Effect.Effect<Service, ParseError, LanguageModel.LanguageModel>
const fromExport: (data: unknown) => Effect.Effect<Service, ParseError, LanguageModel.LanguageModel>

// Persisted chat factories
const makePersisted: (options: { readonly storeId: string }) =>
    Effect.Effect<Persistence, never, Scope | BackingPersistence | LanguageModel.LanguageModel>
const layerPersisted: (options: { readonly storeId: string }) =>
    Layer.Layer<Persistence, never, BackingPersistence>

// Persistence.Service -- managed persisted chat lifecycle
interface Persistence.Service {
    readonly get: (chatId: string, options?: { readonly timeToLive?: Duration.DurationInput }) =>
        Effect.Effect<Persisted, ChatNotFoundError | PersistenceBackingError>
    readonly getOrCreate: (chatId: string, options?: { readonly timeToLive?: Duration.DurationInput }) =>
        Effect.Effect<Persisted, AiError.MalformedOutput | PersistenceBackingError>
}
```

**Usage pattern for Phase 04:** Use `Chat.layerPersisted({ storeId: 'kargadan-chat' })` backed by a PostgreSQL `BackingPersistence`. On restore, `Persistence.getOrCreate(sessionId)` either loads existing conversation or creates fresh. The `Persisted.save` method auto-invokes after each generate call; the harness additionally calls `exportJson` within the atomic checkpoint transaction to serialize the full conversation alongside loop state.

### @effect/experimental: BackingPersistence

**Source:** [raw source Persistence.ts](https://github.com/Effect-TS/effect/tree/main/packages/experimental/src/Persistence.ts)
**Confidence:** HIGH

```typescript
// BackingPersistence -- the storage interface that Chat.Persistence depends on
interface BackingPersistence {
    readonly make: (storeId: string) => Effect.Effect<BackingPersistenceStore, never, Scope>
}

// BackingPersistenceStore -- key-value operations
interface BackingPersistenceStore {
    readonly get: (key: string) => Effect.Effect<Option.Option<unknown>, PersistenceError>
    readonly getMany: (keys: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Option.Option<unknown>>, PersistenceError>
    readonly set: (key: string, value: unknown, options?: { ttl?: Duration.DurationInput }) => Effect.Effect<void, PersistenceError>
    readonly setMany: (entries: ReadonlyArray<readonly [string, unknown]>, options?: { ttl?: Duration.DurationInput }) => Effect.Effect<void, PersistenceError>
    readonly remove: (key: string) => Effect.Effect<void, PersistenceError>
    readonly clear: () => Effect.Effect<void, PersistenceError>
}

// Built-in layers
const layerMemory: Layer.Layer<BackingPersistence>
const layerKeyValueStore: Layer.Layer<BackingPersistence, never, KeyValueStore.KeyValueStore>

// ResultPersistence -- higher-level Exit caching (optional)
const layerResult: Layer.Layer<ResultPersistence, never, BackingPersistence>
const layerResultMemory: Layer.Layer<ResultPersistence>

// Errors
class PersistenceParseError  // schema deserialization
class PersistenceBackingError  // storage operation
```

**Usage pattern for Phase 04:** Implement a PostgreSQL-backed `BackingPersistence` layer that stores key-value pairs in the `kargadan_checkpoints` table using `@effect/sql`. The `make(storeId)` factory returns a store scoped to the checkpoint table. `Chat.layerPersisted` consumes this layer automatically.

### @effect/ai: Tool.make and Toolkit.make

**Source:** [Context7 /tim-smart/effect-io-ai](https://github.com/tim-smart/effect-io-ai) + [raw source Tool.ts](https://github.com/Effect-TS/effect/tree/main/packages/ai/ai/src/Tool.ts)
**Confidence:** HIGH

```typescript
// Tool.make -- primary tool constructor
const make: <const Name extends string, Parameters, Success, Failure>(
    name: Name,
    options?: {
        readonly description?: string
        readonly parameters?: Parameters   // Schema.Struct.Fields
        readonly success?: Success          // Schema.Schema.Any
        readonly failure?: Failure          // Schema.Schema.All
    }
) => Tool<Name, Config, never>

// Tool annotations for metadata (e.g., KB manifest integration)
class Title extends Context.Tag("@effect/ai/Tool/Title")<Title, string>()
class Readonly extends Context.Reference<Readonly>()
class Destructive extends Context.Reference<Destructive>()
class Idempotent extends Context.Reference<Idempotent>()
class OpenWorld extends Context.Reference<OpenWorld>()

// Tool instance methods
tool.annotate(Tag, value)       // add metadata annotation
tool.setParameters(schema)      // override parameter schema
tool.setSuccess(schema)         // override success schema
tool.addDependency(tag)         // add service dependency

// Toolkit.make -- compose tools into a toolkit
const make: <const Tools extends ReadonlyArray<Tool.Any>>(
    ...tools: Tools
) => Toolkit<ToolsByName<Tools>>

// Toolkit instance methods
toolkit.of(handlers)            // type-safe handler declaration
toolkit.toContext(build)        // convert to Effect Context with handlers
toolkit.toLayer(build)          // convert to Layer with handlers

// Toolkit.merge -- combine multiple toolkits
const merge: <Toolkits extends ReadonlyArray<Toolkit.Any>>(
    ...toolkits: Toolkits
) => Toolkit<MergedTools<Toolkits>>
```

**Usage pattern for Phase 04:** The KB manifest shape should align with `Tool.make` parameter schemas so the same manifest feeds both the embedding pipeline AND future tool definitions. Each Rhino command in the manifest maps to a `Tool.make(commandName, { description, parameters: Schema.Struct({...}), success, failure })`. The `Readonly` / `Destructive` annotations classify commands for the agent's risk model. This dual-purpose design avoids maintaining separate manifests for search and tool invocation.

### @effect/ai: AiEmbeddingModel.makeDataLoader

**Source:** [Context7 /tim-smart/effect-io-ai](https://github.com/tim-smart/effect-io-ai)
**Confidence:** HIGH

```typescript
const makeDataLoader: (options: {
    readonly embedMany: (input: ReadonlyArray<string>) =>
        Effect.Effect<Array<AiEmbeddingModel.Result>, AiError>
    readonly window: Duration.DurationInput
    readonly maxBatchSize?: number
}) => Effect.Effect<AiEmbeddingModel.Service, never, Scope>
```

**Usage pattern for Phase 04:** For KB seeding, use `AiEmbeddingModel.makeDataLoader` to batch embedding requests within a 100ms window with `maxBatchSize: 200` (matching `_CONFIG.limits.embeddingBatch` in `packages/database/src/search.ts`). This deduplicates concurrent embed calls during the seeding pipeline. However, `AiRuntime.embed(batch)` already handles batching at the application level, so `makeDataLoader` is only needed if the seeding pipeline issues many concurrent single-string embed calls.

### @effect/sql: Model.Class Field Modifiers

**Source:** [Context7 /effect-ts/effect](https://github.com/effect-ts/effect) + [raw source Model.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/Model.ts)
**Confidence:** HIGH

```typescript
// Model.Class -- base class for typed SQL models
class KargadanSession extends Model.Class<KargadanSession>('KargadanSession')({
    id:         Model.Generated(S.UUID),        // excluded from insert; available in select/update
    runId:      S.UUID,                          // required in all variants
    status:     S.Literal('running', 'completed', 'failed', 'interrupted'),
    error:      Model.FieldOption(S.String),     // null in DB, undefined in JSON; optional across all variants
    startedAt:  S.DateFromSelf,                  // required
    endedAt:    Model.FieldOption(S.DateFromSelf),  // optional timestamp
    updatedAt:  Model.DateTimeUpdateFromDate,    // auto-set to now() on insert/update
}) {}

// Field modifier reference:
// Generated<S>             -- select+update only, excluded from insert
// GeneratedByApp<S>        -- required by DB, optional for JSON
// Sensitive<S>             -- excluded from all JSON variants
// FieldOption<S>           -- optional across all variants; null in DB, missing in JSON
// DateTimeUpdateFromDate   -- auto-updated to now() on every insert/update
// DateTimeInsertFromDate   -- auto-set to now() on insert only

// Model variants (auto-derived):
// KargadanSession.insert   -- Schema for INSERT (excludes Generated fields)
// KargadanSession.update   -- Schema for UPDATE
// KargadanSession.json     -- Schema for JSON serialization (excludes Sensitive)
// KargadanSession.jsonCreate -- Schema for JSON creation
// KargadanSession.jsonUpdate -- Schema for JSON update

// Built-in repository helpers:
const makeRepository: <S extends Model.Any, Id>(model: S, options: {
    readonly tableName: string
    readonly idColumn: string
    readonly spanPrefix: string
}) => Effect.Effect<{ insert, update, findById, delete }, never, SqlClient>

const makeDataLoaders: <S extends Model.Any, Id>(model: S, options: {
    readonly tableName: string
    readonly idColumn: string
    readonly spanPrefix: string
    readonly window: Duration.DurationInput
    readonly maxBatchSize?: number
}) => Effect.Effect<DataLoaders<S, Id>, never, SqlClient | Scope>
```

### @effect/sql: SqlSchema Query Helpers

**Source:** [Context7 /effect-ts/effect](https://github.com/effect-ts/effect) + [raw source SqlSchema.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/SqlSchema.ts)
**Confidence:** HIGH

```typescript
// SqlSchema.findAll -- returns ReadonlyArray<A>
const findAll: <IR, II, IA, AR, AI, A, R, E>(options: {
    readonly Request: Schema.Schema<IA, II, IR>
    readonly Result: Schema.Schema<A, AI, AR>
    readonly execute: (request: II) => Effect.Effect<ReadonlyArray<unknown>, E, R>
}) => (request: IA) => Effect.Effect<ReadonlyArray<A>, E | ParseError, R | IR | AR>

// SqlSchema.findOne -- returns Option.Option<A>
const findOne: <IR, II, IA, AR, AI, A, R, E>(options: {
    readonly Request: Schema.Schema<IA, II, IR>
    readonly Result: Schema.Schema<A, AI, AR>
    readonly execute: (request: II) => Effect.Effect<ReadonlyArray<unknown>, E, R>
}) => (request: IA) => Effect.Effect<Option.Option<A>, E | ParseError, R | IR | AR>

// SqlSchema.single -- returns A (throws NoSuchElementException if empty)
const single: <IR, II, IA, AR, AI, A, R, E>(options: {
    readonly Request: Schema.Schema<IA, II, IR>
    readonly Result: Schema.Schema<A, AI, AR>
    readonly execute: (request: II) => Effect.Effect<ReadonlyArray<unknown>, E, R>
}) => (request: IA) => Effect.Effect<A, E | ParseError | NoSuchElementException, R | IR | AR>

// SqlSchema.void -- returns void (insert, update, delete)
const void: <IR, II, IA, R, E>(options: {
    readonly Request: Schema.Schema<IA, II, IR>
    readonly execute: (request: II) => Effect.Effect<unknown, E, R>
}) => (request: IA) => Effect.Effect<void, E | ParseError, R | IR>
```

### @effect/sql: SqlClient.withTransaction

**Source:** [Context7 /effect-ts/effect](https://github.com/effect-ts/effect) + [raw source SqlClient.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/SqlClient.ts)
**Confidence:** HIGH

```typescript
// SqlClient.SqlClient -- the sql tag function with transaction support
interface SqlClient extends Constructor {
    readonly withTransaction: <R, E, A>(
        self: Effect<A, E, R>
    ) => Effect<A, E | SqlError, R>
    readonly reserve: Effect.Effect<Connection, SqlError, Scope>
    readonly withoutTransforms: () => SqlClient
}

// Usage in the existing codebase (harness.ts:72-77):
const PgClientLayer = PgClient.layerConfig({
    connectTimeout: Config.succeed(Duration.seconds(10)),
    idleTimeout:    Config.succeed(Duration.seconds(30)),
    maxConnections: Config.succeed(5),
    url:            HarnessConfig.checkpointDatabaseUrl.pipe(Config.map((urlString) => urlString as never)),
})
```

### @effect/sql-pg: PgMigrator

**Source:** [Context7 /effect-ts/effect](https://github.com/effect-ts/effect)
**Confidence:** HIGH

```typescript
// PgMigrator.layer -- configure migration runner
const layer: (options: {
    readonly loader: Loader
    readonly schemaDirectory?: string
    readonly table?: string  // default: 'effect_sql_migrations'
}) => Layer.Layer<never, SqlError | MigratorError, SqlClient | FileSystem | Path>

// PgMigrator.fromFileSystem -- load migrations from directory
const fromFileSystem: (directory: string) => Loader

// Migration file format:
// export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`CREATE TABLE ...`)
```

**Usage pattern for Phase 04:** Create a separate migrator for Kargadan at `apps/kargadan/harness/migrations/` with its own `PgMigrator.layer({ loader: PgMigrator.fromFileSystem(...), table: 'kargadan_migrations' })`. Use a distinct migration table name to avoid collision with the platform's `effect_sql_migrations` table.

## Architecture Patterns

### Recommended Module Structure

```
apps/kargadan/harness/
  src/
    persistence/
      checkpoint.ts        # PersistenceService: atomic checkpoint+toolcall writes, write-through Ref cache, restore with corruption fallback
      models.ts            # Model.Class: KargadanSession, KargadanToolCall, KargadanCheckpoint
    knowledge/
      manifest.ts          # CommandManifest schema + JSON loader; dual-purpose shape for search AND Tool.make
      seeder.ts            # KBSeeder: reads manifest, upserts search_documents, generates embeddings via AiRuntime.embed
    runtime/
      agent-loop.ts        # Updated: calls PersistenceService.persist() per tool call within withTransaction
    protocol/
      schemas.ts           # Unchanged: protocol envelope schemas
      dispatch.ts          # Unchanged: command dispatch + session supervisor
    config.ts              # Unchanged: HarnessConfig
    socket.ts              # Unchanged: WebSocket client
    harness.ts             # Updated: add migrator layer, Chat.Persistence layer, corruption fallback
  migrations/
    0001_kargadan.ts       # Kargadan-specific tables: sessions, tool_calls, checkpoints
```

### Pattern 1: PostgreSQL-Backed BackingPersistence for Chat.Persistence

**What:** Implement `BackingPersistence` from `@effect/experimental` backed by PostgreSQL via `@effect/sql`, then provide to `Chat.layerPersisted`. This gives the harness managed `Chat.Persisted` instances with `exportJson`/`fromJson` and automatic save-after-generate.

**When to use:** Chat history persistence (PERS-01, PERS-02).

**Example:**
```typescript
// Source: @effect/experimental BackingPersistence interface + @effect/sql SqlClient
const PgBackingPersistence = Layer.effect(
    BackingPersistence,
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return BackingPersistence.of({
            make: (storeId) => Effect.gen(function* () {
                return {
                    get: (key) => sql`SELECT value FROM kargadan_chat_store WHERE store_id = ${storeId} AND key = ${key}`
                        .pipe(Effect.map((rows) => rows.length > 0 ? Option.some(JSON.parse(rows[0].value)) : Option.none())),
                    set: (key, value) => sql`INSERT INTO kargadan_chat_store (store_id, key, value) VALUES (${storeId}, ${key}, ${JSON.stringify(value)}::jsonb)
                        ON CONFLICT (store_id, key) DO UPDATE SET value = EXCLUDED.value`.pipe(Effect.asVoid),
                    // ... remaining operations
                } satisfies BackingPersistenceStore;
            }),
        });
    }),
);
```

### Pattern 2: Atomic Checkpoint + Tool Call Log via withTransaction

**What:** Every tool call writes the tool call log row AND the checkpoint snapshot in a single PostgreSQL transaction via `SqlClient.withTransaction`. The in-memory Ref is updated in the same Effect pipeline (write-through cache).

**When to use:** Every tool call completion, success or failure (locked decision).

**Example:**
```typescript
// Source: existing codebase patterns from packages/database + @effect/sql SqlClient.withTransaction
const persist = Effect.fn('Persistence.persist')((input: {
    readonly toolCall: typeof KargadanToolCall.insert.Type;
    readonly checkpoint: typeof KargadanCheckpoint.insert.Type;
    readonly chatJson: string;
}) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
            Effect.all([
                SqlSchema.void({
                    Request: KargadanToolCall.insert,
                    execute: (row) => sql`INSERT INTO kargadan_tool_calls ${sql.insert(row)}`,
                })(input.toolCall),
                SqlSchema.void({
                    Request: KargadanCheckpoint.insert,
                    execute: (row) => sql`
                        INSERT INTO kargadan_checkpoints ${sql.insert(row)}
                        ON CONFLICT (session_id) DO UPDATE SET
                            loop_state = EXCLUDED.loop_state,
                            chat_json = EXCLUDED.chat_json,
                            state_hash = EXCLUDED.state_hash,
                            sequence = EXCLUDED.sequence,
                            updated_at = NOW()`,
                })(input.checkpoint),
            ], { discard: true }),
        );
        // Write-through: update in-memory Ref after successful DB write
        yield* Ref.update(store, (c) => ({ ...c, events: [...c.events, input.toolCall] }));
    }),
);
```

### Pattern 3: Silent Resume with Corruption Fallback

**What:** On startup, load the latest checkpoint. Decode loop state and chat JSON. If decode fails, log corruption, preserve raw data in a `_corrupted` column, start fresh session.

**When to use:** Harness entry point (PERS-02).

**Example:**
```typescript
// Source: existing harness.ts restore pattern + CONTEXT.md decisions + Chat.fromJson
const hydrate = Effect.fn('Persistence.hydrate')((sessionId: string) =>
    SqlSchema.findOne({
        Request: S.String,
        Result: KargadanCheckpoint,
        execute: (sid) => sql`SELECT * FROM kargadan_checkpoints WHERE session_id = ${sid} ORDER BY updated_at DESC LIMIT 1`,
    })(sessionId).pipe(
        Effect.flatMap(Option.match({
            onNone: () => Effect.succeed({ fresh: true, state: initialLoopState }),
            onSome: (row) =>
                S.decodeUnknown(LoopStateSchema)(row.loopState).pipe(
                    Effect.flatMap((loopState) => Chat.fromJson(row.chatJson).pipe(
                        Effect.map((chat) => ({ chat, fresh: false, state: loopState })),
                    )),
                    Effect.catchAll((decodeError) =>
                        Effect.log('kargadan.checkpoint.corrupt', { error: String(decodeError), sessionId }).pipe(
                            Effect.as({ fresh: true, state: initialLoopState }),
                        ),
                    ),
                ),
        })),
    ),
);
```

### Pattern 4: KB Seeding via Existing Search Infrastructure

**What:** Insert Rhino command descriptions into `search_documents` with `entityType: 'rhinoCommand'` and `scopeId: null` (global scope). Generate embeddings via `AiRuntime.embed` and upsert via `SearchRepo.upsertEmbedding`.

**When to use:** Build-time or one-time seeding script (PERS-05).

**Example:**
```typescript
// Source: packages/ai/src/search.ts refreshEmbeddings pattern
const seed = Effect.fn('KBSeeder.seed')((manifest: ReadonlyArray<CommandManifestEntry>) =>
    Effect.gen(function* () {
        const [database, ai] = yield* Effect.all([DatabaseService, AiRuntime]);
        const settings = yield* ai.settings();
        const { dimensions, model } = settings.embedding;
        // Insert search documents
        yield* Effect.forEach(manifest, (cmd) =>
            database.search.upsertSearchDocument({
                contentText: cmd.description,
                displayText: cmd.name,
                entityId: cmd.id,
                entityType: 'rhinoCommand',
                metadata: { examples: cmd.examples, params: cmd.params },
                scopeId: null,
            }),
            { concurrency: 10, discard: true },
        );
        // Embed in batches
        const texts = manifest.map((cmd) => [cmd.name, cmd.description].join(' '));
        const embeddings = yield* ai.embed(texts);
        // Upsert embeddings
        yield* Effect.forEach(
            Array.zip(manifest, embeddings),
            ([cmd, embedding]) => database.search.upsertEmbedding({
                dimensions,
                documentHash: hashCanonicalState(cmd),
                embedding,
                entityId: cmd.id,
                entityType: 'rhinoCommand',
                model,
                scopeId: null,
            }),
            { concurrency: 10, discard: true },
        );
    }),
);
```

### Pattern 5: Dual-Purpose Command Manifest Shape

**What:** The command manifest JSON schema aligns with `Tool.make` parameter definitions so the same manifest serves both KB embedding (PERS-05) and future tool definitions (Phase 5 AGNT-02/AGNT-04). Each command entry contains the fields needed for `Tool.make(name, { description, parameters })`.

**When to use:** Manifest design (PERS-05) with forward compatibility for Phase 5.

**Example:**
```typescript
// Source: @effect/ai Tool.make signature + KB seeding requirements
const CommandManifestEntrySchema = S.Struct({
    id:          S.NonEmptyTrimmedString,
    name:        S.NonEmptyTrimmedString,
    description: S.NonEmptyString,
    params:      S.Array(S.Struct({
        name:        S.NonEmptyTrimmedString,
        type:        S.NonEmptyTrimmedString,
        default:     S.optional(S.Unknown),
        description: S.optional(S.String),
        required:    S.Boolean,
    })),
    examples:    S.Array(S.Struct({
        input:       S.NonEmptyString,
        description: S.optional(S.String),
    })),
    category:    S.optional(S.NonEmptyTrimmedString),
    isDestructive: S.optional(S.Boolean),
});
// KB uses: name + description + params + examples for embedding text
// Phase 5 uses: Tool.make(entry.name, { description: entry.description, parameters: paramsToStruct(entry.params) })
//               .annotate(Tool.Destructive, entry.isDestructive ?? false)
```

### Anti-Patterns to Avoid

- **Parallel search infrastructure:** Do NOT create a separate `kargadan_command_embeddings` table or custom cosine similarity query. The existing `search_documents` + `search_embeddings` + `SearchRepo` already handle HNSW iterative scan, RRF scoring, and embedding upsert.
- **Raw SQL in services:** The current `CheckpointService` uses raw `sql` template strings with manual column aliasing. Replace with `Model.Class` + `SqlSchema` for schema validation and type safety, matching the `packages/database/models.ts` pattern.
- **Delta-based reconstruction:** User explicitly chose full snapshots. Do NOT implement event sourcing or delta replay for checkpoint restoration. Each checkpoint is self-contained.
- **Custom embedding pipeline:** Do NOT hand-roll embedding API calls. Use `AiRuntime.embed()` which handles caching, rate limiting, budget tracking, and provider abstraction.
- **Custom chat serialization:** Do NOT hand-roll conversation history JSON serialization. Use `Chat.exportJson` (serializes history via `Prompt.FromJson` schema) and `Chat.fromJson` (restores from JSON string). These are the official @effect/ai primitives for this purpose.
- **Separate migration table collision:** Do NOT share the platform's `effect_sql_migrations` table. Use a separate `kargadan_migrations` table via `PgMigrator.layer({ table: 'kargadan_migrations' })`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chat history serialization | Custom JSON encode/decode for conversation | `Chat.exportJson` / `Chat.fromJson` | Official @effect/ai API; handles Prompt schema encoding, tool call parts, reasoning parts; compatible with `Chat.Persistence` |
| Chat persistence lifecycle | Manual save/load/getOrCreate for chat state | `Chat.layerPersisted` + `BackingPersistence` | Provides `Persisted` with auto-save-after-generate, TTL support, managed lifecycle |
| Vector similarity search | Custom cosine similarity query | `SearchRepo.search()` with existing RRF pipeline | 10-signal fusion (FTS + trigram + phonetic + semantic), iterative scan tuning, keyset pagination already built |
| Embedding generation | Direct OpenAI API calls | `AiRuntime.embed()` / `AiRuntime.embed(batch)` | Built-in caching, rate limiting, budget tracking, provider fallback, tenant isolation |
| Embedding storage | Custom halfvec table + index | `SearchRepo.upsertEmbedding()` + existing `search_embeddings` | HNSW index with `m=24, ef_construction=200`, zero-padding to 3072d, `halfvec_cosine_ops` already configured |
| Transaction management | Manual BEGIN/COMMIT | `SqlClient.withTransaction()` | Automatic connection pinning, rollback on failure/interruption, error propagation |
| Typed SQL queries | Raw sql template with manual aliasing | `SqlSchema.findAll`/`single`/`findOne`/`void` + `Model.Class` | Schema validation at decode boundary, automatic camelCase/snake_case transform, type-safe Result extraction |
| CRUD with tenant scoping | Raw SQL queries per table | `repo()` factory from `packages/database/factory.ts` | Automatic RLS context, OCC, soft-delete, keyset pagination, predicate builder |
| Command manifest extraction | Parsing Rhino docs HTML at runtime | Static JSON manifest built offline from C# plugin source + `Command.GetCommandNames()` | Runtime scraping is fragile; static manifest is versioned, testable, and cached |
| Batch embedding requests | Manual batching loop | `AiEmbeddingModel.makeDataLoader({ window, maxBatchSize })` or `AiRuntime.embed(batch)` | Auto-aggregation within time window; deduplication; existing `AiRuntime.embed(string[])` handles batch natively |

**Key insight:** The @effect/ai `Chat.Persistence` + `@effect/experimental` `BackingPersistence` combination eliminates the entire chat history serialization concern. The planner should focus on implementing the PostgreSQL-backed `BackingPersistence` and composing it into the harness layer -- not on building custom conversation persistence logic.

## Common Pitfalls

### Pitfall 1: Transaction Scope Mismatch

**What goes wrong:** Tool call log and checkpoint are written as separate SQL statements without `withTransaction`. On crash between the two writes, the checkpoint is stale but the tool call is logged (or vice versa).

**Why it happens:** The current `CheckpointService` writes checkpoint and trace events separately (in-memory Ref only). Developers may continue this pattern when adding PostgreSQL writes.

**How to avoid:** Wrap BOTH the tool call insert AND the checkpoint upsert in a single `sql.withTransaction()` call. The Ref update happens AFTER the transaction commits (write-through pattern). Transaction guarantees atomicity -- either both succeed or both roll back.

**Warning signs:** Tool call count in session metadata does not match actual `kargadan_tool_calls` rows for that session.

### Pitfall 2: Chat.fromJson Requires LanguageModel in Context

**What goes wrong:** `Chat.fromJson(data)` returns `Effect.Effect<Service, ParseError, LanguageModel.LanguageModel>` -- it requires the `LanguageModel` service in its R channel. Calling it without providing the language model layer fails at runtime.

**Why it happens:** The restored `Chat.Service` needs the language model to generate subsequent responses. The dependency is declared in the return type.

**How to avoid:** Provide the `LanguageModel` layer (via `AiRegistry.layers(settings).language`) before calling `Chat.fromJson`. The harness entry point should compose the language model layer into the hydration pipeline.

**Warning signs:** Compile error: `LanguageModel.LanguageModel` in R channel unresolved.

### Pitfall 3: BackingPersistence.make Requires Scope

**What goes wrong:** `BackingPersistence.make(storeId)` returns `Effect.Effect<BackingPersistenceStore, never, Scope>`. If the scope is too narrow, the store is disposed while the chat session is still active.

**Why it happens:** The `Scope` dependency means the store lifetime is tied to the enclosing scope. Creating the store inside a short-lived scope (e.g., per-request) disposes the database connection or cleanup resources prematurely.

**How to avoid:** Create the `BackingPersistence` store in the `scoped` constructor of the PersistenceService (which lives for the service lifetime). Do NOT create it inside individual request handlers.

**Warning signs:** `PersistenceBackingError` thrown after initial successful writes; "store disposed" errors.

### Pitfall 4: JSONB Column Size Growth

**What goes wrong:** Full snapshot per checkpoint means the checkpoint JSONB column grows with conversation history. For long sessions (100+ tool calls), the checkpoint row becomes multiple MB.

**Why it happens:** User chose full snapshots (no delta). Conversation history accumulates every turn.

**How to avoid:** Accept the tradeoff (locked decision). PostgreSQL TOAST compression handles JSONB > 2KB automatically. The `ON CONFLICT DO UPDATE` pattern means only one checkpoint row exists per session. Monitor `pg_total_relation_size('kargadan_checkpoints')` growth.

**Warning signs:** `pg_total_relation_size` growing faster than session count.

### Pitfall 5: Embedding Dimension Mismatch Between Seed and Query

**What goes wrong:** Seeding KB with one embedding model/dimension and querying with another produces meaningless cosine similarity scores.

**Why it happens:** `AiRegistry` settings can differ between environments or change over time.

**How to avoid:** Store `model` and `dimensions` alongside each embedding (already done in `search_embeddings` table). Use a fixed model+dimensions config for the Kargadan KB, independent of per-tenant AI settings. The existing `SearchRepo.search()` filters by `model` and `dimensions` in WHERE clause.

**Warning signs:** Semantic search returns irrelevant commands; cosine similarity scores are uniformly low (<0.3).

### Pitfall 6: Missing Indexes for Session Listing Queries

**What goes wrong:** Session listing by status and date range does sequential scans without proper indexes.

**Why it happens:** Migration creates tables without indexes for expected query patterns.

**How to avoid:** Migration MUST include indexes: `(status, started_at DESC)` for filtered listing, `(session_id)` for checkpoint FK lookup, `(session_id, sequence)` for tool call replay ordering, `UNIQUE (session_id)` on checkpoints.

**Warning signs:** Sequential scans in `EXPLAIN ANALYZE` for session list queries.

### Pitfall 7: Migration Table Name Collision

**What goes wrong:** Kargadan migrations tracked in the same `effect_sql_migrations` table as platform migrations, causing sequence conflicts or accidental re-runs.

**Why it happens:** `PgMigrator.layer` defaults to `effect_sql_migrations` table.

**How to avoid:** Pass `table: 'kargadan_migrations'` to `PgMigrator.layer` for the Kargadan-specific migrator. This keeps the migration tracking completely independent.

**Warning signs:** Unexpected "migration already applied" errors; platform migrations appearing in Kargadan migration history.

## Code Examples

Verified patterns from official sources and the existing codebase:

### Model.Class Definition Pattern (from packages/database/src/models.ts)

```typescript
// Source: packages/database/src/models.ts lines 68-77
class User extends Model.Class<User>('User')({
    id:          Model.Generated(S.UUID),
    appId:       S.UUID,
    email:       S.String,
    preferences: Model.Generated(PreferencesSchema),
    role:        RoleSchema,
    status:      S.Literal('active', 'inactive', 'suspended'),
    deletedAt:   Model.FieldOption(S.DateFromSelf),
    updatedAt:   Model.DateTimeUpdateFromDate,
}) {}
```

### PgMigrator Setup Pattern (from packages/database/src/migrator.ts)

```typescript
// Source: packages/database/src/migrator.ts
import { PgMigrator } from '@effect/sql-pg';
import { NodeContext } from '@effect/platform-node';

const KargadanMigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(
        fileURLToPath(new URL('../migrations', import.meta.url))
    ),
    table: 'kargadan_migrations',
}).pipe(Layer.provide(PgClientLayer), Layer.provide(NodeContext.layer));
```

### SqlSchema.findAll for Session Listing

```typescript
// Source: @effect/sql SqlSchema.findAll signature + packages/database/models.ts pattern
const listSessions = SqlSchema.findAll({
    Request: S.Struct({
        status: S.optional(S.Array(S.String)),
        after:  S.optional(S.DateFromSelf),
        before: S.optional(S.DateFromSelf),
    }),
    Result: KargadanSession,
    execute: (filter) => sql`
        SELECT * FROM kargadan_sessions
        WHERE (${filter.status === undefined} OR status = ANY(${sql.array(filter.status ?? [], 'text')}))
        AND (${filter.after === undefined} OR started_at >= ${filter.after})
        AND (${filter.before === undefined} OR started_at <= ${filter.before})
        ORDER BY started_at DESC
    `,
});
```

### Chat.exportJson + Chat.fromJson for History Persistence

```typescript
// Source: @effect/ai Chat module -- exportJson and fromJson
// Serialize: inside the atomic checkpoint transaction
const chatJson = yield* chat.exportJson;
// ... include chatJson in checkpoint upsert

// Restore: during harness hydration
const chat = yield* Chat.fromJson(checkpoint.chatJson).pipe(
    Effect.provide(AiRegistry.layers(settings).language),
);
```

### SearchRepo.upsertEmbedding for KB Commands

```typescript
// Source: packages/database/src/search.ts lines ~323-328
database.search.upsertEmbedding({
    dimensions: 1536,
    documentHash: hashCanonicalState(command),
    embedding: embeddingVector,
    entityId: command.id,
    entityType: 'rhinoCommand',
    model: 'text-embedding-3-small',
    scopeId: null, // global scope -- not tenant-scoped
});
```

### Client.vector.withIterativeScan for KB Queries

```typescript
// Source: packages/database/src/client.ts lines ~216-229
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
| Manual chat JSON serialization | `Chat.exportJson` / `Chat.fromJson` from @effect/ai | @effect/ai 0.33.x (2025) | Eliminates custom serialization; handles Prompt schema with tool calls, reasoning parts, images |
| Custom persistence lifecycle | `Chat.Persistence` + `BackingPersistence` | @effect/ai 0.33.x (2025) | Managed save-after-generate, TTL, getOrCreate; backed by pluggable storage |
| IVFFlat for pgvector | HNSW with iterative scan | pgvector 0.8.0 (2025) | 9.4x latency reduction for filtered queries; no pre-population required |
| `vector(N)` storage | `halfvec(N)` storage | pgvector 0.7.0+ | 50% storage reduction with negligible recall impact |
| Single-signal search | RRF multi-signal fusion | Already in codebase | 10 signals fused via Reciprocal Rank Fusion (FTS + trigram + phonetic + semantic) |
| Raw SQL checkpoint writes | `Model.Class` + `SqlSchema` | Phase 04 deliverable | Type-safe insert/select/update with automatic camelCase/snake_case transform |
| In-memory-only PersistenceTrace | Write-through cache with PostgreSQL backend | Phase 04 deliverable | Durability across harness restarts; existing Ref becomes read cache |

**Deprecated/outdated:**
- IVFFlat: Still supported but HNSW is strictly better for this use case (<1000 vectors, needs zero-data index creation). The codebase already uses HNSW.
- Manual `pg_trgm.similarity_threshold` SET: Now handled automatically in `Client.layerFromConfig` via connection options.
- `sql.resolver` / `sql.schema` (old sqlfx API): Replaced by `SqlResolver` and `SqlSchema` modules in `@effect/sql` 0.49.x.

## Open Questions

1. **BackingPersistence implementation complexity**
   - What we know: `BackingPersistence` requires implementing a key-value store interface (`get`, `set`, `remove`, `clear`, `getMany`, `setMany`) backed by PostgreSQL. `Chat.layerPersisted` consumes this via `Chat.Persistence`.
   - What's unclear: Whether to implement `BackingPersistence` as a thin wrapper over the `kargadan_checkpoints` table or a separate `kargadan_chat_store` key-value table. The checkpoint table has a specific schema (session_id, loop_state, chat_json, etc.) while `BackingPersistence` expects arbitrary key-value storage.
   - Recommendation: Use a dedicated `kargadan_chat_store` table with `(store_id, key, value JSONB)` schema for `BackingPersistence`, keeping it separate from the checkpoint table. The checkpoint table stores structured loop state; the chat store handles Chat.Persistence's internal key-value needs. Alternatively, if the overhead seems excessive, use `Chat.exportJson` / `Chat.fromJson` directly without `Chat.Persistence`, storing the JSON string in the checkpoint table's `chat_json` column. This simpler approach still uses the official serialization API but skips the managed persistence layer.

2. **Command manifest source depth**
   - What we know: `Command.GetCommandNames(english: true, loaded: true)` returns command names. Basic descriptions available from Rhino docs HTML reference.
   - What's unclear: Parameter extraction is NOT available via RhinoCommon API. Parameters, types, and defaults would need manual curation or scraping from individual command help pages.
   - Recommendation: Start with a manifest containing command names + descriptions (scrapeable). Add parameter metadata iteratively. The dual-purpose schema (`CommandManifestEntrySchema`) has optional `params` array -- it works with or without parameter data.

3. **Kargadan-specific vs platform search infra**
   - What we know: `packages/database/search.ts` SearchRepo is designed for multi-tenant, multi-entity-type search. KB commands are global (no tenant scoping).
   - What's unclear: Whether the Kargadan harness should depend on `DatabaseService` (which pulls in the entire server-side dependency chain including `Context.Request`, `AuditService`, `MetricsService`) or only on the lower-level `SearchRepo` / `SqlClient`.
   - Recommendation: The harness should use `SqlClient` directly for Kargadan-specific tables and raw search queries against `search_documents` / `search_embeddings`. Do NOT pull in `DatabaseService` -- it carries server-side dependencies (`Context.Request`, `ClusterService`, `AuditService`) that the CLI harness does not provide. The KB seeder can be a standalone script that uses `SearchRepo` patterns but operates through direct SQL.

## Sources

### Primary (HIGH confidence)
- [Context7 /tim-smart/effect-io-ai](https://github.com/tim-smart/effect-io-ai) -- Chat.fromJson, Chat.exportJson, Chat.Persistence, Chat.layerPersisted, Tool.make, Toolkit.make, AiEmbeddingModel.makeDataLoader signatures
- [Context7 /effect-ts/effect](https://github.com/effect-ts/effect) -- SqlClient.withTransaction, SqlSchema.findAll/single/findOne/void, PgMigrator.fromFileSystem, Model.Class field modifiers
- [Raw source Chat.ts](https://github.com/Effect-TS/effect/tree/main/packages/ai/ai/src/Chat.ts) -- full Chat.Service, Chat.Persisted, Chat.Persistence.Service interfaces; BackingPersistence dependency chain
- [Raw source Persistence.ts](https://github.com/Effect-TS/effect/tree/main/packages/experimental/src/Persistence.ts) -- BackingPersistence interface, BackingPersistenceStore operations, layerMemory, layerKeyValueStore
- [Raw source Tool.ts](https://github.com/Effect-TS/effect/tree/main/packages/ai/ai/src/Tool.ts) -- Tool.make signature, annotation Tags (Title, Readonly, Destructive, Idempotent, OpenWorld)
- [Raw source Toolkit.ts](https://github.com/Effect-TS/effect/tree/main/packages/ai/ai/src/Toolkit.ts) -- Toolkit.make, Toolkit.merge, toContext, toLayer
- [Raw source Model.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/Model.ts) -- Model.Class, Generated, GeneratedByApp, Sensitive, FieldOption, DateTimeUpdateFromDate, DateTimeInsertFromDate, makeRepository, makeDataLoaders
- [Raw source SqlSchema.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/SqlSchema.ts) -- findAll, findOne, single, void exact signatures
- [Raw source SqlClient.ts](https://github.com/Effect-TS/effect/tree/main/packages/sql/src/SqlClient.ts) -- withTransaction, makeWithTransaction, TransactionConnection
- Existing codebase: `packages/database/src/search.ts` -- SearchRepo with pgvector HNSW, halfvec, iterative scan, 10-signal RRF
- Existing codebase: `packages/database/src/factory.ts` -- polymorphic repo() factory
- Existing codebase: `packages/database/src/client.ts` -- Client.vector.withIterativeScan, PgClient.layerConfig
- Existing codebase: `packages/database/src/models.ts` -- 14 Model.Class definitions demonstrating field modifiers
- Existing codebase: `packages/ai/src/runtime.ts` -- AiRuntime.embed (overloaded: single + batch)
- Existing codebase: `packages/ai/src/search.ts` -- SearchService.refreshEmbeddings pattern
- Existing codebase: `packages/ai/src/registry.ts` -- AiRegistry._SettingsSchema with embedding defaults
- Existing codebase: `apps/kargadan/harness/src/persistence/checkpoint.ts` -- current CheckpointService (to be replaced)
- Existing codebase: `apps/kargadan/harness/src/runtime/agent-loop.ts` -- current agent loop state machine
- Existing codebase: `apps/kargadan/harness/src/harness.ts` -- entry point, PgClientLayer, ServicesLayer composition

### Secondary (MEDIUM confidence)
- [pgvector 0.8.0 release notes](https://www.postgresql.org/about/news/pgvector-080-released-2952/) -- iterative scan, halfvec improvements
- [OpenAI embeddings documentation](https://developers.openai.com/api/docs/guides/embeddings/) -- text-embedding-3-small, 1536 dimensions
- [RhinoCommon Command class](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.command) -- GetCommandNames, CommandContextHelpUrl
- [Rhino command list reference](http://docs.mcneel.com/rhino/8mac/help/en-us/commandlist/command_list.htm) -- ~500 commands with name+description

### Tertiary (LOW confidence)
- Rhino command parameter extraction -- no programmatic API found in RhinoCommon for extracting parameter schemas; manual curation likely needed for rich metadata
- `BackingPersistence` PostgreSQL implementation -- no official PostgreSQL-backed implementation exists in `@effect/experimental`; only memory and KeyValueStore layers are provided; PostgreSQL backing must be custom

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- every library is already in the workspace catalog and actively used; exact API signatures verified via Context7 and raw source
- Architecture: HIGH -- patterns derived from existing `packages/database`, `packages/ai`, and verified @effect/ai Chat.Persistence API
- External lib APIs: HIGH -- all signatures verified via Context7 library docs and raw GitHub source files
- KB extraction: MEDIUM -- command names and descriptions are extractable, but parameter-level metadata requires manual curation (no RhinoCommon API)
- BackingPersistence PostgreSQL impl: MEDIUM -- interface is clear (verified from source), but no reference implementation exists for PostgreSQL specifically

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable -- all dependencies pinned in workspace catalog)
