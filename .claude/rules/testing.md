---
paths: ["tests/**/*", "**/*.spec.*", "**/*.test.*"]
---

# Testing Infrastructure

## Framework

`@effect/vitest` as test harness. `it.effect()` for effectful tests, `it.scoped()` for scoped service lifecycle, `it.live()` for live environment, `it.scopedLive` for both. `it.layer(layer)` to share a single layer instance across a describe block. `it.effect.each(cases)` for parameterized effectful tests.

## Property-Based Testing

`it.effect.prop` with fast-check integration. `Arbitrary.make(MySchema)` generates values from Schema definitions — schema constraints (pattern, brand, min/max) translate directly to generator constraints. Custom arbitraries via `annotations({ arbitrary: () => fc => fc.constantFrom(...) })`. Deterministic seed in CI (`{ fastCheck: { seed, path } }`) for failure replay.

## Test Placement

All tests in `tests/` mirroring source structure. Spec files: `*.spec.ts`. Integration: `*.integration.spec.ts`.

## Time & Determinism

`TestClock.adjust(duration)` to advance virtual time — effects scheduled at or before current time execute immediately. `TestClock.setTime` for absolute positioning. Fork the fiber under test before advancing clock. `TestRandom.setSeed` for deterministic PRNG.

## Isolation

Every spec runnable in isolation — no shared mutable state between tests, no ordering dependency. `it.layer(layer)` shares a read-only layer across a describe block; stateful services require fresh layer instances per test via factory functions.

## Fakes Over Mocks

No mocking libraries. `Layer.succeed(Tag, stub)` for minimal service fakes with real schemas. `Layer.merge`, `Layer.mergeAll` for composing test harnesses.

## Mutation Testing

Stryker as mutation engine. Run: `pnpm exec stryker run`. Gates: 80+ pass, 60-79 investigate surviving mutants, below 50 build break. Enable `@stryker-mutator/typescript-checker` — branded types and refinements kill invalid mutants at compile time.

## Oracles

Expected values must be external to implementation. Known-answer vectors (NIST/RFC), differential testing against reference impl, metamorphic relations. Never paste source output as expected.

## Coverage

95% per-file threshold enforced via V8 provider. Run: `pnpm test:coverage`. Coverage gates are per-file, not aggregate — every source file must meet the threshold independently.
