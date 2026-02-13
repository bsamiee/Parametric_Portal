# [H1][UNIT_PBT_TEMPLATE]
>**Dictum:** *Scaffold for algebraic property-based test files targeting `packages/server/` modules.*

<br>

<!-- ┌─────────────────────────────────────────────────────────────────────────────┐ -->
<!-- │ Placeholders: ${UPPER_SNAKE_CASE} — replace all before use.                 │ -->
<!-- │  Identity:  MODULE_NAME, BRIEF_DESCRIPTION, SUITE_NAME                      │ -->
<!-- │  Imports:   SOURCE_IMPORTS, SOURCE_PATH, EFFECT_IMPORTS                     │ -->
<!-- │  Setup:     STATIC_CONSTANTS, ARBITRARIES, LAYER_COMPOSITION, LAYER_NAME    │ -->
<!-- │  Tests:     PROPERTY_ID, LAW_NAME, PROPERTY_DESCRIPTION, PROPERTY_BODY      │ -->
<!-- │  Params:    ARB_PARAMS, DESTRUCTURED, NUM_RUNS (50-200)                     │ -->
<!-- │  Edges:     EDGE_CASE_ID, EDGE_DESCRIPTION, EDGE_CASE_EFFECTS, EXPECTED     │ -->
<!-- │                                                                             │ -->
<!-- │  Conditional: LAYER section — omit entirely when module has no services.    │ -->
<!-- │  Budget: 175 LOC flat cap. See SKILL.md §2 for section allocation.          │ -->
<!-- └─────────────────────────────────────────────────────────────────────────────┘ -->

```typescript
/**
 * ${MODULE_NAME} tests: ${BRIEF_DESCRIPTION}.
 */
import { it, layer } from '@effect/vitest';
import { ${SOURCE_IMPORTS} } from '@parametric-portal/server/${SOURCE_PATH}';
import { ${EFFECT_IMPORTS} } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
// Static known-answer vectors: UPPER_CASE + as const.
// Schema-derived arbitraries: _ prefix + Arbitrary.make(Schema).
// Hand-rolled arbitraries: _ prefix + fc.string/fc.integer/etc.

${STATIC_CONSTANTS}
${ARBITRARIES}

// --- [LAYER] -----------------------------------------------------------------
// Omit this section when the module under test has R=never (pure functions).
// When required: compose test layer with ConfigProvider overrides.

${LAYER_COMPOSITION}

layer(${LAYER_NAME})('${SUITE_NAME}', (it) => {
    // --- [ALGEBRAIC] ---------------------------------------------------------
    // Each it.effect.prop packs 1-4 related laws sharing the same arbitrary shape.
    // Callback MUST return void | Effect<void> — use block syntax { expect(...); }.

    // ${PROPERTY_ID}: ${LAW_NAME}
    it.effect.prop('${PROPERTY_ID}: ${PROPERTY_DESCRIPTION}', { ${ARB_PARAMS} }, ({ ${DESTRUCTURED} }) =>
        Effect.gen(function* () {
            ${PROPERTY_BODY}
        }), { fastCheck: { numRuns: ${NUM_RUNS} } });

    // --- [EDGE_CASES] --------------------------------------------------------
    // Boundary conditions producing specific tagged error codes.
    // Aggregate independent checks with Effect.all for density.

    it.effect('${EDGE_CASE_ID}: ${EDGE_DESCRIPTION}', () => Effect.all([
        ${EDGE_CASE_EFFECTS}
    ]).pipe(Effect.map((results) => expect(results).toEqual(${EXPECTED}))));
});
```

---
## [1][PLACEHOLDER_REFERENCE]
>**Dictum:** *Quick lookup — see inline comments above for usage guidance.*

<br>

| [PLACEHOLDER]          | [EXAMPLE]                                |
| ---------------------- | ---------------------------------------- |
| `MODULE_NAME`          | `Crypto`, `Diff`, `Transfer`             |
| `BRIEF_DESCRIPTION`    | `encryption, hashing, key derivation`    |
| `SOURCE_IMPORTS`       | `Crypto`, `{ Diff, DiffError }`          |
| `SOURCE_PATH`          | `security/crypto`, `utils/diff`          |
| `EFFECT_IMPORTS`       | `Effect, FastCheck as fc, Layer`         |
| `STATIC_CONSTANTS`     | `const CIPHER = { ... } as const;`       |
| `ARBITRARIES`          | `const _text = fc.string({ ... });`      |
| `LAYER_COMPOSITION`    | `const _testLayer = Svc.Default.pipe(…)` |
| `LAYER_NAME`           | `_testLayer`                             |
| `SUITE_NAME`           | `'Crypto'`, `'Diff'`                     |
| `PROPERTY_ID`          | `P1`, `P7`                               |
| `LAW_NAME`             | `inverse + nondeterminism`               |
| `PROPERTY_DESCRIPTION` | `round-trip preserves value`             |
| `ARB_PARAMS`           | `x: _text`, `x: _json, y: _json`         |
| `DESTRUCTURED`         | `x`, `x, y`                              |
| `PROPERTY_BODY`        | `expect(yield* Mod.decrypt(c)).toBe(x);` |
| `NUM_RUNS`             | `100`, `200` (range: 50-200)             |
| `EDGE_CASE_ID`         | `P4`, `P9`                               |
| `EDGE_DESCRIPTION`     | `format boundaries`                      |
| `EDGE_CASE_EFFECTS`    | `Mod.parse('').pipe(Effect.flip)`        |
| `EXPECTED`             | `['INVALID_FORMAT', 'MISSING_TYPE']`     |
