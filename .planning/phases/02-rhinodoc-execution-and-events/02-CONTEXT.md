# Phase 2: RhinoDoc Execution and Events - Context

**Gathered:** 2026-02-22
**Refined:** 2026-02-22 (post-research — undo bifurcation, timeout semantics, error mechanics)
**Status:** Ready for planning

<domain>
## Phase Boundary

The agent can execute arbitrary Rhino commands and direct RhinoCommon API calls inside Rhino, receive document change events as summarized batches, and undo any AI tool call atomically. This phase wires the execution and observation layer — the agent loop, tool definitions, and knowledge base are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Undo boundaries
- One tool call = one undo record — Cmd+Z steps back through individual tool calls, not entire user instructions
- **Bifurcated undo strategy** (research constraint):
  - Direct API calls: wrapped in `BeginUndoRecord`/`EndUndoRecord` pair with `AddCustomUndoEvent` for agent state snapshots
  - RunScript calls: RunScript creates its own undo record internally — do NOT wrap in `BeginUndoRecord`/`EndUndoRecord` (McNeel confirms they conflict). Agent state snapshots for RunScript operations need an alternative mechanism (e.g., harness-side tracking keyed to undo serial number)
- `AddCustomUndoEvent` callback must re-register itself for redo support, and must NEVER modify RhinoDoc — only private plugin data
- When user presses Cmd+Z, plugin detects via `Command.UndoRedo` event and notifies the harness — agent updates its internal model to reflect the reversal
- Agent acknowledges undone actions proactively in its next response ("I see you undid the box creation")

### Event delivery
- Subscribe to ALL document change events: object add/delete/modify, layer changes, undo/redo, selection changes, material changes, view changes
- No distinction between agent-triggered and user-triggered events — all events processed uniformly regardless of source
- Events are consolidated into summarized batches — total count of events with tagged categories (e.g., "3 objects added, 1 layer changed"), not raw event dumps
- Agent can drill down into specific event categories on demand if it needs detail
- Prevents huge payloads: batch delivers counts and tags, not full geometry/attribute payloads

### Command dispatch
- API-first: prefer RhinoCommon API for typed inputs/outputs and precision; RunScript as escape hatch for commands without API equivalents
- RunScript commands echo to Rhino's command line — user sees what's being run (transparency)
- Support scripted input for interactive commands — agent can feed responses to mid-execution prompts (coordinates, selections)
- One command per WebSocket message — no batch sequences; aligns with per-tool-call undo boundaries

### Error feedback
- **Typed error passthrough** (research refinement): RunScript returns only a boolean (did Rhino attempt to run) — actual success/failure detected via `Command.EndCommand` event's `CommandResult` enum (Success, Cancel, Failure). Direct API calls return typed values (Guid.Empty, false, null). Harness receives the richest error signal each path provides.
- All-or-nothing execution: if any sub-operation in a command fails, roll back everything and report failure — no partial success. For direct API calls, rollback via `doc.Undo()` within the undo record. For RunScript, Rhino handles failure atomically.
- **Timeout = harness gives up, not command cancellation** (research constraint): McNeel confirmed no programmatic command cancellation exists. Timeout wraps `WaitAsync()` on the calling side — harness receives a timeout error, but the Rhino command may still be running. `SendKeystrokes` (Escape) is unreliable best-effort only.
- Two-phase response: "command started" acknowledgment sent immediately, then final result (success or failure) when execution completes

### Claude's Discretion
- Whether read-only tool calls create undo records (or only writes) — research recommends: no undo records for reads
- Concurrency model for user changes during agent mid-operation — research notes: Rhino's UI thread naturally serializes access, so user ops wait until agent's current tool call completes
- Default timeout values per command category (research suggests: reads 5s, writes 30s, geometric ops 120s)
- Event debounce window tuning (200ms baseline from requirements)
- Exact event summary format and drill-down protocol
- Agent state snapshot mechanism for RunScript-based operations (since AddCustomUndoEvent requires BeginUndoRecord, which RunScript can't use)

</decisions>

<specifics>
## Specific Ideas

- Event consolidation: "We need a way to properly consolidate all payloads to not have huge walls of info when many events happen, but a total count of events, events have tags so agent can investigate each portion if needed, but not overload the channel with noise"
- Undo transparency: agent should proactively tell the user when it detects its work was undone — keeps conversation grounded in actual document state

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-rhinodoc-execution-and-events*
*Context gathered: 2026-02-22*
