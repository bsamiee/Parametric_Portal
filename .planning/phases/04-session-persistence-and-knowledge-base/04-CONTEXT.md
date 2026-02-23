# Phase 4: Session Persistence and Knowledge Base - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Agent sessions are durable across harness restarts via PostgreSQL-backed checkpoints, and the Rhino command catalog is searchable via pgvector semantic similarity. Conversation history, run events, snapshots, and tool call results persist durably. Past sessions are listable and their execution traces replayable for developer debugging.

</domain>

<decisions>
## Implementation Decisions

### Checkpoint granularity
- Every tool call triggers a checkpoint save to PostgreSQL (maximum durability -- resume from exact last tool call)
- Full snapshot per checkpoint: complete loop state + chat history + active context serialized each time (no delta reconstruction on resume)
- Existing in-memory PersistenceTrace is kept as a write-through cache -- fast reads during active sessions, every write also goes to PostgreSQL, restart hydrates from PostgreSQL
- Tool call logging and checkpoint snapshot update happen in the same PostgreSQL transaction -- atomic consistency guaranteed

### Session replay depth
- Primary audience is developer debugging (full technical detail for diagnosing failures)
- Past sessions listed as a structured table: session ID, start/end time, status (completed/failed/interrupted), tool call count, run ID, error summary if failed -- filterable by status and date range
- Replay trace depth: tool calls with params/result/duration plus loop state transitions -- excludes raw LLM request/response payloads
- Session data persists indefinitely -- no time-based retention policy

### Knowledge base seeding
- Extraction pipeline: pull command definitions from C# Rhino plugin source/API, transform into a structured static manifest (JSON/YAML), then identify additional metadata fields the agent actually needs
- Metadata per command: parameters with types and defaults, natural language description, usage examples (aliases and related commands are not prioritized)
- Ranking: pure pgvector cosine similarity -- closest embedding wins, no usage frequency boosting
- Embedding model: external API (OpenAI or similar) -- leverages existing AI service infrastructure

### Restart recovery UX
- Silent resume: harness detects checkpoint, hydrates state, continues where it left off -- no user prompt, logs record the resume
- No staleness limit: always resume from last checkpoint regardless of age -- user explicitly starts a new session if they want fresh state
- Corruption fallback: log the corruption, start a fresh session, preserve corrupted data for debugging -- no halt or user prompt
- Always resume the most recent session -- past sessions are read-only for replay, not selectable for resume

### Claude's Discretion
- PostgreSQL table schema design for checkpoints, tool call logs, and session metadata
- Embedding dimension and model selection (within the external API constraint)
- Batch size and concurrency for knowledge base seeding
- Exact pgvector index type (IVFFlat vs HNSW) and tuning parameters

</decisions>

<specifics>
## Specific Ideas

- The command manifest should be derived from real source data (C# plugin or Rhino API), not hand-curated -- the extraction pipeline is part of the deliverable
- Manifest structure should be extensible for future metadata fields as agent usage patterns reveal what's needed

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 04-session-persistence-and-knowledge-base*
*Context gathered: 2026-02-23*
