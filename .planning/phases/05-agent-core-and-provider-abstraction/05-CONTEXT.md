# Phase 5: Agent Core and Provider Abstraction - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The agent accepts natural language input, discovers relevant Rhino commands via RAG over a real command catalog extracted from the bridge, generates and executes tool calls through the bridge, and works across multiple AI providers.

Phase 4 delivered the infrastructure (CommandManifest decode schema, KBSeeder write pipeline, PersistenceService). Phase 5 wires the data source (bridge catalog export), the embed function (OpenAI), the agent loop (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE), and the provider abstraction (Anthropic + OpenAI + Google).

</domain>

<decisions>
## Implementation Decisions

### Command catalog pipeline
- Bridge plugin enumerates ALL Rhino commands via SDK on load, sends full catalog JSON as a protocol message after WebSocket handshake
- Harness decodes via `CommandManifest.decode()` and seeds via `KBSeeder.seed(manifest, embed)` on every connection
- No version tracking or change detection -- always re-seed, rely on ON CONFLICT idempotency (already implemented in seeder)
- Full Rhino command list, not a curated subset -- let RAG ranking handle relevance
- First connection seeds embeddings via OpenAI API; subsequent connections re-upsert documents but skip embedding if hash unchanged (seeder's existing hash comparison)

### Agent loop behavior
- Plan-then-confirm: agent plans the full operation, shows the plan, waits for user approval before executing any writes. Reads execute freely without approval.
- On failure: DO NOT retry blindly. Failure means the agent got the approach wrong. Read the API docs, examine the document state, understand what went wrong, then correct the approach.
- Always undo the failed attempt before trying the corrected approach -- clean slate each time. Undo is atomic per tool call (one BeginUndoRecord/EndUndoRecord per command), not batch rollback.
- Maximum 2 correction cycles: original attempt + 2 corrections = 3 total tries. If still failing after reading docs and adjusting twice, surface to user with what was tried and what went wrong.
- Each tool call is its own undo record -- no batching of multiple commands into one undo. This ensures corrections undo precisely what failed, not the entire sequence.

### Tool generation from manifest
- Mechanical conversion: a pure function maps CommandManifestEntry params (Point3d, number, string, ObjectId[]) to Effect Schema types automatically. ManifestEntry -> Tool.make call.
- isDestructive field in CommandManifestEntrySchema is the source of truth for undo wrapping. Plugin marks destructive commands. Agent wraps undo accordingly.
- RAG selects tools per-turn: full catalog is embedded in pgvector. Each turn, agent queries with user intent. Only top-K relevant commands become active tools for that turn. Context-efficient -- no flooding LLM with hundreds of tool definitions.
- One tool call per Rhino command per step. No batching related commands into single tool calls. Atomic, debuggable, clean undo.

### Provider and model selection
- All three providers at launch: Anthropic, OpenAI, Google. Full provider matrix from day one.
- Embedding API: OpenAI text-embedding-3-small (1536 dimensions, already configured in seeder). Fixed regardless of which LLM provider is selected for inference.
- Chat history: wire Chat.exportJson/Chat.fromJson into PersistenceService -- replace the Phase 4 empty-string chatJson placeholder with real serialized conversation data.

### Claude's Discretion
- Top-K value for RAG tool selection (how many commands per turn)
- Exact Schema type mapping for Rhino param types (Point3d -> S.Struct vs S.Tuple etc.)
- Provider fallback chain ordering and retry semantics
- How the plan is presented to the user before confirmation (format, detail level)
- Context window budget allocation between tools, conversation history, and scene context

</decisions>

<specifics>
## Specific Ideas

- Failure handling philosophy: "failed execution is real, not something retry can fix" -- the agent must investigate and correct, not just try again
- Undo granularity: "we need atomic actions, not batching actions, so undo is cleaner, not huge resets"
- The manifest schema is dual-purpose: feeds both KB embedding (pgvector search) and Tool.make definitions (agent tool calls)
- hashCanonicalState currently lives in persistence/checkpoint.ts but is used by knowledge/seeder.ts -- cross-concern dependency to resolve during this phase

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 05-agent-core-and-provider-abstraction*
*Context gathered: 2026-02-23*
