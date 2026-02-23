# [H1][README_GEN]
>**Dictum:** *README generation requires project exploration before documentation.*

<br>

Generation-specific instructions for creating and updating README files at any level — project root, package, module, or directory hub. Canonical structure defined in `docs/standards/readme-standards.md` — this reference covers operational workflow and content generation.

---
## [1][EXPLORATION_PHASE]
>**Dictum:** *Read the project before writing about it.*

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

Title matches the package/project name exactly. Badges in order: CI status, coverage, latest version, license. Badge URLs use shields.io format. Omit badges with no backing service.

### [2.2][DESCRIPTION]

Three components in one paragraph:
1. What the project does (capability).
2. What problem it solves (motivation).
3. What distinguishes it from alternatives (differentiation).

No feature lists. No "this project is a..." framing. Direct statement of purpose.

### [2.3][INSTALL]

Per-environment installation with exact commands. Four required elements:

| [INDEX] | [ELEMENT]                | [EXAMPLE]                          |
| :-----: | ------------------------ | ---------------------------------- |
|   [1]   | **Runtime prerequisite** | `Node.js >=20, pnpm >=9`          |
|   [2]   | **Install command**      | `pnpm add @parametric/core`        |
|   [3]   | **Verification command** | `pnpm exec parametric --version`   |
|   [4]   | **Expected output**      | Version string or success sentinel |

Each command is a standalone fenced code block — no prose wrapping around code. Prerequisites appear as bold inline before the first command block.

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

C4 Level 1 (System Context): the project as one box with external actors and dependencies. Two components rendered in sequence — a Mermaid diagram followed by a responsibility table:

**Diagram:** A `mermaid` fenced code block showing `graph LR` with directional edges labeled by protocol (`REST`, `gRPC`, `events`). Limit to 3-7 nodes representing top-level bounded contexts.

**Responsibility table:** One row per module with bold module name and one-line responsibility statement.

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

Five scope levels determine section selection, depth, and target audience.

| [INDEX] | [SCOPE]               | [LOCATION]                 | [AUDIENCE]              |
| :-----: | --------------------- | -------------------------- | ----------------------- |
|   [1]   | **Project root**      | `./README.md`              | Evaluator → Contributor |
|   [2]   | **Package/workspace** | `packages/*/README.md`     | Adopter → Contributor   |
|   [3]   | **Module/feature**    | `src/modules/*/README.md`  | Contributor             |
|   [4]   | **Directory hub**     | `docs/README.md`           | Navigator               |
|   [5]   | **Docs subsection**   | `docs/reference/README.md` | Navigator               |

**Section requirements per scope:**

**Project root** — Full 12-section structure per `readme-standards.md`. Progressive disclosure from evaluator through contributor tiers.<br>
**Package/workspace** — Title, Description, Install, Usage, API, License. Scoped to the package's own manifest and published name.<br>
**Module/feature** — Title, Description, Architecture, API. Internal-facing; documents bounded context boundaries.<br>
**Directory hub** — Title, Description, Navigation index linking to child documents.<br>
**Docs subsection** — Title, Description, Registry table linking to child resources.

### [3.2][SCOPE_SELECTION]

Determine scope by context:
1. **Root request** (no path qualifier, new project) → Project root.
2. **Package/workspace** (`packages/*`, `apps/*`, workspace manifest references module) → Package scope.
3. **Module/feature** (`src/modules/*`, `src/features/*`, bounded context boundary) → Module scope.
4. **Directory with child docs** (`docs/`, `docs/reference/`, `docs/decisions/`) → Directory hub.

### [3.3][DIRECTORY_HUB_PATTERN]

Directory hub READMEs serve as navigation indexes. Three structural elements in order:

1. **H1 title** matching the directory name.
2. **One-line description** stating the directory's purpose.
3. **Contents table** with `[DOCUMENT]` and `[DESCRIPTION]` columns, each row linking to a child `.md` file via relative path.

The contents table uses standard markdown link syntax: `[filename.md](./filename.md)` in the document column, with a one-line description in the second column. Auto-discover all `.md` files in the directory — omit no files, invent no files.

[IMPORTANT]:
1. [ALWAYS] **Relative links:** All links relative to the hub file location.
2. [ALWAYS] **Alphabetical order:** Sort entries by filename for predictable navigation.

[CRITICAL]:
- [NEVER] Duplicate child document content in the hub — link to it.
- [NEVER] Create hub READMEs for directories with fewer than 2 documentation files.

### [3.4][MONOREPO_PACKAGES]

Per-package READMEs in monorepo workspaces:
1. Read the package's own manifest (`package.json`, `*.csproj`) — not the root manifest.
2. Install section references workspace commands: `pnpm add @scope/package` from root, not `cd packages/foo && npm install`.
3. Usage examples import from the published package name, not relative paths.
4. Cross-reference the root README for shared setup (prerequisites, workspace install).
5. Architecture section optional — include only when the package has internal module boundaries.

---
## [4][PROJECT_TYPE_ADAPTATIONS]
>**Dictum:** *Project type determines section emphasis and ordering.*

<br>

**Library** — Install emphasizes package manager commands. Usage shows import + API call. Architecture minimal (public API surface only).<br>
**Service** — Install emphasizes Docker/compose + environment variables. Usage shows `curl` + expected response. Architecture full (system context + data flow).<br>
**CLI** — Install emphasizes binary installation + PATH configuration. Usage shows primary command + truncated output. Architecture minimal.<br>
**Monorepo** — Install emphasizes root workspace setup. Usage shows per-package examples with cross-references. Architecture full (workspace dependency graph).

---
## [5][UPDATE_WORKFLOW]
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
