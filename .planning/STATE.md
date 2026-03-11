# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** The agent can execute any operation a human can perform in Rhino 9 through natural language, with reliable state persistence and verification — without hardcoding individual commands.
**Current focus:** Phase 7 - Verification and Durable Workflows (non-Grasshopper line)

## Current Position

Phase: 7 of 8 (Verification, Workflows, and Grasshopper)
Plan: Non-Grasshopper execution line integrated; live validation and closure evidence in progress
Status: Phase 07 non-GH implementation is in code (deterministic+visual verification, `view.capture`, single `@effect/workflow` write rail); live Rhino validation pending and `EXEC-06` remains deferred
Last activity: 2026-03-04 -- Phase 7 non-GH pass integrated (`view.capture` command route, deterministic-first verification evidence, workflow activity/compensation write execution, loop-state persistence enrichment, and live acceptance suite scaffolding)

Progress: [█████████░] 96.0%

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: ~12min
- Total execution time: ~1.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 2 | 57min | ~29min |
| 02 | 2 | 19min | ~10min |
| 03 | 2 | 13min | ~7min |
| 04 | 2 | 8min | ~4min |

**Recent Trend:**
- Last 5 plans: 03-01 (4min), 03-02 (9min), 04-01 (5min), 04-02 (3min)
- Trend: accelerating

*Updated after each plan completion*

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 45min | 3 tasks | 5 files |
| Phase 02 P01 | 8min | 2 tasks | 4 files |
| Phase 02 P02 | 11min | 2 tasks | 4 files |
| Phase 03 P01 | 4min | 2 tasks | 4 files |
| Phase 03 P02 | 9min | 2 tasks | 6 files |
| Phase 04 P01 | 5min | 2 tasks | 6 files |
| Phase 04 P02 | 3min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8-phase comprehensive build order derived from dependency chain -- transport before execution before persistence before agent core
- [Roadmap]: Schema redesign (Phase 3) placed after transport/execution but before persistence -- establishes clean topology before new features are built on top
- [Roadmap]: Phases 6, 7, 8 are independent after Phase 5 -- can execute in any order
- [01-02]: AgentPersistenceService composes checkpoint/tool-call/session persistence with PostgreSQL-backed chat hydration
- [01-02]: PgClient.layerConfig with explicit pool limits (5 connections, 30s idle, 10s connect) suitable for single-user CLI
- [01-02]: DisconnectedError propagated via catchTag in dispatch, mapped to CommandDispatchError('disconnected')
- [Phase 01]: Plugin TFM policy locked to `net9.0` single-target for Rhino 9 WIP
- [Phase 01]: MessageDispatcher delegate decouples WebSocketHost from KargadanPlugin -- enables isolated testing and future transport swaps
- [02-01]: Thinktecture ValueObject KeyMember accessor is non-public -- use implicit conversion operators (e.g., (string)scope) instead of .Value
- [02-01]: Suppression pragmas removed in plugin cutover; boundary exemptions retained only where Rhino/.NET callback signatures force imperative boundaries
- [02-01]: RhinoObject.NextRuntimeSerialNumber is static property (not on ObjectTable) -- used for new-object tracking across RunScript
- [02-01]: FindByLayer uses string overload directly instead of two-step FindByFullPath + index lookup
- [02-02]: RhinoObjectEventArgs lacks Document property -- used RhinoDoc.ActiveDoc for UndoActive/RedoActive detection
- [02-02]: DimensionStyleTableEventArgs does not exist in SDK -- used base EventArgs
- [02-02]: Event batch flush publishes through EventPublisher via boundary wiring instead of log-only callback
- [02-02]: Direct API object write routes execute through CommandExecutor (no `not yet implemented` stubs)
- [03-01]: Deleted centralized kargadan-schemas.ts barrel -- app-specific schemas must not live in packages/
- [03-01]: All literal types inlined into parent S.Struct -- no standalone S.Literal schemas at module level
- [03-01]: Persistence schemas private to checkpoint.ts -- consumed locally, not exported
- [03-01]: CommandAckSchema retained despite research deletion note -- member of OutboundEnvelopeSchema decoded by socket.ts
- [03-02]: Extracted 12 protocol schemas into protocol/schemas.ts -- biome noImportCycles detected bidirectional cycles between dispatch.ts <-> config.ts and dispatch.ts <-> socket.ts
- [03-02]: Narrowed _request parameter type via Extract -- CommandAckSchema lacks identity field, accessing envelope.identity was unsound on full union
- [03-02]: Inline EventBatchSummarySchema at decode site and RunStatus literal union in LoopState -- no module-level schema consts needed for single-use types
- [04-01]: PersistenceService replaces CheckpointService with atomic SqlClient.withTransaction for tool call + checkpoint writes
- [04-01]: KargadanMigratorLive uses separate kargadan_migrations table to avoid collision with platform migrations
- [04-01]: KargadanToolCall.createdAt uses Model.Generated (DB DEFAULT now()) not DateTimeInsertFromDate -- excludes from insert variant
- [05]: chatJson checkpoint persistence now uses runtime Chat serialize/deserialize roundtrip
- [04-02]: Deterministic UUID from command ID via SHA-256 namespace hashing -- `search_chunks.entity_id` requires UUID while catalog IDs are strings
- [04-02]: Embedding function injected as parameter to seed() -- keeps seeder decoupled from server-side AiRuntime dependencies
- [04-refactor]: Removed static sample manifest (16 hardcoded commands) -- real command data now comes from C# handshake catalog at runtime.
- [04-refactor]: No aliasing in catalog entry schema -- user decision, explicitly rejected
- [04-refactor]: `AiService.seedKnowledge` is wired into harness startup (handshake catalog first, env fallback only)
- [05]: Catalog source-of-truth is handshake ack payload from plugin; env manifest is fallback/dev metadata enrichment path only
- [05]: Command dispatch boundary accepts `commandId` + structured `args` (legacy `operation`/`payload` compatibility kept at boundary)
- [05]: C# protocol contracts remain canonical; TS schemas conform at decode boundaries
- [05]: TS boundary parity now explicitly covers command `telemetryContext`, optional `result` payload decode, and remote `_tag: "error"` handling
- [06]: PLAN stage requests `read.scene.summary` each cycle (when catalog-supported) and carries masked scene/observation context through loop state
- [06]: Context compaction is tokenizer-gated with configurable thresholds (`KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT` default 75, `KARGADAN_CONTEXT_COMPACTION_TARGET_PERCENT` default 40)
- [06]: Progressive read controls (`detail`, `includeHidden`, `limit`) are normalized in planner args and validated in plugin read handlers
- [06]: Architect model override is independently configurable via `KARGADAN_AI_ARCHITECT_PROVIDER`, `KARGADAN_AI_ARCHITECT_MODEL`, and `KARGADAN_AI_ARCHITECT_FALLBACK`
- [06]: Discovery keeps pgvector default; Anthropic tool-search path is provider-scoped and optional
- [07]: Verification authority is deterministic; visual (`view.capture`) evidence is optional and augmenting only
- [07]: Write-path durability now uses a single `@effect/workflow` execution rail with compensation hooks; duplicated ad-hoc rail removed
- [07]: Non-Grasshopper scope is explicit for this execution line; `EXEC-06` remains pending by design

### Pending Todos

- [Phase 7 close]: Execute live protocol conformance smoke + non-GH Rhino validation and collect artifact bundle
- [Phase 5/6 close]: Final manual Rhino smoke sign-off remains required for historical closure consistency

### Blockers/Concerns

- [Phase 7 close]: Live Rhino acceptance evidence is not yet captured (`KARGADAN_LIVE_TESTS=1` path still pending operator run)
- [Phase 5/6 close]: End-to-end Rhino smoke across the combined Phase 5/6 path is still required before closeout can be marked complete
- [Phase 6 follow-up]: Anthropic provider tool-search path is feature-gated/unavailable at runtime; command discovery currently degrades to pgvector fallback ranking
- [Phase 7 split]: Grasshopper requirement (`EXEC-06`) is intentionally deferred in this execution line

### Phase 7 Live Runbook (Non-GH)

**Prerequisites**
- Rhino 9 WIP running with the Kargadan plugin loaded (`net9.0` build)
- Local PostgreSQL reachable via `KARGADAN_CHECKPOINT_DATABASE_URL`
- Harness environment configured with valid session token/capabilities
- Optional vision provider credentials if visual hint generation is enabled

**Execution Steps**
1. Run protocol conformance smoke with live gate enabled: `KARGADAN_LIVE_TESTS=1 pnpm exec vitest run tests/integration/kargadan/phase7-live.spec.ts`
2. Run non-GH validation matrix: plugin restore/build, harness typecheck/check/test, package type/lint checks, global `pnpm quality`, `pnpm dotnet`, `pnpm python`
3. Execute one manual Rhino session: handshake/catalog ingest -> write command -> Cmd+Z undo -> optional `view.capture` -> reconnect/resume checkpoint

**Expected Artifacts Per Session**
- Harness logs (PLAN/EXECUTE/VERIFY/DECIDE transitions + workflow execution ids)
- Plugin logs (command execution + undo/compensation traces)
- WebSocket transcript (handshake/ack/result/event envelopes)
- PostgreSQL journal rows (checkpoint + tool-call continuity)

### Phase 5 Resolved Questions

1. **Command catalog extraction**: Plugin publishes catalog from canonical command routes in handshake ack payload.
2. **When seeding happens**: Harness seeds from handshake catalog at connection time with marker-hash guard; env manifest is fallback/dev override.
3. **Embed function source**: Knowledge seeding path uses runtime embedding provider through `AiRuntime.embed`.
4. **Chat persistence shape**: `Chat.exportJson`/`Chat.fromJson` roundtrip is wired through checkpoint persistence.
5. **Tool boundary shape**: High-order `command.execute` path uses catalog `commandId` + structured `args` (no raw string tool interface).

## Session Continuity

Last session: 2026-03-04
Stopped at: Phase 7 non-GH code integration complete with automated validation gates green; pending live Rhino acceptance evidence
Resume file: Phase 7 live acceptance run + Phase 5/6 historical smoke closure + `EXEC-06` planning
