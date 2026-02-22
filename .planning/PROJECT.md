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
- Agent loop skeleton (TS): PLAN/EXECUTE/VERIFY/PERSIST/DECIDE state machine with retry/correction/compensation — existing
- WebSocket client with Deferred-correlated request/response (TS) — existing
- Session supervisor state machine (TS): idle/connected/authenticated/active/terminal — existing
- In-memory persistence trace with SHA-256 snapshot hashing (TS) — existing
- packages/ai inference primitives: multi-provider language model (OpenAI/Anthropic/Gemini), embedding, streaming, chat, per-tenant budget/rate enforcement — existing
- packages/ai search service: semantic search with pgvector + trigram fallback, nightly embedding cron — existing
- C# build infrastructure: Directory.Build.props, custom Roslyn analyzer (58 rules), .editorconfig, LanguageExt 5.0.0-beta-77, Thinktecture 10.0.0 — existing
- PostgreSQL database infrastructure: polymorphic repo factory, tenant scoping, OCC, keyset pagination, advisory locks, LISTEN/NOTIFY streaming — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Generic agent loop in packages/ai: tool-calling orchestration, planning, conversation management, context compaction — consumable by any app
- [ ] Dynamic command discovery: RAG-backed Rhino command knowledge base (pgvector) with Anthropic Tool Search Tool integration
- [ ] Persistent agent sessions: PostgreSQL-backed conversation history, run events, snapshots, tool call audit log — replacing in-memory PersistenceTrace
- [ ] Plugin WebSocket server: TCP/WebSocket listener inside Rhino plugin on localhost, background thread with InvokeOnUiThread marshaling
- [ ] RhinoDoc command executor: RhinoApp.RunScript wrapper for arbitrary command execution + direct RhinoCommon API calls for precise operations
- [ ] RhinoDoc event subscriptions: AddRhinoObject, DeleteRhinoObject, ModifyObjectAttributes, LayerTableEvent, UndoRedo — debounced at 200ms
- [ ] Undo integration: BeginUndoRecord/EndUndoRecord wrapping each logical AI action, AddCustomUndoEvent for agent state snapshots
- [ ] CLI interface: terminal-based interaction with streaming progress, tool call visibility, plan-before-execute mode
- [ ] Layered scene representation: Layer 0 compact summary (~500 tokens always present), Layers 1-3 on-demand via read tools
- [ ] Plugin .NET target correction: net9.0 for Rhino 9 WIP (current net10.0 is unsupported), net8.0 for Rhino 8 compatibility
- [ ] packages/ai agent toolkit: Tool.make schema-driven definitions, Toolkit composition, read/write tool bifurcation
- [ ] Refactor apps/kargadan to consume packages/ai for all LLM interaction — no app-specific AI logic
- [ ] Delete and redesign kargadan schemas: move app-specific schemas into app, graduate universal concepts (protocol, telemetry, failure taxonomy) to packages/
- [ ] Context compaction: Tokenizer-gated rolling summarization with configurable thresholds (75% trigger, 40% target)
- [ ] Session resumption: restore from PostgreSQL checkpoint, rebuild loop state from last snapshot
- [ ] Architect/Editor model split: strong reasoning model (Opus/Sonnet) for planning, faster model for execution
- [ ] Local integration testing workflow: real Rhino 9 WIP feedback loop with the plugin loaded
- [ ] Rhino command knowledge base seeding: catalog Rhino commands with descriptions, parameters, examples for embedding

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
- Vision-based verification — ViewCapture.CaptureToBitmap has Metal-specific capture timing issues on macOS; defer until verified reliable
- Intel Mac support — Rhino 9 WIP dropped Intel July 2025; Apple Silicon only

## Context

### Platform Constraints (macOS / Rhino 9 WIP)

- **Apple Silicon arm64 only** — Intel support dropped permanently (Rhino 9.0.25196.12306, July 2025)
- **macOS Sequoia 15+ required** — minimum OS for Rhino 9 WIP
- **Rhino 9 WIP runs .NET 9** — confirmed via `NetCoreVersion=v9` runtime setting; the existing plugin's `net10.0` target MUST be corrected to `net9.0`
- **Thread safety enforcement is stricter on macOS** — NSView/AppKit throws `NSException` immediately on background thread UI access (Windows is more lenient); every document mutation from WebSocket handler must marshal through `RhinoApp.InvokeOnUiThread`
- **macOS event ordering differs** — `ActiveDocumentChanged` fires before some open/new events (documented Rhino macOS behavior); state machines must not depend on Windows event ordering
- **No App Sandbox** — Rhino for Mac distributed outside Mac App Store; full localhost network access confirmed (RhinoMCP validates this pattern)
- **CPython 3.13.3** available inside Rhino 9 WIP for scripting; can invoke via `RhinoApp.RunScript("-_RunPythonScript <path>.py", true)` as supplementary execution path

### Existing Codebase

- **Monorepo**: Nx/Vite/Effect TypeScript + C# polyglot workspace
- **packages/ai**: Multi-provider LLM inference, embedding, search, budget/rate enforcement — built entirely on @effect/ai ecosystem (no Vercel AI SDK, no LangChain)
- **packages/database**: PostgreSQL repo factory with pgvector, tenant scoping, OCC, event sourcing patterns
- **packages/server**: Full platform services — cache, metrics, resilience, telemetry, cluster, policy, context propagation
- **apps/kargadan/harness**: TypeScript agent loop (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE) with WebSocket client, session supervisor, persistence trace
- **apps/kargadan/plugin**: C# Rhino plugin with complete protocol contracts, session state machine, command router — missing transport layer and RhinoDoc execution
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
- **Plugin TFM**: Must target `net9.0` for Rhino 9 WIP, `net8.0` for Rhino 8 — multi-target via `<TargetFrameworks>net8.0;net9.0</TargetFrameworks>`
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
| Two-process architecture (plugin + harness) | Only viable path on macOS — Rhino.Inside and Rhino.Compute are Windows-only | -- Pending |
| WebSocket bridge on localhost | Validated by RhinoMCP; full-duplex; no macOS sandbox restrictions | -- Pending |
| `RhinoApp.RunScript` as dynamic command interface | Agent can execute ANY Rhino command by string; no hardcoded command enum | -- Pending |
| Generic agent loop in packages/ai | Any future app needing AI agent orchestration reuses the same loop; prevents app-specific duplication | -- Pending |
| Delete kargadan-schemas.ts and redesign | Current schemas conflate universal concepts with app-specific protocol; redesign separates concerns | -- Pending |
| Plugin targets net9.0 (not net10.0) | Rhino 9 WIP confirmed running .NET 9; net10.0 unsupported | -- Pending |
| RAG for command discovery (not hardcoded enum) | Rhino has hundreds of commands; embedding + Tool Search Tool scales without context bloat | -- Pending |
| PostgreSQL for session persistence | Existing infra in packages/database; event-sourced run log + pgvector for knowledge retrieval | -- Pending |
| Anthropic Tool Search Tool for large tool catalogs | 85% token reduction; on-demand discovery beats upfront loading | -- Pending |
| @effect/workflow for durable operations | Activity compensation + DurableDeferred approval gates map directly to undo-wrapped multi-step CAD writes | -- Pending |
| Apple Silicon only (no Intel) | Rhino 9 WIP dropped Intel Mac July 2025; no reason to support dead platform | -- Pending |
| No MCP for core execution | MCP adds protocol overhead; native typed tool calls via @effect/ai are the reliability substrate | -- Pending |
| Grasshopper 1 only (no GH2) | GH2 is alpha with unstable API; GH1 has stable C# SDK for programmatic access | -- Pending |

---
*Last updated: 2026-02-22 after initialization*
