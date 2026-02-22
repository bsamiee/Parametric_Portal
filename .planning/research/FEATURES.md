# Feature Research

**Domain:** CLI-based AI agent controlling Rhino 9 via natural language (brownfield)
**Researched:** 2026-02-22
**Confidence:** MEDIUM-HIGH — ecosystem for AI coding agents is HIGH; Rhino-specific AI agent patterns are MEDIUM (limited production deployments; RhinoMCP is the primary reference and it is experimental)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Natural language command execution | Core value proposition — user types intent, agent executes Rhino commands. Without this the product has no reason to exist. | HIGH | `RhinoApp.RunScript` is the dynamic execution interface; agent must translate NL to Rhino command strings or RhinoCommon API calls. |
| Streaming progress output | Every CLI AI tool (Claude Code, aider, Cursor) shows what the agent is doing in real time. Silent terminals feel broken to users. | MEDIUM | AG-UI / SSE patterns for streaming tool calls are industry standard in 2025. Agent harness must emit progress events to terminal as each loop stage executes. |
| Plan-before-execute mode | Aider architect mode, GitHub Copilot plan mode, Claude Code — all production agents support showing the plan before executing. Users with destructive CAD operations need to review before commit. | MEDIUM | `PLAN` stage already exists in the loop state machine. The gate is surfacing the plan output to the terminal and waiting for y/n before the `EXECUTE` stage begins. Implemented via `DurableDeferred` approval gate in `@effect/workflow`. |
| Tool call visibility | Users must see which tools fired and with what arguments. Black-box execution erodes trust fast. | LOW | Print each tool call name + condensed args + result summary to terminal as they fire during `EXECUTE` stage. |
| Undo integration | Rhino users depend on Cmd+Z. An agent that breaks the undo stack is unusable for production design work. | HIGH | `BeginUndoRecord` / `EndUndoRecord` must wrap every logical AI action. `AddCustomUndoEvent` for agent state snapshots. Each `@effect/workflow` activity wraps exactly one undo record. |
| Session persistence and resumption | Claude Code stores history in `~/.claude/projects/`. Aider maintains conversation history per repo. Users expect to close and reopen without losing context. | HIGH | PostgreSQL-backed conversation history, run events, snapshots, tool call audit log — replacing the current in-memory `PersistenceTrace`. `Session resumption` restores from last PostgreSQL checkpoint. |
| Error messages with recovery suggestions | When the agent fails, users expect actionable next steps. Opaque "something went wrong" messages are unacceptable. | MEDIUM | Structured `FailureTaxonomy` already started. Map every failure class to a user-facing recovery hint at the terminal layer. |
| Scene state awareness | The agent must know what is in the document. Users assume the agent "sees" what they see. | MEDIUM | Layered scene representation: Layer 0 compact summary (~500 tokens always present), Layers 1-3 on-demand via read tools. Rhino event subscriptions keep state current. |
| Persistent sessions across Rhino restarts | Rhino crashes, Rhino updates, Rhino closes. The agent session must survive the plugin disconnecting and reconnecting. | HIGH | Session supervisor state machine already handles `idle/connected/authenticated/active/terminal` transitions. Resume path must restore context from PostgreSQL checkpoint when plugin reconnects. |
| Command discovery without memorization | Users cannot memorize hundreds of Rhino commands. An agent that only works when you name the exact command is not usable. | HIGH | RAG-backed Rhino command knowledge base (pgvector). Anthropic Tool Search Tool (`advanced-tool-use-2025-11-20`) with `defer_loading: true` for the command catalog — 85% token reduction vs upfront loading. |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Durable multi-step workflow execution | RhinoMCP and every MCP-based CAD agent loses state on failure. Kargadan retains state via `@effect/workflow` activities with compensation — a failed step rolls back the undo record and retries or escalates. No other Rhino AI tool does this. | HIGH | `@effect/workflow` `Activity.make` wraps each Rhino command group. `withCompensation` pairs each write activity with its undo. `DurableDeferred` gates human approval before irreversible operations (e.g., mesh destructuring, file export). |
| Architect/Editor model split | Aider benchmarks showed 85% SWE-bench pass rate using strong reasoning model for planning + fast model for execution. Applied to CAD: Opus/Sonnet 4 plans the geometry strategy, a faster model executes the command sequence. Users get better plans at lower cost. | MEDIUM | Already in PROJECT.md active scope. Architect model handles `PLAN` stage; Editor handles `EXECUTE` stage. Requires two concurrent `LanguageModel` providers wired in `packages/ai`. |
| Observation masking for context efficiency | NeurIPS DL4C 2025 (JetBrains Research) showed simple observation masking matches LLM summarization at half the cost. Tool output compaction via masking (hide verbose geometry dumps, show only changed-object summary) keeps context window lean without summarization overhead. | MEDIUM | Implement at the tool result layer: `RhinoDoc` event results return object count + bounding box summary, not full geometry data. Full data available via explicit read tool call. Proven approach, not research-grade. |
| RAG-backed dynamic command discovery | Current state of all Rhino AI tools: hardcoded command lists or naive prompt injection. Kargadan uses pgvector embedding + Anthropic Tool Search Tool to surface only the relevant commands for the current task. As Rhino adds commands, the catalog grows without code changes. | HIGH | Requires: (1) seeding Rhino command knowledge base with descriptions, parameters, examples; (2) nightly embedding cron (already exists in `packages/ai`); (3) Tool Search Tool integration via `advanced-tool-use-2025-11-20` beta. |
| Bifurcated read/write tool surface | Read tools (stateless, high-frequency, no undo overhead) vs write tools (validated, undo-wrapped, idempotent). Most CAD agents treat all tools the same — this causes undo stack pollution and unnecessary latency on reads. | MEDIUM | Read tools: get-layer-tree, get-object-attributes, get-bounding-box, get-curve-properties. Write tools: create-object, move-object, modify-attributes, delete-object — each validated and undo-wrapped. Schema-driven `Tool.make` from `@effect/ai`. |
| Layered context representation | Standard CAD AI tools dump the full scene state into the prompt, exhausting context immediately on complex documents. Kargadan's three-layer approach (compact summary always present, detail on-demand) preserves context budget for reasoning. | MEDIUM | Layer 0: object count by type, active layer name, document units. Layer 1: all object names and GUIDs with bounding boxes. Layer 2: full attribute data for specific objects (named explicitly). Layer 3: geometry data (only on explicit request). |
| Grasshopper 1 procedural automation | No production CLI agent integrates with Grasshopper's programmatic C# SDK. RhinoMCP has Python-based GH support but it is experimental and unreliable. Kargadan targets the stable GH1 C# SDK — enabling parametric design automation driven by NL intent. | HIGH | GH1 has stable `GrasshopperDocument`, `IGH_Component`, `GH_Canvas` APIs. Commands routed via the existing C# plugin. Defer to post-v1 unless early users explicitly request it. Blocked by: plugin WebSocket server completion. |
| Full audit trail and replay | Production AI tools that modify documents need a complete audit log. `@effect/workflow` activity log + PostgreSQL run events give a durable, queryable record of every agent action. Can replay a session to reproduce or debug. | MEDIUM | Already architected in the existing infra. Session run events + tool call audit log are part of the active scope. Differentiating because RhinoMCP has zero persistence. |
| Context compaction with configurable thresholds | Tokenizer-gated rolling summarization with 75% trigger / 40% target thresholds means long design sessions stay within context budget without surprising truncation. Claude Code implements this; no Rhino-specific tool does. | MEDIUM | Use `@effect/ai` `Tokenizer` for measurement. Implement rolling summarization using the same model that drives the session. Preserve: architectural decisions, unresolved errors, current active objects. Discard: verbose tool outputs already verified. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Vision-based verification (screenshot analysis) | "Let the AI see the viewport to verify results" — visually intuitive and compelling. | `ViewCapture.CaptureToBitmap` has confirmed Metal-specific capture timing issues on macOS (documented in PROJECT.md Out of Scope). Unreliable timing means false positives on verify — the agent thinks it succeeded when the viewport had not finished rendering. Deferred explicitly. | Verify via `RhinoDoc` event data: object exists, has expected GUID, bounding box is within tolerance. Deterministic, not screenshot-dependent. |
| MCP as primary execution mechanism | MCP is the "standard" and Claude Desktop / Cursor use it. Seems natural to use for Kargadan too. | MCP adds protocol overhead (initialize/negotiate/operate round-trips) on every command execution. For an interactive agent loop executing dozens of commands in a session, this overhead accumulates. The native typed tool call path via `@effect/ai` is the reliability substrate. | Keep MCP in `packages/ai` for interoperability with Claude Desktop/Cursor. Kargadan's core execution path uses native typed tool calls. Users who want MCP can use the MCP layer. |
| Real-time parametric dragging | "Control geometry handles in real time via NL prompts." Sounds like a compelling demo. | 200ms debounce latency in the event system is incompatible with real-time feedback. WebSocket round-trip + LLM inference latency makes this feel broken. Users would get stuck waiting for inference on every drag tick. | Deterministic Grasshopper or Rhino parameter sliders for real-time feedback. The agent sets parameters; the user adjusts with Rhino native UI. Defer real-time loop to future transport optimization. |
| Multi-document simultaneous sessions | Power users manage multiple Rhino documents and want the agent to work across all of them. | macOS `ActiveDocumentChanged` fires before some open/new events — event ordering differs from Windows. Cross-document state management requires careful event sequencing research specific to macOS that adds significant risk to v1. | Single active document per session for v1. Document switching is user-driven: close one session, open another. Add multi-document after macOS event ordering is fully characterized. |
| Inline chat in Rhino viewport / GUI panel | A GUI panel inside Rhino for the agent feels polished and integrated. | This requires a Rhino plugin panel UI, which is a separate development track from the CLI agent loop. It splits focus, doubles the UI surface to maintain, and the terminal is the correct UX for a "Claude Code for CAD" tool — power users prefer terminal. | Terminal-first is the product. A future panel could mirror terminal output. Build that after the core CLI is stable. |
| Auto-execute without confirmation on destructive operations | Speed-focused users want zero friction. | Automation bias — users over-rely on AI outputs even when wrong. Cascading failures in CAD are expensive: a silent destructive operation that cannot be trivially undone destroys hours of work. Even with undo integration, some operations (file export, destructive boolean, mesh from surface) are hard to reverse in practice. | Plan-before-execute mode is default. Destructive-class operations always require explicit confirmation via `DurableDeferred` approval gate. Users who understand the risks can set a "trust mode" flag. |
| Grasshopper 2 integration | GH2 is the future of parametric design; users want AI to drive it. | GH2 is in alpha with no stable programmatic API (confirmed in PROJECT.md Out of Scope). Any integration built today is disposable when McNeel changes the API. | Build on GH1 stable C# SDK. Revisit GH2 when McNeel releases a stable API and documents it officially. |
| Windows support in v1 | Broader market reach if it runs on Windows. | Rhino.Inside (Windows-only) and `RhinoApp.InvokeOnUiThread` behave differently on Windows vs macOS (Windows is more lenient with background thread UI access, masking bugs that surface on macOS). Testing two platforms simultaneously doubles QA overhead for a prototype. | Target macOS Apple Silicon only for v1. Windows support is explicitly deferred. The two-process architecture works on both platforms — add Windows after macOS is stable. |
| Local LLM support | Privacy-sensitive design firms want on-premise inference. | Local LLMs (Ollama, LM Studio) perform significantly worse on complex multi-step planning tasks than Anthropic Claude or OpenAI o-series. A Rhino agent driven by a weak model will execute bad commands and destroy geometry. The Architect/Editor pattern specifically requires strong reasoning capability. | `packages/ai` already supports provider-agnostic `LanguageModel`. Local LLM support is a future catalog entry. Ship with Anthropic/OpenAI only; add local providers once core quality bar is proven. |

---

## Feature Dependencies

```
[WebSocket Plugin Transport]
    └──required by──> [Natural Language Command Execution]
                          └──required by──> [Plan-Before-Execute Mode]
                          └──required by──> [Tool Call Visibility]
                          └──required by──> [Scene State Awareness]

[PostgreSQL Session Persistence]
    └──required by──> [Session Resumption]
    └──required by──> [Audit Trail and Replay]
    └──required by──> [Context Compaction]

[Rhino Command Knowledge Base Seeding]
    └──required by──> [RAG-Backed Command Discovery]
                          └──required by──> [Dynamic Tool Search Tool Integration]

[Undo Integration (BeginUndoRecord/EndUndoRecord)]
    └──required by──> [Durable Multi-Step Workflow Execution]

[Tool.make Schema-Driven Definitions]
    └──required by──> [Bifurcated Read/Write Tool Surface]
    └──required by──> [Architect/Editor Model Split]

[packages/ai Generic Agent Loop]
    └──required by──> [Context Compaction]
    └──required by──> [Architect/Editor Model Split]

[Grasshopper 1 C# SDK Integration]
    └──blocked by──> [Plugin WebSocket Server Completion]

[Layered Scene Representation]
    └──enhances──> [RAG-Backed Command Discovery] (reduces tokens available for retrieval if scene is verbose)
    └──enhances──> [Context Compaction] (observation masking works at layer boundary)

[Plan-Before-Execute Mode]
    └──conflicts with──> [Auto-Execute Without Confirmation] (anti-feature)

[macOS Apple Silicon Only]
    └──conflicts with──> [Windows Support in v1] (anti-feature)
```

### Dependency Notes

- **WebSocket Plugin Transport requires Plugin WebSocket Server**: The `SessionHost.cs` TCP/WebSocket listener inside the Rhino plugin must exist before any command execution can happen. This is the single most critical path item.
- **PostgreSQL Session Persistence requires packages/ai generic loop**: The persistent session must be tied to the generic agent loop, not the app-specific harness. Redesigning kargadan schemas must happen before persistence is wired up.
- **Rhino Command Knowledge Base Seeding requires manual curation work**: Embedding cron and pgvector search exist in `packages/ai`. The blocking item is the data: catalog Rhino commands with descriptions, parameters, valid argument formats, and examples. This is domain knowledge work, not engineering.
- **Architect/Editor Model Split requires Tool.make definitions to be stable**: Cannot wire two model tiers until the tool surface is finalized. Tool schema changes break both models simultaneously.
- **Durable Workflow Execution requires Undo Integration to be correct first**: If undo records are malformed or missing, the compensation path in `@effect/workflow` cannot roll back reliably. Undo correctness gates durability.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what is needed to validate the concept.

- [ ] Plugin WebSocket server (TCP listener, background thread, `InvokeOnUiThread` marshaling) — everything gates on this
- [ ] Natural language command execution via `RhinoApp.RunScript` — the core value, must ship
- [ ] Streaming progress output in terminal — without this the tool feels broken to any user
- [ ] Plan-before-execute mode with y/n approval gate — safety without complexity
- [ ] Tool call visibility in terminal output — builds trust
- [ ] Undo integration (one undo record per agent action) — without this Rhino power users will not adopt
- [ ] Layer 0 scene representation (~500 tokens, always present) — agent must know what is in the document
- [ ] Session persistence via PostgreSQL (replace in-memory PersistenceTrace) — validated in active scope
- [ ] Basic RAG-backed command discovery (pgvector, seeded knowledge base) — enables command-agnostic NL input
- [ ] Error messages with recovery suggestions — minimum bar for usability

### Add After Validation (v1.x)

Features to add once core is working and users are providing feedback.

- [ ] Architect/Editor model split — validated architecture (aider SWE-bench results); add once v1 loop is stable and model cost is measurable
- [ ] Context compaction (75% trigger / 40% target) — needed once real users run long sessions; validate session length patterns first
- [ ] Layers 1-3 on-demand scene representation — implement once Layer 0 is confirmed sufficient or insufficient by user sessions
- [ ] Anthropic Tool Search Tool integration — enhances command discovery; add once knowledge base is seeded and basic RAG is proven
- [ ] Observation masking for tool output compaction — NeurIPS DL4C 2025 confirmed effective; implement after context budget patterns are observable in production sessions
- [ ] Full audit trail UI / replay command — adds polish; implement after persistence layer is stable

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Grasshopper 1 procedural automation — high value but high complexity; requires stable plugin and validated core loop first
- [ ] Durable multi-step workflow execution with compensation — `@effect/workflow` is already in the stack; wire it after single-step execution is reliable
- [ ] Bifurcated read/write tool surface formalization — currently implicit; explicit bifurcation with schema-driven `Tool.make` adds correctness guarantees after tool surface stabilizes
- [ ] Local LLM support — defer until strong model quality is validated as the correct constraint, then add as a catalog option

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Plugin WebSocket server | HIGH | HIGH | P1 |
| Natural language command execution | HIGH | MEDIUM | P1 |
| Streaming terminal progress | HIGH | LOW | P1 |
| Plan-before-execute mode | HIGH | LOW | P1 |
| Undo integration | HIGH | MEDIUM | P1 |
| Tool call visibility | HIGH | LOW | P1 |
| Layer 0 scene representation | HIGH | MEDIUM | P1 |
| Session persistence (PostgreSQL) | HIGH | MEDIUM | P1 |
| Basic RAG command discovery | HIGH | HIGH | P1 |
| Error messages with recovery hints | MEDIUM | LOW | P1 |
| Architect/Editor model split | HIGH | MEDIUM | P2 |
| Context compaction | MEDIUM | MEDIUM | P2 |
| Tool Search Tool integration | HIGH | MEDIUM | P2 |
| Observation masking | MEDIUM | LOW | P2 |
| Audit trail and replay | MEDIUM | LOW | P2 |
| Layers 1-3 on-demand | MEDIUM | MEDIUM | P2 |
| Grasshopper 1 automation | HIGH | HIGH | P3 |
| Durable multi-step workflow | HIGH | HIGH | P3 |
| Bifurcated tool surface formalized | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (v1)
- P2: Should have, add after v1 validation
- P3: Future consideration, deferred to v2+

---

## Competitor Feature Analysis

| Feature | RhinoMCP (reference) | Aider (coding agent pattern) | Claude Code (CLI agent pattern) | Kargadan Approach |
|---------|----------------------|------------------------------|----------------------------------|-------------------|
| Natural language execution | Python script execution, primitive creation | File edits via LLM | Terminal commands, file edits | `RhinoApp.RunScript` + RhinoCommon API |
| Session persistence | None — stateless | Git history only | `~/.claude/projects/` JSON | PostgreSQL-backed run events + snapshots |
| Undo integration | None | Git commits | None (code is version-controlled) | `BeginUndoRecord`/`EndUndoRecord` per action |
| Command discovery | Hardcoded Python RhinoScript functions | Repo map (function signatures) | Tool catalog | RAG pgvector + Anthropic Tool Search Tool |
| Context management | No management — dumps full scene | Repo map truncation | Rolling summarization | Layered scene + observation masking |
| Plan-before-execute | None | Architect mode (read-only planning) | Plan mode (Shift+Tab) | `PLAN` stage + `DurableDeferred` gate |
| Error recovery | None — fails silently | Lint/test loop feedback | Retry with tool call | `VERIFY`/`DECIDE` states with compensation |
| Streaming output | None | Streaming diff display | Full streaming with tool visibility | Per-stage event emission to terminal |
| Model split | Single model | Architect + Editor split | Single model | Architect (Opus/Sonnet) + Editor (Sonnet) |
| Multi-step durability | None | None | None | `@effect/workflow` Activity + compensation |

---

## Sources

- RhinoMCP GitHub repository — [jingcheng-chen/rhinomcp](https://github.com/jingcheng-chen/rhinomcp)
- RhinoMCP community thread — [McNeel Forum: I built RhinoMCP](https://discourse.mcneel.com/t/i-built-rhinomcp-exploring-ai-assisted-modelling/202038)
- Aider architecture — [aider.chat](https://aider.chat/), [Blott review 2025](https://www.blott.com/blog/post/aider-review-a-developers-month-with-this-terminal-based-code-assistant)
- Claude Code features — [Claude Code Docs](https://code.claude.com/docs/en/sub-agents), [sshh.io blog](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)
- Anthropic Tool Search Tool — [platform.claude.com docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool), [Anthropic engineering](https://www.anthropic.com/engineering/advanced-tool-use)
- Observation masking (NeurIPS DL4C 2025) — [arxiv:2508.21433](https://arxiv.org/abs/2508.21433), [JetBrains research blog](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- Context compaction patterns — [Anthropic engineering: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Factory.ai](https://factory.ai/news/compressing-context)
- Durable execution for AI agents — [DBOS blog](https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents), [Convex stack](https://stack.convex.dev/durable-workflows-and-strong-guarantees)
- Undo-and-retry mechanism (NeurIPS 2025) — [IBM Research STRATUS](https://research.ibm.com/blog/undo-agent-for-cloud)
- Plan mode patterns — [GitHub Copilot plan mode](https://skywork.ai/blog/agent/plan-mode-vs-agent-mode-understanding-githubs-revolutionary-coding-workflows/), [Qwen Code approval mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/)
- CAD AI agent landscape — [mecagent.com 2025](https://mecagent.com/blog/ai-in-cad-how-2025-is-reshaping-mechanical-design-workflows), [myarchitectai.com 2026](https://www.myarchitectai.com/blog/ai-cad)
- SceneCraft LLM agent — [arxiv:2403.01248](https://arxiv.org/abs/2403.01248)
- CAD-Llama CVPR 2025 — [arxiv:2505.04481](https://arxiv.org/abs/2505.04481)
- Grasshopper MCP / AI parametric design — [Grasshopper MCP Server](https://playbooks.com/mcp/alfredatnycu-grasshopper-parametric-design)
- AG-UI streaming protocol — [Codecademy AG-UI article](https://www.codecademy.com/article/ag-ui-agent-user-interaction-protocol)
- Safety and compensation in agents — [IBM Research undo-and-retry](https://research.ibm.com/blog/undo-agent-for-cloud), [Jack Vanlightly remediation](https://jack-vanlightly.com/blog/2025/7/28/remediation-what-happens-after-ai-goes-wrong)

---

*Feature research for: CLI-based AI agent controlling Rhino 9 via natural language (Kargadan)*
*Researched: 2026-02-22*
