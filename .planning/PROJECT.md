# Kargadan: AI Agent for Rhino 9

## What This Is

A CLI-based AI agent that controls Rhino 9 through natural language — "Claude Code for CAD." The user types intent in a terminal, the agent discovers appropriate Rhino commands via RAG-backed tool search, executes them through a C# plugin running inside Rhino, verifies results, and maintains persistent context across sessions. Built on the Effect ecosystem with a two-process architecture: TypeScript agent harness (out-of-process) communicating with a C# Rhino plugin (in-process) over localhost WebSocket.

## Core Value

The agent can execute any operation a human can perform in Rhino 9 through natural language, with reliable state persistence and verification — without hardcoding individual commands.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- Typed protocol contracts (C#): 14 value objects, 9 smart enums, all envelope records, command router, handshake negotiation, session state machine — existing
- Event publisher with atomic drain (C#) — existing
- Agent loop core (TS): PLAN/EXECUTE/VERIFY/PERSIST/DECIDE state rails with retry/correction and compensation hooks — existing
- WebSocket client with Deferred-correlated request/response (TS) — existing
- Reconnection supervisor + socket pending-map recovery (TS) — existing
- PostgreSQL-backed AgentPersistenceService checkpoint/chat hydration (TS) — existing
- packages/ai inference primitives: multi-provider language model (OpenAI/Anthropic/Gemini), embedding, streaming, chat, per-tenant budget/rate enforcement — existing
- packages/ai search service: semantic search with pgvector + trigram fallback, nightly embedding cron — existing
- C# build infrastructure: Directory.Build.props, custom Roslyn analyzer (58 rules), .editorconfig, LanguageExt 5.0.0-beta-77, Thinktecture 10.0.0 — existing
- PostgreSQL database infrastructure: polymorphic repo factory, tenant scoping, OCC, keyset pagination, advisory locks, LISTEN/NOTIFY streaming — existing

### Active

<!-- Current scope. Building toward these. -->

- [x] Generic agent loop in packages/ai: core PLAN/EXECUTE/VERIFY/PERSIST/DECIDE rails with typed transition plumbing
- [x] Dynamic command discovery: RAG-backed Rhino command knowledge base (pgvector/hybrid default) with optional provider-gated Anthropic discovery seam (runtime validation pending)
- [x] Persistent agent sessions: PostgreSQL-backed conversation history, run events, snapshots, tool call audit log — replacing legacy in-memory traces
- [x] Plugin WebSocket server: TCP/WebSocket listener inside Rhino plugin on localhost, background thread with InvokeOnUiThread marshaling
- [x] RhinoDoc command executor: RhinoApp.RunScript wrapper for arbitrary command execution + direct RhinoCommon API calls for precise operations
- [x] RhinoDoc event subscriptions: AddRhinoObject, DeleteRhinoObject, ModifyObjectAttributes, LayerTableEvent, UndoRedo — debounced at 200ms
- [x] Undo integration: BeginUndoRecord/EndUndoRecord wrapping each logical AI action, AddCustomUndoEvent for agent state snapshots
- [ ] CLI interface: terminal-based interaction with streaming progress, tool call visibility, plan-before-execute mode
- [x] Layered scene representation: Layer 0 compact summary (~500 tokens always present), Layers 1-3 on-demand via read tools (manual Rhino smoke pending)
- [x] Plugin .NET target correction: net9.0 single-target for Rhino 9 WIP
- [x] packages/ai agent toolkit: high-order Tool.make definitions and Toolkit composition with typed schemas
- [x] apps/kargadan consumes packages/ai runtime/services for AI operations with NL planning over catalog+RAG
- [ ] Schema convergence follow-up (SCHM-02): extract remaining universal concepts (protocol version, telemetry context, failure taxonomy, idempotency) to packages/
- [x] Context compaction: Tokenizer-gated rolling compaction with configurable thresholds (75% trigger, 40% target)
- [x] Session resumption: restore from PostgreSQL checkpoint, rebuild loop state from last snapshot
- [x] Architect/Editor model split: configurable architect override for planning, default/session profile for execution
- [x] Durable write-path workflow refactor: single `@effect/workflow` paradigm in harness execution path (no dual rails)
- [ ] Local integration testing workflow: real Rhino 9 WIP feedback loop with the plugin loaded
- [x] Rhino command knowledge base seeding pipeline: handshake catalog first, env fallback override, hash-marked reseed guard
- [x] Vision/deterministic verification convergence: deterministic checks are authority, optional `view.capture` evidence augments confidence (live Rhino validation pending)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- MCP as primary execution mechanism — MCP adds protocol overhead (initialize/negotiate/operate); native typed tool calls are the core path. MCP kept in packages/ai for interoperability with Claude Desktop/Cursor but not used by Kargadan
- Grasshopper 2 integration — GH2 is alpha with no stable programmatic API; defer until API stabilizes
- Rhino.Inside embedding — Windows-only, confirmed unavailable on macOS; two-process architecture is the only viable path
- Rhino.Compute — Windows-only, no macOS build exists
- Windows-specific features — agent targets macOS (Apple Silicon, Sequoia 15+); Windows support deferred
- Multi-document simultaneous sessions — single active document per agent session for v1; multi-document requires event ordering research specific to macOS
- Real-time parametric dragging — 200ms debounce latency incompatible with real-time feedback; deferred to future transport optimization
- Shared types in packages/types for Kargadan — app-specific schemas belong in the app; universal concepts graduate to appropriate packages
- Intel Mac support — Rhino 9 WIP dropped Intel July 2025; Apple Silicon only

## Context

### Platform Constraints (macOS / Rhino 9 WIP)

- **Apple Silicon arm64 only** — Intel support dropped permanently (Rhino 9.0.25196.12306, July 2025)
- **macOS Sequoia 15+ required** — minimum OS for Rhino 9 WIP
- **Rhino 9 WIP runs .NET 9** — confirmed via `NetCoreVersion=v9` runtime setting; plugin target is `net9.0` (single-target policy)
- **Thread safety enforcement is stricter on macOS** — NSView/AppKit throws `NSException` immediately on background thread UI access (Windows is more lenient); every document mutation from WebSocket handler must marshal through `RhinoApp.InvokeOnUiThread`
- **macOS event ordering differs** — `ActiveDocumentChanged` fires before some open/new events (documented Rhino macOS behavior); state machines must not depend on Windows event ordering
- **No App Sandbox** — Rhino for Mac distributed outside Mac App Store; full localhost network access confirmed (RhinoMCP validates this pattern)
- **CPython 3.13.3** available inside Rhino 9 WIP for scripting; can invoke via `RhinoApp.RunScript("-_RunPythonScript <path>.py", true)` as supplementary execution path

### Existing Codebase

- **Monorepo**: Nx/Vite/Effect TypeScript + C# polyglot workspace
- **packages/ai**: Multi-provider LLM inference, embedding, search, budget/rate enforcement — built entirely on @effect/ai ecosystem (no Vercel AI SDK, no LangChain)
- **packages/database**: PostgreSQL repo factory with pgvector, tenant scoping, OCC, event sourcing patterns
- **packages/server**: Full platform services — cache, metrics, resilience, telemetry, cluster, policy, context propagation
- **apps/kargadan/harness**: TypeScript agent loop (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE) with WebSocket client, ReconnectionSupervisor, and AgentPersistenceService checkpoint/chat hydration
- **apps/kargadan/plugin**: C# Rhino plugin with protocol contracts, session state machine, transport, execution, and observation pipeline
- **apps/cs-analyzer**: Custom Roslyn analyzer (58 rules) enforcing C# coding standards

### Research Foundation

Two research documents (`Rhino-Research1.md`, `Rhino-Research2.md`) provide detailed architectural analysis covering: two-process architecture rationale, RhinoCommon API surface, undo system design, event debouncing strategy, layered context representation, agent loop design, and technology trade-offs. Key validated patterns:
- TCP/WebSocket bridge inside Rhino plugin confirmed viable on macOS (RhinoMCP reference implementation)
- `RhinoApp.RunScript` is the dynamic command execution interface — no need to hardcode commands
- `RhinoDoc.RuntimeData` for per-document agent state that survives the Rhino session
- Bifurcated tool surface: read tools (stateless, high-frequency) vs write tools (validated, undo-wrapped, idempotent)
- Observation masking preferred over LLM summarization for tool output compaction (NeurIPS DL4C 2025)

### Agent Technology Stack

- **@effect/ai 0.33.2**: Tool.make (schema-driven definitions), Toolkit (composable collections), Chat (multi-turn with Ref-based history), Tokenizer (context budget), EmbeddingModel (RAG), LanguageModel (provider-agnostic inference), McpServer (interop), Telemetry (OTEL-native)
- **@effect/ai-anthropic 0.23.0**: Claude provider with extended thinking, Tool Search Tool beta, parallel tool use
- **@effect/workflow 0.16.0**: Activity (execute-once), withCompensation (rollback), DurableDeferred (human-in-the-loop gates), DurableClock.sleep (pause without resource consumption)
- **Anthropic Tool Search Tool** (`advanced-tool-use-2025-11-20` beta): on-demand tool discovery from large catalogs — 85% token reduction, meaningful accuracy gains
- **Architect/Editor pattern**: strong reasoning model plans, faster model executes — mirrors aider's 85% SWE-bench result

## Constraints

- **Tech Stack**: TypeScript + Effect for harness/AI; C# + LanguageExt + Thinktecture for Rhino plugin; PostgreSQL 18.2 for persistence — no exceptions
- **Plugin TFM**: Target `net9.0` only for this project phase line (Rhino 9 WIP policy)
- **Monorepo Topology**: packages/ contain universal/agnostic logic; apps/ contain domain-specific bindings — no app-specific logic bleeding into packages
- **Schema-First**: All types derived from schemas; decode at boundaries; no separate type declarations
- **Thread Safety**: Every RhinoDoc mutation from WebSocket handler must route through `RhinoApp.InvokeOnUiThread` — no exceptions on macOS
- **Platform**: macOS Apple Silicon (arm64) + Sequoia 15+ only for v1
- **No Shared Types**: Kargadan-specific schemas live in apps/kargadan; universal concepts (protocol, telemetry, failure taxonomy) graduate to appropriate packages
- **Command Attribute**: Plugin commands must carry `[CommandStyle(ScriptRunner)]` for `RunScript` to function

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Two-process architecture (plugin + harness) | Only viable path on macOS — Rhino.Inside and Rhino.Compute are Windows-only | Accepted + implemented |
| WebSocket bridge on localhost | Validated by RhinoMCP; full-duplex; no macOS sandbox restrictions | Accepted + implemented |
| `RhinoApp.RunScript` as dynamic command interface | Agent can execute ANY Rhino command by string; no hardcoded command enum | Accepted + implemented |
| Generic agent loop in packages/ai | Any future app needing AI agent orchestration reuses the same loop; prevents app-specific duplication | Accepted + implemented |
| Delete kargadan-schemas.ts and redesign | Current schemas conflate universal concepts with app-specific protocol; redesign separates concerns | Completed |
| Plugin targets net9.0 (not net10.0) | Rhino 9 WIP confirmed running .NET 9; net10.0 unsupported | Completed (`net9.0` single target) |
| RAG for command discovery (not hardcoded enum) | Rhino has hundreds of commands; embedding + Tool Search Tool scales without context bloat | Implemented (pgvector/hybrid default + optional provider-gated Tool Search seam; runtime validation pending) |
| PostgreSQL for session persistence | Existing infra in packages/database; event-sourced run log + pgvector for knowledge retrieval | Completed |
| Anthropic Tool Search Tool for large tool catalogs | 85% token reduction; on-demand discovery beats upfront loading | Phase 6 optional provider-gated seam implemented; default discovery remains pgvector-first |
| @effect/workflow for durable operations | Activity compensation + DurableDeferred approval gates map directly to undo-wrapped multi-step CAD writes | Implemented for non-GH write path in Phase 7 line; live validation pending, `EXEC-06` deferred |
| Apple Silicon only (no Intel) | Rhino 9 WIP dropped Intel Mac July 2025; no reason to support dead platform | Accepted |
| No MCP for core execution | MCP adds protocol overhead; native typed tool calls via @effect/ai are the reliability substrate | Accepted |
| Grasshopper 1 only (no GH2) | GH2 is alpha with unstable API; GH1 has stable C# SDK for programmatic access | Accepted |

---
*Last updated: 2026-03-04 after Phase 7 non-GH implementation update*
