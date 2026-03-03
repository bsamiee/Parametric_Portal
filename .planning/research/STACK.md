# Stack Research

**Domain:** CLI-based AI agent orchestrating tool calls against Rhino 9 (CAD), with persistent sessions, RAG-backed tool discovery, and durable workflows
**Researched:** 2026-02-22
**Confidence:** HIGH (all core choices verified against existing workspace catalog + official sources)

---

## Context: This is a Brownfield Extension

The workspace catalog already pins the core stack. This research documents what is in use, validates each choice against 2025/2026 sources, flags corrections, and records forward policy choices (CLI via `@effect/cli`, plugin TFM `net9.0`).

---

## Recommended Stack

### Core Technologies

| Technology | Version (catalog) | Purpose | Why Recommended |
|------------|-------------------|---------|-----------------|
| `effect` | 3.19.19 | Effect monad runtime — concurrency, typed errors, dependency injection, streams | Single composition model for the entire harness; eliminates async/await + try/catch; `Effect.Service` + `Layer` replace DI containers. Note: Effect v4 entered public beta 2026-02-18 — do NOT migrate yet; 3.x is the stable line until v4 GA |
| `@effect/ai` | 0.33.2 | Tool.make (schema-driven tool definitions), Toolkit (composable collections), Chat (multi-turn with Ref-based history), LanguageModel (provider-agnostic inference), EmbeddingModel (RAG), Tokenizer (context budget gating), McpServer (interop) | Entire AI surface is Effect-native — tool calls, streaming, embeddings, budget, and telemetry all compose via Effect pipelines with no impedance mismatch. Verified: packages/ai already imports Chat, EmbeddingModel, LanguageModel, and Tool from this package |
| `@effect/ai-anthropic` | 0.23.0 | Claude provider with extended thinking, Tool Search Tool beta (`advanced-tool-use-2025-11-20`), parallel tool use, streaming | Primary inference provider. Extended thinking enables multi-step planning. Tool Search Tool delivers 85% token reduction on large tool catalogs (Anthropic engineering blog, verified) |
| `@effect/ai-openai` | 0.37.2 | OpenAI provider (GPT-4o, o3) | Fallback provider; packages/ai registry already supports multi-provider with fallback chains |
| `@effect/workflow` | 0.16.0 | Activity (execute-once with retry), withCompensation (rollback), DurableDeferred (human-in-the-loop pause gates), DurableClock.sleep (suspend without resource consumption) | Maps directly to undo-wrapped multi-step CAD writes: each `write.*` tool call becomes an Activity; failures trigger withCompensation; HITL approval before destructive operations uses DurableDeferred. npm confirms 0.16.0 published ~2 months ago |
| `@effect/platform-node` | 0.104.1 | Node.js platform bindings: WebSocket client (Socket.makeWebSocket), HTTP client, file system, process | makeWebSocket + Socket.runRaw are the native Effect primitives for the Rhino plugin bridge — harness already uses this for the WebSocket transport |
| `@effect/sql` + `@effect/sql-pg` | 0.49.0 / 0.50.3 | PostgreSQL client with Effect integration; underpins the packages/database repo factory | Session persistence, run event log, pgvector tool catalog — all go through the existing repo factory; no new DB client needed |
| TypeScript | 6.0.0-dev.20251125 | Language | Workspace-pinned dev build; enables `using`, `satisfies`, `as const`, const type parameters |
| `@effect/cli` | Policy canonical (Phase 8) | Effect-native CLI command routing, argument parsing, and help generation | Locks CLI surface to Effect-native composition and avoids extra React renderer dependency for this project line |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/ai-google` | 0.12.1 | Gemini provider | Architect/Editor model split: use Gemini Flash as the fast executor model to reduce cost during high-frequency execution turns |
| `@effect/experimental` | 0.58.0 | Machine (state machine), VariantSchema | Reconnection/session-state rails and protocol boundary schema composition in the harness |
| `@effect/opentelemetry` | 0.61.0 | OTEL-native telemetry; span propagation through Effect fibers | Traces tool calls, agent loop stages, WebSocket round-trips through Grafana Alloy without manual instrumentation |
| `@effect/rpc` | 0.73.2 | Type-safe RPC schemas — alternative to raw WebSocket JSON for protocol layer | Consider for replacing ad-hoc JSON envelope protocol if type-safety at protocol boundary becomes a maintenance issue |
| `@anthropic-ai/tokenizer` | 0.0.4 | Rough token counting for pre-flight budget checks | Only for pre-Claude-3 rough approximation; use `@anthropic-ai/sdk` `messages.countTokens()` for accurate counts against current models |
| `pgvector` (PostgreSQL extension, not npm) | 0.8.0+ | Semantic vector search for command knowledge base; already available in packages/database infra | Command discovery: embed Rhino command descriptions at seed time, retrieve top-K candidates per user intent. Hybrid search (pgvector cosine + pg_trgm trigram) is the existing fallback pattern in packages/ai search service |
| `@effect/cluster` | 0.56.4 | Distributed leader election, singleton jobs | DLQ watcher and session supervisor leader role — already wired in platform services layer |
| `vitest` | 4.0.18 | Unit/integration testing | All harness tests; `@effect/vitest` 0.27.0 provides `it.effect` for Effect-native test cases |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `pnpm exec nx run @parametric-portal/kargadan-harness:typecheck` | Typecheck harness TypeScript code | Never bare `nx`; always `pnpm exec nx` per CLAUDE.md |
| `npx @biomejs/biome check <files>` | Lint/format | Biome formatter disabled for TS sources (biome.json:168-186 override) — checks only, no formatting |
| `pnpm quality` | Full quality gate (typecheck + biome + knip + sherif) | Run before every commit |
| `dotnet build` | Build C# plugin | Must target `net9.0` for Rhino 9 WIP |
| `pnpm exec nx run-many -t test` | Run all package tests | Includes packages/ai tests |

---

## Installation

No additional stack dependency is required for Phase 5 closeout.  
Phase 8 should adopt `@effect/cli` as the canonical CLI surface per project policy.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `@effect/ai` + `@effect/ai-anthropic` | `@ai-sdk/anthropic` (Vercel AI SDK) | Vercel AI SDK uses async/await — incompatible with Effect composition model; requires bridging via `Effect.promise` everywhere. Effect-AI is schema-native, telemetry-native, and runs entirely in Effect fiber context. PROJECT.md explicitly bans Vercel AI SDK for this reason |
| `@effect/ai` + `@effect/ai-anthropic` | `@langchain/anthropic` | LangChain is Python-first with TypeScript port; heavy abstractions conflict with monorepo's functional-core philosophy; no Effect integration; banned in project constraints |
| `@effect/workflow` | Manual retry + compensation logic | @effect/workflow Activity semantics guarantee exactly-once execution with durable state; hand-rolling compensation for multi-step CAD operations is a rewrite risk (confirmed by PROJECT.md "Active" requirements list) |
| `@effect/cli` | `@clack/prompts` | clack is prompt-only flow and not a full command surface |
| `@effect/cli` | raw `readline` + ANSI codes | Hand-rolled rendering/dispatch has high maintenance overhead and weak type integration |
| `pgvector` (existing infra) | Pinecone / Qdrant / Weaviate | Adding a separate vector database violates the "single PostgreSQL infra" constraint. packages/database already has pgvector with semantic + trigram hybrid search wired (packages/ai search.ts). pgvector 0.8.0+ achieves 471 QPS at 99% recall on 50M vectors, sufficient for Rhino command catalog scale |
| Anthropic Tool Search Tool (`advanced-tool-use-2025-11-20`) | Loading all tool definitions upfront | Loading all Rhino commands upfront bloats every request. Tool Search Tool delivers 85% token reduction; accuracy improves from 49% to 74% (Opus 4) and 79.5% to 88.1% (Opus 4.5) per Anthropic engineering blog. Supported by `@effect/ai-anthropic` 0.23.0 |
| `@effect/ai-anthropic` Claude claude-opus-4 / claude-sonnet-4 | GPT-4o as primary model | Claude Sonnet 4.5 + Opus 4.5 are required for Tool Search Tool beta — OpenAI models do not support `advanced-tool-use-2025-11-20` header. Primary provider is Anthropic; OpenAI is fallback for non-tool-search paths |
| Two-process WebSocket bridge | MCP as primary execution mechanism | PROJECT.md explicitly records this decision: MCP adds initialize/negotiate/operate protocol overhead. MCP is retained in `@effect/ai` McpServer only for Claude Desktop/Cursor interoperability — not the core execution path. Community RhinoMCP projects validate the WebSocket bridge pattern on macOS |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@langchain/*` | Abstraction conflict; Python-first port; no Effect integration; heavy dependency surface | `@effect/ai` |
| `@ai-sdk/*` (Vercel) | async/await model; requires `Effect.promise` bridging everywhere; no Effect fiber tracing | `@effect/ai` |
| `Rhino.Inside` | Windows-only; confirmed unavailable on macOS arm64 | Two-process WebSocket bridge (validated by RhinoMCP community) |
| `Rhino.Compute` | Windows-only headless server; no macOS build | RhinoCommon via C# plugin in-process |
| `net10.0` as plugin TFM | Rhino 9 WIP confirmed running .NET 9 (`NetCoreVersion=v9`); .NET 10 unsupported | `net9.0` |
| Ink/React renderer surface for this project line | Conflicts with locked CLI policy and introduces extra rendering/runtime dependency | `@effect/cli` |
| `Effect v4` (currently beta) | Public beta as of 2026-02-18; breaking changes expected before GA; 3.x is stable | `effect` 3.19.19 |
| `@anthropic-ai/tokenizer` for modern models | Only accurate for pre-Claude-3 models; inaccurate for claude-sonnet-4/opus-4 | `@anthropic-ai/sdk` `messages.countTokens()` API |
| Separate vector database (Pinecone/Qdrant) | Adds operational complexity; packages/database already has pgvector with hybrid search | `pgvector` (existing infra) |
| `ViewCapture.CaptureToBitmap` as primary verification in v1 | Metal-specific capture timing issues on macOS; unreliable as the sole verifier for automated pipelines | Deterministic verification first (RhinoDoc state + geometry checks); viewport vision is a Phase 7 gated augmentation path |
| Grasshopper 2 API | GH2 is alpha with unstable programmatic API | GH1 C# SDK (stable) for parametric work |

---

## Stack Patterns by Variant

**For the Architect/Editor model split (planner vs executor):**
- Use `claude-opus-4` or `claude-sonnet-4-5` (via `@effect/ai-anthropic`) for PLAN + VERIFY stages — requires extended thinking for multi-step CAD reasoning
- Use `claude-haiku-4` or `gemini-flash` (via `@effect/ai-google`) for EXECUTE stage fast iterations — lower latency, lower cost
- Wire via `AiRegistry.layers(appSettings)` in packages/ai — the registry already supports per-tenant model selection with fallback chains

**For the CLI command surface (`@effect/cli` policy):**
- Use `@effect/cli` command/args/help composition as the canonical entry surface.
- Keep runtime streaming/progress output in Effect fibers; avoid bespoke CLI dispatch wrappers.
- Preserve plan-before-execute approval as a first-class command option, not ad-hoc prompt branching.

**For the RAG command discovery path:**
- Seed: embed Rhino command descriptions + parameter schemas using `AiRuntime.embed()` → pgvector table in packages/database
- Retrieve: hybrid search (pgvector cosine + pg_trgm) via packages/ai search service — already implemented, reuse directly
- Dynamic loading: pass retrieved tool definitions to Anthropic with `defer_loading: true` and enable Tool Search Tool header — Claude selects the 3-5 most relevant tools per turn without context bloat

**For durable multi-step CAD operations (write tools):**
- Each `write.*` tool call = one `Activity.make` — retried automatically on transient failures
- Wrap multi-activity sequences with `withCompensation` — failures trigger `RhinoDoc.Undo` via the plugin's undo scope
- Use `DurableDeferred` for destructive operations requiring human confirmation before execution

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@effect/ai@0.33.2` | `effect@3.19.19` | Same Effect-TS monorepo; patch version pinned. Do NOT mix with Effect v4 beta |
| `@effect/workflow@0.16.0` | `effect@3.19.19` | Same monorepo; same constraint |
| `@effect/ai-anthropic@0.23.0` | `@effect/ai@0.33.2` | Peer-versioned; upgrade together |
| `net9.0` plugin TFM | Rhino 9 WIP `NetCoreVersion=v9` | DO NOT use net10.0 — confirmed unsupported by Rhino 9 WIP runtime |
| `pgvector` 0.8.0+ | PostgreSQL 18.2 | pgvector 0.8.0 introduced HNSW indexing; production-ready for command catalog scale |

---

## Sources

- `pnpm-workspace.yaml` workspace catalog — all pinned versions verified from source (HIGH confidence)
- `packages/ai/src/runtime.ts` — AiRuntime already imports Chat, EmbeddingModel, LanguageModel from `@effect/ai`; verifies existing integration (HIGH confidence)
- `apps/kargadan/harness/src/harness.ts` — ReconnectionSupervisor, AgentLoop, CommandDispatch, AgentPersistenceService wiring verified (HIGH confidence)
- [Anthropic Tool Search Tool engineering blog](https://www.anthropic.com/engineering/advanced-tool-use) — 85% token reduction, accuracy gains verified (HIGH confidence)
- [Tool search tool API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — `advanced-tool-use-2025-11-20` beta, up to 10,000 tools, Sonnet 4.5 + Opus 4.5 required (HIGH confidence)
- [@effect/ai npm](https://www.npmjs.com/package/@effect/ai) — version 0.33.2 confirmed current, published ~1 month ago (MEDIUM confidence — npm 403 direct, confirmed via WebSearch)
- [@effect/workflow npm](https://www.npmjs.com/package/@effect/workflow) — version 0.16.0, published ~2 months ago, Activity + DurableDeferred + withCompensation confirmed (MEDIUM confidence)
- [Effect v4 beta announcement](https://effect.website/blog/releases/effect/40-beta/) — v4 public beta 2026-02-18; 3.x is still stable line (HIGH confidence)
- [effect npm, version 3.19.19 latest](https://www.npmjs.com/package/effect) — confirms 3.19.x is current stable (MEDIUM confidence — via WebSearch)
- [pgvector hybrid search production patterns](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) — BM25 + pgvector cosine RRF fusion, no external dependencies (MEDIUM confidence — multiple sources agree)
- [RhinoMCP community projects](https://github.com/jingcheng-chen/rhinomcp) — validates WebSocket bridge pattern on macOS; confirms no sandbox restrictions (MEDIUM confidence — open-source community implementations)
- [.planning/PROJECT.md](../PROJECT.md) — Platform constraints, out-of-scope decisions, existing codebase map (HIGH confidence — canonical project source)
- [apps/kargadan/Rhino-Research1.md](../../apps/kargadan/Rhino-Research1.md) + [Rhino-Research2.md](../../apps/kargadan/Rhino-Research2.md) — Architecture rationale, API surface, macOS constraints (HIGH confidence — bespoke project research)

---

*Stack research for: Kargadan AI Agent — Rhino 9 CLI orchestrator*
*Researched: 2026-02-22*
