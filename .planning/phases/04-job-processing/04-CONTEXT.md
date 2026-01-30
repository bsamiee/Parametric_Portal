# Phase 4: Job Processing - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Jobs process via Entity mailbox with priority, deduplication, dead-letter handling, and batch efficiency. Single polymorphic `submit` handles all cases. Interface unchanged for existing callers. Gut + replace existing jobs.ts — old poll-based queue replaced with Entity dispatch.

</domain>

<decisions>
## Implementation Decisions

### Submission Behavior
- `submit()` returns job ID only (fire-and-forget pattern)
- Validation happens during processing, not on submit — invalid jobs go to DLQ with ParseError
- Duplicate submissions (via `dedupeKey`) silently return existing job ID
- Open job type model — any job type string + arbitrary payload; handlers register dynamically

### Failure Handling
- Retry/backoff patterns from `resilience.ts` — fully leverage existing infrastructure
- Failed jobs emit `JobFailed` event via EventBus (Phase 5 integration prepared now with explicit TODO comments)
- Validation failures (schema errors) skip retries — DLQ immediately with ParseError tag
- DLQ jobs are replayable — `replayJob(dlqId)` moves job back to queue preserving history

### Status and Visibility
- `status(jobId)` returns full state transition history (audit trail)
- Includes: all state transitions with timestamps, attempts, errors
- Single-job query only — no list/filter capability (keep interface minimal)
- Job history retained for 7 days after completion/failure
- Completed job results stored and queryable via `status().result`

### Batch Semantics
- All jobs in batch get shared `batchId` for correlation/tracing
- Per-job priority allowed — individual jobs can override batch default
- No batch size limit — memory pressure is caller's responsibility

### Claude's Discretion
- Batch atomicity semantics (all-or-nothing vs partial success)
- Priority scheduling implementation (weighted mailbox or external scheduler)
- DLQ table schema design
- Job result serialization format

</decisions>

<specifics>
## Specific Ideas

### Integration Requirements (Explicitly Requested)
- **Context.Request**: Job handlers receive full Context.Request from Phase 2 (cluster context, telemetry, user context)
- **MetricsService**: Extend existing MetricsService with job.* metrics (unified dashboard)
- **Database transactions**: Job system wraps handlers in transaction; auto-rollback on failure
- **Telemetry**: Job execution spans link to original submit request via traceId/spanId
- **resilience.ts**: Use existing retry/backoff patterns — do not reinvent

### Phase 5 Preparation
- Event emission infrastructure wired now (not placeholder)
- Explicit TODO comments marking Phase 5 EventBus integration points
- Code structured so Phase 5 just connects the wiring

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-job-processing*
*Context gathered: 2026-01-30*
