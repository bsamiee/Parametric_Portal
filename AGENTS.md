# Parametric Portal Agent Guide

Condensed, no-bloat instructions for Codex agents. Treat this as a quick checklist; `REQUIREMENTS.md` and `CLAUDE.md` remain the source of truth.

## Scope
- Monorepo: Nx + Vite + Effect. Packages export mechanisms; apps define values.
- Use the existing patterns in `packages/server`, `packages/runtime`, `packages/theme`, `packages/database`, `apps/api`.

## Non-negotiables
- Surgical, minimal diffs; follow established patterns before proposing changes.
- Always refactor existing code bodies; avoid parallel implementations.
- No wrappers, scattered helpers, or single-use factories; consolidate into namespace objects.
- No aliases/redefinitions/indirection: no renaming indirection, no redundant type/value aliases.
- No barrels (`index.ts`), no inline exports, no default exports (except `*.config.ts`).
- No `any`, no `let`/`var`, no `for`/`while`, no `try/catch`.
- No hand-rolled utilities that exist in external libs; import types directly from libs.
- Comments only for "why", never "what". No meta-commentary in output files.

## Types & schemas
- Derive types from schemas/tables: `type X = S.Schema.Type<typeof XSchema>`; `type User = typeof users.$inferSelect`.
- Use branded primitives from `@parametric-portal/types/types`.
- Client errors: `@parametric-portal/types/app-error`. HTTP errors: `@parametric-portal/server/http-errors`.
- Prefer TS 6.0-dev features (`satisfies`, const type params, `using`) to reduce type/const count.
- Use ts-toolbelt, ts-essentials, type-fest to avoid custom type utilities.
- Import official objects from external libs; do not re-define or re-wrap library primitives.

## Algorithmic/parametric rules
- One base constant `_CONFIG` per file; derive all values from `_CONFIG`.
- No numeric literals in logic except `_CONFIG`; show explicit arithmetic.
- Expose tuning at call-sites via params; normalize `T | ReadonlyArray<T>` with `Array.isArray()`.
- Prefer dense constants over constant spam; fold related values into `_CONFIG`.

## Effect patterns
- Use `pipe`, `Effect.map`, `Effect.flatMap`, `Effect.andThen`, `Effect.tap`, `Effect.gen`, `Effect.fn` for composition.
- Core Effect surface (use official APIs, no re-wrapping): `Schema`, `Data`, `Context`, `Layer`, `Config`, `Schedule`, `Option`, `Either`, `Stream`, `Metric`, `Duration`, `Match`.
- Match: prefer `Match.value(...).pipe(Match.when/Match.tag/Match.orElse/Match.exhaustive)` for branching.
- Data: prefer `Data.TaggedError`, `Data.taggedEnum` for error ADTs over custom classes.
- Context: use `Context.Tag`/`Effect.Service` and `Context.Tag.Service<typeof X>` for service types; avoid ad-hoc DI.
- Layer: build with `Layer.succeed`, `Layer.effect`, `Layer.mergeAll`, `Layer.provide`, `Layer.unwrapEffect`; avoid manual wiring.
- Experimental surface: `RateLimiter`, `Machine`, `VariantSchema` (use before custom variants/engines).
- Use `Option.fromNullable` + `Option.match` for nullables.
- Prefer dispatch tables for variants; ternary ok for binary; `if` only in `Effect.gen`.

## File layout
- Use section separators and order:
  `// --- [TYPES] ...` → `[SCHEMA]` → `[CONSTANTS]` → `[CLASSES]` → `[SERVICES]`
  → `[PURE_FUNCTIONS]` → `[DISPATCH_TABLES]` → `[EFFECT_PIPELINE]`
  → `[LAYERS]` → `[ENTRY_POINT]` → `[EXPORT]`
- Domain extensions: `[TABLES]`, `[RELATIONS]`, `[REPOSITORIES]`, `[GROUPS]`, `[MIDDLEWARE]`.

## Monorepo boundaries
- `packages/*`: types, schemas, factories, CSS variable slots. `apps/*`: concrete values.
- No color/font/spacing literals in `packages/*`; use CSS variables and theme generation.
- Theme: OKLCH + Tailwind v4; apps must import `@parametric-portal/theme/base.css`.

## Tooling & workflow
- Stack: TypeScript 6.0-dev, React 19 canary, Vite 7, Effect 3.19, Tailwind v4, LightningCSS, Nx 22.
- Nx commands only via `pnpm exec nx <target>`; never bare `nx`.
- Dependencies must use `pnpm-workspace.yaml` catalog (`catalog:`).
- Quality: Biome, Vitest, Sonar; 80% V8 coverage minimum.
- Research: verify APIs with official changelogs within last 6 months.

## Output norms
- No emojis; use `[TAG]` markers if needed.
- Use backticks for file paths, symbols, and CLI commands.
- Keep responses concise and actionable.
