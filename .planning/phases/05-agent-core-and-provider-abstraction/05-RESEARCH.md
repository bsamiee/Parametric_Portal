# Phase 5: Agent Core and Provider Abstraction - Research

**Researched:** 2026-02-23
**Domain:** Universal AI agent infrastructure (packages/ai) + app-level consumption (Kargadan)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Bridge plugin enumerates ALL Rhino commands via SDK on load, sends full catalog JSON as a protocol message after WebSocket handshake
- Harness decodes via `CommandManifest.decode()` and seeds via `KBSeeder.seed(manifest, embed)` on every connection
- No version tracking or change detection -- always re-seed, rely on ON CONFLICT idempotency (already implemented in seeder)
- Full Rhino command list, not a curated subset -- let RAG ranking handle relevance
- First connection seeds embeddings via OpenAI API; subsequent connections re-upsert documents but skip embedding if hash unchanged (seeder's existing hash comparison)
- Plan-then-confirm: agent plans the full operation, shows the plan, waits for user approval before executing any writes. Reads execute freely without approval.
- On failure: DO NOT retry blindly. Failure means the agent got the approach wrong. Read the API docs, examine the document state, understand what went wrong, then correct the approach.
- Always undo the failed attempt before trying the corrected approach -- clean slate each time. Undo is atomic per tool call (one BeginUndoRecord/EndUndoRecord per command), not batch rollback.
- Maximum 2 correction cycles: original attempt + 2 corrections = 3 total tries. If still failing after reading docs and adjusting twice, surface to user with what was tried and what went wrong.
- Each tool call is its own undo record -- no batching of multiple commands into one undo. This ensures corrections undo precisely what failed, not the entire sequence.
- Mechanical conversion: a pure function maps CommandManifestEntry params (Point3d, number, string, ObjectId[]) to Effect Schema types automatically. ManifestEntry -> Tool.make call.
- isDestructive field in CommandManifestEntrySchema is the source of truth for undo wrapping. Plugin marks destructive commands. Agent wraps undo accordingly.
- RAG selects tools per-turn: full catalog is embedded in pgvector. Each turn, agent queries with user intent. Only top-K relevant commands become active tools for that turn. Context-efficient -- no flooding LLM with hundreds of tool definitions.
- One tool call per Rhino command per step. No batching related commands into single tool calls. Atomic, debuggable, clean undo.
- All three providers at launch: Anthropic, OpenAI, Google. Full provider matrix from day one.
- Embedding API: OpenAI text-embedding-3-small (1536 dimensions, already configured in seeder). Fixed regardless of which LLM provider is selected for inference.
- Chat history: wire Chat.exportJson/Chat.fromJson into PersistenceService -- replace the Phase 4 empty-string chatJson placeholder with real serialized conversation data.

### Claude's Discretion
- Top-K value for RAG tool selection (how many commands per turn)
- Exact Schema type mapping for Rhino param types (Point3d -> S.Struct vs S.Tuple etc.)
- Provider fallback chain ordering and retry semantics
- How the plan is presented to the user before confirmation (format, detail level)
- Context window budget allocation between tools, conversation history, and scene context

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | packages/ai provides generic agent loop service consumable by any app | Universal Type Boundaries + Factory Pattern Design sections define the packages/ai surface; agent loop is a generic service with app-specific config injected via Layer |
| AGNT-02 | Tools defined via Tool.make with schema-driven parameters, annotations, composed into Toolkit | Tool.make exact API verified from installed v0.33.2 type declarations; annotations (Destructive, Readonly, Idempotent) mapped; Toolkit.make/merge documented |
| AGNT-03 | Agent translates NL input into Rhino commands via LLM inference | Chat.generateText + toolkit integration pattern; RAG per-turn tool selection architecture |
| AGNT-04 | Bridge exports real command catalog; harness decodes, seeds, discovers via pgvector | Boundary Adapters section: manifest-to-tool conversion is app adapter; seeder wires to universal embed; SearchService already handles pgvector queries |
| AGNT-05 | Agent uses Chat for multi-turn conversation with Ref-based history | Chat module fully documented: history Ref, exportJson/fromJson for persistence, provider-portable serialization format |
| AGNT-09 | Read/write tool bifurcation by design | Tool.Readonly + Tool.Destructive annotations provide the semantic signal; factory pattern propagates annotation to handler behavior |
| AGNT-10 | Agent loop follows PLAN/EXECUTE/VERIFY/PERSIST/DECIDE state machine | Architecture Patterns section: state machine via Data.taggedEnum + Match.exhaustive; universal loop with app-injected phase handlers |
| PROV-01 | User selects AI provider and model at session start | AiRegistry already provides Match.exhaustive dispatch across providers; config resolved at runtime |
| PROV-02 | Provider selection stored in settings, resolved via AiRegistry | AiRuntimeProvider.resolve already reads tenant/app settings; _SettingsSchema already defined |
| PROV-03 | Provider abstraction is universal -- new provider = new Layer only | LanguageModel is the universal tag; all provider packages implement it; agent code never references provider directly |
| PROV-04 | Fallback chain across providers | AiRuntime.runLanguage already implements .reduce fallback cascade; Architecture Patterns section documents the pattern |

</phase_requirements>

## Summary

Phase 5 builds universal AI agent infrastructure in `packages/ai` that any app can consume, then wires Kargadan as the first consumer. The research priority is packages/ai mechanism design FIRST, Kargadan consumption SECOND.

The installed `@effect/ai` v0.33.2 provides substantially more surface than packages/ai currently uses. The existing codebase uses only LanguageModel, EmbeddingModel, Chat.empty, and basic text generation. Phase 5 must adopt: Tool.make with typed parameters and annotations, Toolkit.make/merge for composable tool collections, Chat.exportJson/fromJson for persistence, Chat.Persistence with BackingPersistence for automatic save-on-generate, and Tokenizer for context budget management. This brings utilization from approximately 40% to 90%.

The factory pattern from `packages/database` (`repo(model, table, config)` generating typed CRUD for 15+ entities) provides the architectural template for `packages/ai`. The equivalent is a composable agent factory that takes a schema-based config (tools, system prompt, loop phases, persistence strategy) and produces a fully-typed agent service -- just as `repo()` takes a model + table + config and produces typed repository operations.

**Primary recommendation:** Design `packages/ai` around three universal factories -- `agent(config)` for loop orchestration, `toolFactory(manifestEntry)` for schema-to-Tool conversion, and `ragToolSelector(searchService, topK)` for per-turn tool filtering -- then have Kargadan supply its domain-specific manifest schema and bridge adapter as config.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/ai` | 0.33.2 | Tool.make, Toolkit, Chat, Tokenizer, LanguageModel abstraction | Installed; provides the universal provider-agnostic AI service layer |
| `@effect/ai-anthropic` | 0.23.0 | Anthropic provider (Claude models) | Installed; implements LanguageModel for Anthropic |
| `@effect/ai-openai` | 0.37.2 | OpenAI provider (GPT models + embeddings) | Installed; implements LanguageModel + EmbeddingModel for OpenAI |
| `@effect/ai-google` | 0.12.1 | Google provider (Gemini models) | Installed; implements LanguageModel for Google |
| `@effect/experimental` | 0.58.0 | BackingPersistence for Chat.Persistence | Installed; provides the persistence abstraction Chat.Persistence requires |
| `effect` | 3.19.18 | Core runtime: Schema, Effect, Match, Data, Layer | Installed; foundation for everything |
| `@effect/sql` | 0.42.3 | SqlClient for persistence | Installed; already used by PersistenceService |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/ai` Tokenizer | 0.33.2 | Token counting and prompt truncation | Context budget management -- truncating history to fit context window |
| `@effect/ai` Chat.Persistence | 0.33.2 | Auto-persisting chat with BackingPersistence | When Chat needs automatic save-on-generate behavior instead of manual exportJson |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Chat.Persistence (auto-save) | Manual exportJson/fromJson | Manual approach gives more control over when/how to persist; auto-save couples to BackingPersistence interface. RECOMMENDATION: start with manual exportJson/fromJson to wire into existing PersistenceService, adopt Chat.Persistence later if the manual approach becomes burdensome |
| Tokenizer from @effect/ai | Character-based estimation | Tokenizer is more accurate but requires provider-specific implementation (each provider tokenizes differently). Character estimation (4 chars/token) is a reasonable approximation for budget allocation. RECOMMENDATION: use Tokenizer when available from provider, fall back to character estimation |

## Architecture Patterns

### Recommended Project Structure

**packages/ai (universal mechanisms):**
```
packages/ai/src/
├── agent.ts           # Agent loop factory + state machine
├── errors.ts          # AiError (exists)
├── mcp.ts             # MCP server (exists)
├── registry.ts        # AiRegistry multi-provider dispatch (exists)
├── runtime.ts         # AiRuntime service (exists -- to be extended)
├── runtime-provider.ts # Budget/observe/resolve/track (exists)
├── search.ts          # SearchService for pgvector queries (exists)
├── tool-factory.ts    # Universal manifest-to-Tool.make conversion
└── toolkit-builder.ts # Dynamic Toolkit assembly from RAG results
```

**apps/kargadan/harness (app-specific wiring):**
```
apps/kargadan/harness/src/
├── agent/
│   ├── loop.ts          # Kargadan-specific loop config (phases, correction policy)
│   └── tools.ts         # Manifest adapter: CommandManifestEntry -> ToolManifestEntry
├── knowledge/
│   ├── manifest.ts      # CommandManifest schema (exists)
│   └── seeder.ts        # KBSeeder (exists)
├── persistence/
│   ├── checkpoint.ts    # PersistenceService (exists -- chatJson to be wired)
│   └── models.ts        # Model.Class definitions (exists)
├── protocol/
│   ├── dispatch.ts      # CommandDispatch (exists)
│   └── schemas.ts       # Protocol envelope schemas (exists)
└── socket.ts            # WebSocket client (exists)
```

### Pattern 1: Universal Tool Factory

**What:** A pure function that converts a generic manifest entry (with typed parameters schema, name, description, destructive flag) into an `@effect/ai` Tool with correct annotations. This is the packages/ai equivalent of `repo()` -- a polymorphic factory that takes config and produces typed output.

**When to use:** Whenever an app has a catalog of operations to expose as AI tools.

**Verified API from installed @effect/ai v0.33.2 Tool.d.ts:**
```typescript
// Tool.make signature (verified from node_modules)
Tool.make<Name, Parameters, Success, Failure, Mode, Dependencies>(
    name: Name,
    options?: {
        description?: string;
        parameters?: Parameters;      // Schema.Struct.Fields (NOT Schema.Struct)
        success?: Success;
        failure?: Failure;
        failureMode?: Mode;           // "error" (default) | "return"
        dependencies?: Dependencies;
    }
) => Tool<Name, { parameters: Schema.Struct<Parameters>; ... }, ...>

// Tool annotations (verified from node_modules)
Tool.Title       // Context.TagClass<Title, string>
Tool.Readonly    // Context.ReferenceClass<Readonly, boolean>
Tool.Destructive // Context.ReferenceClass<Destructive, boolean>
Tool.Idempotent  // Context.ReferenceClass<Idempotent, boolean>
Tool.OpenWorld   // Context.ReferenceClass<OpenWorld, boolean>
```

**Universal manifest entry schema (packages/ai):**
```typescript
// Generic manifest entry that any app can provide
const ToolManifestEntry = S.Struct({
    name:          S.NonEmptyTrimmedString,
    description:   S.String,
    parameters:    S.Record({ key: S.String, value: S.Unknown }), // app interprets
    isDestructive: S.Boolean,
    isIdempotent:  S.optionalWith(S.Boolean, { default: () => false }),
    category:      S.optionalWith(S.String, { default: () => 'general' }),
});
```

### Pattern 2: Dynamic Toolkit Assembly via RAG

**What:** Instead of loading all tools into context, query pgvector with user intent each turn and assemble a Toolkit from only the top-K relevant tools. Uses Toolkit.make for construction and Toolkit.merge if combining static + dynamic tools.

**When to use:** When tool catalog exceeds what fits in a single LLM context window.

**Verified API from installed @effect/ai v0.33.2 Toolkit.d.ts:**
```typescript
// Toolkit.make (verified from node_modules)
Toolkit.make<Tools extends ReadonlyArray<Tool.Any>>(...tools: Tools)
    => Toolkit<ToolsByName<Tools>>

// Toolkit.merge (verified from node_modules)
Toolkit.merge<Toolkits extends ReadonlyArray<Any>>(...toolkits: Toolkits)
    => Toolkit<MergedTools<Toolkits>>

// Toolkit.toLayer -- converts toolkit to handler Layer
toolkit.toLayer<Handlers>(build: Handlers | Effect<Handlers, EX, RX>)
    => Layer.Layer<Tool.HandlersFor<Tools>, EX, Exclude<RX, Scope>>
```

**Pattern:**
```typescript
// Per-turn: query -> filter -> assemble -> provide
const assembleToolkit = (userIntent: string, topK: number) =>
    searchService.query({ query: userIntent, limit: topK }).pipe(
        Effect.map((results) => results.map(manifestToTool)),
        Effect.map((tools) => Toolkit.make(...tools)),
    );
```

### Pattern 3: Chat Persistence via exportJson/fromJson

**What:** Use Chat.exportJson to serialize conversation history to a JSON string, store in PostgreSQL via the existing PersistenceService.chatJson field. On session resume, use Chat.fromJson to restore. The serialization format is the provider-agnostic `Prompt.Prompt` schema -- chats exported under one provider restore cleanly under another.

**When to use:** Session persistence with provider portability.

**Critical finding -- Provider Portability (HIGH confidence, verified from source):**

Chat.fromJson and Chat.fromExport both require `LanguageModel.LanguageModel` in the R channel of their return type. However, reading the actual source implementation at `@effect/ai/src/Chat.ts` lines 538-539 and 579-580:

```typescript
// fromExport implementation (source verified):
export const fromExport = (data: unknown): Effect<Service, ParseError, LanguageModel> =>
    Effect.flatMap(decodeUnknown(data), fromPrompt)

// fromJson implementation (source verified):
export const fromJson = (data: string): Effect<Service, ParseError, LanguageModel> =>
    Effect.flatMap(decodeHistoryJson(data), fromPrompt)
```

Both decode the data into `Prompt.Prompt` (provider-agnostic message array) then call `fromPrompt` which calls `empty` -- a pure Ref construction. The `LanguageModel` requirement in R is a type-level phantom inherited because the `Service` interface methods (`generateText`, `streamText`, `generateObject`) require it. The *construction itself* never calls any LanguageModel method.

**Conclusion:** A chat exported with Anthropic as provider can be restored with OpenAI or Google as provider. The serialized format is `Prompt.Prompt` -- role/content message arrays with no provider-specific encoding. Provider switching between sessions is safe.

### Pattern 4: Agent Loop State Machine

**What:** The agent loop (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE) is a typed state machine using `Data.taggedEnum` for states and `Match.exhaustive` for transitions. The universal loop lives in packages/ai; app-specific phase implementations are injected via config.

**When to use:** Any app that needs a multi-step agent loop with typed transitions.

**Pattern:**
```typescript
// Universal loop states (packages/ai)
type _AgentPhase = Data.TaggedEnum<{
    Plan:     { readonly intent: string };
    Execute:  { readonly plan: unknown; readonly step: number };
    Verify:   { readonly result: unknown };
    Persist:  { readonly checkpoint: unknown };
    Decide:   { readonly verification: unknown; readonly attempt: number };
    Complete: { readonly result: unknown };
    Failed:   { readonly error: unknown; readonly attempts: number };
}>;

// App injects phase handlers via config
type AgentConfig = {
    readonly maxCorrections: number;
    readonly onPlan:    (intent: string) => Effect<PlanResult>;
    readonly onExecute: (plan: unknown, step: number) => Effect<ExecuteResult>;
    readonly onVerify:  (result: unknown) => Effect<VerifyResult>;
    readonly onPersist: (checkpoint: unknown) => Effect<void>;
    readonly onDecide:  (verification: unknown, attempt: number) => Effect<Decision>;
};
```

### Pattern 5: Boundary Adapter (App to Universal)

**What:** Each app provides a boundary adapter that maps its domain-specific manifest to the universal ToolManifestEntry schema. The adapter is a pure function -- no Effect wrapping needed.

**When to use:** Every app that consumes the universal tool factory.

**Kargadan example:**
```typescript
// apps/kargadan/harness/src/agent/tools.ts
// Maps CommandManifestEntry (Kargadan domain) -> ToolManifestEntry (universal)
const toToolManifest = (entry: typeof CommandManifestEntrySchema.Type): ToolManifestEntry => ({
    name: entry.name,
    description: entry.description,
    parameters: mapRhinoParams(entry.params), // Point3d -> S.Tuple, etc.
    isDestructive: entry.isDestructive,
    category: entry.category,
});
```

### Anti-Patterns to Avoid

- **Monolithic tool loading:** Never load all tools into context. RAG selects per-turn. Hundreds of tool definitions exhaust the context window and degrade model performance.
- **App-specific types in packages/ai:** Universal factories must never reference CommandManifest, LoopState tags, undo records, or any Kargadan concept. These are app adapter concerns.
- **Manual Chat history management:** Do not build a custom conversation accumulator. Chat.history is a Ref -- the Chat module handles append-on-generate automatically.
- **Provider-specific serialization:** Do not build per-provider export logic. Chat.exportJson produces provider-agnostic JSON. Chat.fromJson restores under any provider.
- **Wrapping Tool.make:** Do not create an abstraction layer over Tool.make. Use it directly. The factory pattern is about manifest-to-Tool-make *conversion*, not Tool.make *wrapping*.

## Universal Type Boundaries

This section defines precisely what lives in `packages/ai` (universal, app-agnostic) versus `apps/kargadan` (app-specific).

### packages/ai Owns (Universal)

| Concept | Location | Description |
|---------|----------|-------------|
| ToolManifestEntry schema | `packages/ai/tool-factory.ts` | Generic manifest: name, description, parameters (as Schema fields), isDestructive, isIdempotent, category |
| manifestToTool(entry) | `packages/ai/tool-factory.ts` | Pure function: ToolManifestEntry -> Tool.make call with annotations |
| ragToolSelector(searchService, topK) | `packages/ai/toolkit-builder.ts` | Effect: user intent string -> Toolkit of top-K relevant tools from pgvector |
| AgentLoop service | `packages/ai/agent.ts` | State machine orchestration: PLAN/EXECUTE/VERIFY/PERSIST/DECIDE with injected phase handlers |
| AgentConfig type | `packages/ai/agent.ts` | Config shape: maxCorrections, phase handler functions, persistence strategy |
| AiRuntime (extended) | `packages/ai/runtime.ts` | Existing service extended with chat persistence and toolkit integration |
| AiRegistry | `packages/ai/registry.ts` | Multi-provider dispatch (exists) |
| SearchService | `packages/ai/search.ts` | pgvector query for RAG (exists) |

### apps/kargadan Owns (App-Specific)

| Concept | Location | Description |
|---------|----------|-------------|
| CommandManifestEntry schema | `apps/kargadan/harness/src/knowledge/manifest.ts` | Rhino-specific: operation, Point3d params, ObjectRef, isDestructive |
| toToolManifest adapter | `apps/kargadan/harness/src/agent/tools.ts` | Pure: CommandManifestEntry -> ToolManifestEntry (maps Rhino types to Effect Schema) |
| Rhino param type mapping | `apps/kargadan/harness/src/agent/tools.ts` | Point3d -> S.Tuple([S.Number, S.Number, S.Number]), ObjectId[] -> S.Array(S.String), etc. |
| KBSeeder | `apps/kargadan/harness/src/knowledge/seeder.ts` | Seeds pgvector from CommandManifest (exists) |
| CommandDispatch | `apps/kargadan/harness/src/protocol/dispatch.ts` | WebSocket command execution (exists) |
| PersistenceService | `apps/kargadan/harness/src/persistence/checkpoint.ts` | PostgreSQL checkpointing (exists) |
| Kargadan agent config | `apps/kargadan/harness/src/agent/loop.ts` | Supplies AgentConfig: maxCorrections=2, undo-on-fail policy, plan-then-confirm flow |
| KargadanSocketClient | `apps/kargadan/harness/src/socket.ts` | WebSocket transport (exists) |

### Boundary Rule

The boundary adapter (`toToolManifest`) is the ONLY place where Kargadan-specific types cross into universal types. All downstream processing (tool factory, toolkit assembly, agent loop) operates on universal types only. This mirrors how `packages/database` repos operate on `Model.Class` -- the universal type -- while apps define their specific models.

## Factory Pattern Design

This section maps the `packages/database` repo factory pattern to a `packages/ai` agent factory pattern.

### repo() Anatomy (Gold Standard)

```
repo(model, table, config) -> { by, find, one, page, count, put, set, drop, ... }
```

| Input | Purpose | AI Equivalent |
|-------|---------|---------------|
| `model` (Model.Class) | Schema defining entity shape | ToolManifestEntry or AgentConfig schema |
| `table` (string) | Database table name | Agent namespace / tool catalog ID |
| `config.pk` | Primary key configuration | Tool name as identifier |
| `config.scoped` | Tenant isolation field | Tenant/app scoping for tool catalogs |
| `config.resolve` | Named lookup resolvers | RAG-based tool resolution |
| `config.conflict` | Upsert conflict strategy | Tool name deduplication |
| `config.functions` | SQL function bindings | Tool handler bindings |

### agent() Factory Design

The AI equivalent of `repo()`:

```typescript
// Signature mirrors repo(): schema + namespace + config -> typed service
const agent = (config: AgentConfig) => Effect.gen(function* () {
    const runtime = yield* AiRuntime;
    const searchService = yield* SearchService;

    // analogous to repo building its query/mutation surface from config
    const selectTools = ragToolSelector(searchService, config.toolSelection.topK);
    const loop = buildLoop(config.phases, config.maxCorrections);
    const persistence = buildPersistence(config.persistence);

    return {
        run: (intent: string) => loop.execute(intent, selectTools, persistence),
        resume: (sessionId: string) => persistence.hydrate(sessionId).pipe(
            Effect.flatMap((state) => loop.resume(state, selectTools, persistence)),
        ),
    } as const;
});
```

| repo() Returns | agent() Returns | Purpose |
|----------------|-----------------|---------|
| `by.{resolver}` | `selectTools(intent)` | Lookup by criteria |
| `put(data)` | `run(intent)` | Primary write operation |
| `find(predicates)` | `resume(sessionId)` | Filtered retrieval |
| `stream()` | `observe()` | Streaming output |
| `merge()` | N/A (tools merge via Toolkit.merge) | Upsert |

### toolFactory() Design

The AI equivalent of a single repo column resolver:

```typescript
// Pure function: manifest entry -> Tool with annotations
const toolFactory = (entry: ToolManifestEntry): Tool.Any =>
    Tool.make(entry.name, {
        description: entry.description,
        parameters: entry.parameters,
        success: S.Unknown,    // bridge returns untyped result
        failure: S.Never,      // errors go through Effect error channel
    })
    .annotate(Tool.Destructive, entry.isDestructive)
    .annotate(Tool.Idempotent, entry.isIdempotent)
    .annotate(Tool.Readonly, !entry.isDestructive);
```

## Boundary Adapters

### Adapter 1: CommandManifestEntry -> ToolManifestEntry

**Location:** `apps/kargadan/harness/src/agent/tools.ts`
**Direction:** Kargadan domain -> Universal

The existing CommandManifestEntrySchema has fields: id, name, description, params (Record<string, unknown>), examples, isDestructive, category. The adapter maps params to Schema.Struct.Fields:

**Rhino type mapping (Claude's discretion per CONTEXT.md):**

| Rhino Type | Effect Schema | Rationale |
|------------|---------------|-----------|
| `Point3d` | `S.Tuple(S.Number, S.Number, S.Number)` | Positional semantics; LLMs handle tuples well |
| `number` | `S.Number` | Direct mapping |
| `string` | `S.String` | Direct mapping |
| `boolean` | `S.Boolean` | Direct mapping |
| `ObjectId[]` | `S.Array(S.String)` | Bridge serializes GUIDs as strings |
| `ObjectId` | `S.String` | Single GUID reference |
| `Vector3d` | `S.Tuple(S.Number, S.Number, S.Number)` | Same representation as Point3d |

### Adapter 2: PersistenceService.chatJson -> Chat.exportJson/fromJson

**Location:** `apps/kargadan/harness/src/persistence/checkpoint.ts`
**Direction:** @effect/ai Chat <-> PostgreSQL

Currently chatJson is an empty string placeholder. The adapter:
1. After each tool call: `chat.exportJson` -> string -> store as chatJson in checkpoint
2. On session resume: read chatJson from checkpoint -> `Chat.fromJson(chatJson)` -> restored Chat.Service

This wires directly into the existing PersistenceService.persist() and PersistenceService.hydrate() methods.

### Adapter 3: SearchService query results -> Toolkit assembly

**Location:** `packages/ai/toolkit-builder.ts`
**Direction:** pgvector results -> @effect/ai Toolkit

SearchService.query returns ranked document references. The adapter resolves document IDs to manifest entries, converts each through toolFactory, then assembles via Toolkit.make.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool definition with parameters | Custom tool descriptor format | `Tool.make(name, { parameters, success, failure })` | Schema validation, JSON Schema generation, handler type safety all built-in |
| Tool metadata (read-only, destructive) | Custom annotation system | `Tool.Readonly`, `Tool.Destructive`, `Tool.Idempotent` | Provider-recognized annotations; integrated with context |
| Tool collection management | Array of tools with manual lookup | `Toolkit.make(...tools)` + `Toolkit.merge(...)` | Type-safe handler mapping, Layer integration, `toLayer()` |
| Chat history accumulation | Manual message array with push | `Chat.empty` / `Chat.fromPrompt` | Ref-based, semaphore-protected, auto-appends on generate |
| Chat serialization/restore | Custom JSON encode/decode of messages | `Chat.exportJson` / `Chat.fromJson` | Schema-validated, provider-agnostic Prompt format |
| Auto-persisting chat | Manual save-after-each-call logic | `Chat.Persistence` with `BackingPersistence` | Automatic save-on-generate, TTL support, getOrCreate |
| Token counting for budget | Character estimation (chars/4) | `Tokenizer.Tokenizer` from provider package | Provider-accurate tokenization; proper truncation |
| Provider abstraction | Custom model wrapper interface | `LanguageModel.LanguageModel` tag | All @effect/ai providers implement this; tools/chat/streaming all use it |
| Multi-provider fallback | Custom retry-with-next-provider loop | `AiRuntime.runLanguage.reduce` pattern (existing) | Already implemented in registry.ts + runtime.ts |

**Key insight:** Every custom AI abstraction attempted in this codebase will be worse than what @effect/ai provides, because the library handles edge cases around tool call result encoding, streaming chunk accumulation, history format normalization, and provider-specific prompt mapping that are not visible at the API surface but critical at runtime.

## Common Pitfalls

### Pitfall 1: Tool Parameter Schema Confusion
**What goes wrong:** Passing `S.Struct({ x: S.Number })` to Tool.make parameters instead of `{ x: S.Number }`.
**Why it happens:** Tool.make parameters accepts `Schema.Struct.Fields` (the raw field record), NOT a `Schema.Struct` instance. The library wraps it in `Schema.Struct` internally.
**How to avoid:** Always pass the plain object: `parameters: { x: S.Number, y: S.String }`. Never pre-wrap.
**Warning signs:** TypeScript error about `Schema.Struct<...>` not assignable to `Schema.Struct.Fields`.

### Pitfall 2: Toolkit Handler Type Mismatch
**What goes wrong:** Handler function returns wrong type or misses a tool.
**Why it happens:** `Toolkit.toLayer(handlers)` requires a handler for every user-defined tool. The handlers record must have a key for each tool name, and each handler's return type must match the tool's success schema.
**How to avoid:** Use `toolkit.of(handlers)` for type-safe handler declaration before passing to `toLayer`. The `of` method enforces the correct handler shape at compile time.
**Warning signs:** Missing property errors or Effect type mismatches in the handler record.

### Pitfall 3: Context Window Exhaustion from Tool Definitions
**What goes wrong:** Loading 200+ tools into a single LLM call exhausts context, leaving no room for conversation history or scene data.
**Why it happens:** Each tool definition consumes tokens for name, description, and JSON Schema of parameters. Large catalogs (Rhino has hundreds of commands) can consume 50K+ tokens.
**How to avoid:** RAG-based per-turn tool selection. Query pgvector with user intent, take top-K (recommended 8-15), assemble Toolkit from only those. Keep context budget: ~20% tools, ~40% history, ~40% scene+system.
**Warning signs:** Model responses become generic or refuse to use tools; token usage approaching context limit.

### Pitfall 4: Blind Retry Instead of Correction
**What goes wrong:** Agent retries the exact same tool call after failure, wasting attempts.
**Why it happens:** Default retry semantics retry the same input. The CONTEXT.md explicitly requires investigate-then-correct: "Failure means the agent got the approach wrong."
**How to avoid:** The DECIDE phase must inspect the failure, potentially query scene state or docs, then modify the approach before the next EXECUTE. Never retry with identical parameters.
**Warning signs:** Same tool call appearing multiple times in session trace with same parameters.

### Pitfall 5: Forgetting LanguageModel Requirement on Chat.fromJson
**What goes wrong:** Chat.fromJson compiles but fails at runtime because LanguageModel is not in the environment.
**Why it happens:** Chat.fromJson returns `Effect<Service, ParseError, LanguageModel.LanguageModel>`. The LanguageModel is needed because the restored Chat.Service methods (generateText, etc.) require it. Even though construction does not call the model, the Effect type carries the requirement.
**How to avoid:** Always provide a LanguageModel Layer when using Chat.fromJson. The Kargadan harness must have AiRuntime (which provides LanguageModel) in scope during session hydration.
**Warning signs:** `Service LanguageModel not found` runtime error during hydration.

### Pitfall 6: Undo Record Batching
**What goes wrong:** Multiple tool calls wrapped in a single undo record, making granular correction impossible.
**Why it happens:** Attempting to optimize by batching related commands.
**How to avoid:** CONTEXT.md is explicit: "Each tool call is its own undo record." The tool handler must call BeginUndoRecord/EndUndoRecord per invocation, never batch.
**Warning signs:** Undo reverting more operations than the last failed step.

## Code Examples

### Creating Tools from Manifest (Universal)

```typescript
// packages/ai/tool-factory.ts
// Source: @effect/ai v0.33.2 Tool.d.ts (verified from installed node_modules)

const toolFactory = (entry: typeof ToolManifestEntry.Type) =>
    Tool.make(entry.name, {
        description: entry.description,
        parameters: entry.parameters as S.Struct.Fields,
    })
    .annotate(Tool.Destructive, entry.isDestructive)
    .annotate(Tool.Readonly, !entry.isDestructive)
    .annotate(Tool.Idempotent, entry.isIdempotent);
```

### Assembling Dynamic Toolkit from RAG Results

```typescript
// packages/ai/toolkit-builder.ts
// Source: @effect/ai v0.33.2 Toolkit.d.ts (verified from installed node_modules)

const assembleToolkit = Effect.fn('ai.toolkit.assemble')(
    (tools: ReadonlyArray<Tool.Any>) =>
        Effect.succeed(Toolkit.make(...tools))
);

// Merging static tools (always available) with dynamic tools (RAG-selected)
const mergeToolkits = (
    staticKit: Toolkit.Any,
    dynamicKit: Toolkit.Any,
) => Toolkit.merge(staticKit, dynamicKit);
```

### Chat Persistence via exportJson/fromJson

```typescript
// Source: @effect/ai v0.33.2 Chat.ts source (verified from installed node_modules)

// Export after tool call:
const exportChat = (chat: Chat.Service) =>
    chat.exportJson.pipe(
        Effect.mapError(() => new AiError({
            cause: 'serialize_failed',
            operation: 'chat.export',
            reason: 'unknown',
        })),
    );

// Restore on session resume:
const restoreChat = (chatJson: string) =>
    Chat.fromJson(chatJson).pipe(
        Effect.catchTag('ParseError', () => Chat.empty),
    );
// Note: requires LanguageModel in R channel
```

### Toolkit Handler Layer

```typescript
// Source: @effect/ai v0.33.2 Toolkit.d.ts (verified from installed node_modules)

const MyTools = Toolkit.make(
    Tool.make('GetSceneInfo', {
        description: 'Get current scene summary',
        success: S.String,
    }),
    Tool.make('ExecuteCommand', {
        description: 'Execute a command',
        parameters: {
            command: S.String,
            args: S.Record({ key: S.String, value: S.Unknown }),
        },
        success: S.Unknown,
    }).annotate(Tool.Destructive, true),
);

const MyToolsHandlers = MyTools.toLayer(
    Effect.gen(function* () {
        const dispatch = yield* SomeDispatchService;
        return {
            GetSceneInfo: () => dispatch.execute(/* ... */),
            ExecuteCommand: ({ command, args }) => dispatch.execute(/* ... */),
        };
    }),
);
```

### Chat.Persistence with BackingPersistence

```typescript
// Source: @effect/ai v0.33.2 Chat.d.ts (verified from installed node_modules)

// Create persistence layer (requires BackingPersistence from @effect/experimental)
const ChatPersistenceLive = Chat.layerPersisted({
    storeId: 'agent-chats',
});

// Usage:
const program = Effect.gen(function* () {
    const persistence = yield* Chat.Persistence;
    const chat = yield* persistence.getOrCreate('session-123');

    // Auto-saves after each generateText call
    const response = yield* chat.generateText({
        prompt: 'Execute operation',
    });

    // Manual save also available
    yield* chat.save;
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual message array management | `Chat.empty` / `Chat.fromPrompt` with Ref-based history | @effect/ai 0.30+ | Eliminates custom history accumulation code |
| Custom tool descriptor format | `Tool.make` with Schema.Struct.Fields + annotations | @effect/ai 0.28+ | Schema validation, JSON Schema gen, type-safe handlers |
| Single model per request | `AiRuntime.runLanguage.reduce` fallback cascade | Existing in codebase | Multi-provider resilience already implemented |
| Character-based token estimation | `Tokenizer.Tokenizer` service | @effect/ai 0.30+ | Provider-accurate token counting and truncation |
| Manual chat serialize/deserialize | `Chat.exportJson` / `Chat.fromJson` | @effect/ai 0.30+ | Provider-agnostic Prompt schema serialization |
| Custom persistence wrapper | `Chat.Persistence` with BackingPersistence | @effect/ai 0.32+ | Auto-save-on-generate, TTL, getOrCreate |
| Tool arrays with manual dispatch | `Toolkit.make` / `Toolkit.merge` / `toolkit.toLayer` | @effect/ai 0.28+ | Type-safe handler binding, composable collections |

**Deprecated/outdated:**
- Direct `LanguageModel.generateText()` without Chat wrapper: still valid for one-shot calls, but multi-turn conversations should use Chat.Service
- AiRuntime.chat method: currently creates a bare Chat.empty; Phase 5 should evolve this to support Chat.fromJson for session restore

## Open Questions

1. **Top-K Value for RAG Tool Selection**
   - What we know: Rhino has hundreds of commands. Each tool definition consumes approximately 200-500 tokens. Context windows are 128K-200K tokens depending on provider.
   - What is unclear: Optimal top-K that balances relevance with context budget.
   - Recommendation: Start with K=10 (approximately 2K-5K tokens for tools). This leaves ample room for conversation history and scene context. Tune empirically based on retrieval accuracy -- if the correct tool is consistently not in top-10, increase to 15. Monitor via SearchService hit rates.

2. **Chat.Persistence vs Manual exportJson/fromJson**
   - What we know: Chat.Persistence auto-saves on every generateText/streamText/generateObject call using BackingPersistence from @effect/experimental. Manual approach uses exportJson after tool calls and fromJson on resume.
   - What is unclear: Whether BackingPersistence integrates cleanly with the existing PersistenceService's SqlClient-based checkpoint writes, or whether it requires its own storage adapter.
   - Recommendation: Phase 5 should start with manual exportJson/fromJson wired into the existing PersistenceService. This is lower risk and the checkpoint.ts code already has the chatJson field. Migrate to Chat.Persistence in a follow-up if the manual approach proves too fragile.

3. **Tokenizer Provider Availability**
   - What we know: @effect/ai-openai exports `OpenAiTokenizer` (verified from node_modules). Anthropic and Google provider packages need verification for Tokenizer exports.
   - What is unclear: Whether all three providers ship Tokenizer implementations, or whether a fallback is needed.
   - Recommendation: Use OpenAI tokenizer for budget estimation (it is always available since OpenAI is the embedding provider). For context budget allocation, approximate token counts are sufficient -- exact per-provider counts matter less than staying within safe margins.

4. **hashCanonicalState Cross-Concern**
   - What we know: `_hash` (canonicalize + SHA-256) currently lives in `persistence/checkpoint.ts` but is used by `knowledge/seeder.ts` for embedding hash comparison. CONTEXT.md notes this as a cross-concern to resolve.
   - What is unclear: Whether to extract to a shared utility or duplicate.
   - Recommendation: Extract to a small pure utility in the harness (not packages/ai -- this is app-level). Both checkpoint and seeder import from the same module. Per CLAUDE.md, no helper files -- colocate in the module that defines the canonical behavior (checkpoint.ts, since it owns state hashing) and import from there.

## Sources

### Primary (HIGH confidence)
- @effect/ai v0.33.2 installed type declarations (`Tool.d.ts`, `Toolkit.d.ts`, `Chat.d.ts`, `Tokenizer.d.ts`, `LanguageModel.d.ts`) -- exact API signatures verified from `node_modules/.pnpm/@effect+ai@0.33.2_*/node_modules/@effect/ai/dist/dts/`
- @effect/ai v0.33.2 source code (`Chat.ts`) -- verified Chat.fromJson/fromExport implementation for provider portability analysis
- [Effect AI Tool Use documentation](https://effect.website/docs/ai/tool-use/) -- Tool.make, Toolkit patterns
- [Effect AI Introduction](https://effect.website/docs/ai/introduction/) -- Architecture overview, provider abstraction
- [Effect AI blog post](https://effect.website/blog/effect-ai/) -- Design philosophy, ExecutionPlan, streaming
- Existing codebase: `packages/ai/src/` (runtime.ts, registry.ts, runtime-provider.ts, search.ts, errors.ts, mcp.ts)
- Existing codebase: `packages/database/src/factory.ts` -- repo() factory pattern analysis
- Existing codebase: `apps/kargadan/harness/src/` (all modules)

### Secondary (MEDIUM confidence)
- [DeepWiki: AI Integration Architecture](https://deepwiki.com/Effect-TS/effect/10.1-ai-integration-architecture) -- architectural overview cross-referenced with installed types
- [npm: @effect/ai](https://www.npmjs.com/package/@effect/ai) -- version confirmation
- [npm: @effect/ai-openai](https://www.npmjs.com/package/@effect/ai-openai) -- OpenAiTokenizer availability

### Tertiary (LOW confidence)
- Token budget allocation ratios (20% tools / 40% history / 40% scene) -- based on general LLM engineering practice, not @effect/ai-specific guidance. Needs empirical validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified from installed node_modules, exact versions confirmed
- Architecture: HIGH -- factory pattern mapped from verified codebase patterns; Tool/Toolkit/Chat APIs verified from type declarations and source
- Pitfalls: HIGH -- parameter schema confusion verified from Tool.d.ts type signatures; provider portability verified from Chat.ts source; context exhaustion based on established LLM engineering knowledge
- Universal type boundaries: HIGH -- derived from direct analysis of existing packages/ai and packages/database patterns
- Factory pattern design: MEDIUM -- the mapping from repo() to agent() is an architectural recommendation, not a verified pattern from external sources. The individual components (Tool.make, Toolkit, Chat) are HIGH confidence; their composition into a factory is the design contribution.

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (30 days -- @effect/ai is actively developed; check for breaking changes before execution)
