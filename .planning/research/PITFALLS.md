# Pitfalls Research

**Domain:** CLI-based AI agent controlling Rhino 9 on macOS (brownfield Effect/TypeScript + C# monorepo)
**Researched:** 2026-02-22
**Confidence:** MEDIUM-HIGH — macOS/RhinoCommon pitfalls from official McNeel documentation and forums; AI agent pitfalls from Anthropic engineering blog and verified community sources; Tool Search Tool limitations from independent benchmark data (Arcade.dev)

---

## Critical Pitfalls

### Pitfall 1: Missing InvokeOnUiThread on Every RhinoDoc Write Path

**What goes wrong:**
Any document mutation that arrives on the WebSocket background thread and is not marshaled through `RhinoApp.InvokeOnUiThread` causes an `NSException` and immediate crash on macOS. On Windows the same call silently succeeds roughly 99.999% of the time, making this a macOS-exclusive silent killer that only surfaces in production.

**Why it happens:**
macOS AppKit enforces strict UI-thread access rules. NSView and its underlying framework throw immediately on background-thread access. Developers test on Windows, ship to macOS, and discover the race condition only after real usage. The official McNeel forum warns this "has the effect of working 99.999% of the time and giving random crashes the remaining 0.001%" — the non-deterministic nature makes it easy to miss in integration tests.

**How to avoid:**
Every handler inside the WebSocket receiver (`SessionHost`, command router, event publisher) that touches `RhinoDoc`, `RhinoApp.ActiveDoc`, or any geometry table must be wrapped with `RhinoApp.InvokeOnUiThread(() => { ... })`. Geometry-only computations using `Rhino.Geometry.*` are thread-safe and do not require marshaling. Establish a code-review checklist item: no raw RhinoDoc mutation outside InvokeOnUiThread in the plugin boundary layer.

**Warning signs:**
- Tests pass on CI (Windows runner) but crash on macOS Apple Silicon in manual smoke tests
- Crash logs showing `NSException` in call stacks originating from background threads
- Intermittent hangs rather than consistent failures (classic thread-safety non-determinism)

**Phase to address:** Plugin transport layer implementation — before any RhinoDoc write path is wired up.

---

### Pitfall 2: net10.0 TFM Targeting Rhino 9 WIP

**What goes wrong:**
The current plugin `csproj` targets `net10.0`. Rhino 9 WIP runs `.NET 9` (`NetCoreVersion=v9`). A `net10.0` binary will either fail to load at all or produce a cryptic `TypeLoadException` at runtime. Rhino 8 runs `.NET 7/8`. Both are broken by the current target.

**Why it happens:**
The monorepo's `Directory.Build.props` defaults pushed toward `net10.0` to track bleeding-edge C#. The Rhino constraint was documented but not yet applied. It is easy to overlook the Rhino runtime pinning when everything else in the monorepo targets the latest framework.

**How to avoid:**
Change `<TargetFramework>net10.0</TargetFramework>` to `<TargetFrameworks>net8.0;net9.0</TargetFrameworks>` immediately — this is already a known required fix in `PROJECT.md`. Add a CI check that validates the plugin DLL loads against a Rhino 9 WIP headless runner to catch TFM regression.

**Warning signs:**
- Plugin fails to appear in `PlugIn Manager` after installation
- `TypeLoadException` or `BadImageFormatException` in Rhino console on load
- Plugin loads but all commands throw `MethodNotFound` exceptions

**Phase to address:** Plugin build infrastructure — first task before any Rhino API integration begins.

---

### Pitfall 3: Context Window Exhaustion Without Compaction

**What goes wrong:**
The agent accumulates conversation history, tool call results, and scene snapshots across a long CAD session. Without tokenizer-gated rolling summarization, context grows until the model's window is exceeded, the request is rejected, and the agent loop crashes or enters an unrecoverable error state. Even before hard exhaustion, models degrade significantly — attention diffuses across irrelevant earlier turns, tool selection accuracy drops, and the agent begins referencing stale scene state.

**Why it happens:**
Tool results from read operations (geometry queries, layer trees, object attributes) are verbose by nature. A single `read.scene` result can consume 2,000-5,000 tokens. Without active compaction, 10-15 tool calls saturate even a 200K context window in a non-trivial session. Teams underestimate the per-call token cost of structured CAD responses.

**How to avoid:**
Implement the planned tokenizer-gated compaction: trigger at 75% of the configured context budget, target 40% post-compaction. Preserve architectural decisions, unresolved errors, and current scene state in the compacted summary; discard redundant intermediate tool outputs. Implement Layer 0 compact scene summary (≤500 tokens always-present) and Layers 1-3 on-demand. Use observation masking (truncate tool output to a fixed byte limit) before passing to the model rather than summarizing via a second LLM call.

**Warning signs:**
- Session lengths above 20 exchanges start producing degraded tool selection
- The model references objects by stale identifiers or incorrect layer names from earlier in the session
- API errors with `context_length_exceeded` or equivalent after complex multi-step tasks

**Phase to address:** Context compaction implementation — before any extended session use case is tested.

---

### Pitfall 4: Tool Definition Bloat Degrading Tool Selection

**What goes wrong:**
As the tool surface grows (read tools, write tools, protocol tools, RAG search tools), loading all definitions upfront pollutes the context and degrades selection accuracy. Overlapping tool names or ambiguous descriptions cause the model to hesitate, select the wrong tool, or hallucinate tool parameters. The Anthropic engineering team documents this as one of the most common agent failure modes: "if a human engineer can't definitively say which tool should be used in a given situation, an AI agent can't be expected to do better."

**Why it happens:**
Developers add tools incrementally. Each tool seems reasonable in isolation. The cumulative context cost and ambiguity surface is invisible until the agent starts misbehaving with a real task. Schema verbosity compounds the problem — over-documented tool schemas consume context without adding signal.

**How to avoid:**
Bifurcate read tools (stateless, high-frequency) from write tools (validated, undo-wrapped) and load them in separate Toolkits with explicit use conditions in the system prompt. Use the Anthropic Tool Search Tool (`advanced-tool-use-2025-11-20` beta) with `defer_loading: true` for the Rhino command catalog (hundreds of commands) — this provides 85% token reduction for the command knowledge base. Keep non-search tools (protocol, read-scene, write-geometry) as always-loaded definitions. Maintain a 1:1 rule: if two tools can plausibly answer the same user request, merge or rename them before shipping.

**Warning signs:**
- Agent asks clarifying questions about which tool to use for an obvious operation
- Tool call error rate (wrong parameters, wrong tool name) increases above 5% across a test suite
- Repeated tool selection confusion in logs for semantically similar tools (e.g., `read.objects` vs `read.scene`)

**Phase to address:** packages/ai agent toolkit design — define Tool.make conventions and Toolkit composition rules before building the Rhino-specific tool surface.

---

### Pitfall 5: Tool Search Tool Reliability at 60% Retrieval Accuracy

**What goes wrong:**
Independent testing of the Anthropic Tool Search Tool with 4,027 tools showed 56% accuracy with regex search and 64% with BM25. Specific failures included "send an email" failing to surface `Gmail_SendEmail`, and "create a ticket" failing to surface `Zendesk_CreateTicket`. For Rhino command lookup, equivalent failures would be "create a box" failing to retrieve the `Box` command entry, causing the agent to hallucinate a command invocation or fall back incorrectly.

**Why it happens:**
The Tool Search Tool uses embedding-based retrieval. Tool names and descriptions may not be semantically similar enough to natural language task descriptions, especially for CAD domain vocabulary. The tool is also incompatible with few-shot tool use examples, removing a key accuracy lever.

**How to avoid:**
Enrich command knowledge base entries with multiple natural language aliases and task-oriented descriptions, not just the official command name. For example, the `Sphere` command entry should include "create a ball", "add a sphere", "make a round solid". Add a hybrid fallback: if Tool Search returns no result with confidence above a threshold, fall back to trigram search against command names. Monitor tool search hit rates in production logs and iteratively refine underperforming entries.

**Warning signs:**
- Agent regularly reports "no appropriate tool found" for commands that clearly exist in the catalog
- High rate of fallback to `RhinoApp.RunScript` with free-text command strings rather than retrieved command invocations
- Low cosine similarity scores in embedding retrieval logs (below 0.7 threshold)

**Phase to address:** Rhino command knowledge base seeding — alias enrichment must be part of the seeding strategy, not an afterthought.

---

### Pitfall 6: Undo Record Breaking Outside Command Scope

**What goes wrong:**
`AddCustomUndoEvent` called outside a Rhino command context (i.e., from the WebSocket handler that is not inside `RunCommand`) silently fails to register undo events unless explicitly bracketed with `RhinoDoc.BeginUndoRecord()` / `EndUndoRecord()`. The result: the user performs Cmd+Z expecting to undo the AI's action, nothing happens, and the document enters a state the agent cannot reconcile with its session history.

**Why it happens:**
The WebSocket command handler is not a Rhino command in the `ICommand` sense — it is invoked from a background listener. McNeel's documentation treats `BeginUndoRecord` as needed only for "modeless dialogs or plugin UI interactions" but the same applies to any non-command mutation path. Developers who test undo inside a `RunCommand` wrapper see it work and assume the pattern applies everywhere.

**How to avoid:**
Every document mutation from the WebSocket handler must be wrapped: `doc.BeginUndoRecord("kargadan:{undoScope}")` before mutations, `doc.EndUndoRecord(recordNumber)` after. The `undoScope` field on `CommandEnvelope` (already present in the protocol contracts) must be passed through to this wrapper. Verify undo chains with an integration test: issue 3 write commands, press Cmd+Z three times, confirm document returns to original state.

**Warning signs:**
- Undo operation does nothing after agent writes
- Undo chain skips AI-issued operations and reverts earlier manual edits instead
- `RhinoDoc.UndoRecordingEnabled` returns false at point of mutation (common if a previous `EndUndoRecord` was never called due to exception)

**Phase to address:** RhinoDoc command executor implementation — undo wrapping is a hard requirement, not a nice-to-have.

---

### Pitfall 7: macOS Event Ordering: ActiveDocumentChanged Fires Before Document Is Ready

**What goes wrong:**
On macOS, `ActiveDocumentChanged` fires before `EndOpenDocument`, meaning `RhinoDoc.Path` and `RhinoDoc.Name` are null when the event arrives. State machines that read document identity from `ActiveDocumentChanged` will silently receive null values, mis-identify the active document, and correlate subsequent events against the wrong session.

**Why it happens:**
The macOS Cocoa event system has a different ordering guarantee than Windows. McNeel have confirmed this behavior in their forums: "Under Mac Rhino the ActiveDoc can change while a command is running." Additionally, `RhinoDoc.Path` and `RhinoDoc.Name` remain null during both `ActiveDocumentChanged` and `EndOpenDocument` — they only become valid after the `Open` command ends.

**How to avoid:**
Do not read `RhinoDoc.Path` or `RhinoDoc.Name` in `ActiveDocumentChanged`. Instead, subscribe to `Command.EndCommand` and filter for `Open`-family commands to extract document identity. Use `DocumentOpenEventArgs.FileName` as a temporary identity during the opening window. Pass the `doc` parameter received in `RunCommand` rather than calling `RhinoDoc.ActiveDoc` directly to avoid re-reading a potentially-stale reference.

**Warning signs:**
- Session handshake fails with null document identity on first connection after a file open
- Agent correlates events against wrong document when multiple documents are opened in sequence
- Null reference exceptions in event handlers on macOS that work on Windows

**Phase to address:** RhinoDoc event subscription implementation — define the canonical document-identity resolution flow before wiring up any event handlers.

---

### Pitfall 8: Correction Loop Without Break Condition on Structured Errors

**What goes wrong:**
The current `handleDecision` implementation transitions to `Planning` state when `failureClass === 'correctable'` and `correctionCycles < correctionMax`. If the underlying Rhino command returns the same structured error every attempt (e.g., a geometry operation that fails due to degenerate input the LLM keeps regenerating), the loop exhausts `correctionMax` cycles against a structurally unsolvable problem, wastes tokens and time, and ends in `Failed` with no diagnostic breadcrumbs distinguishing "same error repeated" from "genuinely making progress."

**Why it happens:**
Correction loops assume the LLM will generate a different (better) command on each attempt. For CAD operations, the error may be geometric (self-intersecting surface, zero-area face) and the model may not have enough spatial context to produce a valid alternative without new scene information.

**How to avoid:**
Add error fingerprinting to the correction decision: if the same `error.code` + `error.message` hash recurs across two consecutive correction cycles, escalate the failure class to `fatal` and append the error sequence to the incident artifact. Include the last failing command and error in the next PLAN prompt so the LLM has explicit failure context. Cap correction cycles at 3, not higher.

**Warning signs:**
- Correction cycle counter hitting `correctionMax` on the same error code repeatedly
- Agent spending all retries on identical commands with no parameter variation
- Incident artifacts showing the same error code 3 times in sequence

**Phase to address:** Agent loop refinement — add error-fingerprint escalation when implementing the full LLM-driven PLAN stage.

---

### Pitfall 9: RAG Index Using Generic Embeddings for CAD Command Catalog

**What goes wrong:**
Generic embedding models (text-embedding-3-large, voyage-3) fail to capture CAD-specific semantic nuances. "Fillet" and "chamfer" are semantically distant in natural language but operationally similar in CAD context. "Sweep" in natural language suggests motion but in Rhino means a specific surface construction. Queries like "round off the edge" fail to retrieve `Fillet` because the embedding distance is too large.

**Why it happens:**
The packages/ai search service uses a general-purpose embedding model. CAD terminology is a narrow, specialized vocabulary. Generalist embeddings are trained on web text where CAD command names appear rarely and often in non-technical contexts.

**How to avoid:**
Enrich every command catalog entry with task-oriented natural language aliases as part of the knowledge base seeding phase. Example: `Fillet` entry includes "round edge", "smooth corner", "blend edges", "add radius to edge". This bridges the vocabulary gap without requiring a fine-tuned embedding model. Additionally, keep the existing trigram fallback path active for exact command name matches (RhinoApp command names like `_Box`, `_Sphere` are never paraphrased). Monitor retrieval precision with a test set of 50 natural language → expected command mappings before production seeding.

**Warning signs:**
- Agent frequently uses `RhinoApp.RunScript` with guessed command names instead of RAG-retrieved commands
- Cosine similarity scores for correct commands consistently below 0.65
- False positive retrievals (wrong command returned for clear queries) above 10% in evaluation runs

**Phase to address:** Rhino command knowledge base seeding — alias strategy must be defined before embedding generation.

---

### Pitfall 10: WebSocket Reconnection Without Session State Re-Sync

**What goes wrong:**
When the WebSocket connection drops (Rhino crash, macOS sleep/wake, network hiccup) and the harness reconnects, the `SessionSupervisor` phase resets to `idle` but the `AgentLoop` `LoopState` may be mid-execution (between EXECUTE and VERIFY). The reconnected session starts a new handshake, receives a new `sessionId`, and continues iterating the loop — but the C# plugin's `SessionHost` has no memory of the previous in-flight command. The result is a duplicate execution or a ghost command in the undo stack.

**Why it happens:**
The current `KargadanSocketClientLive` layer wraps a stateless socket. Reconnection creates a fresh `KargadanSocketClient` with an empty pending map and a new session. The agent loop's `Effect.iterate` drives state forward independently. Without explicit re-sync, the loop state and the plugin session state diverge.

**How to avoid:**
On reconnect, the harness must re-run the handshake and then check whether any command was in-flight (pending `Deferred` in the socket map at disconnect time). If a command was in-flight, issue a status query to the plugin to determine if it executed before the drop. Only then continue the loop. The PostgreSQL-backed session persistence (planned) solves this structurally — session resumption from checkpoint is the correct fix. Until that is implemented, treat any mid-execution disconnect as a `retryable` transport error and re-execute from the last persisted sequence number.

**Warning signs:**
- Duplicate geometry appearing in the document after reconnect
- Undo stack containing commands that appear twice
- Session IDs in loop trace events diverging from plugin session IDs in event payloads

**Phase to address:** Session resumption implementation — wire PostgreSQL checkpoint restore before enabling long-running sessions.

---

### Pitfall 11: Schema Proliferation Across Protocol Boundary

**What goes wrong:**
TypeScript `Kargadan.*` schemas and C# `ProtocolEnvelopes` / `ProtocolValueObjects` contracts evolve independently. A new field added to the C# `CommandEnvelope` record that is not reflected in the TypeScript `Kargadan.OutboundEnvelopeSchema` is silently dropped at decode. Conversely, a TS schema field with no C# counterpart causes a decode warning that is silently swallowed (the current `_dispatchChunk` logs a warning and continues). Over time, the two sides drift, and the contract between harness and plugin becomes ambiguous.

**Why it happens:**
There is no shared schema source-of-truth across the polyglot boundary. C# records and TS `@effect/schema` schemas are maintained separately. Developers add fields on one side to solve an immediate problem and forget to mirror them.

**How to avoid:**
Define a canonical protocol specification document (JSON Schema or OpenRPC) that both C# and TS schemas are validated against in CI. Alternatively, designate the C# `ProtocolEnvelopes.cs` as the authoritative side and generate TS types from it via a script. Add a protocol version negotiation test: any mismatch in `protocolVersion` during handshake must fail fast, not degrade silently.

**Warning signs:**
- `_dispatchChunk` warning log volume increasing over time
- Handshake succeeds but command results contain empty or null fields that were expected to be populated
- `Schema.decodeUnknown` failures increasing in harness logs after a C# plugin update

**Phase to address:** Protocol contract stabilization — address before adding any new fields to either side of the boundary.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory `PersistenceTrace` instead of PostgreSQL persistence | No DB dependency during early testing | Session state lost on harness crash; no resumption possible | MVP only — must migrate before any session > 30 min |
| Single TFM (`net9.0`) without `net8.0` multi-target | Simpler build | No Rhino 8 compatibility; blocks broader adoption | Acceptable for Rhino 9 WIP development phase |
| Hardcoded operations list in `HarnessConfig` | No LLM orchestration needed for testing loop | Cannot express user intent; loop is a fixture not an agent | Scaffolding only — must replace before any real agent run |
| Always-loaded tool definitions (no Tool Search) | No search latency on tool calls | Context bloat at ≥50 tools; selection accuracy degrades | Acceptable for ≤20 tools; mandatory threshold for full command catalog |
| Observation masking (truncate tool output) | Zero LLM cost for compaction | Loss of detail; may miss important error context in truncated tail | Acceptable for non-critical read operations; never for error responses |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `RhinoApp.RunScript` | Calling without `[CommandStyle(ScriptRunner)]` on the command class — RunScript silently does nothing | Add `[CommandStyle(ScriptRunner)]` to every plugin command class that should be invokable via RunScript |
| RhinoDoc undo | Calling `AddCustomUndoEvent` from WebSocket handler without `BeginUndoRecord` wrapper | Always wrap non-command mutations with `BeginUndoRecord` / `EndUndoRecord` |
| `RhinoDoc.ActiveDoc` | Reading `ActiveDoc` in event handlers on macOS — may change mid-command | Use the `doc` parameter passed directly to `RunCommand`; never re-read `ActiveDoc` in event handlers |
| Anthropic Tool Search Tool | Using it with tool-use examples (few-shot prompting) — API returns error | Tool Search Tool is incompatible with tool-use examples; use standard calling for few-shot scenarios |
| pgvector cosine search | Vector-only retrieval misses exact CAD command names (e.g., `_Box`, `_Extrude`) — rare tokens, low embedding signal | Hybrid search: cosine similarity for semantic queries + trigram index for exact command name lookup |
| WebSocket Layer composition | Creating `Socket.layerWebSocket` inside `Layer.unwrapEffect` without providing `Socket.layerWebSocketConstructorGlobal` | Always merge `layerWebSocketConstructorGlobal` with the socket layer as shown in current `KargadanSocketClientLive` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded `events` Queue in `KargadanSocketClient` | Memory growth on high-frequency RhinoDoc events (AddObject, ModifyAttributes) during large scene operations | Add backpressure or drain the queue on each loop iteration; debounce at 200ms on the C# side before publishing | Scenes with > 10K objects; batch import operations |
| Re-embedding entire command catalog on each knowledge base update | Nightly cron takes hours; stale embeddings serve queries during re-indexing window | Incremental embedding: only re-embed changed/new entries; use a versioned index with atomic swap | Catalog size above 1,000 entries |
| Session snapshot on every PERSIST step (SHA-256 of full trace) | Snapshot duration grows linearly with trace length | Cap snapshot at last N transitions; store delta snapshots rather than full state | Traces above 200 events |
| Serializing all pending Deferreds through a single Ref | Contention under concurrent tool calls | Already using `HashMap` under `Ref` — ensure no monolithic lock across write and read operations | Parallel tool use (multiple simultaneous tool invocations) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing the WebSocket listener on `0.0.0.0` instead of `127.0.0.1` | Any process on the LAN can send arbitrary Rhino commands — `RhinoApp.RunScript` executes arbitrary strings | Bind listener exclusively to `127.0.0.1`; enforce in `SessionHost` TCP listener setup |
| Passing LLM-generated strings directly to `RhinoApp.RunScript` without allowlist | Command injection: LLM prompted to run `_-Delete _All` or destructive macros | Validate every generated command string against a resolved catalog entry before execution; reject unrecognized commands |
| Logging full command payloads including user prompts | User prompt data (potentially sensitive design intent) leaks into telemetry | Redact `payload.userPrompt` in telemetry context; log operation type and result code only |
| Storing API keys in harness config file | Keys visible in monorepo if `.env` accidentally committed | Use Doppler for secrets; validate `.gitignore` includes all env files |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent tool call execution with no progress indication | User sees terminal idle for 30s during a complex multi-step operation; unclear if agent is working or hung | Stream progress events from each PLAN/EXECUTE/VERIFY stage to the CLI; show tool call name and arguments as they execute |
| Verification failure reported as generic error | User cannot understand why "create a box" failed; no actionable guidance | Include the specific Rhino error code and the next-attempt strategy in the CLI output |
| Correction retry invisible to user | Agent silently retries 3 times; user sees only final failure with no history | Display "Attempt 2/3: correcting — {brief reason}" during correction cycles |
| Context compaction happening mid-session | User asks about an object discussed earlier; agent responds "I don't have that in context" | Inform user when compaction occurs; preserve object references in the compacted summary even if prose is condensed |

---

## "Looks Done But Isn't" Checklist

- [ ] **Thread safety:** Every RhinoDoc write path passes through `InvokeOnUiThread` — verify by searching for `RhinoDoc` calls outside the UI thread marshal in the plugin source.
- [ ] **Undo integration:** Issue 3 write commands via harness, press Cmd+Z three times in Rhino, confirm the document returns to pre-agent state.
- [ ] **Context compaction:** Run a 40-turn session (simulated with fixture tool results), verify context never exceeds configured budget, verify compacted summary retains object references.
- [ ] **Tool Search fallback:** Disable Tool Search Tool and verify the agent degrades gracefully to full tool loading rather than crashing.
- [ ] **Reconnect recovery:** Kill the WebSocket listener mid-EXECUTE, reconnect, verify the command is not duplicated in the document.
- [ ] **Protocol version mismatch:** Change the harness `protocolVersion` to a mismatched value, verify handshake rejects with a clear error rather than proceeding silently.
- [ ] **RAG retrieval coverage:** Run 50 natural-language → expected-command test cases against the seeded knowledge base; verify ≥85% recall before enabling Tool Search integration.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| InvokeOnUiThread missing on one write path | MEDIUM | Audit all RhinoDoc call sites in plugin; add InvokeOnUiThread wrapper; test on macOS Apple Silicon specifically |
| net10.0 TFM blocking plugin load | LOW | Change TFM to `net8.0;net9.0` in csproj; rebuild; reinstall `.rhp` in Rhino Plugin Manager |
| Context window exhaustion mid-session | MEDIUM | Add tokenizer check before each PLAN step; truncate or summarize history to budget; restart session from PostgreSQL checkpoint once persistence is implemented |
| Tool Search Tool accuracy below threshold | MEDIUM | Add alias fields to all catalog entries; rerun embedding generation; retune search confidence threshold |
| Undo stack corruption | HIGH | Requires RhinoDoc reload from last `.3dm` save; all AI-issued operations since last save are lost; prevention is the only viable strategy |
| Schema boundary drift (TS vs C#) | HIGH | Requires versioned protocol negotiation or full re-sync; add field-level comparison test between schemas in CI before this becomes a production problem |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Missing InvokeOnUiThread (Pitfall 1) | Plugin transport layer | macOS Apple Silicon smoke test: 100 rapid write commands, zero crashes |
| net10.0 TFM (Pitfall 2) | Plugin build infrastructure | Plugin loads and all commands resolve in Rhino 9 WIP |
| Context window exhaustion (Pitfall 3) | Context compaction implementation | 40-turn fixture session never exceeds token budget |
| Tool definition bloat (Pitfall 4) | packages/ai agent toolkit design | Tool selection accuracy ≥92% on standard task set with full tool surface loaded |
| Tool Search 60% accuracy (Pitfall 5) | Knowledge base seeding with aliases | 50-query evaluation set achieves ≥85% recall before production use |
| Undo outside command scope (Pitfall 6) | RhinoDoc command executor | 3-write + 3-undo integration test passes on macOS |
| macOS event ordering (Pitfall 7) | RhinoDoc event subscription | Document identity resolution test: open 5 files in sequence, all correlate correctly |
| Correction loop without fingerprinting (Pitfall 8) | Agent loop LLM integration | Same-error repeated test: loop escalates to `fatal` after 2 identical errors |
| Generic embeddings for CAD (Pitfall 9) | Knowledge base seeding | 50-query precision/recall evaluation with alias-enriched entries |
| Reconnect without re-sync (Pitfall 10) | Session resumption (PostgreSQL) | Mid-EXECUTE disconnect test: no duplicate geometry after reconnect |
| Schema boundary drift (Pitfall 11) | Protocol contract stabilization | CI gate: JSON Schema validation of both C# and TS schemas against canonical spec |

---

## Sources

- [RhinoCommon Async Best Practices — McNeel Forum](https://discourse.mcneel.com/t/best-practices-for-rhino-plugin-development-wrt-async-operations/177773) — threading non-determinism on macOS confirmed by McNeel developer
- [RhinoDoc Event Timing — McNeel Forum](https://discourse.mcneel.com/t/rhinodoc-name-and-rhinodoc-path-after-which-event/73951) — `Path`/`Name` null in `ActiveDocumentChanged`; valid only after `Open` command ends
- [AddCustomUndoEvent Outside Commands — McNeel Forum](https://discourse.mcneel.com/t/can-addcustomundoevent-be-used-outside-of-a-rhino-command/141123) — `BeginUndoRecord`/`EndUndoRecord` required for non-command mutation paths
- [RhinoApp.InvokeOnUiThread API — developer.rhino3d.com](https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_RhinoApp_InvokeOnUiThread.htm) — official threading marshal API
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — tool bloat, compaction, sub-agent architecture patterns
- [Anthropic: Advanced Tool Use Introduction](https://www.anthropic.com/engineering/advanced-tool-use) — Tool Search Tool token reduction data (85%)
- [Anthropic Tool Search Tool — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — `defer_loading` API, few-shot incompatibility
- [Arcade.dev: Tool Search 4,000-Tool Test](https://arcade.dev/blog/anthropic-tool-search-claude-mcp-runtime) — 60%/64% accuracy at scale; specific failure cases documented
- [Glama: Context Bloat in MCP-Based Agents](https://glama.ai/blog/2025-12-16-what-is-context-bloat-in-mcp) — tool proliferation causing cognitive overload, performance degradation
- [23 RAG Pitfalls — nb-data.com](https://www.nb-data.com/p/23-rag-pitfalls-and-how-to-fix-them) — embedding model mismatch for domain-specific vocabulary, stale index patterns
- [WebSocket Reconnection Strategies — oneuptime.com](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view) — reconnection storm prevention, state management on reconnect
- [RhinoMCP — GitHub](https://github.com/jingcheng-chen/rhinomcp) — reference implementation validating localhost WebSocket on macOS

---
*Pitfalls research for: CLI-based AI agent controlling Rhino 9 on macOS*
*Researched: 2026-02-22*
