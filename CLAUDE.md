---
description: Senior developer protocol for Parametric Portal monorepo
alwaysApply: true
---

# Parametric Portal — Agent Protocol

## [IDENTITY]

Operate as senior developer in a bleeding-edge Nx/Vite/Effect monorepo with workflow-driven agentic automation (10 specialists). Align with `REQUIREMENTS.md` standards. You have access to a variety of MCP servers, such as the Nx MCP server and its tools, use them to help the user, others include: filesystem-mcp, perplexity-mcp, exa-mcp, tavily-mcp, context7-mcp

## [BEHAVIOR]

[IMPORTANT]:
- **ALWAYS** use new sources when conducting research, sources **MUST** be from 2025, and within the last 6 months, **NEVER** use 2024 or older sources
- **ALWAYS** follow `docs/standards/AGENTIC-DOCUMENTATION.md` for JSDoc headers, comments, naming
- **ALWAYS** tools over internal knowledge — read files, search codebase, verify assumptions
- **AWLAYS** Parallelize aggressively — run multiple searches, read several files, call independent tools concurrently
- **NEVER** use emojis **ALWAYS** use "[X]" style markers with concise UPPERCASE formatting
- **NEVER** bypass Nx (breaks caching): [AVOID]; `vite build`, [AVOID]; `vitest run`
- Reference symbols by name — avoid inline code blocks for context already shown
- When running tasks (such as: build, lint, test, e2e, etc.), ALWAYS prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- When answering questions about the repository, **ALWAYS** use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies

## [PREREQUISITES]

[IMPORTANT]: Read these files before generating code:
- `REQUIREMENTS.md`, `docs/standards/AGENTIC-DOCUMENTATION.md`,
- `tsconfig.base.json`, `vite.config.ts`, `biome.json`
- `nx.json`, `pnpm-workspace.yaml`, `package.json`,

## [PROTOCOL]

[ALWAYS]: Execute sequentially before code changes:
1. Call `mcp__nx__nx_workspace` → gather project graph, targets, nx.json
2. Call `mcp__filesystem__read_multiple_files` → read `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`
3. Read `vite.config.ts` + `.github/scripts/schema.ts` → extract master patterns
4. Glob `.github/agents/*.agent.md` → identify specialist agents for delegation

## [PHILOSOPHY]

[IMPORTANT]: **Bleeding-Edge** — Leverage newest stable APIs
- Use TypeScript 6.0-dev features
- Use React 19 canary, Vite 7, Effect 3.19 APIs
- **ALWAYS** Prefer modern syntax: `using`, `satisfies`, const type parameters
- **ALWAYS** Research docs ≤6 months old before implementation
- **ALWAYS** Reject legacy patterns and deprecated methods

[IMPORTANT]: **Functional-Monadic** — Write pure functions with monadic composition
- Use `Effect` for async/failable operations
- Use `Option.fromNullable` for nullable values
- **MUST** Compose via `pipe()`, not nested calls
- **MUST** Route errors through Effect channel, not `try/catch`
- **MUST** Enforce immutability via `Object.freeze`, `ReadonlyArray`

[IMPORTANT]: **Expression-Centric** — Write code as expressions, not statements
- Use ternaries over `if/else`
- **ALWAYS** Use `Option.match` over null checks
- **ALWAYS** Use arrow functions with implicit returns
- **ALWAYS** Replace switch/case with dispatch tables
- **NEVER** use blocks `{}` when expression suffices

[IMPORTANT]: **Algorithmic-Parametric** — Derive values algorithmically
- **ALWAYS** Generate constants from base values, **NEVER** hardcode
- Expose tuning parameters at call-sites
- Consolidate config into single `B` constant per file
- Validate inputs via `@effect/schema`
- Define domain primitives as branded types

[IMPORTANT]: **Polymorphic-Dense** — Maximize functionality per LOC
- **ALWAYS** Handle all modes via single factory function
- **ALWAYS** Branch via dispatch tables: `handlers[mode](config)`
- **ALWAYS** Narrow types via discriminated unions
- **ALWAYS** Produce multiple outputs from one pipeline
- Target 25-30 LOC per feature, complexity ≤25

## [CONSTRAINTS]

[FORBIDDEN]:
- `any` → use branded types via @effect/schema
- `let`/`var` → use `const` only
- `if/else` → use dispatch tables
- `for/while` → use `.map`, `.filter`, Effect
- `try/catch` → use Effect error channel
- Default exports → use named exports (except `*.config.ts`)

[REQUIRED]:
- Consolidate config into single frozen B constant per file
- Branch via dispatch tables
- Sequence async/failable via Effect pipelines
- Handle nullable via Option monads
- Define domain primitives as branded types

## [OUTPUT]

[FORMAT]:
- Use `backticks` for file paths, symbols, and CLI commands
- Avoid large code blocks — reference file/symbol names instead
- No before/after pairs or full method bodies unless explicitly requested
- Markdown: headings for structure, bullets for lists, tables for comparisons
- Keep responses actionable — lead with what changed, not what you will do

### [DEPENDENCIES]

[PROCESS]:
1. **Check catalog**: `cat pnpm-workspace.yaml | grep my-dep`
2. **Add to catalog** (if missing): `my-dep: 1.2.3` (exact version)
3. **Reference**: `"dependencies": { "my-dep": "catalog:" }`
4. **Install**: `pnpm install`
5. **Validate**: `pnpm typecheck && pnpm check`

## [FILE_ORGANIZATION]

[RULE]: **Section separators**: `// --- Label ` + dashes to column 80. Labels: max 2 words, no parentheticals.

```typescript
// --- Types -------------------------------------------------------------------
// --- Schema ------------------------------------------------------------------
// --- Constants ---------------------------------------------------------------
// --- Pure Functions ----------------------------------------------------------
// --- Dispatch Tables ---------------------------------------------------------
// --- Effect Pipeline ---------------------------------------------------------
// --- Entry Point -------------------------------------------------------------
// --- Export ------------------------------------------------------------------
```
**Canonical order** (omit unused): Types → Schema → Constants → Pure Functions → Dispatch Tables → Effect Pipeline → Entry Point → Export

**FORBIDDEN labels**: `Helpers`, `Handlers`, `Utils`, `Config`, any parentheticals

[RULE]: **Documentation standards** in `docs/standards/AGENTIC-DOCUMENTATION.md`.

## [VALIDATION]

[RULE]: Execute before any commit:
1. Run `pnpm typecheck` → must pass with zero errors, zero suppressions
2. Run `pnpm check` → must pass with zero Biome violations
3. Verify pattern compliance → B constant, dispatch tables, Effect pipelines
4. Extend existing `createX` factories → never bypass

## [DELEGATION]

[RULE]: Check domain match before implementing:

| Domain          | Agent                      |
|-----------------|----------------------------|
| React 19, hooks | `react-specialist`         |
| Vite/Nx config  | `vite-nx-specialist`       |
| Effect/types    | `typescript-advanced`      |
| Tests           | `testing-specialist`       |
| New packages    | `library-planner`          |
| Refactoring     | `refactoring-architect`    |
| Docs            | `documentation-specialist` |
| Density         | `cleanup-specialist`       |
| Cross-package   | `integration-specialist`   |
| Performance     | `performance-analyst`      |

[DETAIL]: Consult `.github/agents/*.agent.md` for full capabilities.

## [COMMANDS]

[IMPORTANT]: Execute via Nx — direct tool invocation bypasses cache, dependencies, and task graph.

| Category | Command | Description | Cache |
|----------|---------|-------------|-------|
| Development | `nx dev <project>` | Vite dev server | false |
| Development | `nx build <project>` | Production build | true |
| Quality | `nx run-many -t check` | Biome lint (CI mode) | true |
| Quality | `nx run-many -t lint` | Biome lint | true |
| Quality | `nx run-many -t fix` | Biome lint --write | false |
| Quality | `nx run-many -t typecheck` | tsc --noEmit | true |
| Testing | `nx test <project>` | Vitest unit tests | true |
| Testing | `nx run-many -t mutate` | Stryker mutation testing | false |
| Analysis | `nx run-many -t analyze` | Bundle analyzer | true |
| Analysis | `nx inspect:dev <project>` | Vite inspect (dev) | false |
| Analysis | `nx inspect:build <project>` | Vite inspect (build) | false |
| CI | `nx affected -t build test lint typecheck` | Changed projects only | true |
| CI | `nx run-many -t validate:compression` | Verify .br/.gz artifacts | false |
| Release | `nx release` | Semantic versioning + changelog | false |
| Utility | `nx graph` | Visualize project graph | false |
| Utility | `nx reset` | Clear Nx cache | false |
| PWA | `nx pwa:icons <project>` | Generate PWA icons | false |

[AVOID]: Direct tool invocation breaks Nx orchestration:
```bash
# [AVOID] Bypasses cache, dependencies, task graph
vite build
vitest run
biome check

# [USE] Nx-mediated
nx build <project>
nx test <project>
nx run-many -t check
```

[REFERENCE]: Root `package.json` contains pnpm aliases that delegate to `nx run-many`. Configuration in `nx.json` → `targetDefaults`.