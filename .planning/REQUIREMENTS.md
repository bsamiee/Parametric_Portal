# Requirements: Kargadan

**Defined:** 2026-02-22
**Core Value:** The agent can execute any operation a human can perform in Rhino 9 through natural language, with reliable state persistence and verification — without hardcoding individual commands.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Transport

- [ ] **TRAN-01**: Plugin opens a WebSocket/TCP listener on localhost inside Rhino on a configurable port, accepting connections from the CLI harness
- [ ] **TRAN-02**: Plugin targets net9.0 for Rhino 9 WIP and net8.0 for Rhino 8 via multi-target build (`<TargetFrameworks>net8.0;net9.0</TargetFrameworks>`)
- [ ] **TRAN-03**: Plugin marshals all incoming WebSocket commands to Rhino's UI thread via `RhinoApp.InvokeOnUiThread` before executing any RhinoDoc operation
- [ ] **TRAN-04**: Harness detects plugin disconnection (Rhino quit/crash) and reconnects automatically when the plugin becomes available again
- [ ] **TRAN-05**: Session state survives plugin disconnection — harness restores context from PostgreSQL checkpoint on reconnection without losing conversation history
- [ ] **TRAN-06**: Heartbeat keepalive between harness and plugin detects stale connections within a configurable timeout

### Execution

- [ ] **EXEC-01**: Plugin wraps `RhinoApp.RunScript(commandString, echo)` for executing arbitrary Rhino commands by string — enabling the agent to invoke any command a human can type
- [ ] **EXEC-02**: Plugin provides direct RhinoCommon API access for precise geometry operations (create, modify, query objects via `RhinoDoc.Objects`, `RhinoDoc.Layers`, etc.)
- [ ] **EXEC-03**: Plugin subscribes to RhinoDoc events (AddRhinoObject, DeleteRhinoObject, ModifyObjectAttributes, LayerTableEvent, UndoRedo) and pushes them to the harness with 200ms debounce batching
- [ ] **EXEC-04**: Each logical AI action wraps in a single `BeginUndoRecord`/`EndUndoRecord` pair so Cmd+Z undoes the entire action atomically
- [ ] **EXEC-05**: Agent state snapshots are stored via `AddCustomUndoEvent` so undo/redo keeps the agent's internal model consistent with the document
- [ ] **EXEC-06**: Plugin provides Grasshopper 1 programmatic access via the stable GH1 C# SDK — loading definitions, setting parameters, solving, and extracting outputs

### Agent

- [ ] **AGNT-01**: packages/ai provides a generic agent loop service (tool-calling orchestration, planning, conversation management) consumable by any app — not Kargadan-specific
- [ ] **AGNT-02**: Tools are defined via @effect/ai `Tool.make` with schema-driven parameters, typed success/failure, and descriptive annotations — composed into `Toolkit` collections
- [ ] **AGNT-03**: Agent translates natural language user input into appropriate Rhino commands or RhinoCommon API calls via LLM inference
- [ ] **AGNT-04**: Agent discovers relevant commands from a large catalog via RAG-backed pgvector search over an embedded Rhino command knowledge base
- [ ] **AGNT-05**: Agent uses @effect/ai `Chat` for multi-turn conversation with Ref-based history accumulation
- [ ] **AGNT-06**: Architect/Editor model split — strong reasoning model (configurable) plans the operation strategy, faster model executes the command sequence
- [ ] **AGNT-07**: Anthropic Tool Search Tool integration for on-demand tool discovery from large catalogs without upfront context loading
- [ ] **AGNT-08**: Durable multi-step workflows via @effect/workflow — Activity (execute-once), withCompensation (rollback on failure), DurableDeferred (human approval gates)
- [ ] **AGNT-09**: Read tools are stateless and high-frequency (no undo overhead); write tools are validated, undo-wrapped, and carry idempotency tokens — bifurcated by design
- [ ] **AGNT-10**: Agent loop follows PLAN/EXECUTE/VERIFY/PERSIST/DECIDE state machine with typed transitions for retry, correction, compensation, and fatal escalation

### Provider

- [ ] **PROV-01**: User can select AI provider (Anthropic, OpenAI, Google) and model at session start — no hardcoded default provider
- [ ] **PROV-02**: Provider selection and model configuration stored in user/project settings and resolved at runtime via packages/ai AiRegistry
- [ ] **PROV-03**: packages/ai provider abstraction is universal — adding a new provider requires only a new Layer implementation, not changes to the agent loop or tool definitions
- [ ] **PROV-04**: Fallback chain across providers — if primary provider fails, agent automatically retries on configured fallback providers

### Persistence

- [ ] **PERS-01**: Conversation history, run events, snapshots, and tool call results persist to PostgreSQL — replacing the in-memory PersistenceTrace
- [ ] **PERS-02**: Session resumption restores from the last PostgreSQL checkpoint — rebuilds loop state, Chat history, and active context without data loss
- [ ] **PERS-03**: Every tool call is logged with parameters, result, duration, and failure status for audit and replay
- [ ] **PERS-04**: Past agent sessions are queryable and replayable from the audit trail
- [ ] **PERS-05**: Rhino command knowledge base is seeded with command descriptions, parameters, examples, and alias enrichment for accurate RAG retrieval

### Scene

- [ ] **SCEN-01**: Layer 0 compact scene summary (~500 tokens) is always present in the agent's context — object counts by type, active layer, document units, bounding volume
- [ ] **SCEN-02**: Layers 1-3 provide progressive on-demand detail — per-object metadata (Layer 1), full attribute data (Layer 2), geometry data (Layer 3) — fetched only when explicitly needed
- [ ] **SCEN-03**: Context compaction triggers at configurable token threshold (default 75% of context window) and summarizes to a target size (default 40%), preserving session goal, recent turns, and artifact trail
- [ ] **SCEN-04**: Tool outputs use observation masking — return compact summaries (object count + bounding box) rather than verbose geometry dumps; full data available via explicit read tool

### Verification

- [ ] **VRFY-01**: Verification pipeline supports both deterministic checks (geometry validity, bounding box, object existence) and visual checks (viewport capture) through a unified interface — no parallel systems
- [ ] **VRFY-02**: Plugin captures viewport via `ViewCapture.CaptureToBitmap` and returns the image to the harness for vision model assessment, with Metal-aware frame timing to avoid blank/partial captures on macOS
- [ ] **VRFY-03**: Vision model evaluates viewport captures against the agent's stated intent — confirming the operation produced the expected visual result (shape, position, relationship)
- [ ] **VRFY-04**: Verification results (deterministic + visual) feed into the DECIDE stage — informing retry, correction, or completion decisions with both structural and visual evidence

### CLI

- [ ] **CLI-01**: Agent streams progress output to the terminal in real time — showing what stage the loop is in and what tools are firing
- [ ] **CLI-02**: Each tool call displays its name, condensed arguments, and result summary in the terminal as it executes
- [ ] **CLI-03**: Plan-before-execute mode shows the agent's proposed actions and waits for user approval before executing any write operations
- [ ] **CLI-04**: Error messages include the failure class (retryable/correctable/compensatable/fatal) and actionable recovery suggestions
- [ ] **CLI-05**: CLI built on @effect/cli for Effect-native argument parsing, command routing, and help generation — no React/Ink dependency
- [ ] **CLI-06**: Terminal UI provides modern, responsive output without hand-rolled rendering — leveraging existing Effect-ecosystem TUI capabilities

### Schema

- [ ] **SCHM-01**: Delete packages/types/src/kargadan/kargadan-schemas.ts and redesign from scratch — app-specific schemas move to apps/kargadan, universal concepts graduate to appropriate packages
- [ ] **SCHM-02**: Universal concepts (protocol version, telemetry context, failure taxonomy, idempotency) extracted to packages/ as reusable schemas
- [ ] **SCHM-03**: apps/kargadan consumes packages/ai for all LLM interaction — no app-specific AI orchestration logic outside the app
- [ ] **SCHM-04**: Minimal schema surface — one canonical schema per entity with pick/omit/partial derivation at call site; no struct/type proliferation
- [ ] **SCHM-05**: Consistent semantics across boundaries — same field names, parameter signatures, and return shapes between TS harness and C# plugin; mapping isolated at boundary adapters only
- [ ] **SCHM-06**: Internal logic is private — public API surface is minimal; composition and orchestration internalized within services following packages/server patterns

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Platform Expansion

- **PLAT-01**: Windows support — validate InvokeOnUiThread behavior differences, add Windows-specific testing
- **PLAT-02**: Grasshopper 2 integration — when McNeel releases stable programmatic API

### Advanced Capabilities

- **ADVN-02**: Multi-document simultaneous sessions — characterize macOS ActiveDocumentChanged event ordering first
- **ADVN-03**: Local LLM support — add as provider catalog entry once core quality bar is proven with cloud providers
- **ADVN-04**: CI JSON Schema gate for cross-boundary TS/C# contract drift detection

### UX Polish

- **UX-01**: Rhino panel UI mirroring terminal output — after CLI is stable
- **UX-02**: Real-time parametric feedback — after transport latency optimization

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| MCP as primary execution mechanism | Protocol overhead on every command; native typed tool calls via @effect/ai are the reliability substrate |
| Grasshopper 2 integration | Alpha with unstable API; defer until McNeel releases stable docs |
| Rhino.Inside embedding | Windows-only, confirmed unavailable on macOS |
| Rhino.Compute | Windows-only, no macOS build |
| Intel Mac support | Rhino 9 WIP dropped Intel July 2025 |
| Real-time parametric dragging | 200ms debounce + LLM inference latency incompatible with real-time |
| Inline chat panel in Rhino GUI | Terminal-first product; panel is a separate dev track |
| Auto-execute without confirmation on destructive ops | Automation bias risk; plan-before-execute is default |
| React/Ink terminal UI | Using @effect/cli for Effect-native CLI; no React dependency |
| Shared types in packages/types for Kargadan | App-specific schemas belong in the app; universal concepts graduate to packages/ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRAN-01 | Phase 1 | Pending |
| TRAN-02 | Phase 1 | Pending |
| TRAN-03 | Phase 1 | Pending |
| TRAN-04 | Phase 1 | Pending |
| TRAN-05 | Phase 1 | Pending |
| TRAN-06 | Phase 1 | Pending |
| EXEC-01 | Phase 2 | Pending |
| EXEC-02 | Phase 2 | Pending |
| EXEC-03 | Phase 2 | Pending |
| EXEC-04 | Phase 2 | Pending |
| EXEC-05 | Phase 2 | Pending |
| EXEC-06 | Phase 7 | Pending |
| AGNT-01 | Phase 5 | Pending |
| AGNT-02 | Phase 5 | Pending |
| AGNT-03 | Phase 5 | Pending |
| AGNT-04 | Phase 5 | Pending |
| AGNT-05 | Phase 5 | Pending |
| AGNT-06 | Phase 6 | Pending |
| AGNT-07 | Phase 6 | Pending |
| AGNT-08 | Phase 7 | Pending |
| AGNT-09 | Phase 5 | Pending |
| AGNT-10 | Phase 5 | Pending |
| PROV-01 | Phase 5 | Pending |
| PROV-02 | Phase 5 | Pending |
| PROV-03 | Phase 5 | Pending |
| PROV-04 | Phase 5 | Pending |
| PERS-01 | Phase 4 | Pending |
| PERS-02 | Phase 4 | Pending |
| PERS-03 | Phase 4 | Pending |
| PERS-04 | Phase 4 | Pending |
| PERS-05 | Phase 4 | Pending |
| SCEN-01 | Phase 6 | Pending |
| SCEN-02 | Phase 6 | Pending |
| SCEN-03 | Phase 6 | Pending |
| SCEN-04 | Phase 6 | Pending |
| VRFY-01 | Phase 7 | Pending |
| VRFY-02 | Phase 7 | Pending |
| VRFY-03 | Phase 7 | Pending |
| VRFY-04 | Phase 7 | Pending |
| CLI-01 | Phase 8 | Pending |
| CLI-02 | Phase 8 | Pending |
| CLI-03 | Phase 8 | Pending |
| CLI-04 | Phase 8 | Pending |
| CLI-05 | Phase 8 | Pending |
| CLI-06 | Phase 8 | Pending |
| SCHM-01 | Phase 3 | Pending |
| SCHM-02 | Phase 3 | Pending |
| SCHM-03 | Phase 3 | Pending |
| SCHM-04 | Phase 3 | Pending |
| SCHM-05 | Phase 3 | Pending |
| SCHM-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after roadmap creation — all 51 requirements mapped to phases*
