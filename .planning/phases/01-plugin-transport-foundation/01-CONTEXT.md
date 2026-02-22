# Phase 1: Plugin Transport Foundation - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

WebSocket bridge between the CLI harness (TypeScript/Effect) and the Rhino 9 plugin (C#/.NET 9) on localhost. Reliable, reconnectable, typed message exchange with session checkpoint persistence. Command execution, events, agent logic, and CLI interface are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Protocol format
- JSON end-to-end as single wire format — harness, plugin, and DB all speak JSON. No mixed paradigms
- Tagged union message structure with `_tag` discriminator field — aligns with Effect `Schema.TaggedClass` on TS side and `[JsonPolymorphic]`/`[JsonDerivedType]` on C# side
- Both request-response (commands with `requestId` correlation) and push (events/heartbeat without `requestId`) message patterns — dispatched by `_tag`
- Protocol version negotiated once at connection handshake — harness declares version, plugin confirms or rejects. No per-message version field

### Connection lifecycle
- Dynamic port discovery via file — plugin picks an available port, writes it to a known file path, harness reads on connect
- Exponential backoff on disconnect — start fast (500ms), slow down exponentially (cap ~30s)
- Drop and notify during disconnection — reject outbound sends with immediate error, agent loop's DECIDE stage handles retry after reconnect

### Plugin loading
- Auto-start on Rhino launch via `PluginLoadTime.AtStartup` — WebSocket listener opens immediately on plugin load
- CLI setup command (`kargadan setup`) copies plugin DLL to Rhino's plugin folder and configures auto-load. One-time setup with confirmation
- Fully headless inside Rhino — no status bar, no tray icon, no visible UI. Status observable only from CLI harness
- **Rhino 9 only** — single `net9.0` target. No Rhino 8, no multi-target build. Overrides multi-target aspect of TRAN-02

### Session resilience
- Checkpoint scope: conversation history AND agent loop state (current stage). On reconnect, loop resumes where it was
- In-flight commands on disconnect: fail and report with disconnection error. No auto-retry (command may have partially executed)
- PostgreSQL checkpoint storage from Phase 1 — no intermediate local file mechanism. DB connection is a Phase 1 dependency
- Verify on reconnect — harness queries current scene state and compares to checkpoint. Flags divergence if user made manual changes during disconnect

### Claude's Discretion
- Heartbeat interval and staleness timeout calibration for localhost latency
- Exact exponential backoff parameters (initial delay, multiplier, cap)
- Port file location and format
- Handshake message schema details
- WebSocket frame size limits and chunking strategy for large payloads

</decisions>

<specifics>
## Specific Ideas

- User wants single paradigm: "no mixed paradigms" — JSON everywhere, tagged unions everywhere, one dispatch mechanism
- Plugin install should be dead simple: CLI command handles it, user just confirms
- "Drop Rhino 8 fully" — no compatibility concerns, no shims, net9.0 only
- Reconnect verification catches manual user edits during disconnect — agent should not operate on stale state assumptions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-plugin-transport-foundation*
*Context gathered: 2026-02-22*
