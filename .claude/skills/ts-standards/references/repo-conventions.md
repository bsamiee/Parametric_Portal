# [H1][REPO_CONVENTIONS]
>**Dictum:** *Conventions become policy only when measurable and automated.*

---
## [1][SOURCES_OF_TRUTH]

Authoritative sources: `CLAUDE.md` and `REQUIREMENTS.md`.

---
## [2][FORMATTING]

| [INDEX] | [RULE]                              | [SCOPE]                     |
| :-----: | ----------------------------------- | --------------------------- |
|   [1]   | 4-space indentation                 | TypeScript source           |
|   [2]   | Biome formatter disabled for TS src | configured in `biome.json`  |
|   [3]   | Skill files LOC cap                 | `<=275` per file            |

---
## [3][VALIDATION_COMMANDS]

| [INDEX] | [COMMAND]                                                                                | [PURPOSE]                         |
| :-----: | ---------------------------------------------------------------------------------------- | --------------------------------- |
|   [1]   | `bash ./.claude/skills/ts-standards/scripts/validate-ts-standards.sh --mode check`      | policy gate                       |
|   [2]   | `pnpm run check:ts-standards`                                                            | package command alias             |
|   [3]   | `pnpm exec nx run-many -t typecheck`                                                     | type-level safety                 |

---
## [4][PUBLIC_API_POLICY]
>**Dictum:** *Minimal package exports force better internal integration.*

| [PACKAGE] | [ALLOWED_EXPORTS] |
| --------- | ----------------- |
| `@parametric-portal/server` | `./api`, `./runtime`, `./errors`, `./testing` |
| `@parametric-portal/database` | `./runtime`, `./models`, `./migrator`, `./testing` |

[CRITICAL]:
- [NEVER] export `_`-prefixed symbols.
- [NEVER] add new subpath exports without policy update.

---
## [5][IMPORT_POLICY]
>**Dictum:** *Consumers depend on package capabilities, not package internals.*

[CRITICAL]:
- [NEVER] deep-import unapproved server/database subpaths.
- [NEVER] import internal wiring modules from external packages.

---
## [6][NO_IF_POLICY]
>**Dictum:** *Closed control flow stays algebraic.*

[CRITICAL]:
- [NEVER] `if (...)` in TypeScript policy scope.
- [NEVER] `Effect.if(...)`.
- [ALWAYS] use `Match.type`, `Match.value`, `Option.match`, or `Effect.filterOrFail`.

---
## [7][FILE_ORGANIZATION]

Canonical order (omit unused): Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export.

Forbidden section labels: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.

---
## [8][SNIPPET_POLICY]

[IMPORTANT]:
- [ALWAYS] reference snippet IDs from [snippets.md](./snippets.md) before introducing new structural patterns.
- [ALWAYS] keep snippet-heavy code in `snippets.md` to avoid reference-file bloat.
