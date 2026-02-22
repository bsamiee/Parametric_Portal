# Building a production-grade AI assistant for Rhino 3D on macOS

**The optimal architecture is a hybrid system: a TypeScript agent core communicating via WebSocket with a C# plugin running inside Rhino, using native tool calling for core operations, prompt-based skill injection for domain knowledge, and MCP only as an extensibility layer.** This mirrors the architecture that powers Claude Code — the most successful AI tool integration to date — while adapting it to the unique demands of real-time 3D geometry manipulation. The key insight from analyzing every major AI coding tool (Claude Code, Cursor, aider, Cline, Windsurf) is that none rely on a single integration mechanism; all combine native function calling, prompt engineering, and protocol-mediated access in a carefully layered architecture. Rhino's RhinoCommon API provides comprehensive programmatic access to virtually every feature, but offers no built-in IPC mechanism — meaning a custom plugin acting as a WebSocket server inside Rhino is the mandatory bridge.

---

## Rhino's API is comprehensive but demands a plugin bridge

RhinoCommon, the .NET SDK for Rhino 8/9, exposes **1,201 new API items** in version 8 alone and covers nearly every operation possible through the GUI. Geometry creation and modification (NURBS, meshes, SubDs, Breps), viewport control (`RhinoViewport.SetCameraLocation`, `SetCameraTarget`), CPlane manipulation, layer management (`LayerTable` with full CRUD), block/instance management (`InstanceDefinitionTable`, `InstanceObject`), layout/sheet management (`RhinoPageView`, `DetailViewObject`), annotations (`TextEntity`, `LinearDimension`, `Leader`), and display pipeline customization (`DisplayConduit`, `DisplayModeDescription`) are all fully scriptable. Rhino 8 unified the runtime on **.NET Core** across Windows and macOS, meaning the RhinoCommon API surface is **identical on both platforms**.

The critical constraint is that **Rhino has no built-in REST API, WebSocket server, named pipe listener, or any external communication mechanism**. On Windows, legacy COM automation exists (`Rhino.Application.8` ProgID), but macOS has nothing — no COM, no AppleScript dictionary. The only viable path, proven by every existing integration project, is to run a **socket server inside Rhino via a plugin or Python script** that accepts commands from an external AI process and executes them through RhinoCommon.

Rhino 8 added **CPython 3.9** scripting (upgraded to 3.13 in Rhino 9 WIP) with full PyPI package support, meaning the in-process listener can be written in Python using `rhinoscriptsyntax` or direct RhinoCommon access. The `RhinoApp.RunScript()` method allows invoking any Rhino command programmatically from within a plugin. Rhino.Compute (exposing 2,400+ API calls via REST) is **Windows-only** and headless, making it unsuitable for interactive macOS workflows but validating the REST-over-geometry pattern. The standalone `rhino3dm` library (available in Python, JavaScript, and .NET) handles file I/O and basic geometry but **lacks advanced operations** like Boolean operations, meshing, trimming, and intersections — these require the full RhinoCommon inside a running Rhino instance.

---

## Why the hybrid architecture wins over pure MCP

MCP (Model Context Protocol), now at spec version **2025-11-25** with Streamable HTTP transport, OAuth 2.1, and async task execution, has become the de facto standard for AI-tool integration — adopted by OpenAI, Google DeepMind, AWS, and Anthropic. But treating MCP as the *sole* integration mechanism introduces unnecessary fragility, latency, and security surface. Analysis of how production AI tools actually work reveals a consistent pattern: **MCP is used for extensibility, not core operations**.

Claude Code implements its core tools (file read/write, bash, grep, glob, edit) as **native function calls** defined with typed schemas sent directly in each API request. MCP enters only when connecting to external services — Google Drive, Jira, Slack — via "Connectors" (Anthropic-hosted, pre-curated MCP servers with OAuth and rate limits). Cursor follows the same pattern: 15+ built-in tools (including `codebase_search`, `edit_file`, `run_command`) are native, with MCP providing optional extensibility. Cline uses native tool calling for its core `ToolExecutor` system while supporting MCP for marketplace extensions. **No major AI tool uses MCP as its primary tool execution mechanism.**

The reasons are architectural. MCP adds **protocol overhead** (initialize → negotiate capabilities → operate handshake), **context window bloat** (tool definitions consume tokens on every call), and **security risks** (tool poisoning, tool shadowing, rug-pulling attacks where servers dynamically change capabilities). Connection stability has improved with Streamable HTTP replacing the fragile SSE transport, but full resumability implementation is still rolling out across client libraries. For a tightly coupled Rhino integration requiring sub-second command execution and rich bidirectional state flow, the overhead is unjustifiable for core operations.

The recommended architecture layers three integration mechanisms:

- **Native tool calling** (core): Rhino geometry operations, layer management, viewport control, and document queries are defined as typed tool schemas sent with each LLM API call. The AI model selects tools based on descriptions; results flow back as structured JSON. This gives the tightest control, lowest latency, and best prompt-cache efficiency (static tool definitions cache well).

- **Prompt-based skill injection** (domain knowledge): Following Claude Code's SKILL.md pattern, Rhino-specific knowledge — API conventions, architectural best practices, geometric constraints, modeling workflows — is packaged as composable markdown templates with YAML frontmatter. The LLM selects relevant skills via pure reasoning (no algorithmic routing), and selected skills inject domain instructions into the conversation context. This is more flexible and composable than fine-tuning, and doesn't require schema definitions.

- **MCP** (extensibility): An optional MCP server wraps the Rhino plugin for interoperability with Claude Desktop, Cursor, or any MCP-compatible client. This allows the same Rhino backend to serve multiple AI frontends without custom integration for each.

---

## The two-process architecture with WebSocket bridge

The system requires two processes connected by a WebSocket bridge. The **Rhino plugin** (C# targeting .NET 8, running inside Rhino's process) acts as a WebSocket server on `localhost`, with direct access to the full RhinoCommon API. The **AI agent** (TypeScript or Python, running as a separate process) connects as a WebSocket client, sending JSON commands and receiving structured responses plus push notifications.

The Rhino plugin has four subsystems. The **WebSocket server** accepts connections and dispatches JSON commands. The **Command Executor** marshals operations to Rhino's UI thread via `RhinoApp.InvokeOnUiThread` (mandatory — RhinoCommon is not thread-safe), wraps them in undo records via `RhinoDoc.BeginUndoRecord`/`EndUndoRecord`, validates geometry results, and captures errors. The **Event Monitor** subscribes to RhinoDoc events (`AddRhinoObject`, `DeleteRhinoObject`, `ModifyObjectAttributes`, `LayerTableEvent`, `UndoRedo`) and pushes batched change notifications over the WebSocket with **200ms debouncing** to prevent event storms. The **Viewport Capture** module uses `ViewCapture.CaptureToBitmap()` to generate on-demand screenshots for vision-based reasoning.

```
AI Agent (TypeScript/Python)          Rhino Plugin (C#/.NET 8)
┌────────────────────────┐            ┌──────────────────────────┐
│ LLM Client (Claude API)│            │ WebSocket Server         │
│ Tool Definitions       │◄──────────►│ Command Executor         │
│ Context Manager        │  WebSocket │ Event Monitor (debounced)│
│ State Tracker          │  JSON/TCP  │ Viewport Capture         │
│ Skill System           │            │ Undo Record Manager      │
└────────────────────────┘            │     ↕ RhinoCommon API    │
                                      └──────────────────────────┘
```

The JSON protocol uses request/response with unique IDs plus unsolicited event notifications:

```json
{"id":"req-001","type":"create_object","params":{"shape":"box","corner":[0,0,0],"size":[10,5,3],"layer":"Walls"}}
{"id":"req-001","status":"success","result":{"guid":"abc-123","bbox":[[0,0,0],[10,5,3]]}}
{"type":"event","event":"objects_changed","data":{"added":["abc-123"],"modified":[],"deleted":[]}}
```

**WebSocket over TCP localhost** is the recommended transport — it's full-duplex, provides built-in JSON framing, has excellent library support in both C# (`System.Net.WebSockets`) and Python/TypeScript, and is the exact pattern proven by all five existing RhinoMCP implementations. Unix domain sockets offer ~30% less latency but are unnecessary unless benchmarking reveals a bottleneck. macOS imposes **no sandbox restrictions** on Rhino or external Python processes, so all IPC mechanisms work freely without entitlements.

---

## Context management requires a layered scene representation

The central challenge of AI-CAD integration is representing a complex 3D model in a form an LLM can reason about. Research across SceneGPT, SG-Nav, CAD-Llama, and the RhinoMCP projects converges on **JSON scene graphs** as the optimal interchange format — GPT and Claude are specifically trained to comprehend JSON for structured reasoning and function calling.

The recommended approach uses four layers of progressive detail:

**Layer 0** (always in context, ~500 tokens): A compact scene summary — layer tree with object counts, active viewport/CPlane, current selection, bounding box of entire model, recent operation history. This lives in the system prompt and is updated after every operation.

**Layer 1** (on-demand via tool call, ~2-5K tokens): Per-object metadata including GUID, name, type (Brep/Mesh/Curve/Surface), layer assignment, bounding box center and extents, material, color, and spatial relationships to neighboring objects. Fetched when the AI needs to reason about specific objects.

**Layer 2** (tool-fetched for precision work): Detailed geometry — control points for NURBS, face/edge/vertex topology, exact coordinates, dimension values. Retrieved only when the AI needs to modify specific geometric properties.

**Layer 3** (visual verification): Viewport captures sent to the vision model for spatial reasoning, aesthetic judgment, and verification that geometry looks correct. Multiple angles (perspective + plan + section) for 3D understanding.

For **context window management**, the JetBrains Research finding (NeurIPS DL4Code 2025) is directly applicable: **simple observation masking delivers equal or superior performance to complex LLM summarization** for tool-using agents, because tool outputs (geometry query results) dominate token usage and can be re-fetched. The recommended strategy combines observation masking for recent tool outputs, LLM summarization for older conversation turns, and a persistent **model state summary** that survives compaction. Claude Code and Windsurf's **todo-list pattern** — maintaining task tracking that persists across context compaction — is essential for multi-step architectural workflows where the AI might be creating a building over dozens of operations.

**PostgreSQL with pgvector** serves as the persistent backend, storing session history (event-sourced operation log), model state snapshots (periodic checkpoints enabling recovery), design decisions with rationale, and a knowledge base with hybrid search (vector similarity + BM25 full-text + structured SQL filters). This eliminates the need for a separate vector database while providing ACID guarantees for critical design state.

---

## RAG is necessary but not sufficient for domain knowledge

With context windows now reaching 200K+ tokens, the question of whether RAG remains necessary has a nuanced answer. Elastic Labs benchmarking shows RAG is **1,250x cheaper** ($0.00008 vs $0.10 per query) and **45x faster** (1 second vs 45 seconds) than pure long-context approaches. The "lost in the middle" problem persists — Databricks research shows model performance degrades after **32-64K tokens** of context depending on the model. RAG remains indispensable for large documentation corpora.

However, for structured API access, a **tool registry is superior to RAG**. RhinoCommon's API is structured and finite — tool definitions with precise schemas (name, typed parameters, return types, descriptions) give the model more reliable access than retrieving documentation chunks. The optimal knowledge architecture uses:

- **Tool registry** for RhinoCommon API operations: Each Rhino capability (create box, modify layer, set viewport) is a typed tool definition with schema validation. This is more reliable than RAG for structured APIs and benefits from prompt caching (static definitions).
- **RAG** for Grasshopper component documentation (928+ community plugins — too large for context), design best practices, error resolution patterns, and community examples.
- **Skill injection** for modeling workflows: Composable markdown templates encoding architectural conventions, parametric design patterns, and firm-specific standards.
- **Long context** for active conversation, model state summary, and the current design session.

Fine-tuning is less practical than structured tooling for this use case. CAD-Llama and BlenderLLM demonstrate that domain-specific fine-tuning improves geometric code generation, but the cost and inflexibility of fine-tuning (static, can't update without retraining) makes it inferior to the tool registry + skill injection approach for a system that must track evolving APIs and user-specific workflows.

---

## Language choice depends on where code runs

The language decision splits naturally along the two-process boundary. For the **Rhino plugin** (running inside Rhino's process), **C# is the only serious option** — it provides full RhinoCommon access, native .NET 8 support, proper threading via `InvokeOnUiThread`, and access to Rhino's undo system, event model, and display pipeline. Python scripts running inside Rhino via the ScriptEditor offer a lighter-weight alternative for prototyping but lack the robustness of a compiled C# plugin for production use.

For the **AI agent** (external process), the choice is between TypeScript and Python:

| Factor | TypeScript | Python |
|--------|-----------|--------|
| AI SDK maturity | Best (Vercel AI SDK, Anthropic Agent SDK primary) | Excellent (all providers, LangChain, LlamaIndex) |
| Agent framework | Claude Agent SDK (powers Claude Code) | OpenAI Agents SDK, CrewAI, LangGraph |
| CLI UI | Ink (React for terminal) — used by Claude Code | Rich + Textual — used by aider |
| Rhino geometry | rhino3dm.js (limited, WASM) | rhino3dm.py (limited but more mature) |
| Streaming | Native async generators, SSE | asyncio, async generators |
| Precedent | Claude Code is TypeScript | aider is Python |

**TypeScript with Ink is the recommended choice** for the agent process. The Anthropic Agent SDK's primary implementation is TypeScript, Claude Code proves this stack at scale ($500M+ ARR, 55K GitHub stars), and Ink provides a battle-tested React-based terminal UI framework. The rhino3dm limitation is irrelevant because all geometry operations route through the C# plugin via WebSocket — the agent never manipulates geometry directly.

The **Architect/Editor pattern** pioneered by aider (achieving SOTA 85% on code editing benchmarks) translates directly to Rhino: a strong reasoning model (Claude Sonnet/Opus) plans the design operations, then a faster model or direct code generation produces the specific RhinoCommon commands. Cursor's two-model system (main agent + cheaper "apply model" for producing file edits) is the same idea. For Rhino, the "architect" reasons about spatial relationships and design intent, while the "editor" generates precise coordinate values and API calls.

---

## Five existing RhinoMCP projects validate the socket-bridge pattern

The open-source ecosystem already contains **five RhinoMCP implementations**, all following the same architecture: a Python script or C# plugin running a TCP socket server inside Rhino, connected to an MCP server that bridges to Claude Desktop or Cursor.

The most mature is **reer-ide/rhino_mcp** (PyPI package `rhinomcp` v0.2.0), supporting both Windows and macOS with scene inspection, arbitrary Python code execution, object selection filters, RhinoScriptSyntax documentation lookup, and viewport screenshot capture. **GH_mcp_server** (Carnegie Mellon) adds Grasshopper integration with auto-generated GHPython scripts. **grasshopper-mcp** (alfredatnycu) introduces an **intent-based architecture** with a component knowledge base — rather than generating raw code, it recognizes high-level intents and auto-creates complex component patterns. **rhino-grasshopper-mcp** (dongwoosuk) adds ML-based layout optimization using DBSCAN clustering and K-means.

From the **Blender ecosystem**, BlenderMCP (16,800+ GitHub stars) is the primary reference implementation. **SceneCraft** (academic, 45.1% improvement over BlenderGPT on CLIP scores) demonstrates that **multi-agent systems with visual feedback loops** dramatically improve scene generation quality — an LLM-Planner creates relational graphs, an LLM-Coder writes constraint code, and an LLM-Reviewer provides visual feedback. This plan-generate-verify architecture should be adopted for Rhino.

Autodesk is investing heavily in AI: **Autodesk Assistant** (shipping in AutoCAD, Revit, Fusion) uses a proprietary Neural CAD model understanding shapes and structural connections, with plans for MCP server support via the Autodesk App Store. SolidWorks 2025 ships **AI Co-create** for batch drawing generation and **Magic SOLIDWORKS** for text-to-3D. The startup **Backflip** creates parametric CAD models from mesh data by directly driving SolidWorks sketching and extrusion operations. These validate that AI-driven CAD manipulation is an active, well-funded area — not speculative.

---

## Undo integration and error handling require transaction patterns

AI-generated operations must integrate cleanly with Rhino's undo system. The recommended pattern wraps each "logical AI action" (one user prompt → one set of geometry operations) in a **single undo record** via `RhinoDoc.BeginUndoRecord("AI: [description]")` / `EndUndoRecord()`. All sub-operations execute within this record, so a single Ctrl+Z undoes the entire AI operation atomically. For AI-private state (context tracking, session data), `RhinoDoc.AddCustomUndoEvent()` stores a snapshot that gets restored on undo — keeping the AI's internal model consistent with Rhino's document state after undo/redo.

Error handling follows a **saga-style workflow** pattern with explicit compensation. Each step in a multi-step operation has a defined compensation action (e.g., Step 1: create curves → compensation: delete curves; Step 2: loft surface → compensation: delete surface). On failure at any step, compensations execute in reverse order, or — more practically — the entire undo record is rolled back via `RhinoDoc.Undo()`. Geometry validation checks (`GeometryBase.IsValid`, bounding box reasonableness, topological validity for Breps) run after each operation, and the AI receives classified errors: **retryable** (timeouts), **correctable** (invalid parameters — AI self-corrects), **compensatable** (partial completion — rollback), or **fatal** (requires human intervention).

The **plan-execute-verify loop** is the recommended agentic pattern, with four verification layers: execution validation (did the code run?), geometric checks (are dimensions correct? is the Brep valid?), visual verification (viewport capture → vision model assessment), and design intent validation (does the result match what the user asked for?). **CADCodeVerify** (arxiv 2410.05340) demonstrates a two-step verification using binary yes/no questions answered by a VLM inspecting rendered output, achieving 64-68% automated verification accuracy. Maximum retry limits (3-5 attempts) prevent infinite loops on geometrically impossible requests, with escalation to the user when automated correction fails.

---

## Conclusion

The path to a first-class Rhino AI assistant is architecturally clear, technically feasible, and validated by production precedents in adjacent domains. The core insight is that **successful AI tool integration is never a single mechanism** — it's a layered system where native tool calling handles core operations with maximum reliability, prompt-based skills inject domain expertise with maximum flexibility, and MCP provides universal extensibility. The C# plugin inside Rhino acts as the "hands" (direct RhinoCommon access, event monitoring, undo management, viewport capture), while the TypeScript agent acts as the "brain" (LLM orchestration, context management, skill selection, plan-execute-verify loops).

Three technical decisions will most impact success. First, **the quality of the scene representation** determines how well the AI reasons about 3D space — the layered approach (compact summary always present, detailed geometry fetched on demand, visual verification for spatial reasoning) balances token efficiency against geometric precision. Second, **the Architect/Editor separation** — using a strong reasoning model for design planning and a faster model or direct code generation for RhinoCommon commands — mirrors the pattern that achieves state-of-the-art performance in code editing. Third, **event-driven state synchronization with debounced batching** keeps the AI continuously aware of model changes without overwhelming the context window, enabling the kind of fluid human-AI collaboration that transforms a tool from a command executor into a genuine design partner.

The existing RhinoMCP ecosystem proves the socket-bridge pattern works on macOS. What's missing is the step from MCP server to first-class tool: the skill system encoding architectural workflows, the persistent memory enabling cross-session learning, the verification loops catching geometric errors before they propagate, and the layered context management enabling reasoning about models with thousands of objects. Building this means building the infrastructure that turns an LLM from an occasional command generator into an always-aware design collaborator — and every piece of that infrastructure now has a proven reference implementation in the AI coding tool ecosystem.