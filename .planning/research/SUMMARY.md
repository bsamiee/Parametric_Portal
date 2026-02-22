# Project Research Summary

**Project:** Kargadan — CLI-based AI agent controlling Rhino 9 via natural language
**Domain:** Agentic CAD automation (brownfield Effect/TypeScript + C# monorepo extension)
**Researched:** 2026-02-22
**Confidence:** HIGH (stack fully grounded in existing workspace catalog; architecture validated against current codebase)

## Executive Summary

Kargadan is a brownfield extension to an existing Nx/Effect/TypeScript monorepo. The product is a "Claude Code for CAD" — a terminal-based AI agent that accepts natural language intent and translates it to Rhino 9 commands executed over a localhost WebSocket bridge between a Node.js harness and a C# Rhino plugin. The workspace already pins the entire stack (`@effect/ai`, `@effect/ai-anthropic`, `@effect/workflow`, `@effect/platform-node`, `@effect/sql`); the only missing piece is `ink` 6.8.0 for the terminal UI layer, which must be added to the pnpm catalog. All package/library choices are settled — this project is an integration and wiring task, not a greenfield stack selection.

The recommended approach mirrors proven patterns from Claude Code and aider: a two-tier loop where a strong reasoning model (Opus/Sonnet 4.5) handles planning and a faster model (Haiku or Sonnet) handles execution parameter generation; RAG-backed command discovery using the existing pgvector infrastructure with Anthropic's Tool Search Tool (`advanced-tool-use-2025-11-20`); tokenizer-gated rolling context compaction at 75% trigger / 40% target; and PostgreSQL-backed session persistence replacing the current in-memory `PersistenceTrace`. The architecture divides cleanly across three layers: CLI shell (Ink), generic AI orchestration (packages/ai — reusable), and Kargadan-specific protocol/plugin execution (apps/kargadan — bounded). The key dependency chain is Plugin WebSocket Server → RhinoDoc Executor → PostgreSQL Persistence → AI Agent Core → Context Management → CLI Interface.

The dominant risks are macOS-specific: every RhinoDoc write path must go through `RhinoApp.InvokeOnUiThread` or the plugin crashes non-deterministically; the plugin's .NET target must be `net8.0;net9.0` (not `net10.0`) to load in Rhino 9 WIP; and the undo record must be explicitly bracketed outside Rhino command context. Secondary risks are architectural: context window exhaustion without compaction, tool selection degradation from catalog bloat, and schema drift across the polyglot WebSocket boundary. All risks have documented prevention strategies and should be addressed phase by phase in dependency order.

---

## Key Findings

### Recommended Stack

The entire stack already exists in the workspace catalog. The harness uses `@effect/ai` (Chat, LanguageModel, Tool, Toolkit), `@effect/ai-anthropic` for Claude providers (Opus for planning, Sonnet for execution), `@effect/workflow` for durable multi-step operations with Activity + DurableDeferred, and `@effect/platform-node` for the WebSocket bridge. `packages/ai` already wires AiRuntime, AiRegistry, SearchService, and EmbeddingCron. The only new dependency is `ink` 6.8.0 for the terminal rendering layer — compatible with the existing `react: 19.3.0-canary` catalog pin.

Effect v4 entered public beta on 2026-02-18 but must not be used; `effect 3.19.18` is the stable line. `@effect/workflow 0.16.0` is alpha — its Activity and DurableDeferred semantics are the correct approach for CAD undo-wrapped operations, but simpler compensation logic in `loop-stages.ts` is an acceptable fallback for single-step writes until the library stabilizes. The Anthropic Tool Search Tool (`advanced-tool-use-2025-11-20`) delivers 85% token reduction on large tool catalogs and is supported by `@effect/ai-anthropic 0.23.0`, but requires Sonnet 4.5 or Opus 4.5 as the model — this gates the model choice.

**Core technologies:**
- `@effect/ai 0.33.2`: schema-driven Tool.make definitions, Chat history, LanguageModel provider-agnostic inference, Tokenizer — entire AI surface is Effect-native with no impedance mismatch
- `@effect/ai-anthropic 0.23.0`: Claude provider with extended thinking, Tool Search Tool beta header, streaming — primary inference for both Architect and Editor model tiers
- `@effect/workflow 0.16.0`: Activity.make (execute-once with retry), withCompensation (rollback), DurableDeferred (human-in-the-loop gate) — maps directly to undo-wrapped CAD write sequences
- `@effect/platform-node 0.104.1`: Socket.makeWebSocket — native Effect primitive already wired in the harness for the Rhino plugin bridge
- `ink 6.8.0` (ADD to catalog): React-for-terminal — streaming token output, plan-before-execute UI, tool call visibility; used by GitHub Copilot CLI and Claude Code at production scale
- `pgvector` (existing infra): hybrid cosine + trigram search for Rhino command catalog via existing packages/database and packages/ai SearchService

### Expected Features

**Must have for launch (v1 — P1):**
- Plugin WebSocket server (C# TcpListener + WebSocket upgrade) — gates everything else
- Natural language command execution via `RhinoApp.RunScript` — core value proposition
- Streaming progress output in terminal (Ink) — silent terminals feel broken; industry baseline
- Plan-before-execute mode with y/n approval gate — safety for destructive CAD operations
- Undo integration (`BeginUndoRecord`/`EndUndoRecord` per AI action) — non-negotiable for Rhino power users
- Tool call visibility in terminal — builds user trust; zero implementation cost
- Layer 0 scene representation (≤500 tokens, always present) — agent must know what is in the document
- Session persistence via PostgreSQL (replaces in-memory PersistenceTrace) — required for restart-safe sessions
- Basic RAG-backed command discovery (pgvector knowledge base) — enables command-agnostic NL input
- Error messages with actionable recovery suggestions — minimum usability bar

**Should have after v1 validation (v1.x — P2):**
- Architect/Editor model split (Opus/Sonnet planning + Haiku/Sonnet execution) — proven 85% SWE-bench improvement pattern from aider; add once v1 loop is stable
- Context compaction (75% trigger / 40% target, observation masking + summarization) — needed once real users run long sessions
- Anthropic Tool Search Tool integration (`advanced-tool-use-2025-11-20`) — enhances command discovery; add once knowledge base is seeded and evaluated
- Observation masking for tool output compaction — NeurIPS DL4C 2025 validated; lower cost than LLM summarization
- Audit trail UI and replay — adds operational polish; requires stable persistence layer
- Layers 1-3 on-demand scene representation — implement once Layer 0 insufficiency is confirmed by real usage

**Defer to v2+:**
- Grasshopper 1 procedural automation — blocked on stable plugin; high value, high complexity
- Durable multi-step workflow execution with full `@effect/workflow` compensation — wire after single-step execution is reliable and `@effect/workflow` stabilizes
- Bifurcated tool surface formalization with schema-driven `Tool.make` — currently implicit; explicit bifurcation adds correctness guarantees after tool surface stabilizes
- Local LLM support — defer until Anthropic/OpenAI quality bar is validated as the correct constraint

**Explicit anti-features (never build):**
- Vision-based verification (`ViewCapture.CaptureToBitmap`) — confirmed Metal timing issues on macOS; deferred in PROJECT.md
- MCP as primary execution mechanism — protocol overhead accumulates; keep for Claude Desktop interop only
- Multi-document simultaneous sessions in v1 — macOS `ActiveDocumentChanged` event ordering adds cross-document risk
- Auto-execute without confirmation on destructive operations — automation bias causes unrecoverable CAD state

### Architecture Approach

The system splits into two OS processes communicating over a localhost WebSocket (`ws://127.0.0.1:9181`): the Node.js harness runs the Effect agent loop and all LLM orchestration; the C# Rhino plugin executes commands against RhinoCommon inside the Rhino process. This two-process design is the only viable approach on macOS (Rhino.Inside is Windows-only; confirmed by RhinoMCP community). The harness architecture itself uses a two-layer loop: `AgentLoop` (apps/kargadan — protocol state machine: PLAN→EXECUTE→VERIFY→PERSIST→DECIDE) delegates to `AiAgentService` (packages/ai — generic LLM conversation cycle). This separation keeps generic AI orchestration reusable while bounding Kargadan-specific protocol in the app.

**Major components:**
1. **Plugin WebSocket Server** (C# net9.0) — TcpListener + WebSocket upgrade + background thread; all RhinoDoc writes must route through `RhinoApp.InvokeOnUiThread`; TO BUILD
2. **RhinoDoc Command Executor** (C#) — `RhinoApp.RunScript` + direct RhinoCommon API + undo record wrapping; TO BUILD
3. **KargadanSocketClient** (TypeScript) — Effect Platform WebSocket with pending-map Deferred correlation, inbound event Queue; EXISTING — extend
4. **AgentLoop** (TypeScript) — PLAN→EXECUTE→VERIFY→PERSIST→DECIDE state machine; EXISTING — wire to AiAgentService
5. **AiAgentService** (packages/ai) — generic tool-calling loop, Architect/Editor model dispatch, context compaction gating; TO BUILD
6. **AiToolkit** (packages/ai) — read/write bifurcated Tool.make definitions, Tool Search proxy; TO BUILD
7. **PostgreSQL Session Store** — RunEvent log, RunSnapshot checkpoints, ConversationHistory; replaces PersistenceTrace; TO BUILD
8. **pgvector Knowledge Base** — Rhino command catalog with embeddings, hybrid search; schema exists in packages/database, requires seeding
9. **CLI Shell** (Ink 6.8.0) — streaming progress, plan-before-execute, tool call visibility; TO BUILD

### Critical Pitfalls

1. **Missing `InvokeOnUiThread` on every RhinoDoc write path** — macOS enforces strict UI-thread access; any off-thread mutation throws `NSException` non-deterministically (99.999% pass rate on Windows, crash on macOS). Prevention: establish a code-review rule that no RhinoDoc mutation exists outside `InvokeOnUiThread` in the plugin. Verify with 100 rapid write commands on macOS Apple Silicon before any other integration testing.

2. **Plugin targeting `net10.0` instead of `net8.0;net9.0`** — Rhino 9 WIP runs .NET 9 (`NetCoreVersion=v9`); a `net10.0` binary fails to load with `TypeLoadException`. This is a known required fix (documented in PROJECT.md). Must be the first change before any Rhino API integration.

3. **Context window exhaustion without compaction** — a single Rhino scene read can consume 2,000-5,000 tokens; 10-15 tool calls saturate 200K context. Models degrade after 32-64K tokens of context (Databricks finding). Prevention: implement tokenizer gate at 75% trigger with observation masking before any extended session testing.

4. **Undo records broken outside Rhino command scope** — `AddCustomUndoEvent` called from the WebSocket handler (not a `RunCommand` context) silently does nothing without explicit `BeginUndoRecord`/`EndUndoRecord` brackets. Prevention: every document mutation path must explicitly bracket undo records. Verify with 3-write + 3-Cmd+Z integration test on macOS.

5. **Schema drift across the polyglot WebSocket boundary** — TypeScript `@effect/schema` and C# `ProtocolEnvelopes` evolve independently; new fields silently drop at decode. Prevention: designate one side as authoritative (C# `ProtocolEnvelopes.cs`) and generate a canonical JSON Schema spec validated by CI on both sides.

---

## Implications for Roadmap

Based on combined research, the build order is strictly dependency-constrained. Nothing works until the WebSocket bridge functions; no LLM integration is meaningful until real Rhino execution is wired; no session is durable until PostgreSQL persistence replaces the in-memory trace. The architecture research provides an explicit 8-phase order that maps directly to feature groupings.

### Phase 1: Plugin Transport Foundation

**Rationale:** Every other phase depends on a functioning WebSocket bridge. This is the critical path item with no parallelism option. Also includes the immediate TFM fix that is blocking plugin load entirely.
**Delivers:** `ws://localhost:9181` endpoint that accepts connections, completes handshake, routes commands, and returns results; plugin loads in Rhino 9 WIP without TFM errors.
**Addresses:** Plugin WebSocket server (P1), net10.0 TFM fix (P1 prerequisite)
**Avoids:** Pitfall 2 (net10.0 TFM), Pitfall 1 foundation (InvokeOnUiThread code-review rule established here)
**Research flags:** WELL-DOCUMENTED — System.Net.WebSockets on .NET 9, TcpListener pattern, `[CommandStyle(ScriptRunner)]` are all McNeel-documented. Standard patterns; skip research-phase.

### Phase 2: RhinoDoc Execution and Event Push

**Rationale:** Transport is live but no actual Rhino operations execute yet. Wiring `RhinoApp.RunScript` + `InvokeOnUiThread` + undo records + event subscriptions validates the full round-trip and proves the core value proposition mechanically (commands actually change the document).
**Delivers:** Agent can create, modify, and delete geometry; undo stack is intact; scene events flow back to harness.
**Addresses:** Natural language command execution (P1), Undo integration (P1), Layer 0 scene representation foundation
**Avoids:** Pitfall 1 (InvokeOnUiThread — must be 100% coverage here), Pitfall 6 (undo outside command scope), Pitfall 7 (macOS event ordering — document identity resolution)
**Research flags:** NEEDS ATTENTION — macOS-specific RhinoDoc event ordering (`ActiveDocumentChanged` fires before document is ready) requires careful implementation. Verify against McNeel forum sources before implementation begins.

### Phase 3: PostgreSQL Session Persistence

**Rationale:** Session persistence gates all durability requirements. Until this is in place, any harness crash loses all context. Swapping `PersistenceTrace` to PostgreSQL is architectural but the interface stays the same — this is an implementation swap, not a redesign.
**Delivers:** Restart-safe sessions; RunEvent log; RunSnapshot checkpoints; session resumption from last checkpoint; audit trail foundation.
**Addresses:** Session persistence (P1), Persistent sessions across Rhino restarts (P1)
**Avoids:** Pitfall 10 (WebSocket reconnection without session re-sync — PostgreSQL checkpoint is the structural fix), Anti-Pattern 4 (in-memory PersistenceTrace in production)
**Research flags:** WELL-DOCUMENTED — packages/database repo factory pattern is established in the workspace; RunEvent/RunSnapshot schema mirrors existing workspace patterns. Standard patterns; skip research-phase.

### Phase 4: AI Agent Core and Command Discovery

**Rationale:** With a working bridge and durable persistence, the LLM integration can be wired end-to-end. This is the largest phase — it produces `AiAgentService`, `AiToolkit`, and the Rhino command knowledge base. Phase 4a/4b/4c can parallelize within the phase.
**Delivers:** Agent accepts natural language intent, discovers relevant Rhino commands via pgvector RAG, generates tool calls, executes via the bridge, and verifies results.
**Addresses:** Natural language command execution (P1), Basic RAG command discovery (P1), Error messages with recovery (P1), Tool call visibility (P1)
**Avoids:** Anti-Pattern 1 (loading full command catalog — use defer_loading from the start), Pitfall 4 (tool definition bloat — bifurcate read/write in AiToolkit design), Pitfall 5 (Tool Search accuracy — alias enrichment must be part of seeding strategy), Pitfall 9 (generic embeddings for CAD)
**Research flags:** NEEDS DEEPER RESEARCH — Anthropic Tool Search Tool beta (`advanced-tool-use-2025-11-20`) API contract, `defer_loading` behavior, and custom client-side `tool_reference` block implementation should be verified against latest Claude API docs before AiToolkit design is finalized.

### Phase 5: Context Management and Model Split

**Rationale:** Without compaction, any real user session (20+ turns) degrades or crashes. This phase installs the tokenizer gate, observation masking, Layer 0 scene summary, and the Architect/Editor model split. Requires Phase 4 to have tool calls measurable.
**Delivers:** Sessions of unlimited length without context degradation; cost reduction via fast executor model; Layer 0 compact scene summary always present in context.
**Addresses:** Context compaction (P2), Architect/Editor model split (P2), Observation masking (P2)
**Avoids:** Pitfall 3 (context window exhaustion), Anti-Pattern 3 (growing Chat history without compaction)
**Research flags:** MEDIUM — observation masking strategy (NeurIPS DL4C 2025 finding) is well-validated; the 75%/40% thresholds should be tuned against real session data once Phase 4 produces measurable sessions.

### Phase 6: CLI Interface

**Rationale:** CLI shell is architecturally independent of the AI internals — it can start in parallel with Phases 4-5. Surfaces the plan-before-execute gate, streaming progress, and tool call visibility as user-facing affordances.
**Delivers:** Ink-based terminal UI with streaming token output, plan-before-execute mode (DurableDeferred gate), tool call visibility, correction cycle visibility, and context compaction notification.
**Addresses:** Streaming progress output (P1), Plan-before-execute mode (P1), Tool call visibility (P1)
**Avoids:** UX Pitfalls (silent execution, generic errors, invisible retries, silent compaction)
**Research flags:** WELL-DOCUMENTED — Ink 6.8.0 with React 19 is the established pattern; `Static` for completed turns, `Box`/`Text` for live streaming, `useInput` for interactive mode. Standard patterns; skip research-phase.

### Phase 7: Durable Workflow Transactions

**Rationale:** Multi-step write sequences (create floor plate → extrude → add openings) need atomic rollback on partial failure. `@effect/workflow` Activity + withCompensation provides this. Deferred to after single-step execution is reliable because `@effect/workflow` is alpha and adds complexity.
**Delivers:** Multi-step CAD operations with compensation rollback; `DurableDeferred` human-approval gates for destructive operations; exactly-once execution semantics.
**Addresses:** Durable multi-step workflow execution (P3), Plan-before-execute for destructive operations
**Avoids:** `@effect/workflow` alpha instability — single-step compensation in `loop-stages.ts` is the fallback
**Research flags:** NEEDS RESEARCH — `@effect/workflow 0.16.0` is alpha as of 2026-01-02; API stability must be re-verified against latest Effect blog/changelog before implementation begins.

### Phase 8: Protocol Contract Stabilization and Topology Compliance

**Rationale:** Ongoing refinement as both sides of the boundary evolve. Protocol drift and topology violations accumulate across phases; this phase formalize the CI gates and completes the monorepo topology alignment (separate universal from app-specific schemas).
**Delivers:** JSON Schema CI gate validating TS and C# schemas against canonical spec; Kargadan-specific protocol types isolated to apps/kargadan; packages/ai universally reusable for future apps.
**Addresses:** Schema drift (Pitfall 11), Monorepo topology compliance (Anti-Pattern 5)
**Avoids:** Protocol boundary drift from incremental field additions across the polyglot boundary
**Research flags:** WELL-DOCUMENTED — CI schema validation and monorepo topology patterns are established workspace conventions. Standard patterns; skip research-phase.

---

### Phase Ordering Rationale

- **Phases 1→2→3 are strictly sequential**: transport must exist before execution; execution must be validated before persistence is meaningful; persistence must be in place before session resumption works
- **Phase 4 requires Phase 1**: needs a working bridge to validate tool execution end-to-end; 4a/4b/4c can parallelize within phase
- **Phase 5 requires Phase 4**: needs observable tool calls to measure context consumption and tune thresholds
- **Phase 6 can start in parallel with Phases 4-5**: CLI shell is architecturally independent of AI internals; can proceed once bridge is validated in Phase 1
- **Phase 7 depends on Phase 4**: `@effect/workflow` wraps tool calls; single-step execution must be reliable first
- **Phase 8 is continuous**: start protocol contract spec in Phase 1; enforce CI gate by Phase 4 when field additions accelerate

### Research Flags

Phases needing deeper research during planning:
- **Phase 2:** macOS `ActiveDocumentChanged` event ordering — verify document identity resolution against McNeel forum sources; test on macOS Apple Silicon specifically
- **Phase 4:** Anthropic Tool Search Tool beta API contract — `defer_loading`, `tool_reference` block format, custom client-side implementation; verify against latest Claude API docs (docs evolving rapidly)
- **Phase 7:** `@effect/workflow 0.16.0` alpha stability — re-verify Activity/DurableDeferred/withCompensation API before committing to implementation; check Effect blog for breaking changes since 2026-01-02

Phases with standard patterns (skip research-phase):
- **Phase 1:** System.Net.WebSockets, TcpListener, `[CommandStyle(ScriptRunner)]` — McNeel-documented, RhinoMCP community validates the pattern
- **Phase 3:** packages/database repo factory — established workspace pattern; RunEvent/RunSnapshot schema is a straight extension
- **Phase 6:** Ink 6.8.0 + React 19 — well-documented; `Static`/`Box`/`Text`/`useInput` pattern is proven at production scale (GitHub Copilot CLI, Claude Code)
- **Phase 8:** CI schema validation, monorepo topology — established workspace conventions

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Fully grounded in existing workspace catalog (`pnpm-workspace.yaml`) and current codebase (`packages/ai/src/runtime.ts`, `apps/kargadan/harness/src/`). Only new dependency is `ink 6.8.0` — confirmed compatible with React 19 canary already in catalog. |
| Features | MEDIUM-HIGH | AI agent patterns (Claude Code, aider) are HIGH confidence. Rhino-specific AI agent patterns are MEDIUM — RhinoMCP is the primary reference and it is experimental with no production deployment data. Feature prioritization is based on analogical reasoning from coding agents. |
| Architecture | HIGH | Grounded in existing codebase (agent-loop.ts, loop-stages.ts, socket.ts, KargadanPlugin.cs, SessionHost.cs), validated prior Rhino research (Rhino-Research1.md, Rhino-Research2.md), and official Effect AI documentation. Two-process WebSocket bridge validated by RhinoMCP community on macOS. |
| Pitfalls | MEDIUM-HIGH | macOS/RhinoCommon pitfalls from official McNeel documentation and forums (HIGH). AI agent pitfalls from Anthropic engineering blog (HIGH). Tool Search Tool accuracy data from independent Arcade.dev benchmark (MEDIUM — single study, 4,027 tool catalog). |

**Overall confidence:** HIGH

### Gaps to Address

- **Tool Search Tool production accuracy at Rhino catalog scale**: independent testing shows 56-64% accuracy at 4,027-tool catalogs. The Rhino command catalog is smaller (~300 commands) but CAD vocabulary mismatch (e.g., "fillet" vs "round edge") may produce similar failure rates. Mitigation: alias enrichment strategy during Phase 4 seeding + hybrid trigram fallback. Validate with a 50-query evaluation set before enabling in production.

- **`@effect/workflow` alpha stability timeline**: the library is alpha as of 2026-01-02. Phase 7 depends on it stabilizing before implementation. Mitigation: the existing PLAN→EXECUTE retry/compensation pattern in `loop-stages.ts` covers single-step failure recovery and is an acceptable fallback if `@effect/workflow` remains alpha through Phases 1-6.

- **macOS event ordering edge cases with multiple documents**: the research explicitly flags multi-document scenarios as risky (v1 defers multi-document sessions for this reason). Single-document-per-session constraint removes most of the risk, but the document-identity resolution flow in Phase 2 should be tested with file open/close/reopen sequences on macOS before assuming correctness.

- **Rhino command knowledge base curation effort**: seeding the command knowledge base is not an engineering task — it requires domain knowledge curation of Rhino command descriptions, parameters, and natural language aliases. This is the blocking item for Phase 4 RAG discovery; it should begin in parallel with Phase 1/2 engineering work.

---

## Sources

### Primary (HIGH confidence)
- `pnpm-workspace.yaml` workspace catalog — all pinned versions verified from source
- `packages/ai/src/runtime.ts` — AiRuntime imports Chat, EmbeddingModel, LanguageModel from `@effect/ai`; confirms existing integration shape
- `apps/kargadan/harness/src/harness.ts` — SessionSupervisor, AgentLoop, CommandDispatch, PersistenceTrace wiring confirmed
- `apps/kargadan/PROJECT.md` — platform constraints, out-of-scope decisions, existing codebase map; canonical project source
- `apps/kargadan/Rhino-Research1.md` and `Rhino-Research2.md` — architecture rationale, API surface, macOS constraints; bespoke validated research
- [McNeel Forum: RhinoCommon Async Best Practices](https://discourse.mcneel.com/t/best-practices-for-rhino-plugin-development-wrt-async-operations/177773) — threading non-determinism on macOS confirmed by McNeel developer
- [McNeel Forum: RhinoDoc event ordering](https://discourse.mcneel.com/t/rhinodoc-name-and-rhinodoc-path-after-which-event/73951) — Path/Name null in ActiveDocumentChanged
- [McNeel Forum: AddCustomUndoEvent outside commands](https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123) — BeginUndoRecord required for non-command mutation paths
- [Anthropic engineering: Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) — 85% token reduction, accuracy improvement data
- [Anthropic Tool Search Tool API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — `advanced-tool-use-2025-11-20` beta, defer_loading, model requirements
- [Effect v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/) — v4 public beta 2026-02-18; 3.x is stable line
- [Anthropic engineering: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — tool bloat, compaction patterns

### Secondary (MEDIUM confidence)
- [RhinoMCP GitHub](https://github.com/jingcheng-chen/rhinomcp) — validates WebSocket bridge pattern on macOS; confirms no sandbox restrictions
- [@effect/workflow npm](https://www.npmjs.com/package/@effect/workflow) — version 0.16.0, Activity + DurableDeferred confirmed; alpha status
- [ink npm](https://www.npmjs.com/package/ink) — version 6.8.0, React 19 compatible
- [Arcade.dev: Tool Search 4,027-tool benchmark](https://arcade.dev/blog/anthropic-tool-search-claude-mcp-runtime) — 60%/64% accuracy data; failure case examples
- NeurIPS DL4C 2025 observation masking finding (arxiv:2508.21433) — observation masking equals LLM summarization accuracy at half the cost
- Aider Architect/Editor 85% SWE-bench result — two-model planning/execution split pattern

### Tertiary (LOW confidence)
- [pgvector production patterns](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) — hybrid vector + BM25 search patterns; multiple sources agree but specific Rhino vocabulary matching is unvalidated
- CAD AI agent landscape surveys (mecagent.com, myarchitectai.com 2025/2026) — market context only; no direct technical validation

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*
