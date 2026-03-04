# Architecture Research

**Domain:** CLI-based AI agent controlling Rhino 9 on macOS — two-process Effect/TypeScript + C# architecture
**Researched:** 2026-02-22
**Confidence:** HIGH (grounded in existing codebase, official Effect docs, Anthropic Tool Search docs, validated prior Rhino research)
**Status note (2026-03-04):** Research artifact; implementation truth is tracked in `.planning/ROADMAP.md` and `.planning/STATE.md`.

---

## Standard Architecture (Target-State / Phase 6+)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLI LAYER (apps/kargadan/harness — TypeScript, Node.js process)     │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  CLI Shell  │  │  AgentLoop   │  │   packages/ai AiService     │  │
│  │ (@effect/cli│  │ PLAN→EXECUTE │  │  LanguageModel + Toolkit    │  │
│  │  /stdio)    │  │ →VERIFY→     │  │  Chat (Ref history)         │  │
│  │  streaming  │  │ PERSIST→     │  │  Tokenizer (context budget) │  │
│  │  progress   │  │ DECIDE       │  │  Tool Search Tool proxy     │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────────────────────────┘  │
│         │                │                                           │
│  ┌──────┴──────────────────────────────────────────────────────┐     │
│  │                   packages/ai AiRuntime                     │     │
│  │  AiRegistry (provider layers) + AiRuntimeProvider           │     │
│  │  Budget/rate enforcement + OTEL telemetry                   │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │           packages/ai Tool Infrastructure                    │    │
│  │  AiToolkit (read tools | write tools)                        │    │
│  │  Tool.make schema-driven definitions                         │    │
│  │  Rhino command knowledge base (pgvector RAG)                 │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────┐  ┌─────────────────────────────────────────┐   │
│  │ ReconnectionSup. │  │  PostgreSQL Session Store               │   │
│  │ socket/session   │  │  checkpoints + journal + chatJson       │   │
│  │ recovery rails   │  │  (legacy trace replaced)                │   │
│  │ pending-map sync │  └─────────────────────────────────────────┘   │
│  │ + timeout policy │                                                │
│  └──────────────────┘                                                │
├──────────────────────────────────────────────────────────────────────┤
│             WebSocket Bridge (ws://127.0.0.1:<port from ~/.kargadan/port>) │
│  Full-duplex JSON; Deferred-correlated request/response; event queue │
├──────────────────────────────────────────────────────────────────────┤
│  PLUGIN LAYER (apps/kargadan/plugin — C# net9.0, Rhino process)      │
│                                                                      │
│  ┌────────────────────┐  ┌─────────────────────────────────────┐     │
│  │  WebSocket Server  │  │  RhinoDoc Command Executor          │     │
│  │  System.Net.       │  │  RhinoApp.RunScript (dynamic cmds)  │     │
│  │  WebSockets +      │  │  Direct RhinoCommon API             │     │
│  │  background thread │  │  InvokeOnUiThread (mandatory macOS) │     │
│  └──────────┬─────────┘  └─────────────────────────────────────┘     │
│             │                                                        │
│  ┌──────────┴───────────────────────────────────────────────────┐    │
│  │  Protocol Contracts (ProtocolValueObjects, ProtocolEnvelopes)│    │
│  │  CommandRouter (JsonElement → Fin<CommandEnvelope>)          │    │
│  │  SessionHost (Connected → Active → Terminal state machine)   │    │
│  │  Handshake.Negotiate (version negotiation)                   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────────┐  ┌───────────────────────────────────┐   │
│  │  EventPublisher        │  │  Undo Record Manager              │   │
│  │  Atomic drain with     │  │  BeginUndoRecord / EndUndoRecord  │   │
│  │  Atom<Seq<Event>>      │  │  AddCustomUndoEvent (agent state) │   │
│  └────────────────────────┘  └───────────────────────────────────┘   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │  RhinoDoc Event Subscriptions (200ms debounced)            │      │
│  │  AddRhinoObject / DeleteRhinoObject / ModifyObjectAttrs    │      │
│  │  LayerTableEvent / UndoRedo                                │      │
│  └────────────────────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER                                                   │
│  ┌──────────────────────┐  ┌───────────────────────────────────┐     │
│  │  PostgreSQL 18.2     │  │  pgvector Knowledge Base          │     │
│  │  (packages/database) │  │  Rhino command catalog            │     │
│  │  RunEvent log        │  │  embeddings: text-embedding-3-    │     │
│  │  RunSnapshot         │  │  small (1536-dim)                 │     │
│  │  ConversationHistory │  │  hybrid: vector + trigram         │     │
│  └──────────────────────┘  └───────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries (Target-State / Phase 6+)

| Component                                          | Responsibility                                                                                                                                         | Communicates With                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **CLI Shell**                                      | Terminal UI (`@effect/cli` policy), streaming progress, plan-before-execute mode, session start/resume                                                  | AgentLoop                                                             |
| **AgentLoop** (`apps/kargadan/harness`)            | PLAN→EXECUTE→VERIFY→PERSIST→DECIDE state machine; retry/correction/compensation; heartbeat fiber; event ingestion fiber                                | packages/ai `AiService.runAgentCore`, CommandDispatch, PostgreSQL session store |
| **AiService** (`packages/ai`)                      | Generic agent orchestration: tool-calling loop, conversation management with `Chat` module, provider/model resolution, context compaction gating        | AiRuntime, toolkit builders, Tokenizer                                |
| **AiRuntime** (`packages/ai`)                      | Existing service: multi-provider LLM inference, embedding, budget/rate enforcement, OTEL telemetry                                                     | AiRegistry, AiRuntimeProvider, packages/database                      |
| **AiToolkit** (`packages/ai`)                      | Tool.make schema-driven definitions; read/write bifurcation; current runtime uses high-order `catalog.search` + `command.execute` + `context.read`      | AiRuntime (LanguageModel), pgvector knowledge base                    |
| **CommandDispatch** (`apps/kargadan/harness`)      | Typed WebSocket protocol: handshake, execute, heartbeat, event streaming; correlates Deferred by requestId                                             | KargadanSocketClient, ReconnectionSupervisor                          |
| **KargadanSocketClient** (`apps/kargadan/harness`) | Effect Platform WebSocket with pending-map Deferred correlation, inbound event Queue                                                                   | WebSocket bridge                                                      |
| **ReconnectionSupervisor** (`apps/kargadan/harness`) | Reconnect/session timeout supervision + pending request coordination across socket resets                                                              | KargadanSocketClient, harness runtime                                 |
| **PostgreSQL Session Store**                       | Durable checkpoints (`chatJson`), tool-call/session journal, deterministic latest-sequence hydrate; replaces legacy in-memory traces                   | packages/database repo factory                                        |
| **pgvector Knowledge Base**                        | Rhino command catalog with embeddings for RAG-backed discovery; seeded at handshake and queried during PLAN for command selection                       | packages/database, AiRuntime (embed)                                  |
| **WebSocket Bridge**                               | localhost ephemeral port via port-file discovery (`~/.kargadan/port`); request/response correlation by identity.requestId; push event channel        | KargadanSocketClient ↔ Plugin WebSocket Server                        |
| **Plugin WebSocket Server** (C#)                   | Accepts connections; dispatches to SessionHost/CommandRouter; marshals via background thread; pushes EventPublisher drain                              | Plugin boundary layer                                                 |
| **CommandRouter** (C#)                             | Decodes JsonElement → `Fin<CommandEnvelope>`; validates all fields via Fin combinators                                                                 | KargadanPlugin.HandleCommand                                          |
| **SessionHost** (C#)                               | Lock-gated session state machine (Connected→Active→Terminal); heartbeat timeout enforcement                                                            | KargadanPlugin                                                        |
| **RhinoDoc Command Executor** (C#)                 | RhinoApp.RunScript for dynamic commands + direct RhinoCommon calls; mandatory InvokeOnUiThread marshaling on macOS; undo record wrapping               | RhinoApp, RhinoDoc                                                    |
| **EventPublisher** (C#)                            | Atomic Atom<Seq<PublishedEvent>> drain; subscriptions to RhinoDoc events with 200ms debounce                                                           | KargadanPlugin, WebSocket Server push                                 |
| **Undo Record Manager** (C#)                       | BeginUndoRecord/EndUndoRecord per logical AI action; AddCustomUndoEvent for agent state snapshots                                                      | RhinoDoc                                                              |

---

## Data Flow

### Primary: User Intent → CAD Execution

> Note: This section describes target-state runtime flow. Phase 5 now uses NL planning over handshake-catalog + pgvector search; remaining closeout is manual Rhino smoke sign-off.

```
[User types intent in CLI]
    ↓
[CLI Shell] — streams to → [AiService.runAgentCore() rails]
    ↓
[Chat.append(user message)] — appended to Ref history
    ↓
[Tokenizer.check()] — verify context budget (75% trigger → compaction)
    ↓  (if compaction needed)
[Context Compaction] — rolling summarize older turns, mask tool results
    ↓
[LanguageModel.generateText(tools, history)] — Architect model plans
    ↓ (response contains tool-call blocks)
[AiToolkit dispatch] — for each tool-call:
    ↓
    ├─ Read tools  → execute stateless (no undo scope)
    │   [read.scene.summary / read.object.metadata / read.layer.table]
    │       ↓ via WebSocket
    │   [Plugin CommandRouter] → [RhinoCommon read API] → JSON result
    │       ↓
    │   [tool-result] fed back into Chat history
    │
    └─ Write tools → validated + undo-scoped
        [Tool Search Tool] → searches pgvector catalog → discovers command
            ↓ defer_loading: true resolved
        [write.object.create / write.layer.update / etc.]
            ↓ CommandEnvelope with undoScope + idempotencyKey
        [WebSocket: CommandDispatch.execute()]
            ↓
        [Plugin: SessionHost.Beat() → CommandRouter.Decode() → RhinoDoc executor]
            ↓
        [RhinoApp.InvokeOnUiThread] → BeginUndoRecord → RhinoCommon op → EndUndoRecord
            ↓
        [ResultEnvelope] → back over WebSocket
            ↓
        [AgentLoop.VERIFY] → verifyResult() → Verification.Verified | Failed
            ↓
        [AgentLoop.PERSIST] → appendTransition + snapshot → PostgreSQL
            ↓
        [AgentLoop.DECIDE] → next operation or retry/correction/compensation
    ↓
[LanguageModel.generateText(updated history)] — Editor model executes precise params
    ↓
[Final response streamed to CLI]
```

### Secondary: RhinoDoc Event Push

```
[RhinoDoc.AddRhinoObject / DeleteRhinoObject / ModifyObjectAttrs / UndoRedo]
    ↓ (debounced 200ms)
[EventPublisher.Publish(EventEnvelope)]
    ↓
[Plugin WebSocket Server pushes event JSON]
    ↓
[KargadanSocketClient._dispatchChunk] → event _tag → Queue.offer(events)
    ↓
[AgentLoop inboundEventLoop fiber] → Queue.take → log / update Layer 0 summary
```

### Session Persistence Flow

```
[AgentLoop starts] → PostgreSQL: load last RunSnapshot for runId
    ↓ (on session resume)
[Replay RunEvents in sequence order] → reconstruct LoopState
    ↓
[Each transition]
AgentPersistenceService.persistCall → PostgreSQL checkpoint/tool-call/session journal write
    ↓
AgentPersistenceService.getLatestCheckpoint → deterministic highest-sequence hydrate
    ↓
[Session end / crash] → next start resumes from last RunSnapshot
```

### RAG Tool Discovery Flow

```
[AiService/SearchService] — on tool call with "rhino.command.*" prefix
    ↓
[Tool Search Tool (BM25)] — natural language query to pgvector catalog
    ↓ returns tool_reference blocks (3-5 best matches)
[API expands tool_reference → full tool definitions]
    ↓
[LanguageModel receives expanded tool, selects parameters]
    ↓
[CommandEnvelope.commandId + args = discovered command invocation]
    ↓ over WebSocket
[Plugin: CommandExecutor route (direct API or RhinoApp.RunScript)]
```

---

## Recommended Project Structure

```
apps/kargadan/
├── harness/src/
│   ├── cli/
│   │   └── shell.ts             # @effect/cli-driven terminal surface, streaming display
│   ├── runtime/
│   │   └── agent-loop.ts        # EXISTING: PLAN/EXECUTE/VERIFY/PERSIST/DECIDE — wired to generic ai.runAgentCore
│   ├── protocol/
│   │   ├── dispatch.ts          # EXISTING: CommandDispatch service
│   │   └── schemas.ts           # EXISTING: protocol boundary schemas (handshake/catalog/command envelopes)
│   ├── socket.ts                # EXISTING: KargadanSocketClient with ack/result sequencing guard
│   ├── config.ts                # EXISTING: HarnessConfig — add LLM model config
│   └── harness.ts               # EXISTING: entry point
│
	└── plugin/src/
	    ├── boundary/
	    │   ├── KargadanPlugin.cs    # EXISTING: entry point with host + handshake/catalog wiring
	    │   └── EventPublisher.cs   # EXISTING: atomic drain
	    ├── contracts/
	    │   ├── ProtocolEnvelopes.cs # EXISTING: typed envelopes
	    │   ├── ProtocolValueObjects.cs # EXISTING: 14 VOs
	    │   └── ProtocolEnums.cs    # EXISTING: 9 smart enums
	    ├── execution/
	    │   └── CommandExecutor.cs   # EXISTING: route metadata + command catalog projection + dispatch
	    ├── observation/
	    │   └── ObservationPipeline.cs # EXISTING: RhinoDoc event subscriptions + 200ms debounce
	    ├── transport/
	    │   ├── SessionHost.cs       # EXISTING: session state machine + capability negotiation
	    │   ├── WebSocketHost.cs     # EXISTING: TcpListener + WebSocket upgrade + background host
	    │   └── WebSocketPortFile.cs # EXISTING: port discovery contract
	    └── protocol/
	        └── Router.cs            # EXISTING: CommandRouter.Decode (`commandId` + legacy compatibility)

packages/ai/src/
├── runtime.ts                   # EXISTING: AiRuntime (generateText, embed, chat, serialize/deserialize)
├── registry.ts                  # EXISTING: AiRegistry (provider layers + session override decode/apply)
├── runtime-provider.ts          # EXISTING: AiRuntimeProvider (tenant settings + override resolution)
├── service.ts                   # EXISTING: AiService (search, seed, generic agent-core rails/toolkit)
└── mcp.ts                       # EXISTING: McpServer interop
```

---

## Architectural Patterns

### Pattern 1: Two-Layer Loop (AgentLoop delegates to AiService rails)

**What:** `AgentLoop` (harness) handles the execution protocol state machine (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE). `AiService.runAgentCore` (packages/ai) handles reusable stage orchestration. They compose: AgentLoop provides stage handlers (`plan/execute/verify/persist/decide`) and the generic runner drives iteration.

**When to use:** Always. Separation keeps the generic AI agent loop in packages/ai (reusable) and the Kargadan-specific execution protocol in apps/kargadan (bounded).

**Trade-offs:** One extra indirection per agent iteration. Benefit: packages/ai is reusable for any future app needing AI orchestration.

**Example:**
```typescript
// packages/ai/src/service.ts
const runAgentCore = Effect.fn('AiService.runAgentCore')(<State, Plan, Execution, Verification>(input: {
    readonly plan: (state: State) => Effect.Effect<Plan>;
    readonly execute: (state: State, plan: Plan) => Effect.Effect<Execution>;
    readonly verify: (state: State, plan: Plan, execution: Execution) => Effect.Effect<Verification>;
    readonly persist: (state: State, plan: Plan, execution: Execution, verification: Verification) => Effect.Effect<void>;
    readonly decide: (state: State, plan: Plan, execution: Execution, verification: Verification) => Effect.Effect<State>;
    readonly isTerminal: (state: State) => boolean;
    readonly initialState: State;
}) =>
    Effect.iterate(input.initialState, {
        body: (state) => Effect.gen(function* () {
            const planResult = yield* input.plan(state);
            const executionResult = yield* input.execute(state, planResult);
            const verificationResult = yield* input.verify(state, planResult, executionResult);
            yield* input.persist(state, planResult, executionResult, verificationResult);
            return yield* input.decide(state, planResult, executionResult, verificationResult);
        }),
        while: (state) => !input.isTerminal(state),
    }));
```

### Pattern 2: Bifurcated Tool Surface (Read vs Write)

**What:** Read tools are stateless, high-frequency, no undo scope, no idempotency key. Write tools are validated, undo-wrapped, idempotency-keyed, and execute via the full PLAN→PERSIST loop. The distinction is encoded in `CommandOperation` category/operation prefixes (`read.*` vs `write.*`) and direct-vs-script dispatch metadata.

**When to use:** Every tool definition. The bifurcation is the primary reliability mechanism.

**Trade-offs:** More schema definitions up front. Benefit: read tools can be retried freely; write tools carry full transactional semantics (undo, dedup, OCC).

**Example:**
```typescript
// packages/ai/src/service.ts
const toolkit = Toolkit.make(
    Tool.make('catalog.search', { parameters: { term: S.NonEmptyTrimmedString }, success: S.Unknown }),
    Tool.make('command.execute', { parameters: { commandId: S.NonEmptyTrimmedString, args: S.Unknown }, success: S.Unknown }),
    Tool.make('context.read', { parameters: { query: S.NonEmptyTrimmedString }, success: S.Unknown }),
);
```

### Pattern 3: Tool Search Tool for Rhino Command Catalog

**What:** The full Rhino command catalog (hundreds of commands) is seeded into pgvector with descriptions, parameters, and examples. At runtime, `tool_search_tool_bm25_20251119` is included as a non-deferred tool; all catalog entries carry `defer_loading: true`. Claude searches for relevant commands on demand — 85% token reduction vs loading the full catalog.

**When to use:** Any time the command set exceeds ~30 items. For Rhino this is always. Requires `advanced-tool-use-2025-11-20` beta header via `@effect/ai-anthropic`.

**Trade-offs:** Requires the beta header; Tool Search is not ZDR-eligible on server side. Custom client-side implementation (return `tool_reference` blocks from pgvector search) is ZDR-eligible and uses the existing `AiRuntime.embed()` + `packages/database` search infrastructure.

**Recommended approach:** Custom client-side tool search using `AiRuntime.embed(query)` → pgvector similarity → return `tool_reference` blocks. This avoids beta dependency and reuses existing infrastructure.

### Pattern 4: Tokenizer-Gated Context Compaction

**What:** Before each LLM call, `Tokenizer.estimate(history)` checks the token count. At 75% of the model's context limit, compaction triggers: (1) mask tool results for turns older than N using observation masking (NeurIPS DL4C 2025 finding — equal or better accuracy vs LLM summarization), (2) LLM-summarize conversation turns older than the masking window into a compact narrative, (3) persist Layer 0 scene summary (always present). Target: 40% of budget after compaction.

**When to use:** Every agent session. Without this, complex Rhino work (dozens of operations) exhausts the context window.

**Trade-offs:** Compaction adds one LLM call per trigger (~5-10s). Benefit: sessions can span unlimited operations without degradation.

### Pattern 5: @effect/workflow for Multi-Step Write Operations

**What:** Multi-step write sequences (create building floor plate → extrude walls → add openings → place instances) use `Workflow.make` with `Activity.withCompensation` for each step. If any step fails, compensations execute in reverse order: delete created objects → undo. `DurableDeferred` gates human-approval checkpoints in plan-before-execute mode.

**When to use:** Write sequences with 3+ dependent steps, or any operation requiring human-in-the-loop approval before execution.

**Trade-offs:** `@effect/workflow` remains alpha, but the non-Grasshopper Phase 7 write path now runs on a single workflow rail in `agent-loop.ts`. Live Rhino conformance/compensation evidence remains the closure gate.

**Example:**
```typescript
const buildingFloorPlateWorkflow = Workflow.make(
    'kargadan/buildingFloorPlate',
    Effect.gen(function* () {
        const outline = yield* Activity.make('createOutline', createOutlineCurves).pipe(
            Activity.withCompensation(({ guid }) => deleteObjects([guid]))
        );
        const approval = yield* DurableDeferred.make('approveOutline');  // plan-before-execute gate
        yield* DurableDeferred.await(approval);
        const floor = yield* Activity.make('extrudeFloor', extrudeToSolid(outline)).pipe(
            Activity.withCompensation(({ guid }) => deleteObjects([guid]))
        );
        return floor;
    })
);
```

### Pattern 6: Architect/Editor Model Split

**What:** Strong reasoning model (claude-opus-4-6 / claude-sonnet-4-5) plans the operation sequence and validates design intent. Faster model (claude-haiku-4-x or claude-sonnet-4-5) executes precise parameter generation for each command invocation. Mirrors aider's 85% SWE-bench result from the two-model pattern.

**When to use:** All agent sessions. The split is wired through `AiService`/`AiRuntime` with provider/model selection from `AiRegistry`.

**Trade-offs:** Two model API calls per planning cycle. Benefit: cost reduction on execution calls; stronger reasoning reserved for planning.

---

## Data Flow: State Management

```
[HarnessConfig (Effect Config)] — resolves env → LoopState.identityBase
    ↓
[PostgreSQL RunSnapshot] — replays last checkpoint on resume
    ↓
[Chat Ref] — grows with each turn; Tokenizer gates compaction
    ↓
[LoopState] — mutable only within Effect.iterate; no shared mutable state
    ↓
[AgentPersistenceService → PostgreSQL] — checkpoints/journal persisted after PERSIST
```

---

## Anti-Patterns

### Anti-Pattern 1: Loading Full Rhino Command Catalog into Context

**What people do:** Define all 300+ Rhino commands as Tool schemas in every API call.

**Why it's wrong:** ~300 tools consume 60K-90K tokens per request. Leaves insufficient context for actual work. Tool selection accuracy degrades severely above 30-50 tools.

**Do this instead:** Use custom client-side tool search (pgvector embed + tool_reference blocks) with `defer_loading: true`. Keep 3-5 most frequently used read tools non-deferred.

### Anti-Pattern 2: Calling RhinoCommon from WebSocket Background Thread

**What people do:** Execute RhinoDoc mutations directly in the WebSocket message handler.

**Why it's wrong:** NSView/AppKit throws `NSException` immediately on macOS when any UI-touching operation runs off the main thread. Rhino 9 macOS enforces this strictly.

**Do this instead:** Always use `RhinoApp.InvokeOnUiThread(() => { ... })` for every RhinoCommon call that touches the document or viewport. All plugin command execution must route through this.

### Anti-Pattern 3: Growing Chat History Without Compaction

**What people do:** Append every turn and tool result to Chat history without a token budget check.

**Why it's wrong:** At 200K context with tool results, Rhino sessions with dozens of operations hit the limit within ~20-30 turns. Model performance degrades after 32-64K tokens of context (Databricks finding).

**Do this instead:** Gate every `LanguageModel.generateText` call with `Tokenizer.estimate`. Trigger compaction at 75% via observation masking (remove tool results) + summarization of old turns. Store Layer 0 scene summary as a persistent note that survives compaction.

### Anti-Pattern 4: Reintroducing In-Memory Trace for Production

**What people do:** Keep or reintroduce `Ref`-backed in-memory tracing as the persistence layer.

**Why it's wrong:** Process crash loses all session state. No session resumption across restarts. Architectural regression from the "Persistent agent sessions" requirement.

**Do this instead:** Keep persistence in `AgentPersistenceService` + PostgreSQL-backed checkpoints/journal (`chatJson` + sequence-ordered hydrate). Do not add parallel in-memory persistence implementations.

### Anti-Pattern 5: Conflating Universal and App-Specific Schemas

**What people do:** Put Kargadan-specific protocol types (CommandEnvelope, ResultEnvelope, TelemetryContext) into shared packages.

**Why it's wrong:** Violates monorepo topology: packages own universal mechanisms, apps own domain-specific values. Kargadan protocol types are not universal — they are the wire contract of one app.

**Do this instead:** Kargadan protocol schemas stay in `apps/kargadan`. Universal concepts (failure taxonomy, telemetry, tool definitions) graduate to `packages/ai` when they earn universality by being needed by a second app.

---

## Integration Points

### External Services

| Service         | Integration Pattern                                                | Notes                                                                                             |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Anthropic API   | `@effect/ai-anthropic` `AnthropicLanguageModel.modelWithTokenizer` | Beta header `advanced-tool-use-2025-11-20` for Tool Search; Opus for Architect, Sonnet for Editor |
| OpenAI API      | `@effect/ai-openai` `OpenAiEmbeddingModel`                         | text-embedding-3-small for Rhino command catalog; existing `AiRuntime.embed()`                    |
| PostgreSQL 18.2 | `packages/database` polymorphic repo factory                       | RunEvent, RunSnapshot, ConversationHistory, command knowledge base                                |
| pgvector        | `packages/database` search + `packages/ai` SearchService           | Existing `SearchService.query()` + `refreshEmbeddings()` covers knowledge base queries            |
| Rhino 9 WIP     | C# plugin over localhost WebSocket (ephemeral port via port file)  | net9.0 target required; `[CommandStyle(ScriptRunner)]` on plugin commands                         |

### Internal Boundaries

| Boundary                        | Communication                                  | Notes                                                                                |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| harness ↔ packages/ai           | Effect service composition via `Layer.provide` | AiService/AiRuntime in packages/ai; harness provides dependencies via Layer          |
| harness ↔ plugin                | WebSocket JSON, Deferred-correlated            | Typed protocol; all messages schema-validated at decode boundary                     |
| packages/ai ↔ packages/database | Direct Effect service dependency               | AiRuntime → DatabaseService for budget, SearchService for embeddings                 |
| AgentLoop ↔ AiService           | Effect.gen call passing `LoopState`            | AiService rails are loop-agnostic; LoopState carries Kargadan protocol context       |
| Plugin ↔ RhinoCommon            | Direct C# API calls inside InvokeOnUiThread    | No async allowed inside InvokeOnUiThread; use synchronous RhinoCommon APIs only      |

---

## Build Order (Dependency Implications)

Canonical build order is maintained in `.planning/ROADMAP.md`. Current phase state:

```
Phase 1-4: Complete
    Transport + execution + schema topology + persistence foundations are implemented.

Phase 5: Code complete (manual Rhino smoke sign-off pending closeout)
    Handshake catalog transfer, harness ingestion/seeding, generic agent-core rails,
    chat checkpoint roundtrip, and provider override/fallback runtime paths are wired.

Phase 6: Code complete (manual Rhino smoke sign-off pending closeout)
    Protocol telemetry parity, Layer-0 scene context, progressive detail controls,
    tokenizer-gated compaction, architect override split, and provider-gated discovery seam are wired.

Phase 7: Non-GH implementation integrated; live validation pending
    Deterministic-first verification, optional `view.capture`, and single-paradigm `@effect/workflow`
    write durability are wired. Grasshopper (`EXEC-06`) remains deferred in this execution line.

Phase 8: Pending
    CLI surface via @effect/cli policy remains queued behind validated Phase 5/6/7 baseline.
```

**Critical dependencies:**
- Phases 1→4 are sequential and complete foundations (transport, execution, schema topology, persistence).
- Phase 5 depends on Phase 4 and Phase 5 closeout (manual Rhino smoke sign-off) remains the integration gate.
- Phase 6 code is implemented but shares the same closeout validation gate as Phase 5.
- Phases 7 and 8 depend on validated Phase 5/6 baseline and are otherwise independent.

---

## Sources

- Effect AI introduction and Chat/Tool architecture: [DeepWiki Effect-TS/effect AI](https://deepwiki.com/Effect-TS/effect/10-ai-and-external-services), [effect.website/blog/effect-ai](https://effect.website/blog/effect-ai/)
- Anthropic Tool Search Tool (defer_loading, BM25, regex): [platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- Anthropic advanced tool use announcement: [anthropic.com/engineering/advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use)
- Context compaction strategy: [code.claude.com/docs/en/how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)
- Rhino two-process architecture validation: `apps/kargadan/Rhino-Research1.md`, `apps/kargadan/Rhino-Research2.md` (existing validated research in codebase)
- Existing harness codebase: `apps/kargadan/harness/src/` (agent-loop.ts, socket.ts, protocol/dispatch.ts, protocol/schemas.ts, harness.ts)
- Existing plugin codebase: `apps/kargadan/plugin/src/` (KargadanPlugin.cs, SessionHost.cs, Router.cs, EventPublisher.cs)
- Existing packages/ai: `packages/ai/src/` (service.ts, runtime.ts, registry.ts, runtime-provider.ts, mcp.ts)
- @effect/workflow alpha status: [effect.website/blog/this-week-in-effect/2026/01/02](https://effect.website/blog/this-week-in-effect/2026/01/02/)
- Observation masking vs LLM summarization: NeurIPS DL4Code 2025 finding (cited in Rhino-Research2.md)
- Architect/Editor model split (85% SWE-bench): aider pattern, cited in Rhino-Research2.md

---

*Architecture research for: CLI-based AI agent controlling Rhino 9 on macOS*
*Researched: 2026-02-22*
