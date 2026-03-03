# Project Research Summary

**Project:** Kargadan — CLI-based AI agent controlling Rhino 9 via natural language
**Domain:** Agentic CAD automation (brownfield Effect/TypeScript + C# monorepo extension)
**Researched:** 2026-02-22
**Confidence:** HIGH (stack fully grounded in existing workspace catalog; architecture validated against current codebase)

## Executive Summary

Kargadan is a brownfield extension to an existing Nx/Effect/TypeScript monorepo. The product is a "Claude Code for CAD" — a terminal-based AI agent that accepts natural language intent and translates it to Rhino 9 commands executed over a localhost WebSocket bridge between a Node.js harness and a C# Rhino plugin. The workspace already pins the core stack (`@effect/ai`, `@effect/ai-anthropic`, `@effect/workflow`, `@effect/platform-node`, `@effect/sql`). CLI policy for forward phases is `@effect/cli`. All package/library choices are settled — this project is an integration and wiring task, not a greenfield stack selection.

The recommended approach mirrors proven patterns from Claude Code and aider: a two-tier loop where a strong reasoning model (Opus/Sonnet 4.5) handles planning and a faster model (Haiku or Sonnet) handles execution parameter generation; RAG-backed command discovery using the existing pgvector infrastructure with Anthropic's Tool Search Tool (`advanced-tool-use-2025-11-20`); tokenizer-gated rolling context compaction at 75% trigger / 40% target; and PostgreSQL-backed session persistence replacing legacy in-memory traces. The architecture divides cleanly across three layers: CLI shell (`@effect/cli` policy), generic AI orchestration (packages/ai — reusable), and Kargadan-specific protocol/plugin execution (apps/kargadan — bounded). The key dependency chain is Plugin WebSocket Server → RhinoDoc Executor → PostgreSQL Persistence → AI Agent Core → Context Management → CLI Interface.

The dominant risks are macOS-specific: every RhinoDoc write path must go through `RhinoApp.InvokeOnUiThread` or the plugin crashes non-deterministically; plugin/runtime TFM drift must be prevented (`net9.0` is the current project policy for Rhino 9 WIP); and the undo record must be explicitly bracketed outside Rhino command context. Secondary risks are architectural: context window exhaustion without compaction, tool selection degradation from catalog bloat, and schema drift across the polyglot WebSocket boundary. All risks have documented prevention strategies and should be addressed phase by phase in dependency order.

---

## Key Findings

### Recommended Stack

The entire stack already exists in the workspace catalog. The harness uses `@effect/ai` (Chat, LanguageModel, Tool, Toolkit), `@effect/ai-anthropic` for Claude providers (Opus for planning, Sonnet for execution), `@effect/workflow` for durable multi-step operations with Activity + DurableDeferred, and `@effect/platform-node` for the WebSocket bridge. `packages/ai` already wires AiRuntime, AiRegistry, SearchService, and EmbeddingCron. CLI policy is `@effect/cli`; no additional runtime dependency is required for this phase line.

Effect v4 entered public beta on 2026-02-18 but must not be used; `effect 3.19.19` is the stable line. `@effect/workflow 0.16.0` is alpha — its Activity and DurableDeferred semantics are the correct approach for CAD undo-wrapped operations, but simpler compensation logic in `apps/kargadan/harness/src/runtime/agent-loop.ts` is an acceptable fallback for single-step writes until the library stabilizes. The Anthropic Tool Search Tool (`advanced-tool-use-2025-11-20`) delivers 85% token reduction on large tool catalogs and is supported by `@effect/ai-anthropic 0.23.0`, but requires Sonnet 4.5 or Opus 4.5 as the model — this gates the model choice.

**Core technologies:**
- `@effect/ai 0.33.2`: schema-driven Tool.make definitions, Chat history, LanguageModel provider-agnostic inference, Tokenizer — entire AI surface is Effect-native with no impedance mismatch
- `@effect/ai-anthropic 0.23.0`: Claude provider with extended thinking, Tool Search Tool beta header, streaming — primary inference for both Architect and Editor model tiers
- `@effect/workflow 0.16.0`: Activity.make (execute-once with retry), withCompensation (rollback), DurableDeferred (human-in-the-loop gate) — maps directly to undo-wrapped CAD write sequences
- `@effect/platform-node 0.104.1`: Socket.makeWebSocket — native Effect primitive already wired in the harness for the Rhino plugin bridge
- `@effect/cli` (policy canonical for Phase 8): Effect-native command routing/help/argument parsing for CLI surface
- `pgvector` (existing infra): hybrid cosine + trigram search for Rhino command catalog via existing packages/database and packages/ai SearchService

### Expected Features

**Must have for launch (v1 — P1):**
- Plugin WebSocket server (C# TcpListener + WebSocket upgrade) — gates everything else
- Natural language command execution via `RhinoApp.RunScript` — core value proposition
- Streaming progress output in terminal (`@effect/cli` policy) — silent terminals feel broken; industry baseline
- Plan-before-execute mode with y/n approval gate — safety for destructive CAD operations
- Undo integration (`BeginUndoRecord`/`EndUndoRecord` per AI action) — non-negotiable for Rhino power users
- Tool call visibility in terminal — builds user trust; zero implementation cost
- Layer 0 scene representation (≤500 tokens, always present) — agent must know what is in the document
- Session persistence via PostgreSQL (replaces legacy in-memory traces) — required for restart-safe sessions
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
- Grasshopper 1 procedural automation — high value/high complexity; deferred behind Phase 7 workflow/verification closure
- Durable multi-step workflow execution with full `@effect/workflow` compensation — wire after single-step execution is reliable and `@effect/workflow` stabilizes
- Bifurcated tool surface formalization with schema-driven `Tool.make` — currently implicit; explicit bifurcation adds correctness guarantees after tool surface stabilizes
- Local LLM support — defer until Anthropic/OpenAI quality bar is validated as the correct constraint

**Explicit anti-features (never build):**
- Vision-only verification as a primary mechanism in v1 (`ViewCapture.CaptureToBitmap`) — known Metal timing risk on macOS; keep deterministic verification as baseline and treat vision as Phase 7 augmentation
- MCP as primary execution mechanism — protocol overhead accumulates; keep for Claude Desktop interop only
- Multi-document simultaneous sessions in v1 — macOS `ActiveDocumentChanged` event ordering adds cross-document risk
- Auto-execute without confirmation on destructive operations — automation bias causes unrecoverable CAD state

### Architecture Approach

The system splits into two OS processes communicating over a localhost WebSocket discovered from `~/.kargadan/port`: the Node.js harness runs the Effect agent loop and all LLM orchestration; the C# Rhino plugin executes commands against RhinoCommon inside the Rhino process. This two-process design is the only viable approach on macOS (Rhino.Inside is Windows-only; confirmed by RhinoMCP community). The harness architecture itself uses a two-layer loop: `AgentLoop` (apps/kargadan — protocol state machine: PLAN→EXECUTE→VERIFY→PERSIST→DECIDE) delegates to `AiService.runAgentCore` (packages/ai — generic LLM conversation cycle). This separation keeps generic AI orchestration reusable while bounding Kargadan-specific protocol in the app.

**Major components:**
1. **Plugin WebSocket host + handshake** (C# net9.0) — existing and active; handshake now carries capability + catalog payload.
2. **RhinoDoc Command Executor** (C#) — existing `RunScript` + direct RhinoCommon routes + undo wrapping.
3. **KargadanSocketClient** (TypeScript) — existing Effect WebSocket client with pending-map correlation and command ack/result sequencing guard.
4. **AgentLoop** (TypeScript) — existing PLAN→EXECUTE→VERIFY→PERSIST→DECIDE loop, rewired through generic `packages/ai` rails.
5. **AiService Agent Core Rails** (`packages/ai`) — in progress; generic stage orchestration + high-order toolkit builders are implemented.
6. **PostgreSQL Session Store** — existing RunEvent/RunSnapshot/session hydration with checkpoint sequence selection.
7. **pgvector Knowledge Base** — existing schema + seed pipeline; harness now seeds from plugin handshake catalog first.
8. **CLI Surface** — pending; forward policy is `@effect/cli`.

### Critical Pitfalls

1. **Missing `InvokeOnUiThread` on every RhinoDoc write path** — macOS enforces strict UI-thread access; any off-thread mutation throws `NSException` non-deterministically (99.999% pass rate on Windows, crash on macOS). Prevention: establish a code-review rule that no RhinoDoc mutation exists outside `InvokeOnUiThread` in the plugin. Verify with 100 rapid write commands on macOS Apple Silicon before any other integration testing.

2. **Plugin/runtime TFM drift** — Rhino 9 WIP runs .NET 9 (`NetCoreVersion=v9`); mismatched targets fail with `TypeLoadException`. Current project policy is `net9.0` single-target.

3. **Context window exhaustion without compaction** — a single Rhino scene read can consume 2,000-5,000 tokens; 10-15 tool calls saturate 200K context. Models degrade after 32-64K tokens of context (Databricks finding). Prevention: implement tokenizer gate at 75% trigger with observation masking before any extended session testing.

4. **Undo records broken outside Rhino command scope** — `AddCustomUndoEvent` called from the WebSocket handler (not a `RunCommand` context) silently does nothing without explicit `BeginUndoRecord`/`EndUndoRecord` brackets. Prevention: every document mutation path must explicitly bracket undo records. Verify with 3-write + 3-Cmd+Z integration test on macOS.

5. **Schema drift across the polyglot WebSocket boundary** — TypeScript `@effect/schema` and C# `ProtocolEnvelopes` evolve independently; new fields silently drop at decode. Prevention: designate one side as authoritative (C# `ProtocolEnvelopes.cs`) and generate a canonical JSON Schema spec validated by CI on both sides.

---

## Implications for Roadmap

Canonical phase sequencing is tracked in `.planning/ROADMAP.md`.

Current roadmap implications (2026-03-03):
- Phases 1-4 are complete (transport, execution, schema topology, persistence foundations).
- Phase 5 code implementation is complete (catalog handshake path, harness ingestion/seeding, NL planning over RAG catalog search, typed agent-core rails, chat checkpoint roundtrip, provider override/fallback support); manual Rhino smoke sign-off remains before close.
- Phase 6/7/8 remain pending and are still gated by Phase 5 close.

Research carry-forward flags for upcoming phases:
- Phase 6: re-verify Anthropic Tool Search Tool contract at implementation start.
- Phase 7: re-verify `@effect/workflow` stability before durable workflow implementation.
- Phase 8: execute CLI surface through `@effect/cli` policy (not Ink).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Fully grounded in existing workspace catalog (`pnpm-workspace.yaml`) and current codebase (`packages/ai/src/runtime.ts`, `apps/kargadan/harness/src/`). CLI policy is `@effect/cli`; no extra runtime dependency is required. |
| Features | MEDIUM-HIGH | AI agent patterns (Claude Code, aider) are HIGH confidence. Rhino-specific AI agent patterns are MEDIUM — RhinoMCP is the primary reference and it is experimental with no production deployment data. Feature prioritization is based on analogical reasoning from coding agents. |
| Architecture | HIGH | Grounded in existing codebase (agent-loop.ts, harness.ts, socket.ts, KargadanPlugin.cs, SessionHost.cs), validated prior Rhino research (Rhino-Research1.md, Rhino-Research2.md), and official Effect AI documentation. Two-process WebSocket bridge validated by RhinoMCP community on macOS. |
| Pitfalls | MEDIUM-HIGH | macOS/RhinoCommon pitfalls from official McNeel documentation and forums (HIGH). AI agent pitfalls from Anthropic engineering blog (HIGH). Tool Search Tool accuracy data from independent Arcade.dev benchmark (MEDIUM — single study, 4,027 tool catalog). |

**Overall confidence:** HIGH

### Gaps to Address

- **Tool Search Tool production accuracy at Rhino catalog scale**: independent testing shows 56-64% accuracy at 4,027-tool catalogs. The Rhino command catalog is smaller (~300 commands) but CAD vocabulary mismatch (e.g., "fillet" vs "round edge") may produce similar failure rates. Mitigation: alias enrichment strategy during Phase 4 seeding + hybrid trigram fallback. Validate with a 50-query evaluation set before enabling in production.

- **`@effect/workflow` alpha stability timeline**: the library is alpha as of 2026-01-02. Phase 7 depends on it stabilizing before implementation. Mitigation: the existing PLAN→EXECUTE retry/compensation pattern in `apps/kargadan/harness/src/runtime/agent-loop.ts` covers single-step failure recovery and is an acceptable fallback if `@effect/workflow` remains alpha through Phases 1-6.

- **macOS event ordering edge cases with multiple documents**: the research explicitly flags multi-document scenarios as risky (v1 defers multi-document sessions for this reason). Single-document-per-session constraint removes most of the risk, but the document-identity resolution flow in Phase 2 should be tested with file open/close/reopen sequences on macOS before assuming correctness.

- **Rhino command knowledge base curation effort**: seeding infrastructure is implemented, but retrieval quality still depends on curated Rhino command descriptions/aliases/examples. Treat this as a Phase 5/6 quality-hardening track, not a Phase 4 blocker.

---

## Sources

### Primary (HIGH confidence)
- `pnpm-workspace.yaml` workspace catalog — all pinned versions verified from source
- `packages/ai/src/runtime.ts` — AiRuntime imports Chat, EmbeddingModel, LanguageModel from `@effect/ai`; confirms existing integration shape
- `apps/kargadan/harness/src/harness.ts` — ReconnectionSupervisor, AgentLoop, CommandDispatch, AgentPersistenceService wiring confirmed
- `.planning/PROJECT.md` — platform constraints, out-of-scope decisions, existing codebase map; canonical project source
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
- [Arcade.dev: Tool Search 4,027-tool benchmark](https://arcade.dev/blog/anthropic-tool-search-claude-mcp-runtime) — 60%/64% accuracy data; failure case examples
- NeurIPS DL4C 2025 observation masking finding (arxiv:2508.21433) — observation masking equals LLM summarization accuracy at half the cost
- Aider Architect/Editor 85% SWE-bench result — two-model planning/execution split pattern

### Tertiary (LOW confidence)
- [pgvector production patterns](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) — hybrid vector + BM25 search patterns; multiple sources agree but specific Rhino vocabulary matching is unvalidated
- CAD AI agent landscape surveys (mecagent.com, myarchitectai.com 2025/2026) — market context only; no direct technical validation

---
*Research completed: 2026-02-22*
*Ready for roadmap: yes*
