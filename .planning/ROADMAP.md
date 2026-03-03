# Roadmap: Kargadan

## Overview

Kargadan delivers a CLI-based AI agent that controls Rhino 9 through natural language. The build order is strictly dependency-constrained: nothing works until the WebSocket bridge functions (Phase 1); no LLM integration is meaningful until real Rhino execution is wired (Phase 2); schema topology must be clean before new features are built on top (Phase 3); persistence must be durable before sessions can survive restarts (Phase 4); the agent core wires LLM orchestration end-to-end (Phase 5); scene representation and context management prevent degradation in long sessions (Phase 6); verification and durable workflows add reliability guarantees (Phase 7); the CLI interface surfaces everything to the user (Phase 8).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Plugin Transport Foundation** - WebSocket bridge between CLI harness and Rhino plugin on localhost with reconnection and heartbeat (completed 2026-02-22)
- [x] **Phase 2: RhinoDoc Execution and Events** - Command execution, direct API access, event subscriptions, and undo integration inside Rhino (completed 2026-02-23)
- [ ] **Phase 3: Schema Redesign and Topology** - Delete legacy schemas, extract universal concepts to packages/, isolate app-specific protocol in apps/kargadan
- [x] **Phase 4: Session Persistence and Knowledge Base** - PostgreSQL-backed session store replacing in-memory trace, plus Rhino command knowledge base for RAG (completed 2026-02-23)
- [ ] **Phase 5: Agent Core and Provider Abstraction** - Generic agent loop in packages/ai with tool orchestration, RAG discovery, multi-provider support, and fallback chains
- [ ] **Phase 6: Scene Representation and Context Management** - Layered scene summary, context compaction, Architect/Editor model split, and Tool Search Tool integration
- [ ] **Phase 7: Verification, Workflows, and Grasshopper** - Unified verification pipeline, durable multi-step workflows with compensation, and Grasshopper 1 programmatic access
- [ ] **Phase 8: CLI Interface** - Terminal-based interaction with streaming progress, tool call visibility, plan-before-execute mode, and Effect-native CLI

## Phase Details

### Phase 1: Plugin Transport Foundation
**Goal**: The harness and Rhino plugin can exchange typed messages over a reliable localhost connection that survives disconnections
**Depends on**: Nothing (first phase)
**Requirements**: TRAN-01, TRAN-02, TRAN-03, TRAN-04, TRAN-05, TRAN-06
**Success Criteria** (what must be TRUE):
  1. Harness connects to the plugin's WebSocket endpoint on localhost and completes the protocol handshake
  2. Plugin loads in Rhino 9 WIP without TypeLoadException (net9.0 target)
  3. All incoming WebSocket commands are marshaled to the UI thread before touching RhinoDoc — no NSException on macOS
  4. Harness detects plugin disconnection (Rhino quit/crash) and reconnects automatically when the plugin returns
  5. Session context survives plugin disconnection — conversation history and loop state restored from checkpoint on reconnection
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — C# plugin WebSocket server (TcpListener + HTTP upgrade), port file discovery, UI thread marshaling, net9.0 target
- [x] 01-02-PLAN.md — TS harness reconnection supervisor with exponential backoff, port file reader, PostgreSQL checkpoint persistence

### Phase 2: RhinoDoc Execution and Events
**Goal**: The agent can execute arbitrary Rhino commands and direct API calls, receive document change events, and undo any AI action atomically
**Depends on**: Phase 1
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05
**Success Criteria** (what must be TRUE):
  1. Agent sends a command string and it executes inside Rhino via RunScript — geometry appears in the document
  2. Agent can create, modify, and query objects directly through RhinoCommon API (Objects, Layers, etc.)
  3. Document changes (add/delete/modify objects, layer changes, undo/redo) push to the harness as batched events within 200ms
  4. Pressing Cmd+Z after an AI action undoes the entire action atomically — not individual sub-operations
  5. Agent state snapshots are stored in the undo stack so undo/redo keeps the agent's internal model consistent with the document
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Protocol contracts extension + CommandExecutor with bifurcated undo strategy (direct API undo wrapping, RunScript result tracking, RhinoCommon facades)
- [x] 02-02-PLAN.md -- ObservationPipeline (15 events + undo detection + batched flush), WebSocketHost two-phase ack, KargadanPlugin execution/observation wiring, TS schema sync

Completion status (2026-02-23):
- Direct API write routing for object create/update/delete is implemented through `CommandExecutor`.
- Event batches and undo envelopes are published by the plugin boundary and delivered by WebSocket as `_tag: "event"` frames.
- Harness ingestion persists inbound transport events and decodes `stream.compacted` batch deltas.

### Phase 3: Schema Redesign and Topology
**Goal**: Monorepo topology is clean — universal concepts live in packages/, app-specific protocol lives in apps/kargadan, and public API surface is minimal
**Depends on**: Phase 1
**Requirements**: SCHM-01, SCHM-02, SCHM-03, SCHM-04, SCHM-05, SCHM-06
**Success Criteria** (what must be TRUE):
  1. The legacy kargadan-schemas.ts file is deleted and does not exist anywhere in the codebase
  2. Universal concepts (protocol version, telemetry context, failure taxonomy, idempotency) are importable from packages/ by any app
  3. apps/kargadan imports packages/ai for all LLM interaction — no app-specific AI orchestration logic duplicated in the app
  4. Each entity has one canonical schema with derived variants via pick/omit/partial — no proliferated struct/type definitions
  5. Field names and parameter signatures are consistent across the TS harness and C# plugin boundary — mapping isolated at boundary adapters only
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- Delete legacy kargadan-schemas.ts and infrastructure wiring, define 2 root schema groups (protocol in dispatch.ts, persistence in checkpoint.ts)
- [x] 03-02-PLAN.md -- Rewire all 5 consumer files to use colocated schemas, typecheck gate, LOC reduction verification

### Phase 4: Session Persistence and Knowledge Base
**Goal**: Agent sessions are durable across harness restarts, and the Rhino command catalog is searchable via semantic similarity
**Depends on**: Phase 2, Phase 3
**Requirements**: PERS-01, PERS-02, PERS-03, PERS-04, PERS-05
**Success Criteria** (what must be TRUE):
  1. Conversation history, run events, snapshots, and tool call results are stored in PostgreSQL — the in-memory PersistenceTrace is no longer used
  2. After a harness restart, the agent resumes from the last checkpoint with full Chat history and loop state intact
  3. Every tool call is logged with parameters, result, duration, and failure status — queryable after the fact
  4. Past agent sessions can be listed and their full execution trace replayed from the audit trail
  5. The Rhino command knowledge base infrastructure is ready — CommandManifest decode schema and KBSeeder write pipeline (search_documents + search_embeddings) accept real command catalog data from the bridge and seed pgvector for RAG queries
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Model.Class definitions, PostgreSQL migration, PersistenceService with atomic checkpoint+tool-call writes, session listing/replay, migrator layer, harness rewire
- [x] 04-02-PLAN.md -- CommandManifest decode boundary schema, KBSeeder write pipeline (search_documents + search_embeddings via injected embed function)

### Phase 5: Agent Core and Provider Abstraction
**Goal**: The agent accepts natural language input, discovers relevant Rhino commands via RAG over a real command catalog extracted from the bridge, generates and executes tool calls, and works across multiple AI providers
**Depends on**: Phase 4
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-09, AGNT-10, PROV-01, PROV-02, PROV-03, PROV-04

**Architecture context — what Phase 4 built and what Phase 5 must wire:**
- Phase 4 delivered `CommandManifest` (decode schema) and `KBSeeder` (write pipeline into search_documents + search_embeddings). These are infrastructure — pipes without a data source.
- Phase 5 must provide the data source: the C# bridge plugin exports the real Rhino command catalog as JSON on connection. The harness decodes it via `CommandManifest.decode()`, seeds via `KBSeeder.seed(manifest, embed)`, and the agent queries the populated pgvector tables for RAG discovery.
- Phase 5 must also wire the embed function: `AiRuntime.embed` (or provider-specific implementation) is the concrete `EmbedFn` passed to `KBSeeder.seed()`.
- Phase 5 must wire `Chat.exportJson`/`Chat.fromJson` into `PersistenceService` — the `chatJson` field is currently an empty string placeholder.

**Success Criteria** (what must be TRUE):
  1. The C# bridge plugin exports its command catalog as structured JSON on connection — the harness decodes it, seeds the knowledge base via `KBSeeder`, and pgvector embeddings are generated via a real embedding provider
  2. A user types a natural language instruction (e.g., "create a 10x10 box") and geometry appears in Rhino — end-to-end through LLM inference, RAG command discovery, and tool execution via the bridge
  3. The agent discovers relevant commands from the knowledge base via pgvector cosine similarity without hardcoded command enums — commands it has never seen in conversation are findable
  4. Tools are schema-driven via `Tool.make` with typed success/failure; read tools are stateless (no undo overhead); write tools are undo-wrapped and validated
  5. The agent loop follows PLAN/EXECUTE/VERIFY/PERSIST/DECIDE transitions with retry on transient failure and correction on verification failure
  6. Chat history is serialized to PostgreSQL via `Chat.exportJson`/`Chat.fromJson` — the Phase 4 `chatJson` placeholder is replaced with real data
  7. The user can select AI provider and model at session start; if the primary provider fails, the agent retries on configured fallback providers
**Plans**: TBD

Plans:
- [ ] 05-01-PLAN.md — Universal tool factory + RAG toolkit builder + agent loop state machine in packages/ai, C# catalog export, Kargadan boundary adapter, AiRuntime.chatFromJson, protocol catalog envelope
- [ ] 05-02-PLAN.md — Kargadan agent loop config (createAgentLoop wiring), Chat persistence (exportJson/fromJson replacing placeholder), bridge catalog reception, dispatch extension, harness rewire
- [ ] 05-03-PLAN.md — System prompt, tool handler layer (read/write bifurcation via bridge dispatch), WebSocketHost catalog send, packages/ai barrel export, end-to-end pipeline closure

### Phase 6: Scene Representation and Context Management
**Goal**: The agent maintains awareness of the Rhino document state, manages context window budget to sustain unlimited session length, and uses model-appropriate inference tiers
**Depends on**: Phase 5
**Requirements**: SCEN-01, SCEN-02, SCEN-03, SCEN-04, AGNT-06, AGNT-07
**Success Criteria** (what must be TRUE):
  1. A compact scene summary (~500 tokens) showing object counts, active layer, units, and bounding volume is always present in the agent's context
  2. The agent can request progressive detail (per-object metadata, full attributes, geometry data) on demand without flooding context with unneeded information
  3. Context compaction fires at 75% of the context window and reduces to 40% target — sessions of 50+ turns do not degrade in quality
  4. A strong reasoning model handles planning while a faster model handles execution — reducing cost and latency for routine tool calls
  5. Tool Search Tool discovers relevant tools from large catalogs on demand without loading the full catalog into context upfront
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: Verification, Workflows, and Grasshopper
**Goal**: The agent verifies its own work through deterministic and visual checks, executes multi-step operations with rollback on failure, and accesses Grasshopper 1 definitions
**Depends on**: Phase 5
**Requirements**: VRFY-01, VRFY-02, VRFY-03, VRFY-04, AGNT-08, EXEC-06
**Success Criteria** (what must be TRUE):
  1. After executing an operation, the agent runs deterministic checks (geometry validity, bounding box, object existence) and reports pass/fail through a unified verification interface
  2. The agent captures a viewport image via ViewCapture.CaptureToBitmap with Metal-aware frame timing and a vision model evaluates whether the result matches the stated intent
  3. Verification results (deterministic + visual) feed into the DECIDE stage — informing whether to retry, correct, or mark complete
  4. Multi-step write sequences use durable workflows with compensation — partial failure rolls back completed steps via the undo stack
  5. The agent can load a Grasshopper 1 definition, set input parameters, solve, and extract outputs programmatically via the GH1 C# SDK
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: CLI Interface
**Goal**: The user interacts with the agent through a polished terminal interface that provides real-time feedback, approval gates, and clear error communication
**Depends on**: Phase 5
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06
**Success Criteria** (what must be TRUE):
  1. The terminal streams real-time progress showing which loop stage is active and which tools are firing — no silent waiting
  2. Each tool call displays its name, condensed arguments, and result summary as it executes
  3. In plan-before-execute mode, the agent shows proposed write actions and waits for user approval before executing
  4. Error messages include failure class (retryable/correctable/compensatable/fatal) and actionable recovery suggestions — not raw stack traces
  5. The CLI is built on @effect/cli with Effect-native argument parsing, command routing, and help generation
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

Note: Phases 6, 7, and 8 all depend on Phase 5 but not on each other. They can be executed in any order after Phase 5 completes.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Plugin Transport Foundation | 2/2 | Complete   | 2026-02-22 |
| 2. RhinoDoc Execution and Events | 2/2 | Complete | 2026-02-23 |
| 3. Schema Redesign and Topology | 2/2 | Complete | 2026-02-23 |
| 4. Session Persistence and Knowledge Base | 2/2 | Complete    | 2026-02-23 |
| 5. Agent Core and Provider Abstraction | 0/3 | Not started | - |
| 6. Scene Representation and Context Management | 0/2 | Not started | - |
| 7. Verification, Workflows, and Grasshopper | 0/3 | Not started | - |
| 8. CLI Interface | 0/2 | Not started | - |
