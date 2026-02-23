---
description: Structural specification for README documents
---

# [H1][README-STANDARDS]
>**Dictum:** *README structure determines project adoption velocity.*

<br>

[CRITICAL] README is the single entry point for every audience. Structure encodes progressive disclosure — each audience tier inherits prior tiers.

---
## [1][ANATOMY]
>**Dictum:** *Canonical sections in canonical order.*

<br>

Standard-README specification. Section order is fixed — never reorder.

| [INDEX] | [SECTION]             | [REQUIRED]  | [CONTENT]                                                          |
| :-----: | --------------------- | :---------: | ------------------------------------------------------------------ |
|   [1]   | **Title**             |     Yes     | Project name. Single `#` H1. No tagline — that belongs in [3].     |
|   [2]   | **Badges**            | Conditional | CI status, coverage, version, license. Omit if no CI.              |
|   [3]   | **Description**       |     Yes     | One paragraph. What the project does, why it exists.               |
|   [4]   | **Table of Contents** | Conditional | Required when >4 sections visible.                                 |
|   [5]   | **Security**          | Conditional | Vulnerability reporting instructions. Required for public repos.   |
|   [6]   | **Background**        | Conditional | Domain context, motivation, prior art. Required for novel domains. |
|   [7]   | **Install**           |     Yes     | Exact commands. Prerequisites. Environment requirements.           |
|   [8]   | **Usage**             |     Yes     | Minimum viable example — runnable, not comprehensive.              |
|   [9]   | **API**               | Conditional | Public surface reference. Required for libraries.                  |
|  [10]   | **Architecture**      | Conditional | System context + component overview. Required for services.        |
|  [11]   | **Contributing**      | Conditional | Setup, conventions, PR workflow. Required for open-source.         |
|  [12]   | **License**           |     Yes     | SPDX identifier. Link to LICENSE file.                             |

---
## [2][AUDIENCES]
>**Dictum:** *Each audience tier adds depth; none removes sections.*

<br>

| [INDEX] | [TIER]          | [TIME_BUDGET] | [SECTIONS_REQUIRED]          | [DEPTH]                                     |
| :-----: | --------------- | :-----------: | ---------------------------- | ------------------------------------------- |
|   [1]   | **Evaluator**   |    30 sec     | Title, Description, Badges   | Scan-quality: can this solve my problem?    |
|   [2]   | **Adopter**     |    10 min     | + Install, Usage, License    | Setup-quality: can I get this running?      |
|   [3]   | **Contributor** |    30 min     | + Architecture, Contributing | Orientation-quality: where does my code go? |

[IMPORTANT]:
1. [ALWAYS] **Progressive disclosure:** Evaluator content precedes Adopter content precedes Contributor content within every section.
2. [ALWAYS] **Install-first for libraries:** Place Install immediately after Description when the project is consumed as a dependency.
3. [ALWAYS] **Architecture-first for services:** Place Architecture before Install when the project deploys as a standalone system.

---
## [3][SECTIONS]
>**Dictum:** *Per-section content requirements eliminate ambiguity.*

<br>

### [3.1][DESCRIPTION]

One paragraph. Three components: what it does, what problem it solves, what distinguishes it from alternatives. No feature lists — feature lists belong in Usage or API.

### [3.2][INSTALL]

Exact shell commands for each supported environment. Prerequisites table: runtime version, required system dependencies, environment variables. Verification command proving successful installation.

### [3.3][USAGE]

Minimum viable example: the smallest working invocation that demonstrates primary value. Runnable — not pseudocode, not truncated. For libraries: importable code block. For services: `curl` or CLI command with expected output. For CLIs: help output + primary command.

### [3.4][ARCHITECTURE]

System context diagram (C4 Level 1): the project as a single box with external dependencies and consumers. Component overview: 3-7 primary modules with one-line responsibility descriptions. Dependency direction: arrows show data flow, not import direction.

[IMPORTANT]:
- [ALWAYS] **Concrete over abstract:** Exact module names, exact file paths.
- [ALWAYS] **Diagram reference:** Mermaid inline or link to rendered diagram.

[CRITICAL]:
- [NEVER] Implementation details in Architecture — Architecture shows structure, not logic.
- [NEVER] Class diagrams — use component or container diagrams.

---
## [4][PROJECT_TYPE_ROUTING]
>**Dictum:** *Project type determines section emphasis.*

<br>

| [INDEX] | [PROJECT_TYPE] | [EMPHASIS_SECTIONS]             | [SECTION_ORDER_OVERRIDE]                     |
| :-----: | -------------- | ------------------------------- | -------------------------------------------- |
|   [1]   | **Library**    | Install, API, Usage             | Title → Description → Install → Usage → API  |
|   [2]   | **Service**    | Architecture, Install, Usage    | Title → Description → Architecture → Install |
|   [3]   | **CLI**        | Install, Usage                  | Title → Description → Install → Usage        |
|   [4]   | **Monorepo**   | Architecture, Install, packages | Title → Description → Architecture → Install |

---
## [5][VALIDATION]
>**Dictum:** *Gates prevent incomplete documentation.*

<br>

[VERIFY] Completion:
- [ ] Title is single H1 matching project/package name.
- [ ] Description is one paragraph with what/why/distinction.
- [ ] Install commands are copy-pasteable and verified.
- [ ] Usage example is runnable — not pseudocode.
- [ ] All conditional sections included per project type routing.
- [ ] Audience tiers are progressively disclosed — evaluator content first.
- [ ] No implementation details in Architecture section.
- [ ] License section contains SPDX identifier.
