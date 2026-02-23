# [H1][README_GEN]
>**Dictum:** *README generation requires project exploration before documentation.*

<br>

Generation-specific instructions for creating and updating README files at any level — project root, package, module, or directory hub. Canonical structure defined in `docs/standards/readme-standards.md`; this reference covers operational workflow and content generation.

---
## [1][EXPLORATION_PHASE]
>**Dictum:** *Read project before writing about it.*

<br>

Before generating any README content, gather:

| [INDEX] | [SOURCE]                                                        | [EXTRACTS]                           |
| :-----: | --------------------------------------------------------------- | ------------------------------------ |
|   [1]   | Package manifest (`*.csproj`, `pyproject.toml`, `package.json`) | Name, version, dependencies, scripts |
|   [2]   | Entry points (`Program.cs`, `main.py`, `index.ts`)              | Primary invocation path              |
|   [3]   | Configuration files (`.env.example`, `appsettings.json`)        | Environment requirements             |
|   [4]   | CI/CD files (`.github/workflows/`, `Dockerfile`)                | Build/deploy commands                |
|   [5]   | Existing documentation (`docs/`, `*.md` in root)                | Prior art, established conventions   |
|   [6]   | Test configuration (`xunit`, `pytest.ini`, `vitest.config`)     | Test execution commands              |

[CRITICAL]:
- [NEVER] Generate README content from assumptions — verify every command by reading configuration.
- [NEVER] Describe architecture from file tree alone — read module-level comments and service boundaries.

---
## [2][SECTION_CATALOG]
>**Dictum:** *Per-section requirements eliminate content ambiguity.*

<br>

### [2.1][TITLE_AND_BADGES]

Title matches package/project name exactly. Badges in order: CI status, coverage, latest version, license. Badge URLs use shields.io format; omit badges with no backing service.

### [2.2][DESCRIPTION]

Three components in one paragraph:
1. What project does (capability).
2. What problem it solves (motivation).
3. What distinguishes it from alternatives (differentiation).

Omit feature lists and "this project is a..." framing; state purpose directly.

### [2.3][INSTALL]

Per-environment installation with exact commands. Four required elements:

| [INDEX] | [ELEMENT]                | [EXAMPLE]                          |
| :-----: | ------------------------ | ---------------------------------- |
|   [1]   | **Runtime prerequisite** | `Node.js >=20, pnpm >=9`           |
|   [2]   | **Install command**      | `pnpm add @parametric/core`        |
|   [3]   | **Verification command** | `pnpm exec parametric --version`   |
|   [4]   | **Expected output**      | Version string or success sentinel |

Each command is a standalone fenced code block; no prose wrapping around code. Prerequisites appear as bold inline before first command block.

[CRITICAL]:
- [NEVER] Nest code fences inside markdown fences — each code block stands alone with its language tag.
- [NEVER] Include IDE setup, editor extensions, or optional tooling in Install.

### [2.4][USAGE]

Minimum viable example — the smallest working invocation demonstrating primary value.

| [INDEX] | [PROJECT_TYPE] | [EXAMPLE_FORMAT]                                         |
| :-----: | -------------- | -------------------------------------------------------- |
|   [1]   | **Library**    | Import + function call + expected output as comment      |
|   [2]   | **Service**    | `curl` request + JSON response                           |
|   [3]   | **CLI**        | Command invocation + truncated output (first 5-10 lines) |
|   [4]   | **Monorepo**   | Per-package example with cross-reference links           |

### [2.5][ARCHITECTURE]

C4 Level 1 (System Context): project as one box with external actors and dependencies. Two components rendered in sequence — Mermaid diagram followed by responsibility table:

**Diagram:** `mermaid` fenced code block showing `graph LR` with directional edges labeled by protocol (`REST`, `gRPC`, `events`); limit to 3-7 nodes representing top-level bounded contexts.

**Responsibility table:** One row per module with bold module name; one-line responsibility statement.

| [INDEX] | [MODULE]         | [RESPONSIBILITY]                                       |
| :-----: | ---------------- | ------------------------------------------------------ |
|   [1]   | **Gateway**      | HTTP ingress, auth token validation, request routing.  |
|   [2]   | **Identity**     | User registration, authentication, profile management. |
|   [3]   | **Commerce**     | Order lifecycle, payment orchestration, inventory.     |
|   [4]   | **Notification** | Email and push delivery triggered by domain events.    |

[CRITICAL]:
- [NEVER] Nest Mermaid fences inside markdown fences — the Mermaid block stands alone.
- [NEVER] Include implementation-level detail (class names, file paths) — only bounded contexts and data flow direction.

---
## [3][SCOPE_ROUTING]
>**Dictum:** *README scope determines section selection and depth.*

<br>

### [3.1][SCOPE_TYPES]

Five scope levels determine section selection; depth; and target audience.

| [INDEX] | [SCOPE]               | [LOCATION]                 | [AUDIENCE]              |
| :-----: | --------------------- | -------------------------- | ----------------------- |
|   [1]   | **Project root**      | `./README.md`              | Evaluator → Contributor |
|   [2]   | **Package/workspace** | `packages/*/README.md`     | Adopter → Contributor   |
|   [3]   | **Module/feature**    | `src/modules/*/README.md`  | Contributor             |
|   [4]   | **Directory hub**     | `docs/README.md`           | Navigator               |
|   [5]   | **Docs subsection**   | `docs/reference/README.md` | Navigator               |

**Section requirements per scope:**

**Project root** — Full 12-section structure per `readme-standards.md`; progressive disclosure from evaluator through contributor tiers.<br>
**Package/workspace** — Title, Description, Install, Usage, API, License; scoped to package's own manifest and published name.<br>
**Module/feature** — Title, Description, Architecture, API; internal-facing documentation of bounded context boundaries.<br>
**Directory hub** — Title, Description, Navigation index linking to child documents.<br>
**Docs subsection** — Title, Description, Registry table linking to child resources.

---
### [3.2][SCOPE_SELECTION]

Determine scope by context:
1. **Root request** (no path qualifier, new project) → Project root.
2. **Package/workspace** (`packages/*`, `apps/*`, workspace manifest references module) → Package scope.
3. **Module/feature** (`src/modules/*`, `src/features/*`, bounded context boundary) → Module scope.
4. **Directory with child docs** (`docs/`, `docs/reference/`, `docs/decisions/`) → Directory hub.

---
### [3.3][DIRECTORY_HUB_PATTERN]

Directory hub READMEs serve as navigation indexes. Three structural elements in order:

1. **H1 title** matching the directory name.
2. **One-line description** stating the directory's purpose.
3. **Contents table** with `[DOCUMENT]` and `[DESCRIPTION]` columns, each row linking to a child `.md` file via relative path.

Contents table uses standard markdown link syntax: `[filename.md](./filename.md)` in document column; one-line description in second column. Auto-discover all `.md` files in directory; omit no files, invent no files.

[IMPORTANT]:
1. [ALWAYS] **Relative links:** All links relative to the hub file location.
2. [ALWAYS] **Alphabetical order:** Sort entries by filename for predictable navigation.

[CRITICAL]:
- [NEVER] Duplicate child document content in the hub — link to it.
- [NEVER] Create hub READMEs for directories with fewer than 2 documentation files.

---
### [3.4][MONOREPO_PACKAGES]

Per-package READMEs in monorepo workspaces:
1. Read package's own manifest (`package.json`, `*.csproj`); not root manifest.
2. Install section references workspace commands: `pnpm add @scope/package` from root, not `cd packages/foo && npm install`.
3. Usage examples import from published package name, not relative paths.
4. Cross-reference root README for shared setup (prerequisites, workspace install).
5. Architecture section optional; include only when package has internal module boundaries.

---
## [4][DIATAXIS_CLASSIFICATION]
>**Dictum:** *Every document targets one quadrant — mixing quadrants serves no audience well.*

<br>

Diátaxis framework classifies documentation into four quadrants. READMEs are primarily **Reference** documents with **How-To** elements.

| [INDEX] | [QUADRANT]      | [PURPOSE]                  | [README_APPLICATION]                                     |
| :-----: | --------------- | -------------------------- | -------------------------------------------------------- |
|   [1]   | **Tutorial**    | Learning-oriented          | Not a README concern. Tutorials live in `docs/tutorials/`. |
|   [2]   | **How-To**      | Task-oriented              | Install and Usage sections. Step-by-step, assumes competence. |
|   [3]   | **Reference**   | Information-oriented       | API, Configuration, Architecture sections. Lookup-focused. |
|   [4]   | **Explanation** | Understanding-oriented     | Description, Background sections. Context and rationale. |

**Classification rules per README section:**

**How-To sections** (Install, Usage, Contributing) — Assume competence; provide exact commands and expected outcomes; handle real-world variations with conditionals; omit foundational concepts.<br>
**Reference sections** (API, Configuration, Architecture) — Factual, precise, indexed; structured for lookup, not sequential reading; no narrative explanation.<br>
**Explanation sections** (Description, Background) — State context, motivation, trade-offs; answer "why" not "how."

[CRITICAL]:
- [NEVER] Mix tutorial content into a README — tutorials assume no prior knowledge and follow a single guided path. READMEs assume the reader chose this project deliberately.
- [NEVER] Embed reference tables inside how-to steps — separate the lookup material from the procedure.

---
## [5][PACKAGE_README]
>**Dictum:** *Package READMEs document capability boundaries, not project marketing.*

<br>

Package-level READMEs (scope [2] in §3.1) serve fundamentally different purpose than root-level READMEs. Root READMEs attract and onboard; package READMEs orient and enable contributors already inside codebase.

### [5.1][PACKAGE_SECTIONS]

Required sections for package/workspace READMEs in priority order:

| [INDEX] | [SECTION]              | [CONTENT]                                                     |
| :-----: | ---------------------- | ------------------------------------------------------------- |
|   [1]   | **Title**              | Package name matching `package.json` or `*.csproj` name.      |
|   [2]   | **Purpose**            | One-two sentences: what capability this package provides.     |
|   [3]   | **Ownership**          | Team name, point of contact, CODEOWNERS path.                 |
|   [4]   | **Dependencies**       | Internal (`@org/other-package`) and external, with versions.  |
|   [5]   | **API surface**        | Exported functions/types from the package entry point.        |
|   [6]   | **Usage examples**     | 2-3 common invocation patterns importing the published name.  |
|   [7]   | **Important files**    | Annotated listing of key source files and their purpose.      |
|   [8]   | **Testing**            | Commands to run tests locally, coverage expectations.         |
|   [9]   | **Build**              | Compilation commands if applicable. Omit for JIT packages.    |

---
### [5.2][OWNERSHIP_SECTION]

Enterprise packages require explicit ownership. Three elements:

1. **Team:** Organization team or squad name.
2. **Contact:** Point of contact for questions or escalation.
3. **CODEOWNERS:** Path to the CODEOWNERS entry governing this package.

---
### [5.3][IMPORTANT_FILES]

Annotated directory listing communicating which files matter and why; uses tree-style ASCII art with inline comments; maximum two levels of nesting.

**Generation rules:**
1. Read the actual directory — do not invent paths.
2. Mark the entry point (e.g., `index.ts`, `__init__.py`) with emphasis.
3. Group by concern: entry point → core logic → types → tests → configuration.
4. Skip generated, build output, and dependency directories.

---
### [5.4][DEPENDENCY_DOCUMENTATION]

Separate internal and external dependencies. Internal dependencies reference the workspace package name; external dependencies reference the npm/NuGet/PyPI package name with version constraint.

[IMPORTANT]:
1. [ALWAYS] **Internal first:** List internal workspace dependencies before external.
2. [ALWAYS] **Version constraints:** State minimum version or compatibility range for external dependencies.

[CRITICAL]:
- [NEVER] List transitive dependencies — only direct dependencies of this package.
- [NEVER] Reference root-level dependencies that this package does not directly import.

---
## [6][PROJECT_TYPE_ADAPTATIONS]
>**Dictum:** *Project type determines section emphasis and ordering.*

<br>

**Library** — Install emphasizes package manager commands; Usage shows import + API call; Architecture minimal (public API surface only).<br>
**Service** — Install emphasizes Docker/compose + environment variables; Usage shows `curl` + expected response; Architecture full (system context + data flow).<br>
**CLI** — Install emphasizes binary installation + PATH configuration; Usage shows primary command + truncated output; Architecture minimal.<br>
**Monorepo** — Install emphasizes root workspace setup; Usage shows per-package examples with cross-references; Architecture full (workspace dependency graph).

---
## [7][UPDATE_WORKFLOW]
>**Dictum:** *README updates are scoped — never regenerate from scratch.*

<br>

When updating an existing README:
1. Identify which sections are affected by the change (new dependency → Install; new API → Usage/API).
2. Read the current section content to preserve tone and structure.
3. Apply the minimum edit that brings the section current.
4. Verify no other section references stale information introduced by the change.

[IMPORTANT]:
1. [ALWAYS] **Preserve existing structure:** Do not reorganize sections unless the README violates readme-standards.md.
2. [ALWAYS] **Verify commands:** Run Install commands mentally against current package manifest.

[CRITICAL]:
- [NEVER] Regenerate a README from scratch when an update is requested — preserve author voice and accumulated context.
