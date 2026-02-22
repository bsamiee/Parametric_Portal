# Architecture Research

**Domain:** CLI-based AI agent controlling Rhino 9 on macOS — two-process Effect/TypeScript + C# architecture
**Researched:** 2026-02-22
**Confidence:** HIGH (grounded in existing codebase, official Effect docs, Anthropic Tool Search docs, validated prior Rhino research)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLI LAYER (apps/kargadan/harness — TypeScript, Node.js process)     │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  CLI Shell  │  │  AgentLoop   │  │  packages/ai AiAgentService │  │
│  │ (Ink/stdio) │  │ PLAN→EXECUTE │  │  LanguageModel + Toolkit    │  │
│  │  streaming  │  │ →VERIFY→     │  │  Chat (Ref history)         │  │
│  │  progress   │  │ PERSIST→     │  │  Tokenizer (context budget) │  │
│  └──────┬──────┘  │ DECIDE       │  │  Tool Search Tool proxy     │  │
│         │         └──────┬───────┘  └─────────────────────────────┘  │
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
│  │ SessionSupervisor│  │  PostgreSQL Session Store               │   │
│  │ Ref state machine│  │  RunEvent / RunSnapshot / RetrievalArti │   │
│  │ idle→connected→  │  │  fact (replaces PersistenceTrace)       │   │
│  │ authed→active→   │  └─────────────────────────────────────────┘   │
│  │ terminal         │                                                │
│  └──────────────────┘                                                │
├──────────────────────────────────────────────────────────────────────┤
│             WebSocket Bridge  (ws://127.0.0.1:9181)                  │
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

## Component Boundaries

| Component                                          | Responsibility                                                                                                                                         | Communicates With                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **CLI Shell**                                      | Terminal UI (Ink or raw stdio), streaming progress, plan-before-execute mode, session start/resume                                                     | AgentLoop                                                             |
| **AgentLoop** (`apps/kargadan/harness`)            | PLAN→EXECUTE→VERIFY→PERSIST→DECIDE state machine; retry/correction/compensation; heartbeat fiber; event ingestion fiber                                | packages/ai AiAgentService, CommandDispatch, PostgreSQL session store |
| **AiAgentService** (`packages/ai`)                 | Generic agent orchestration: tool-calling loop, conversation management with `Chat` module, Architect/Editor model dispatch, context compaction gating | AiRuntime, AiToolkit, Tokenizer                                       |
| **AiRuntime** (`packages/ai`)                      | Existing service: multi-provider LLM inference, embedding, budget/rate enforcement, OTEL telemetry                                                     | AiRegistry, AiRuntimeProvider, packages/database                      |
| **AiToolkit** (`packages/ai`)                      | Tool.make schema-driven definitions; read/write bifurcation; Tool Search Tool integration; `defer_loading: true` for the full Rhino catalog            | AiRuntime (LanguageModel), pgvector knowledge base                    |
| **CommandDispatch** (`apps/kargadan/harness`)      | Typed WebSocket protocol: handshake, execute, heartbeat, event streaming; correlates Deferred by requestId                                             | KargadanSocketClient, SessionSupervisor                               |
| **KargadanSocketClient** (`apps/kargadan/harness`) | Effect Platform WebSocket with pending-map Deferred correlation, inbound event Queue                                                                   | WebSocket bridge                                                      |
| **SessionSupervisor** (`apps/kargadan/harness`)    | Ref-backed session lifecycle state machine (idle→connected→authenticated→active→terminal)                                                              | CommandDispatch                                                       |
| **PostgreSQL Session Store**                       | Durable RunEvent log, RunSnapshot checkpoints, ConversationHistory, tool call audit; replaces in-memory PersistenceTrace                               | packages/database repo factory                                        |
| **pgvector Knowledge Base**                        | Rhino command catalog with embeddings for RAG-backed discovery; queried by AiToolkit for Tool Search                                                   | packages/database, AiRuntime (embed)                                  |
| **WebSocket Bridge**                               | localhost:9181 full-duplex JSON; request/response correlation by identity.requestId; push event channel                                                | KargadanSocketClient ↔ Plugin WebSocket Server                        |
| **Plugin WebSocket Server** (C#)                   | Accepts connections; dispatches to SessionHost/CommandRouter; marshals via background thread; pushes EventPublisher drain                              | Plugin boundary layer                                                 |
| **CommandRouter** (C#)                             | Decodes JsonElement → `Fin<CommandEnvelope>`; validates all fields via Fin combinators                                                                 | KargadanPlugin.HandleCommand                                          |
| **SessionHost** (C#)                               | Lock-gated session state machine (Connected→Active→Terminal); heartbeat timeout enforcement                                                            | KargadanPlugin                                                        |
| **RhinoDoc Command Executor** (C#)                 | RhinoApp.RunScript for dynamic commands + direct RhinoCommon calls; mandatory InvokeOnUiThread marshaling on macOS; undo record wrapping               | RhinoApp, RhinoDoc                                                    |
| **EventPublisher** (C#)                            | Atomic Atom<Seq<PublishedEvent>> drain; subscriptions to RhinoDoc events with 200ms debounce                                                           | KargadanPlugin, WebSocket Server push                                 |
| **Undo Record Manager** (C#)                       | BeginUndoRecord/EndUndoRecord per logical AI action; AddCustomUndoEvent for agent state snapshots                                                      | RhinoDoc                                                              |

---

## Data Flow

### Primary: User Intent → CAD Execution

```
[User types intent in CLI]
    ↓
[CLI Shell] — streams to → [AiAgentService.run()]
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
PersistenceTrace.appendTransition → PostgreSQL INSERT RunEvent
    ↓
PersistenceTrace.snapshot → PostgreSQL UPSERT RunSnapshot (SHA-256 hash)
    ↓
[Session end / crash] → next start resumes from last RunSnapshot
```

### RAG Tool Discovery Flow

```
[AiAgentService] — on tool call with "rhino.command.*" prefix
    ↓
[Tool Search Tool (BM25)] — natural language query to pgvector catalog
    ↓ returns tool_reference blocks (3-5 best matches)
[API expands tool_reference → full tool definitions]
    ↓
[LanguageModel receives expanded tool, selects parameters]
    ↓
[CommandEnvelope.operation = discovered command string]
    ↓ over WebSocket
[Plugin: RhinoApp.RunScript(command, true)]
```

---

## Recommended Project Structure

```
apps/kargadan/
├── harness/src/
│   ├── cli/
│   │   └── shell.ts             # Ink or readline-based terminal UI, streaming display
│   ├── runtime/
│   │   ├── agent-loop.ts        # EXISTING: PLAN/EXECUTE/VERIFY/PERSIST/DECIDE — wire to AiAgentService
│   │   ├── loop-stages.ts       # EXISTING: pure stage functions — extend for LLM planning
│   │   └── persistence-trace.ts # MIGRATE: swap Ref store → PostgreSQL via packages/database
│   ├── protocol/
│   │   ├── dispatch.ts          # EXISTING: CommandDispatch service
│   │   └── supervisor.ts        # EXISTING: SessionSupervisor state machine
│   ├── socket.ts                # EXISTING: KargadanSocketClient
│   ├── config.ts                # EXISTING: HarnessConfig — add LLM model config
│   └── harness.ts               # EXISTING: entry point
│
└── plugin/src/
    ├── boundary/
    │   ├── KargadanPlugin.cs    # EXISTING: entry point — ADD WebSocket server start
    │   └── EventPublisher.cs   # EXISTING: atomic drain
    ├── contracts/
    │   ├── ProtocolEnvelopes.cs # EXISTING: typed envelopes
    │   ├── ProtocolValueObjects.cs # EXISTING: 14 VOs
    │   └── ProtocolEnums.cs    # EXISTING: 9 smart enums
    ├── transport/
    │   ├── SessionHost.cs       # EXISTING: session state machine
    │   ├── WebSocketServer.cs   # TO BUILD: TcpListener + WebSocket upgrade + background thread
    │   └── Handshake.cs         # EXISTING: version negotiation
    └── protocol/
        ├── Router.cs            # EXISTING: CommandRouter.Decode
        ├── RhinoExecutor.cs     # TO BUILD: InvokeOnUiThread + RunScript + RhinoCommon ops
        ├── EventMonitor.cs      # TO BUILD: RhinoDoc event subscriptions + 200ms debounce
        └── FailureMapping.cs    # EXISTING

packages/ai/src/
├── runtime.ts                   # EXISTING: AiRuntime (generateText, embed, chat)
├── registry.ts                  # EXISTING: AiRegistry (provider layers)
├── runtime-provider.ts          # EXISTING: AiRuntimeProvider
├── search.ts                    # EXISTING: SearchService + EmbeddingCron
├── errors.ts                    # EXISTING: AiError
├── mcp.ts                       # EXISTING: McpServer interop
├── agent.ts                     # TO BUILD: AiAgentService (tool-calling loop, Architect/Editor split)
├── toolkit.ts                   # TO BUILD: AiToolkit (read + write bifurcation, Tool Search proxy)
├── compaction.ts                # TO BUILD: TokenizerGatedCompaction (75% trigger, 40% target)
└── knowledge-base.ts            # TO BUILD: Rhino command catalog seed + pgvector queries
```

---

## Architectural Patterns

### Pattern 1: Two-Layer Loop (AgentLoop delegates to AiAgentService)

**What:** `AgentLoop` (harness) handles the execution protocol state machine (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE). `AiAgentService` (packages/ai) handles the LLM conversation cycle (model inference, tool dispatch, history management). They compose: AgentLoop calls `AiAgentService.run(userIntent, tools)` to get the next CommandEnvelope; AiAgentService's result feeds EXECUTE.

**When to use:** Always. Separation keeps the generic AI agent loop in packages/ai (reusable) and the Kargadan-specific execution protocol in apps/kargadan (bounded).

**Trade-offs:** One extra indirection per agent iteration. Benefit: packages/ai is reusable for any future app needing AI orchestration.

**Example:**
```typescript
// packages/ai/src/agent.ts
class AiAgentService extends Effect.Service<AiAgentService>()('ai/Agent', {
    scoped: Effect.gen(function* () {
        const [runtime, toolkit] = yield* Effect.all([AiRuntime, AiToolkit]);
        const run = Effect.fn('AiAgentService.run')(
            (input: { intent: string; history: Chat.History }) =>
                Effect.gen(function* () {
                    yield* Tokenizer.check(input.history);  // compaction gate
                    const response = yield* LanguageModel.generateText({
                        prompt: input.intent,
                        tools: toolkit.architect,   // Architect model tools
                    });
                    // dispatch tool calls → resolve via Toolkit.toLayer
                    return response;  // CommandEnvelope or final answer
                })
        );
        return { run } as const;
    }),
}) {}
```

### Pattern 2: Bifurcated Tool Surface (Read vs Write)

**What:** Read tools are stateless, high-frequency, no undo scope, no idempotency key. Write tools are validated, undo-wrapped, idempotency-keyed, and execute via the full PLAN→PERSIST loop. The distinction is encoded in the `CommandOperation` smart enum prefix (`read.*` vs `write.*`) which already gates the undo logic in `loop-stages.ts`.

**When to use:** Every tool definition. The bifurcation is the primary reliability mechanism.

**Trade-offs:** More schema definitions up front. Benefit: read tools can be retried freely; write tools carry full transactional semantics (undo, dedup, OCC).

**Example:**
```typescript
// packages/ai/src/toolkit.ts
const readTools = Toolkit.make(
    Tool.make('rhino/read.scene.summary', { ... }),      // no undoScope
    Tool.make('rhino/read.object.metadata', { ... }),
    Tool.make('rhino/read.layer.table', { ... }),
);
const writeTools = Toolkit.make(
    Tool.make('rhino/write.object.create', { ... }),     // carries undoScope
    Tool.make('rhino/write.layer.update', { ... }),
    // ... all marked defer_loading: true for Tool Search
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

**Trade-offs:** @effect/workflow is alpha. Until stable, the existing PLAN→EXECUTE retry/compensation pattern in `loop-stages.ts` handles simpler cases.

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

**When to use:** All agent sessions. The split is wired into `AiAgentService` via two `AiRegistry` layers with different model configs.

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
[PersistenceTrace → PostgreSQL] — every transition appended; snapshots after PERSIST
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

### Anti-Pattern 4: In-Memory PersistenceTrace for Production

**What people do:** Keep the existing `Ref`-backed `PersistenceTrace` as the persistence layer.

**Why it's wrong:** Process crash loses all session state. No session resumption across restarts. Architectural regression from the "Persistent agent sessions" requirement.

**Do this instead:** Replace `PersistenceTrace` with PostgreSQL-backed run events + snapshots via `packages/database` repo factory. The existing schema (RunEvent, RunSnapshot, RetrievalArtifact) maps directly to database tables. Keep `PersistenceTrace` interface, swap implementation layer.

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
| Rhino 9 WIP     | C# plugin over `ws://localhost:9181`                               | net9.0 target required; `[CommandStyle(ScriptRunner)]` on plugin commands                         |

### Internal Boundaries

| Boundary                        | Communication                                  | Notes                                                                                |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| harness ↔ packages/ai           | Effect service composition via `Layer.provide` | AiAgentService in packages/ai; harness provides dependencies via Layer               |
| harness ↔ plugin                | WebSocket JSON, Deferred-correlated            | Typed protocol; all messages schema-validated at decode boundary                     |
| packages/ai ↔ packages/database | Direct Effect service dependency               | AiRuntime → DatabaseService for budget, SearchService for embeddings                 |
| AgentLoop ↔ AiAgentService      | Effect.gen call passing `LoopState`            | AiAgentService is stateless w.r.t. loop; LoopState carries conversation context refs |
| Plugin ↔ RhinoCommon            | Direct C# API calls inside InvokeOnUiThread    | No async allowed inside InvokeOnUiThread; use synchronous RhinoCommon APIs only      |

---

## Build Order (Dependency Implications)

The following order minimizes blocked work and validates each layer before the next depends on it:

```
Phase 1: Transport (unblocks everything)
    1a. Plugin WebSocket Server (C#) — TcpListener + WebSocket upgrade + background thread
    1b. Plugin .NET target correction (net10.0 → net9.0 multi-target)
    → Validates: WebSocket bridge, handshake, heartbeat, basic command round-trip

Phase 2: Execution (unblocks LLM integration)
    2a. RhinoDoc Command Executor (C#) — RunScript + InvokeOnUiThread + undo records
    2b. RhinoDoc Event Subscriptions + EventMonitor (C#) — 200ms debounce + push
    → Validates: actual Rhino state changes respond to commands; events flow back

Phase 3: Persistence (unblocks session durability)
    3a. PostgreSQL session store schemas (RunEvent, RunSnapshot, ConversationHistory tables)
    3b. PersistenceTrace → PostgreSQL swap in harness
    3c. Session resumption from last snapshot
    → Validates: restart-safe sessions; audit trail

Phase 4: AI Agent Core (unblocks tool calling)
    4a. packages/ai AiToolkit (Tool.make read + write definitions)
    4b. packages/ai AiAgentService skeleton (Chat loop, Architect model, tool dispatch)
    4c. Rhino command knowledge base seeding (pgvector catalog)
    4d. Custom tool search proxy using AiRuntime.embed() + pgvector → tool_reference blocks
    → Validates: LLM can discover and invoke Rhino commands dynamically

Phase 5: Context Management (unblocks long sessions)
    5a. Tokenizer-gated compaction (75% trigger, observation masking + summarization)
    5b. Layer 0 scene summary (always-present compact Rhino state)
    5c. Architect/Editor model split
    → Validates: multi-operation sessions don't degrade

Phase 6: CLI Interface
    6a. Terminal shell with streaming progress (Ink or readline)
    6b. Plan-before-execute mode (DurableDeferred approval gate)
    6c. Tool call visibility in terminal
    → Validates: usable end-to-end developer experience

Phase 7: Durability (workflow transactions)
    7a. @effect/workflow integration for multi-step write sequences
    7b. Activity compensation for partial failure rollback
    → Validates: complex multi-object operations can recover atomically

Phase 8: Refactoring
    8a. Delete and redesign kargadan-schemas.ts (separate universal vs app-specific)
    8b. Refactor apps/kargadan to consume packages/ai for all LLM interaction
    → Completes: monorepo topology compliance
```

**Critical dependencies:**
- Phases 1→2→3 are strictly sequential (transport required before execution, execution before persistence)
- Phase 4 requires Phase 1 (needs a working bridge to validate tool execution)
- Phase 4a/4b/4c can parallelize within the phase
- Phase 5 requires Phase 4 (needs tool calls to measure context consumption)
- Phase 6 can start in parallel with Phases 4-5 (CLI shell is independent of AI internals)
- Phase 7 depends on Phase 4 (workflow wraps tool calls)
- Phase 8 can start any time but should not block earlier phases

---

## Sources

- Effect AI introduction and Chat/Tool architecture: [DeepWiki Effect-TS/effect AI](https://deepwiki.com/Effect-TS/effect/10-ai-and-external-services), [effect.website/blog/effect-ai](https://effect.website/blog/effect-ai/)
- Anthropic Tool Search Tool (defer_loading, BM25, regex): [platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- Anthropic advanced tool use announcement: [anthropic.com/engineering/advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use)
- Context compaction strategy: [code.claude.com/docs/en/how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)
- Rhino two-process architecture validation: `apps/kargadan/Rhino-Research1.md`, `apps/kargadan/Rhino-Research2.md` (existing validated research in codebase)
- Existing harness codebase: `apps/kargadan/harness/src/` (agent-loop.ts, loop-stages.ts, socket.ts, protocol/dispatch.ts, protocol/supervisor.ts)
- Existing plugin codebase: `apps/kargadan/plugin/src/` (KargadanPlugin.cs, SessionHost.cs, CommandRouter.cs, EventPublisher.cs)
- Existing packages/ai: `packages/ai/src/` (runtime.ts, registry.ts, search.ts)
- @effect/workflow alpha status: [effect.website/blog/this-week-in-effect/2026/01/02](https://effect.website/blog/this-week-in-effect/2026/01/02/)
- Observation masking vs LLM summarization: NeurIPS DL4Code 2025 finding (cited in Rhino-Research2.md)
- Architect/Editor model split (85% SWE-bench): aider pattern, cited in Rhino-Research2.md

---

*Architecture research for: CLI-based AI agent controlling Rhino 9 on macOS*
*Researched: 2026-02-22*
