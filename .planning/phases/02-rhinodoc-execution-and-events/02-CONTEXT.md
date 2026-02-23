# Phase 2: RhinoDoc Execution and Events - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

The agent can execute arbitrary Rhino commands and direct RhinoCommon API calls inside Rhino, receive document change events as summarized batches, and undo any AI tool call atomically. This phase wires the execution and observation layer — the agent loop, tool definitions, and knowledge base are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Undo boundaries
- One tool call = one undo record — each discrete tool call (create, set material, move) gets its own `BeginUndoRecord`/`EndUndoRecord` pair
- Cmd+Z steps back through individual tool calls, not entire user instructions
- Agent state snapshots stored via `AddCustomUndoEvent` so undo/redo keeps agent's internal model consistent with the document
- When user presses Cmd+Z, plugin notifies the harness AND the agent updates its internal model to reflect the reversal
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
- Pass through raw Rhino error output — whatever Rhino reports (exception messages, command-line output) goes to the harness as-is
- All-or-nothing execution: if any sub-operation in a command fails, roll back everything and report failure — no partial success
- Configurable timeout: plugin enforces a timeout on command execution (default configurable) and cancels if exceeded
- Two-phase response: "command started" acknowledgment sent immediately, then final result (success or failure) when execution completes

### Claude's Discretion
- Whether read-only tool calls create undo records (or only writes)
- Concurrency model for user changes during agent mid-operation (interrupt vs queue)
- Default timeout value and cancellation mechanism based on Rhino's capabilities
- Event debounce window tuning (200ms baseline from requirements)
- Exact event summary format and drill-down protocol

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
