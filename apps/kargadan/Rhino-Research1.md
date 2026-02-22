# Designing a First‑Class AI Assistant for Rhino on macOS

## Fundamental architecture decision: SDK-first with an agent harness, MCP as an interoperability layer

A “first-class” AI integration for Rhino on macOS is best modeled as a **two-part system**: (a) an in-process Rhino plug-in that exposes **authoritative, typed, stateful operations** via Rhino’s SDK, and (b) an out-of-process “agent harness” (CLI) that runs the model loop, orchestration policies, and provider abstraction. This separation follows the pattern used by modern terminal agents (an explicit “agent loop” that alternates model inference with tool calls) and clarifies what MCP can and cannot solve.

The key point is that MCP is fundamentally a **transport + tool-description protocol**, not a reliability strategy. The MCP specification frames it as a standardized way to connect LLM applications to “external data sources and tools.” That standardization is important for interoperability (and is now housed under the entity["organization","Linux Foundation","nonprofit tech consortium"] via the Agentic AI Foundation announcement), but the hard work of *making the agent reliable* still sits in the harness and in the tool surface area you expose.

What makes MCP-based systems “feel fragile” in practice tends to be a combination of:
- **Tool overload and tool ambiguity** (too many similarly named tools and too much schema text consuming context).
- **Insufficiently constrained tool inputs** (schemas that allow too many degrees of freedom, producing malformed or nonsensical calls).
- **Weak tool response design** (returning low-signal data, massive payloads, or unhelpful errors that do not steer corrective action).
- **Missing harness policies** (no transaction model, no bounded retries, no context management, no durable artifacts between sessions).

Accordingly, the “objective best” approach for a serious Rhino assistant is:

**SDK-first (Rhino plug-in) for truth + harness-first (CLI) for reliability**, with MCP optionally exposed as a compatibility layer.

This yields three concrete benefits (each is essential for the use-cases you listed: layers, blocks, layouts, annotations, view styles, and larger building-scale coordination):
- **Authoritative state** comes from Rhino itself (active document, active view/viewport, CPlane, object tables, layers, instance definitions, layouts, etc.), not from the model remembering or guessing.
- **Deterministic operations** happen through SDK calls with IDs, tolerances, and validated preconditions—not through brittle UI scripting or “skills” that depend on latent assumptions.
- **Provider independence** becomes tractable because the CLI harness is the only “model-specific” component; the Rhino plug-in is merely a local capability server. This is the same separation used by Codex CLI, which explicitly runs an agent loop and treats tool execution as a harness responsibility.

## Rhino 8/9 on macOS: runtime, packaging, and integration surfaces you can rely on today

Two “current” constraints largely dictate how clean your Rhino integration can be.

First, runtime realities: recent Rhino 8 service releases have moved to .NET 8, and the Rhino 9 WIP is running on .NET 9 (with a stated likelihood of moving to .NET 10 before Rhino 9.0 release). On macOS specifically, Rhino 9 is described as running **only** with .NET 9 (and .NET 10 when released), whereas Windows will support multiple runtimes.

Second, distribution realities: McNeel’s packaging toolchain (Yak / Package Manager) now supports **multi-targeted** plug-in packages in Rhino 8+, with a specific packaging structure (e.g., `net48/` and `net7.0/` directories) and a requirement that the manifest live outside the framework directories. The same guide documents “distribution tags” that let you publish variants targeting different Rhino versions and platforms (win/mac/any), and it explicitly notes you can even target a specific service release minor when you rely on an SDK change delivered there.

For a first-class AI tool meant to span Rhino 8 and Rhino 9 on macOS, the practical implication is:

- Your **Rhino-side integration** should be written as a .NET plug-in (C#) and packaged via Yak with **multi-targeting**.
- Your **CLI harness** remains decoupled and can be written in any language that best supports model-provider abstraction and local IPC, because it does not run inside Rhino’s .NET runtime.

Rhino itself provides the integration primitives you need for “AI that is aware of the model,” because RhinoCommon exposes the document’s object tables and the geometry types that underlie exact modeling. Current RhinoCommon API docs (built against Rhino 8.28 with a 2026-02-10 build stamp) describe:
- `Rhino.DocObjects` as the namespace for document objects (geometry + attributes + stable IDs).
- `Rhino.Geometry` as the namespace for core 3D types (curves, meshes, B-reps, etc.).
- The view system (`RhinoView`/`RhinoViewport`) as explicitly supporting multiple viewports per layout, which matters for layouts/detail viewports and paper-space workflows.

Several smaller but practically important “current” signals show active evolution in the exact areas you care about:
- Rhino 8 SR27 release notes include fixes and changes in ScriptEditor, RhinoCommon, and macOS-specific display and panel behavior (Metal performance, Dark Mode panel refresh, etc.).
- That same SR27 list includes SDK/RhinoCommon changes (new functions, crash fixes), reinforcing that a “hard requirement” for <6-month recency is sensible for this space.

## Tool and harness design to avoid fragility: strict schemas, transactions, and deterministic read/write tools

The most robust way to avoid the “MCP is fragile” failure mode is to adopt an explicit harness design where reliability is engineered into the loop, the tools, and the state contract.

The Codex harness description is useful because it spells out the minimal agent loop: the agent builds a prompt, runs inference, then either returns a final response or performs tool calls and loops until completion. Codex further notes that **context window management** is one of the harness’s responsibilities, because tool calls and conversation history can exhaust the context window. This is precisely the failure mode you are naming when you describe “context windows with compaction will lead to terrible results for serious work” unless there is a deliberate harness strategy.

A Rhino assistant should therefore be built around a **bifurcated tool surface**:

- **Read tools**: high-frequency, low-risk, deterministic state capture. Examples: active doc metadata, active view/viewport/cplane, selection set, layer table summary, instance definition table summary, layout/detail viewport summary, dimensional style settings, annotation standards, modeling tolerances. These tools are how the agent “stops guessing.”
- **Write tools**: constrained, validated, undo-able operations that can be composed safely. Examples: create/update/delete geometry by explicit IDs, assign objects to layers by exact layer IDs/names, create instance definitions and place instances, create/modify named views and restore them into a viewport, create/modify display modes, create/modify layout pages and detail viewports, create annotations with explicit plane/space and style IDs where relevant.

The RhinoCommon API directly supports key mechanics needed to make writes safe:
- RhinoDoc exposes undo recording primitives (e.g., `BeginUndoRecord`) intended for changes “outside of a command,” which aligns with the usual structure of modeless tools and background-driven automation.
- A dedicated helper class (`RhinoDocUndoRecord`) exists to manage Begin/End undo calls and is explicitly recommended for modeless UI modifications.
- `RhinoDoc.RuntimeData` is described as a place to store “non-serializable, per document data,” which is the cleanest place to keep *your agent’s document-scoped state machine* (session IDs, last-seen selection hash, last successful plan, tool traces) without polluting the file.
- On macOS, RhinoDoc’s event ordering differs (e.g., ActiveDocumentChanged will be raised before some open/new events), which matters if your AI state is “attached” to documents and must not drift across document windows.

Reliability then comes from *how the harness specifies and validates tool calls*. Here, modern “structured output” mechanisms are directly relevant. OpenAI documents Structured Outputs as ensuring that model outputs adhere to a supplied JSON Schema, reducing failures like missing required keys or invalid enum values. The Responses API reference further describes tools as having JSON-schema parameter objects and a `strict` control point, which enables precisely the kind of deterministic, schema-validated tool invocation that fragile agent systems typically lack.

Anthropic’s tool-design guidance is consistent with this: tools are contracts between deterministic systems and non-deterministic agents, and performance improves materially when tools are namespaced, the returned context is high-signal, token usage is bounded, and the tool descriptions/specs are written as if onboarding a new engineer.

Two recent Anthropic features are especially relevant to Rhino-scale tooling (where the tool set can become large):
- **Tool Search Tool**: designed to avoid loading all tool definitions upfront; it addresses both token overhead and tool selection accuracy by discovering tools on demand.
- **Programmatic Tool Calling**: designed to reduce “context pollution” from large intermediate results by allowing code to orchestrate tool calls and control what gets returned into the model context.

In Rhino terms: rather than returning hundreds of thousands of object records to the model, you would run analysis in the plug-in, then return only the minimal structured result (for example: “these 12 objects intersect the plane; here are their IDs; here are 12 intersection curves as lightweight parameterizations or 3DM-encoded payloads”). This is exactly the “high-signal tool response” principle (plus token efficiency) described in the tool-writing guidance.

## Context systems: live-state tooling plus modern retrieval and compaction, not blind prompts

Your concerns about “the AI going in blind each pass” are fundamentally concerns about **context engineering**, not about the existence of an MCP server.

Anthropic’s context engineering guidance frames the central problem as curating the smallest set of high-signal tokens that maximize success; it explicitly distinguishes strategies like compaction, note-taking, and multi-agent architectures. The Claude API documentation similarly positions **server-side compaction** as the “primary strategy” for long-running agentic workflows, with other strategies such as tool result clearing when needed.

OpenAI’s own Codex harness description parallels this: it identifies context window management as a core harness responsibility and describes an explicit compaction mechanism (“compaction” items that preserve understanding and are triggered once an auto-compaction limit is exceeded).

What this implies for a Rhino assistant is that “RAG” is not outdated, but it is also not the main lever for correctness in 3D modeling. For Rhino, the dominant sources of “correct context” are:

- **Live state retrieval from the open Rhino document**, via read tools, because that yields exact viewport/CPlane state, exact object IDs, exact tolerances, exact layer membership, and exact instance-definition structure.
- **Durable, structured notes (memory artifacts) created by the harness**, because complex modeling work spans sessions and the model must not re-derive decisions every time. Anthropic explicitly describes long-running agents as working in discrete sessions that otherwise begin with “no memory,” and it proposes a harness strategy that leaves artifacts for subsequent sessions.
- **Retrieval over static corpora** (documentation, conventions, office standards, project requirements) as a secondary mechanism, primarily for *instructional* or *policy* context rather than for geometry truth.

A high-fidelity pattern for persistent state in the harness is described in the OpenAI Agents SDK cookbook: a `RunContextWrapper` provides structured state objects that persist across runs, enabling memory/notes and context injection with precedence rules. This is conceptually aligned with what you want for Rhino: a stable “project state” plus per-run deltas distilled into a durable form, rather than repeatedly compressing the entire conversation and hoping the model reconstructs the world correctly.

The direct Rhino analogue is to couple:
1) **Document-scoped state** stored in `RhinoDoc.RuntimeData` (what the agent believes about the open document, keyed to runtime serial numbers),
2) **Workspace-scoped state** stored by the CLI harness (project-level modeling standards, the current “task plan,” and audit traces of tool calls).

This combination eliminates the “Ralph Wiggum loop” failure mode (repeatedly re-prompting an amnesiac model with lossy summaries) because the agent is not relying on summarization as its only memory mechanism. Instead, it is repeatedly re-grounded in **current Rhino truth** plus **stable artifacts**.

## Data layer choices: when Postgres (and vectors) are additive vs unnecessary

A Postgres database is neither automatically required nor automatically wasteful. Its utility depends on whether you need (a) long-running memory across sessions, (b) auditability and replay, (c) cross-project analytics, or (d) multi-user collaboration.

Two observations from current sources help ground the decision:

- Modern agent frameworks emphasize **durable state objects and memory artifacts** across runs; this is explicitly presented as a foundation for personalization and long-running reliability in the Agents SDK cookbook pattern.
- Postgres itself is in rapid maintenance cadence (e.g., PostgreSQL 17.8 release notes dated 2026-02-12), which matters if you are treating Postgres as a long-lived backbone for an AI system.

If you already have Postgres, there are three “high-value” integration points:

1) **Event-sourced tool trace and audit log**
Store every tool call request, validated parameters, Rhino-side outcome, and resulting state summary. This enables replay, debugging, and evaluation. This approach aligns with “harness engineering” emphasis: long-running agents need stable artifacts and a reliable story of what occurred, not just chat transcripts.

2) **Project memory and retrieval index**
If your assistant must remember office conventions, prior design decisions, and project-specific rules, you need a retrieval mechanism. This can be implemented as embeddings/vector search, keyword search, or a hybrid. Anthropic’s Tool Search Tool explicitly supports the concept that “search tools” can be used to discover capabilities and reduce context overhead, and it notes that custom search tools can be implemented using embeddings.

3) **Vector search in Postgres when the scale is moderate**
Managed Postgres offerings are actively maintaining pgvector as an extension; for example, Google Cloud SQL release notes state that `Pgvector` was upgraded from 0.8.0 to 0.8.1 as part of a November 19, 2025 rollout. This is a concrete signal that pgvector remains operationally supported in mainstream managed Postgres platforms (not merely an experimental extension).

When Postgres is overkill: if the assistant is single-user, single-machine, and primarily needs to remain grounded in the *current* Rhino document state, a heavy external database can add latency and complexity without improving correctness. In that scenario, the Rhino-side `RuntimeData` plus a small local harness store (for example, encrypted local files keyed to project roots) often achieves the same reliability goals with far fewer failure modes.

## Implementation stack and reference systems to borrow from

The language question (“TypeScript, Python, something else?”) is best answered by acknowledging that this is a split system:

- The Rhino-integration component should be written in **C#/.NET** because it must run in-process inside Rhino and call RhinoCommon directly; this also aligns with Rhino 8/9 runtime realities (.NET 8 for Rhino 8 and .NET 9 for Rhino 9 WIP).
- The CLI harness can be implemented in the ecosystem that most cleanly supports multi-provider orchestration, schema validation, streaming, and local IPC. Two “current” signals matter here: OpenAI explicitly ships Agents SDK in both Python and TypeScript, which indicates a deliberate dual-language support strategy at the orchestration layer.

A practical model for a multi-provider CLI harness is Codex CLI: OpenAI describes it as a cross-platform local agent that orchestrates an agent loop and tool calls. The agent loop write-up also states that Codex’s Responses API endpoint is configurable and can be used with any endpoint that implements the Responses API, explicitly referencing Open Responses; it even describes local endpoints (e.g., localhost) for OSS-mode usage. This is highly aligned with your stated preference to “choose any provider.”

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["OpenAI Codex CLI terminal screenshot","Anthropic Claude Code terminal screenshot","Block Goose CLI screenshot","Warp terminal agents screenshot"],"num_per_query":1}

Three additional reference systems are particularly relevant:

- **Claude’s tool design and harness guidance**: Anthropic’s engineering posts are unusually explicit about tool naming, tool response design, token efficiency, and evaluation as first-class engineering work.
- **Goose (local-first agent framework)**: contributed by entity["company","Block","fintech company"] to the Agentic AI Foundation, with early adoption of MCP-related “apps” UI patterns (useful if you eventually want interactive panels inside Rhino, not only terminal I/O).
- **Warp’s “agentic development environment” framing**: Warp’s 2025 review explicitly positions the terminal as a place where agents run tasks with “full terminal use,” which is a useful conceptual model for your CLI side—even if your domain is Rhino rather than codebases.

Finally, two “instruction discipline” patterns from the coding-agent ecosystem translate well to Rhino:
- A dedicated file (e.g., AGENTS.md) that contains stable project-level guidance and is automatically loaded into the agent’s instruction stack. Codex documents a layered discovery model (global + project + nested overrides) precisely to keep behavior consistent across tasks.
- A separation between “schema validity” and “usage validity”: Anthropic notes that JSON schemas alone cannot express usage patterns, and it emphasizes examples and tool description quality as a steering mechanism.

## Further considerations

The most overlooked engineering risk in geometry-integrated agents is **semantic correctness under geometric tolerance**, not “prompt quality.” Rhino’s geometry stack is inherently tolerance-bound (absolute tolerance, angle tolerance, units, meshing parameters), and the agent must treat those as explicit inputs to tool calls. The correct approach is to expose tolerances and units as first-class read tools and to require them in write tools that generate or intersect geometry, rather than letting the model assume defaults. (The RhinoCommon API surface is explicitly organized around document objects and geometry namespaces, which is the technical foundation for doing this correctly.)

A second underappreciated issue is **layout/detail-viewport multiplicity**: layout pages can contain multiple viewports nested inside a single page view, and “active viewport” semantics can differ between modeling space and paper space. If your assistant will manage layouts, annotations, and sheets at a serious level, you should treat view/viewport selection as a formal state machine (not a side effect), and expose explicit tools to enumerate and select the active page view and active detail viewport.

A third niche but high-impact consideration is **tool-definition scalability**: if you expose a large Rhino capability surface (dozens to hundreds of tools), you should architect for deferred tool loading or tool search early. Anthropic’s Tool Search Tool is a concrete demonstration that large tool libraries can consume vast context budgets and reduce accuracy, and that on-demand tool discovery can materially improve both token economics and correctness.