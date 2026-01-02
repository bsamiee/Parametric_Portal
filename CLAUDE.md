---
description: Senior developer protocol for Parametric Portal monorepo
alwaysApply: true
---

# [H1][CLAUDE_MANIFEST]
>**Dictum:** *Protocol governs agent execution in monorepo context.*

Operate as senior developer in bleeding-edge Nx/Vite/Effect monorepo with workflow-driven agentic automation (10 specialists). Align with `REQUIREMENTS.md` standards. Workspace queries via skill scripts: `nx-tools` (nx workspace), `github-tools` (gh CLI), `perplexity-tools` (web research), `exa-tools` (code search), `context7-tools` (library docs), `sonarcloud-tools` (code quality), `tavily-tools` (web crawl/extract).

---
## [1][BEHAVIOR]
>**Dictum:** *Constraints govern agent actions.*

<br>

[IMPORTANT]:
- [ALWAYS] Use new sources when conducting research; sources [MUST] be from 2025 and within last 6 months.
- [ALWAYS] Follow `docs/styleguide/voice.md` for code headers, comments, naming.
- [ALWAYS] Tools over internal knowledge—read files, search codebase, verify assumptions.
- [ALWAYS] Parallelize aggressively—run multiple searches, read several files, call independent tools concurrently.
- [ALWAYS] Reference symbols by name—avoid inline code blocks for context already shown.
- [ALWAYS] Use `nx-tools` skill scripts for workspace queries (zero MCP overhead).

[CRITICAL]:
- [NEVER] Use emojis; use `[X]` style markers with concise UPPERCASE formatting.
- [NEVER] Bypass Nx (breaks caching).
- [NEVER] Run bare `nx` commands; use `pnpm exec nx` (ensures correct binary resolution).

---
## [2][PHILOSOPHY]
>**Dictum:** *Philosophy principles guide implementation.*

<br>

[IMPORTANT]: **Bleeding-Edge** — Leverage newest stable APIs.
- [ALWAYS] Use TypeScript 6.0-dev features.
- [ALWAYS] Use React 19 canary, Vite 7, Effect 3.19 APIs.
- [ALWAYS] Prefer modern syntax: `using`, `satisfies`, const type parameters.
- [ALWAYS] Research docs ≤6 months old before implementation.
- [ALWAYS] Reject legacy patterns and deprecated methods.

[IMPORTANT]: **Functional-Monadic** — Write pure functions with monadic composition.
- [ALWAYS] Use `Effect` for async/failable operations.
- [ALWAYS] Use `Option.fromNullable` for nullable values.
- [MUST] Compose via `pipe()`, not nested calls.
- [MUST] Route errors through Effect channel, not `try/catch`.
- [MUST] Enforce immutability via `Object.freeze`, `ReadonlyArray`.

[IMPORTANT]: **Expression-Centric** — Write code as expressions, not statements.
- [ALWAYS] Use ternaries over `if/else`.
- [ALWAYS] Use `Option.match` over null checks.
- [ALWAYS] Use arrow functions with implicit returns.
- [ALWAYS] Replace switch/case with dispatch tables.

[CRITICAL]: **Expression-Centric** — Prohibited patterns.
- [NEVER] Use blocks `{}` when expression suffices.

[IMPORTANT]: **Algorithmic-Parametric** — Derive values algorithmically.
- [ALWAYS] Generate constants from base values.
- [ALWAYS] Expose tuning parameters at call-sites.
- [ALWAYS] Consolidate config into single `B` constant per file.
- [ALWAYS] Validate inputs via `@effect/schema`.
- [ALWAYS] Define domain primitives as branded types.

[CRITICAL]: **Algorithmic-Parametric** — Prohibited patterns.
- [NEVER] Hardcode values.

[IMPORTANT]: **Polymorphic-Dense** — Maximize functionality per LOC.
- [ALWAYS] Handle all modes via single factory function.
- [ALWAYS] Branch via dispatch tables: `handlers[mode](config)`.
- [ALWAYS] Narrow types via discriminated unions.
- [ALWAYS] Produce multiple outputs from one pipeline.
- [ALWAYS] Target 25-30 LOC per feature, complexity ≤25.

[IMPORTANT]: **Topology** — Packages export mechanisms; apps define values.
- [ALWAYS] Package B constants define CSS variable *slots* (`var(--prefix-key)`), not values.
- [ALWAYS] Package factories (`createX`) accept scale/behavior config; derive dimensions algorithmically.
- [ALWAYS] Apps define CSS variables in `main.css`; call factories in `theme.config.ts`/`ui.ts`.
- [ALWAYS] Packages own: types, schemas, factories, pure functions, dispatch tables.
- [ALWAYS] Apps own: CSS variable values, factory invocations, visual overrides.

[CRITICAL]: **Topology** — Prohibited patterns.
- [NEVER] Color/font/spacing literals in `packages/*`.

---
## [3][CONSTRAINTS]
>**Dictum:** *Constraints enforce code standards.*

<br>

[IMPORTANT]:
- [ALWAYS] Consolidate config into single frozen B constant per file.
- [ALWAYS] Branch via dispatch tables.
- [ALWAYS] Sequence async/failable via Effect pipelines.
- [ALWAYS] Handle nullable via Option monads.
- [ALWAYS] Define domain primitives as branded types.

[CRITICAL]:
- [NEVER] `any` → use branded types via @effect/schema.
- [NEVER] `let`/`var` → use `const` only.
- [NEVER] `if/else` → use dispatch tables.
- [NEVER] `for/while` → use `.map`, `.filter`, Effect.
- [NEVER] `try/catch` → use Effect error channel.
- [NEVER] Default exports → use named exports (except `*.config.ts`).
- [NEVER] Barrel files (`index.ts`) → consumers import directly from source.
- [NEVER] Re-export symbols → each module owns its exports.
- [NEVER] Inline exports → declare first, export at file end.
- [NEVER] Meta-commentary ("Sourced from...", "Confirmed with...") in output files.

---
## [4][OUTPUT]
>**Dictum:** *Output format optimizes readability.*

<br>

[IMPORTANT]:
- [ALWAYS] Use `backticks` for file paths, symbols, and CLI commands.
- [ALWAYS] Avoid large code blocks—reference file/symbol names instead.
- [ALWAYS] Use Markdown: headings for structure, bullets for lists, tables for comparisons.
- [ALWAYS] Keep responses actionable—lead with what changed, not what you will do.

<br>

### [4.1][DEPENDENCIES]

[IMPORTANT]:
1. [ALWAYS] **Check catalog**: `cat pnpm-workspace.yaml | grep my-dep`.
2. [ALWAYS] **Add to catalog** (if missing): `my-dep: 1.2.3` (exact version).
3. [ALWAYS] **Reference**: `"dependencies": { "my-dep": "catalog:" }`.
4. [ALWAYS] **Install**: `pnpm install`.
5. [ALWAYS] **Validate**: `nx run-many -t typecheck && nx run-many -t check`.

---
## [5][FILE_ORGANIZATION]
>**Dictum:** *Organization patterns enable navigation.*

<br>

[IMPORTANT] **Section separators**: `// --- [LABEL] ` + dashes to column 80. Labels: UPPERCASE, max 2 words, underscores for spaces, no parentheticals.

```typescript
// --- [TYPES] -----------------------------------------------------------------
// --- [SCHEMA] ----------------------------------------------------------------
// --- [CONSTANTS] -------------------------------------------------------------
// --- [PURE_FUNCTIONS] --------------------------------------------------------
// --- [DISPATCH_TABLES] -------------------------------------------------------
// --- [EFFECT_PIPELINE] -------------------------------------------------------
// --- [ENTRY_POINT] -----------------------------------------------------------
// --- [EXPORT] ----------------------------------------------------------------
```

**Canonical order** (omit unused): Types → Schema → Constants → Pure Functions → Dispatch Tables → Effect Pipeline → Entry Point → Export.<br>
**FORBIDDEN labels**: `Helpers`, `Handlers`, `Utils`, `Config`, any parentheticals.
