---
description: Structural specification for Architecture documents
---

# [H1][ARCHITECTURE-STANDARDS]
>**Dictum:** *Architecture documentation captures system structure that code alone cannot communicate.*

<br>

[CRITICAL] ARCHITECTURE.md serves as living onboarding document for contributors. It answers two questions: "Where is the thing that does X?" and "What does the thing I am looking at do?"

---
## [1][PURPOSE]
>**Dictum:** *Architecture documentation complements — never duplicates — README and ADRs.*

<br>

Three documentation artifacts form the architecture triad:

**README.md** — Project introduction, adoption path, quick start. Marketing-facing for external audiences, orientation-facing for internal.<br>
**ARCHITECTURE.md** — System structure, component relationships, invariants, cross-cutting concerns. Contributor-facing; living document updated quarterly.<br>
**ADRs** — Immutable decision records with context, options, consequences. Historical reference.

ARCHITECTURE.md summarizes and links to ADRs—never replaces them. ADRs record why decision was made; ARCHITECTURE.md records what system looks like as result.

[IMPORTANT]:
1. [ALWAYS] **Scope trigger:** Projects exceeding 10,000 lines of code warrant a standalone ARCHITECTURE.md. Smaller projects fold architecture into the README §Architecture section.
2. [ALWAYS] **Quarterly review:** Revisit ARCHITECTURE.md every 3 months or after major structural changes.

[CRITICAL]:
- [NEVER] Synchronize ARCHITECTURE.md with implementation details—describe modules, boundaries; not classes, methods.
- [NEVER] Duplicate README content—ARCHITECTURE.md assumes reader has already read README.

---
## [2][FORMAT]
>**Dictum:** *Canonical sections in canonical order.*

<br>

Seven sections in fixed order. All required unless noted.

| [INDEX] | [SECTION]                   | [REQUIRED]  | [CONTENT]                                                          |
| :-----: | --------------------------- | :---------: | ------------------------------------------------------------------ |
|   [1]   | **System Overview**         |     Yes     | Problem domain, high-level purpose, C4 Context diagram.            |
|   [2]   | **High-Level Architecture** |     Yes     | Component/container diagram. 3-7 bounded contexts with data flow.  |
|   [3]   | **Codemap**                 |     Yes     | Annotated directory structure mapping source to concepts.          |
|   [4]   | **Key Design Decisions**    |     Yes     | Summarized decisions with links to ADRs.                           |
|   [5]   | **Cross-Cutting Concerns**  |     Yes     | Auth, logging, error handling, caching, observability patterns.    |
|   [6]   | **External Dependencies**   | Conditional | Third-party services, integration points, protocols. If any exist. |
|   [7]   | **Deployment Architecture** | Conditional | Infrastructure, environments, deployment topology. If applicable.  |

---
## [3][SECTIONS]
>**Dictum:** *Per-section content requirements eliminate ambiguity.*

<br>

### [3.1][SYSTEM_OVERVIEW]

One paragraph: what system does and what problem domain it operates in. Follow with C4 Context diagram (Level 1) showing system as single box with external actors, users, dependent systems.

[IMPORTANT]:
1. [ALWAYS] **Problem-first:** State the business problem before describing the technical solution.
2. [ALWAYS] **Boundary clarity:** The context diagram shows what is inside the system boundary and what is outside.

---
### [3.2][HIGH_LEVEL_ARCHITECTURE]

Draw component or container diagram showing 3-7 bounded contexts with directional data flow. Give each component one-line responsibility statement. Use Mermaid `graph LR` or `graph TD`.

| [INDEX] | [DIAGRAM_TYPE]   | [USE_WHEN]                                           |
| :-----: | ---------------- | ---------------------------------------------------- |
|   [1]   | **C4 Container** | Microservices, multi-process systems, polyglot apps  |
|   [2]   | **C4 Component** | Monolith internals, single-service module boundaries |
|   [3]   | **Sequence**     | Key runtime flows (auth, order lifecycle, sync)      |
|   [4]   | **State**        | Stateful workflows, lifecycle transitions            |
|   [5]   | **ER**           | Data models, aggregate relationships                 |

[CRITICAL]:
- [NEVER] Include implementation-level detail (class names, file paths) in high-level diagram—components represent bounded contexts, not code files.
- [NEVER] Exceed 7 nodes in single diagram—split into sub-diagrams if complexity demands.

---
### [3.3][CODEMAP]

Annotate directory structure mapping source code organization to architectural concepts. Use tree-style ASCII art with inline comments explaining each significant directory.

**Required elements per entry:**
- Directory or file path
- One-line purpose statement
- Link to architectural concept it implements

[IMPORTANT]:
1. [ALWAYS] **Entry points first:** Mark the primary entry point(s) with emphasis.
2. [ALWAYS] **Depth limit:** Show 2-3 levels of nesting maximum — deeper structure belongs in package-level READMEs.

[CRITICAL]:
- [NEVER] List every file—codemap is "map of country, not atlas of its states."
- [NEVER] Include generated or build output directories.

---
### [3.4][KEY_DESIGN_DECISIONS]

Summarize architectural decisions with links to full ADRs. Each entry states decision, primary justification, ADR reference.

[IMPORTANT]:
1. [ALWAYS] **Link to ADRs:** Every summarized decision links to its full ADR for context and consequences.
2. [ALWAYS] **Current state only:** List only decisions that are currently Accepted — Deprecated and Superseded decisions belong in the ADR index.

---
### [3.5][CROSS_CUTTING_CONCERNS]

Document patterns spanning multiple components:

| [INDEX] | [CONCERN]          | [DOCUMENT]                             |
| :-----: | ------------------ | -------------------------------------- |
|   [1]   | **Authentication** | Auth mechanism, token flow, boundaries |
|   [2]   | **Error handling** | Error types, propagation, boundaries   |
|   [3]   | **Logging**        | Strategy, levels, structured format    |
|   [4]   | **Observability**  | Metrics, traces, health checks         |
|   [5]   | **Caching**        | Strategy, invalidation, boundaries     |

---
### [3.6][INVARIANTS]

System-level invariants—properties that must always hold true regardless of state. Document as numbered list with rationale.

[IMPORTANT]:
1. [ALWAYS] **Testable:** Each invariant must be verifiable by an automated test or architectural fitness function.
2. [ALWAYS] **Consequence-linked:** State what breaks if the invariant is violated.

---
## [4][VALIDATION]
>**Dictum:** *Gates prevent incomplete architecture documentation.*

<br>

[VERIFY]:
- [ ] System Overview states business problem and includes C4 Context diagram.
- [ ] High-Level Architecture shows 3-7 components with directional data flow.
- [ ] Codemap maps source directories to architectural concepts.
- [ ] Key Design Decisions link to corresponding ADRs.
- [ ] Cross-Cutting Concerns document auth, error handling, logging, observability.
- [ ] No implementation details (class names, file paths) in high-level diagrams.
- [ ] Diagrams use Mermaid syntax with descriptive node labels.
- [ ] Invariants are testable and consequence-linked.
