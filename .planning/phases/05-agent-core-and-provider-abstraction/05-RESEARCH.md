# Phase 5: Agent Core and Provider Abstraction - Research

**Researched:** 2026-02-23
**Domain:** AI agent orchestration, LLM provider abstraction, RAG-driven tool generation, state machine loop
**Confidence:** HIGH (core APIs verified against installed v0.33.2 type declarations)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Bridge plugin enumerates ALL Rhino commands via SDK on load, sends full catalog JSON as a protocol message after WebSocket handshake
- Harness decodes via `CommandManifest.decode()` and seeds via `KBSeeder.seed(manifest, embed)` on every connection
- No version tracking or change detection -- always re-seed, rely on ON CONFLICT idempotency (already implemented in seeder)
- Full Rhino command list, not a curated subset -- let RAG ranking handle relevance
- First connection seeds embeddings via OpenAI API; subsequent connections re-upsert documents but skip embedding if hash unchanged (seeder's existing hash comparison)
- Plan-then-confirm: agent plans the full operation, shows the plan, waits for user approval before executing any writes. Reads execute freely without approval.
- On failure: DO NOT retry blindly. Read the API docs, examine the document state, understand what went wrong, then correct the approach.
- Always undo the failed attempt before trying the corrected approach -- clean slate each time.
- Maximum 2 correction cycles: original attempt + 2 corrections = 3 total tries.
- Each tool call is its own undo record -- no batching.
- Mechanical conversion: a pure function maps CommandManifestEntry params to Effect Schema types automatically.
- isDestructive field in CommandManifestEntrySchema is the source of truth for undo wrapping.
- RAG selects tools per-turn: full catalog is embedded in pgvector. Each turn, agent queries with user intent. Only top-K relevant commands become active tools for that turn.
- One tool call per Rhino command per step.
- All three providers at launch: Anthropic, OpenAI, Google.
- Embedding API: OpenAI text-embedding-3-small (1536 dimensions, already configured in seeder). Fixed regardless of which LLM provider is selected.
- Chat history: wire Chat.exportJson/Chat.fromJson into PersistenceService -- replace the Phase 4 empty-string chatJson placeholder.

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
| AGNT-01 | packages/ai provides a generic agent loop service consumable by any app | AiRuntime already exists in packages/ai; kargadan AgentLoop consumes it. Phase 5 refactors loop to accept LLM-generated plans via Chat + Toolkit |
| AGNT-02 | Tools defined via @effect/ai Tool.make with schema-driven parameters | Tool.make API verified in installed v0.33.2; Toolkit.make composes tools; toLayer wires handlers |
| AGNT-03 | Agent translates natural language into Rhino commands via LLM inference | Chat.generateText with toolkit enables tool-calling; RAG selects relevant tools per turn |
| AGNT-04 | C# bridge exports real command catalog, harness decodes + seeds KB | GetCommandNames SDK API returns string[]; plugin must build catalog JSON with descriptions from structured metadata |
| AGNT-05 | Agent uses @effect/ai Chat for multi-turn conversation with Ref-based history | Chat.empty / Chat.fromPrompt create sessions; chat.history is Ref<Prompt>; exportJson/fromJson for persistence |
| AGNT-09 | Read tools stateless/high-frequency; write tools validated/undo-wrapped | Tool.Readonly and Tool.Destructive annotations in @effect/ai distinguish read vs write tools |
| AGNT-10 | Agent loop follows PLAN/EXECUTE/VERIFY/PERSIST/DECIDE state machine | Tagged union LoopState + Match.type dispatch; Effect.iterate drives transitions |
| PROV-01 | User selects AI provider at session start | AiRegistry.layers already dispatches via Match.value on provider name |
| PROV-02 | Provider config stored and resolved at runtime | AiRuntimeProvider.resolve.settings reads per-tenant config; HarnessConfig for CLI-level override |
| PROV-03 | Adding new provider requires only a new Layer | Architecture verified: _languageModel returns Layer<LanguageModel> per provider; adding a new case is one Match branch |
| PROV-04 | Fallback chain across providers | AiRuntime.runLanguage already reduces through fallbackLanguage array with catchIf(AiSdkError.isAiError) |
</phase_requirements>

## Summary

Phase 5 connects three systems: (1) the C# bridge plugin exports a Rhino command catalog that the harness decodes and seeds into pgvector, (2) an agent loop state machine accepts natural language, discovers relevant commands via RAG, generates Tool.make definitions dynamically, and executes them through the bridge, and (3) a provider abstraction layer enables Anthropic/OpenAI/Google from day one with fallback chains.

The existing codebase provides strong infrastructure. `packages/ai` already has AiRuntime with embed/generateText/streamText/chat, AiRegistry with multi-provider layer dispatch, and AiRuntimeProvider with budget/rate/fallback tracking. `apps/kargadan/harness` has the persistence pipeline (PersistenceService), the KB seeder (KBSeeder with EmbeddingModel dependency), the command manifest decode schema (CommandManifest), and a working agent loop skeleton (AgentLoop with PLAN/EXECUTE/VERIFY state machine). The primary work is: (a) adding a catalog export protocol message type on the C# side, (b) building the RAG query function to retrieve relevant commands from pgvector, (c) generating Tool.make definitions dynamically from CommandManifestEntry, (d) wiring Chat into the agent loop for LLM interaction, and (e) wiring Chat.exportJson/fromJson into PersistenceService.

**Primary recommendation:** Use @effect/ai v0.33.2's Tool.make + Toolkit.make + Chat as the core API surface. Generate tools dynamically from manifest entries. Wire Chat.exportJson/fromJson into PersistenceService's chatJson field. Use the existing SearchRepo cosine similarity query pattern for RAG retrieval.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/ai` | 0.33.2 | Tool.make, Toolkit, Chat, LanguageModel, EmbeddingModel | Provider-agnostic AI abstractions; already integrated in packages/ai |
| `@effect/ai-anthropic` | 0.23.0 | AnthropicLanguageModel, AnthropicClient | Anthropic Claude provider; already wired in AiRegistry |
| `@effect/ai-openai` | 0.37.2 | OpenAiLanguageModel, OpenAiEmbeddingModel, OpenAiClient | OpenAI provider + embedding; already wired in AiRegistry |
| `@effect/ai-google` | 0.12.1 | GoogleLanguageModel, GoogleClient | Google Gemini provider; already wired in AiRegistry |
| `@effect/sql` | 0.49.0 | SqlClient for pgvector queries | Already used by KBSeeder and PersistenceService |
| `@effect/sql-pg` | 0.50.3 | PostgreSQL client with pgvector support | Already used for halfvec storage and cosine similarity |
| `effect` | 3.19.18 | Effect, Schema, Match, Ref, Data.TaggedError | Core framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/platform` | 0.94.5 | FetchHttpClient for provider API calls | Already used by provider client layers |
| `@effect/experimental` | 0.58.0 | BackingPersistence for Chat.Persistence | Only if using Chat.Persistence instead of manual exportJson/fromJson |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual exportJson/fromJson | Chat.Persistence + BackingPersistence | More infrastructure but automatic save; Phase 5 scope favors manual wiring into existing PersistenceService |
| Dynamic Tool.make per turn | Static Tool.make at startup | Static cannot adapt to RAG-selected subsets; dynamic is required by design |
| pgvector via @effect/sql raw SQL | Dedicated vector DB (Pinecone, Weaviate) | pgvector is already deployed, SearchRepo patterns exist, no external dependency needed |

**Installation:** No new dependencies required. All packages already in catalog and installed.

## Architecture Patterns

### Recommended Project Structure
```
apps/kargadan/harness/src/
├── knowledge/
│   ├── manifest.ts          # CommandManifest decode schema (exists)
│   ├── seeder.ts             # KBSeeder write pipeline (exists)
│   └── retriever.ts          # NEW: RAG query for top-K commands
├── agent/
│   ├── loop.ts               # REFACTORED: LLM-driven PLAN/EXECUTE/VERIFY/PERSIST/DECIDE
│   ├── tools.ts              # NEW: Dynamic Tool.make from CommandManifestEntry
│   └── state.ts              # NEW: Tagged union LoopState with Match.type transitions
├── persistence/
│   ├── checkpoint.ts         # PersistenceService (exists, chatJson wiring)
│   └── models.ts             # Model.Class definitions (exists)
├── protocol/
│   ├── dispatch.ts           # CommandDispatch (exists)
│   └── schemas.ts            # Protocol schemas (exists, add catalog message type)
├── config.ts                 # HarnessConfig (exists)
├── harness.ts                # Main entry + ServicesLayer (exists)
└── socket.ts                 # WebSocket client (exists)
```

### Pattern 1: Dynamic Tool Generation from Manifest
**What:** Pure function converts CommandManifestEntry to Tool.make call. RAG selects which entries become active tools each turn.
**When to use:** Every agent turn -- query user intent against pgvector, get top-K, generate Toolkit from results.

```typescript
// Source: @effect/ai v0.33.2 Tool.d.ts (verified against installed types)
const manifestToTool = (entry: typeof CommandManifest.schema.Type) =>
    Tool.make(entry.id, {
        description: `${entry.name}: ${entry.description}`,
        parameters: schemaFromParams(entry.params),
        success: S.Struct({ objectId: S.optional(S.UUID), status: S.String }),
    }).pipe(
        (tool) => entry.isDestructive
            ? tool.annotate(Tool.Destructive, true)
            : tool.annotate(Tool.Readonly, true),
    );

const buildToolkit = (entries: ReadonlyArray<typeof CommandManifest.schema.Type>) =>
    Toolkit.make(...entries.map(manifestToTool));
```

### Pattern 2: Chat Integration with Persistence
**What:** Chat.exportJson serializes conversation; Chat.fromJson restores it. Wire into PersistenceService.persist chatJson field.
**When to use:** Every persist call saves chat state; hydrate restores it.

```typescript
// Source: @effect/ai v0.33.2 Chat.d.ts (verified)
// Export: chat.exportJson -> Effect<string, AiError.MalformedOutput>
// Import: Chat.fromJson(data) -> Effect<Service, ParseError, LanguageModel>

const chatJson = yield* chat.exportJson;
yield* persistence.persist({
    chatJson,
    checkpoint: buildCheckpoint(state, sequence),
    toolCall: buildToolCall(state, command, result),
});

// On hydrate:
const resumed = yield* Chat.fromJson(hydrationResult.chatJson);
```

### Pattern 3: RAG-Driven Tool Selection via pgvector
**What:** Query pgvector with user intent embedding, retrieve top-K matching commands, build per-turn toolkit.
**When to use:** Every agent turn before calling Chat.generateText.

```typescript
// Source: packages/database/src/search.ts (existing pattern)
// Cosine similarity: 1 - (embeddings.embedding <=> query::halfvec(3072))
// Already implemented in SearchRepo._buildRankedCtes semantic_candidates CTE

const retrieve = Effect.fn('kargadan.kb.retrieve')((
    query: string,
    topK: number,
) => Effect.gen(function* () {
    const embedding = yield* aiRuntime.embed(query);
    const results = yield* sql`
        SELECT d.entity_id, d.display_text, d.metadata,
               1 - (e.embedding <=> (${serializeVector(embedding)})::halfvec(${3072})) AS score
        FROM search_embeddings e
        JOIN search_documents d ON d.entity_type = e.entity_type AND d.entity_id = e.entity_id
        WHERE d.entity_type = 'rhinoCommand'
        ORDER BY e.embedding <=> (${serializeVector(embedding)})::halfvec(${3072})
        LIMIT ${topK}
    `;
    return results;
}));
```

### Pattern 4: Agent Loop State Machine with Tagged Union
**What:** LoopState as tagged union with exhaustive Match.type dispatch for transitions.
**When to use:** Core agent loop structure.

```typescript
// Source: effect Match.type pattern (CLAUDE.md mandated)
type AgentState =
    | { readonly _tag: 'Planning'; readonly turnContext: TurnContext }
    | { readonly _tag: 'AwaitingApproval'; readonly plan: Plan; readonly turnContext: TurnContext }
    | { readonly _tag: 'Executing'; readonly command: Command; readonly turnContext: TurnContext }
    | { readonly _tag: 'Verifying'; readonly result: Result; readonly turnContext: TurnContext }
    | { readonly _tag: 'Persisting'; readonly verified: VerifiedResult; readonly turnContext: TurnContext }
    | { readonly _tag: 'Deciding'; readonly outcome: Outcome; readonly turnContext: TurnContext }
    | { readonly _tag: 'Correcting'; readonly failure: FailureInfo; readonly cycle: number; readonly turnContext: TurnContext }
    | { readonly _tag: 'Completed'; readonly summary: Summary }
    | { readonly _tag: 'Failed'; readonly error: FailureInfo };

const transition = (state: AgentState) =>
    Match.value(state).pipe(
        Match.tag('Planning', handlePlanning),
        Match.tag('AwaitingApproval', handleApproval),
        Match.tag('Executing', handleExecution),
        Match.tag('Verifying', handleVerification),
        Match.tag('Persisting', handlePersist),
        Match.tag('Deciding', handleDecide),
        Match.tag('Correcting', handleCorrection),
        Match.tag('Completed', () => Effect.succeed(state)),
        Match.tag('Failed', () => Effect.succeed(state)),
        Match.exhaustive,
    );
```

### Pattern 5: Provider Fallback Chain
**What:** Sequential fallback through configured providers on AiError.
**When to use:** Already implemented in AiRuntime.runLanguage. Leveraged automatically.

```typescript
// Source: packages/ai/src/runtime.ts (existing implementation)
// layers.fallbackLanguage.reduce builds a catchIf chain:
// primary provider -> catchIf(isAiError) -> fallback[0] -> catchIf -> fallback[1]
// Each fallback uses its own provider layer

// AiRegistry.layers returns:
// { language: Layer, fallbackLanguage: Layer[], embedding: Layer, policy: Settings }
```

### Anti-Patterns to Avoid
- **Static tool catalog in context:** Loading all 500+ Rhino commands as tools per request wastes context. RAG selects top-K per turn.
- **Retry-on-failure without investigation:** User decision locks this out. Agent MUST undo failed attempt, read docs/state, then correct approach.
- **Batching tool calls:** One undo record per tool call. No multi-command batching.
- **Manual provider dispatch:** AiRegistry.layers already handles this via Match.value. Do not duplicate.
- **Separate chat state management:** Use Chat.exportJson/fromJson, not a parallel serialization system.
- **Embedding at query time with wrong model:** Embedding model is OpenAI text-embedding-3-small regardless of chat provider. Do not use the chat provider for embeddings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool definition | Custom tool schemas | `Tool.make(name, { parameters, success, failure })` | @effect/ai handles JSON Schema generation, parameter validation, handler wiring |
| Tool composition | Manual tool registry | `Toolkit.make(...tools)` + `toolkit.toLayer(handlers)` | Type-safe handler enforcement, automatic tool-call resolution |
| Chat state management | Custom message array tracking | `Chat.empty` / `Chat.fromPrompt` with `Ref<Prompt>` history | Semaphore-protected concurrent access, automatic history accumulation |
| Chat persistence | Custom serialization format | `chat.exportJson` / `Chat.fromJson(data)` | Schema-validated round-trip; provider-aware reconstruction via LanguageModel requirement |
| Provider abstraction | Custom API wrappers | `AiRegistry.layers(settings)` returning per-provider Layer | Already implemented; Match.exhaustive ensures new providers added correctly |
| Provider fallback | Custom retry logic | `AiRuntime.runLanguage` with `fallbackLanguage` reduce chain | Already handles catchIf(isAiError) cascade with per-fallback layer provision |
| Embedding pipeline | Custom OpenAI API calls | `EmbeddingModel.embed` / `EmbeddingModel.embedMany` via AiRuntime | Batching, caching, budget tracking already wired |
| Vector similarity search | Custom pgvector query builder | Adapt existing `SearchRepo._buildRankedCtes` semantic_candidates pattern | Handles halfvec padding, cosine distance operator, iterative scan config |
| State machine dispatch | if/else chains | `Match.value(state).pipe(Match.tag(...), Match.exhaustive)` | Exhaustive compile-time checking; CLAUDE.md mandates no if/else |

**Key insight:** The packages/ai layer already implements 80% of the provider abstraction. The primary new code is in apps/kargadan: RAG retrieval, dynamic tool generation, and Chat integration into the agent loop.

## Common Pitfalls

### Pitfall 1: Chat.fromJson Requires LanguageModel in R
**What goes wrong:** `Chat.fromJson(data)` returns `Effect<Service, ParseError, LanguageModel>`. Calling it without providing the LanguageModel layer fails at runtime.
**Why it happens:** Chat restoration needs the language model to validate/reconstruct internal state tied to the provider.
**How to avoid:** Always provide the LanguageModel layer when hydrating. The harness must resolve provider config before calling fromJson.
**Warning signs:** TypeScript will show `LanguageModel` in the R channel. If ignored via `as any`, runtime failure on hydrate.

### Pitfall 2: Embedding Model vs Language Model Provider Mismatch
**What goes wrong:** Embeddings are always OpenAI text-embedding-3-small (1536 dim). If the language model provider changes (e.g., to Anthropic), embeddings must still use OpenAI.
**Why it happens:** KBSeeder uses EmbeddingModel.embedMany which resolves from the layer. The embedding layer must always be OpenAI regardless of chat provider.
**How to avoid:** AiRegistry.layers already separates `embedding` and `language` layers. Always provide embedding layer independently. The seeder yields `EmbeddingModel.EmbeddingModel` directly.
**Warning signs:** Dimension mismatch (not 1536), wrong model name in search_embeddings table.

### Pitfall 3: Tool.make Parameters Must Be Schema.Struct.Fields
**What goes wrong:** Passing a full Schema.Struct to `parameters` instead of the fields object causes type errors.
**Why it happens:** Tool.make wraps fields in Schema.Struct internally. Passing `S.Struct({ ... })` double-wraps.
**How to avoid:** Pass the fields object directly: `parameters: { x: S.Number, y: S.Number }` not `parameters: S.Struct({ x: S.Number, y: S.Number })`.
**Warning signs:** TypeScript error about nested Struct types; tool parameters appear as `{ fields: { ... } }` in JSON Schema output.

### Pitfall 4: halfvec Dimension Padding
**What goes wrong:** pgvector halfvec columns are fixed at 3072 dimensions. Embeddings from text-embedding-3-small are 1536 dimensions. Without padding, INSERT fails.
**Why it happens:** halfvec(3072) expects exactly 3072 values. 1536-dim vectors must be zero-padded.
**How to avoid:** Use the existing `_serializeVector` in seeder.ts which pads to `_EMBEDDING.maxDimensions` (3072). The retriever must also pad query vectors.
**Warning signs:** PostgreSQL error about vector dimension mismatch.

### Pitfall 5: Toolkit.toLayer Handler Type Must Match Tool Schema
**What goes wrong:** Handler function returns a value that doesn't match the Tool's success schema type.
**Why it happens:** Tool.make's success schema defines the expected return type. The handler in toLayer must produce exactly that type.
**How to avoid:** Type system enforces this. Use toolkit.of(handlers) for type-safe handler declaration before passing to toLayer.
**Warning signs:** TypeScript error in toLayer call about handler return type incompatibility.

### Pitfall 6: Rhino GetCommandNames Returns Names Only -- No Metadata
**What goes wrong:** Expecting GetCommandNames to return descriptions, categories, or parameter info. It returns only string[].
**Why it happens:** RhinoCommon API provides command names but not structured metadata. Descriptions, parameters, and categories must be constructed separately.
**How to avoid:** The plugin must build the catalog JSON by iterating commands, collecting available metadata (name, category from CommandStyleAttribute), and providing descriptions from a curated source or help system. Parameters for built-in Rhino commands are not programmatically discoverable via SDK.
**Warning signs:** Empty description/params fields in catalog JSON.

### Pitfall 7: Re-seeding Embeddings on Every Connection
**What goes wrong:** Every connection triggers KBSeeder.seed which calls EmbeddingModel.embedMany for the entire catalog. This is slow and expensive.
**Why it happens:** User decision is to re-seed every connection, relying on ON CONFLICT idempotency.
**How to avoid:** The seeder already has hash comparison via document_hash. On re-upsert, if the hash hasn't changed, the embedding is preserved. The cost is the re-embedding of ALL texts every time. Optimize by: (a) checking document hashes before calling embedMany, (b) only embedding new/changed entries.
**Warning signs:** 5-10 second startup delay; high OpenAI embedding API costs.

## Code Examples

### Creating a Tool from CommandManifestEntry
```typescript
// Source: @effect/ai v0.33.2 Tool.d.ts (verified against installed types)
import { Tool, Toolkit } from '@effect/ai';
import { Schema as S } from 'effect';

const _PARAM_MAP: Record<string, S.Schema.Any> = {
    'Boolean': S.Boolean,
    'Int32':   S.Int,
    'Number':  S.Number,
    'ObjectId': S.UUID,
    'ObjectId[]': S.Array(S.UUID),
    'Point3d': S.Struct({ x: S.Number, y: S.Number, z: S.Number }),
    'String':  S.String,
    'Vector3d': S.Struct({ x: S.Number, y: S.Number, z: S.Number }),
} as const;

const schemaForParam = (type: string): S.Schema.Any =>
    _PARAM_MAP[type] ?? S.Unknown;

const manifestEntryToTool = (entry: typeof CommandManifest.schema.Type) => {
    const fields: Record<string, S.Schema.Any> = {};
    entry.params.forEach((param) => {
        const schema = schemaForParam(param.type);
        fields[param.name] = param.required ? schema : S.optional(schema);
    });
    return Tool.make(entry.id, {
        description: [entry.name, entry.description, entry.category]
            .filter(Boolean).join(' -- '),
        parameters: fields as S.Struct.Fields,
        success: S.Struct({
            objectId: S.optional(S.UUID),
            status: S.String,
        }),
    }).pipe((tool) =>
        entry.isDestructive
            ? tool.annotate(Tool.Destructive, true)
            : tool.annotate(Tool.Readonly, true),
    );
};
```

### Building Per-Turn Toolkit from RAG Results
```typescript
// Source: @effect/ai v0.33.2 Toolkit.d.ts (verified)
const buildTurnToolkit = (
    entries: ReadonlyArray<typeof CommandManifest.schema.Type>,
    dispatch: CommandDispatch,
) => {
    const tools = entries.map(manifestEntryToTool);
    const toolkit = Toolkit.make(...tools);
    return toolkit.toLayer(
        Object.fromEntries(
            entries.map((entry) => [
                entry.id,
                (params: unknown) => dispatch.execute(buildCommand(entry, params)),
            ]),
        ),
    );
};
```

### Chat with Toolkit for Agent Turn
```typescript
// Source: @effect/ai v0.33.2 Chat.d.ts (verified)
const agentTurn = (chat: Chat.Service, toolkit: Toolkit.WithHandler<any>) =>
    chat.generateText({
        prompt: userMessage,
        toolkit,
    });
```

### Chat Export/Import for Persistence
```typescript
// Source: @effect/ai v0.33.2 Chat.d.ts (verified)
// Export
const chatJson = yield* chat.exportJson;
// -> Effect<string, AiError.MalformedOutput>

// Import (requires LanguageModel in R)
const restored = yield* Chat.fromJson(savedChatJson);
// -> Effect<Chat.Service, ParseError, LanguageModel.LanguageModel>
```

### pgvector Cosine Similarity Query for RAG Retrieval
```typescript
// Source: packages/database/src/search.ts (existing codebase pattern)
// Uses: halfvec cosine distance operator <=>
// Index: HNSW with halfvec_cosine_ops
const retrieveCommands = (queryVector: readonly number[], topK: number) =>
    sql`
        SELECT d.entity_id, d.display_text, d.content_text, d.metadata,
               1 - (e.embedding <=> (${serializeVector(queryVector)})::halfvec(${3072})) AS score
        FROM search_embeddings e
        JOIN search_documents d
            ON d.entity_type = e.entity_type AND d.entity_id = e.entity_id
        WHERE d.entity_type = ${'rhinoCommand'}
        ORDER BY e.embedding <=> (${serializeVector(queryVector)})::halfvec(${3072})
        LIMIT ${topK}
    `;
```

### C# Command Catalog Export (Bridge Side)
```csharp
// Source: Rhino.Commands.Command.GetCommandNames (RhinoCommon SDK, verified)
// Returns string[] of command names; no descriptions/params available from SDK
string[] commandNames = Command.GetCommandNames(english: true, loaded: false);

// Plugin must construct catalog JSON by iterating and adding metadata:
// - name: from GetCommandNames
// - id: normalized lowercase with underscores
// - description: from curated static map or help system
// - params: from curated static map (SDK does not expose params programmatically)
// - isDestructive: from curated static map
// - category: from CommandStyleAttribute or curated map
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom AI wrappers per provider | @effect/ai provider-agnostic LanguageModel + EmbeddingModel | @effect/ai 0.30+ (2025 H2) | Single Tool/Chat API works across all providers |
| AiToolkit (older API name) | Toolkit.make + Tool.make (current API) | @effect/ai 0.33 | AiToolkit was renamed/refactored; Toolkit is the current module |
| Manual tool JSON schema | Tool.make auto-generates JSON Schema from Schema fields | @effect/ai 0.33 | No hand-written JSON Schema needed; derived from Effect Schema |
| Custom chat persistence | Chat.exportJson + Chat.fromJson | @effect/ai 0.33 | Built-in serialization; also Chat.Persistence with BackingPersistence for automatic save |
| Manual vector padding | SearchRepo._embeddingPayload handles padding | Existing codebase | halfvec(3072) padding is automated |

**Deprecated/outdated:**
- `AiToolkit`: Renamed to `Toolkit` in @effect/ai 0.33. Use `Toolkit.make(...tools)` not `AiToolkit.make(...)`.
- Direct `LanguageModel.generateText` without toolkit: Still works but misses tool-calling. Always pass toolkit when tools are needed.

## Open Questions

1. **Rhino command metadata sourcing**
   - What we know: `GetCommandNames(true, false)` returns all English command names as string[]. No SDK method returns descriptions, parameter schemas, or categories programmatically.
   - What's unclear: How to generate structured descriptions and parameter metadata for 500+ built-in Rhino commands. Options: (a) curated JSON manifest shipped with plugin, (b) parsing Rhino help files, (c) LLM-generated descriptions from command names, (d) starting with a subset and expanding.
   - Recommendation: Ship a curated static manifest with the plugin. Start with the ~50 most common modeling commands. The CommandManifestEntrySchema already defines the shape. Expand the manifest incrementally. This is a data problem, not an architecture problem.

2. **Top-K value for RAG tool selection**
   - What we know: Context window budget matters. Each tool definition consumes ~100-200 tokens. With GPT-4o's 128K context, 20 tools = ~4K tokens (3% of budget).
   - What's unclear: Optimal balance between tool breadth and context consumption.
   - Recommendation: Start with K=10. This provides sufficient command variety (~2K tokens) while preserving context for conversation, scene summary, and response. Configurable via KARGADAN_RAG_TOP_K env var.

3. **Chat.fromJson LanguageModel requirement for CLI harness**
   - What we know: Chat.fromJson requires LanguageModel in its R channel. The harness is a CLI app, not a multi-tenant server. The LanguageModel layer must be resolved before hydration.
   - What's unclear: Whether the LanguageModel layer must match the original provider that created the chat (e.g., if exported with Anthropic, must it be restored with Anthropic?).
   - Recommendation: Provide the currently-configured LanguageModel layer when calling fromJson. The chat content is provider-agnostic (it's just message history). The LanguageModel requirement likely exists for the tokenizer/prompt formatting, not content validation. Verify empirically.

4. **hashCanonicalState cross-concern**
   - What we know: `_hash` in checkpoint.ts is a pure SHA-256 canonicalization function. It's used by PersistenceService internally and was previously needed by KBSeeder (now uses its own `_deterministicUuid`).
   - What's unclear: Whether the hash utility should be extracted to a shared module during Phase 5.
   - Recommendation: Defer extraction. The seeder and persistence service now use different hash functions for different purposes. Extract only when a third consumer appears.

## Sources

### Primary (HIGH confidence)
- @effect/ai v0.33.2 installed type declarations (`Chat.d.ts`, `Tool.d.ts`, `Toolkit.d.ts`) -- verified exact API signatures against installed package
- `packages/ai/src/runtime.ts`, `registry.ts`, `runtime-provider.ts` -- existing codebase, verified current implementation
- `packages/database/src/search.ts` -- existing pgvector query patterns with halfvec cosine similarity
- `apps/kargadan/harness/src/` -- existing harness code (manifest.ts, seeder.ts, checkpoint.ts, agent-loop.ts)
- [RhinoCommon Command class API](https://developer.rhino3d.com/api/rhinocommon/rhino.commands.command) -- GetCommandNames signature verified
- [RhinoCommon source](https://github.com/mcneel/rhinocommon/blob/master/dotnet/rhino/rhinosdkcommand.cs) -- Command metadata limitations confirmed

### Secondary (MEDIUM confidence)
- [Effect AI Introduction](https://effect.website/docs/ai/introduction/) -- architecture overview
- [DeepWiki Effect-TS AI Integration](https://deepwiki.com/Effect-TS/effect/10.1-ai-integration-architecture) -- architecture patterns and Chat/Tool system design
- [pgvector GitHub](https://github.com/pgvector/pgvector) -- halfvec documentation, cosine operator syntax

### Tertiary (LOW confidence)
- Rhino command parameter metadata availability -- no official documentation found confirming or denying programmatic access to command parameters beyond names. Negative claim based on absence of evidence in SDK docs and source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages verified against installed versions; APIs confirmed from .d.ts files
- Architecture: HIGH - Existing codebase provides strong precedent for all patterns; Tool.make/Toolkit/Chat APIs verified
- Pitfalls: HIGH - API signatures verified; dimension/padding issues confirmed from existing seeder code; Rhino SDK limitations confirmed from source
- C# bridge catalog: MEDIUM - GetCommandNames verified; metadata limitation confirmed; but the catalog construction approach (curated manifest) is a recommendation, not a verified pattern

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (30 days; @effect/ai is in active development but API is stable at 0.33.x)
