# [H1][ARCHITECTURE_GEN]
>**Dictum:** *Architecture generation requires system comprehension before documentation.*

<br>

Generation-specific instructions for creating and updating ARCHITECTURE.md files. Canonical structure defined in `docs/standards/architecture-standards.md`; this reference covers operational workflow and content generation.

---
## [1][EXPLORATION_PHASE]
>**Dictum:** *Read the system before mapping it.*

<br>

Before generating architecture content; gather:

| [INDEX] | [SOURCE]                                                     | [EXTRACTS]                                |
| :-----: | ------------------------------------------------------------ | ----------------------------------------- |
|   [1]   | Entry points (`Program.cs`, `main.py`, `index.ts`)           | Boot sequence, dependency wiring          |
|   [2]   | Module boundaries (`src/modules/`, `packages/`, `apps/`)     | Bounded contexts, ownership boundaries    |
|   [3]   | Configuration (`docker-compose.yml`, `k8s/`, `pulumi/`)      | Infrastructure topology, service mesh     |
|   [4]   | Existing ADRs (`docs/decisions/`)                            | Key design decisions, supersession chains |
|   [5]   | Inter-service communication (gRPC protos, event schemas)     | Data flow direction, protocol choices     |
|   [6]   | Cross-cutting config (auth middleware, logging, error types) | Shared patterns spanning components       |

[CRITICAL]:
- [NEVER] Infer architecture from file tree alone — read service boundaries, event schemas, and middleware chains.
- [NEVER] Document implementation details — ARCHITECTURE.md maps bounded contexts, not classes.

---
## [2][SECTION_GENERATION]
>**Dictum:** *Per-section generation rules eliminate structural ambiguity.*

<br>

### [2.1][SYSTEM_OVERVIEW]

One paragraph: business problem, system purpose, target audience; followed by Mermaid C4 Context diagram (Level 1).

**Diagram requirements:** System as central node, external actors as surrounding nodes, labeled edges showing interaction type (REST, gRPC, events, batch); maximum 7 external actors — group related actors if needed.

---
### [2.2][HIGH_LEVEL_ARCHITECTURE]

Select diagram type by system topology:

| [INDEX] | [TOPOLOGY]         | [DIAGRAM_TYPE] | [MERMAID_SYNTAX]       |
| :-----: | ------------------ | -------------- | ---------------------- |
|   [1]   | **Microservices**  | C4 Container   | `graph LR` with groups |
|   [2]   | **Monolith**       | C4 Component   | `graph TD` with layers |
|   [3]   | **Event-driven**   | Sequence       | `sequenceDiagram`      |
|   [4]   | **Stateful flows** | State          | `stateDiagram-v2`      |
|   [5]   | **Data-centric**   | ER             | `erDiagram`            |

Follow diagram with responsibility table: one row per bounded context, bold name, one-line responsibility statement.

[IMPORTANT]:
1. [ALWAYS] **Protocol labels:** Every edge in the diagram carries a protocol or interaction label.
2. [ALWAYS] **3-7 nodes:** Fewer signals missing decomposition; more signals insufficient abstraction.

---
### [2.3][CODEMAP]

Generate annotated directory structure using tree-style ASCII art; maximum two levels of nesting.

**Generation rules:**
1. Read the actual directory structure — do not invent paths.
2. Mark entry points with emphasis (bold or annotation).
3. One-line purpose statement per directory.
4. Skip generated/build output directories (`dist/`, `node_modules/`, `bin/`).
5. Group by architectural concern, not alphabetical order.

---
### [2.4][KEY_DESIGN_DECISIONS]

Scan `docs/decisions/` for ADRs with Accepted status. For each:
1. One-line summary of the decision.
2. Primary justification (which driver it addresses).
3. Relative link to the full ADR.

[CRITICAL]:
- [NEVER] Duplicate ADR content — summarize and link.
- [NEVER] Include Deprecated or Superseded decisions — those belong in the ADR index only.

---
### [2.5][CROSS_CUTTING_CONCERNS]

Document each cross-cutting pattern with: mechanism name, implementation approach, boundary scope (which components it affects).

---
### [2.6][INVARIANTS]

System-level invariants — properties that hold regardless of state; format: numbered list, each invariant is one sentence stating property and consequence if violated.

---
## [3][SCOPE_ROUTING]
>**Dictum:** *Architecture scope determines document depth and diagram selection.*

<br>

| [INDEX] | [SCOPE]           | [LOCATION]                            | [DEPTH]                                                |
| :-----: | ----------------- | ------------------------------------- | ------------------------------------------------------ |
|   [1]   | **System-level**  | `./ARCHITECTURE.md`                   | Full 7-section structure per architecture-standards.   |
|   [2]   | **Package-level** | `packages/*/ARCHITECTURE.md`          | Overview, component diagram, codemap; omit deployment. |
|   [3]   | **Module-level**  | Inline in module README §Architecture | Single diagram + responsibility table.                 |

---
## [4][UPDATE_WORKFLOW]
>**Dictum:** *Architecture updates are quarterly, not continuous.*

<br>

When updating existing ARCHITECTURE.md:
1. Verify diagram accuracy against current service topology.
2. Update codemap only for structural changes (new modules, removed packages).
3. Add new ADR summaries to Key Design Decisions.
4. Review invariants for continued validity.

[IMPORTANT]:
1. [ALWAYS] **Preserve existing structure:** Do not reorganize sections unless architecture-standards.md requires it.
2. [ALWAYS] **Diagram-first updates:** Update diagrams before prose — diagrams anchor the reader's mental model.

[CRITICAL]:
- [NEVER] Regenerate from scratch when update is requested; preserve accumulated context and contributor annotations.
