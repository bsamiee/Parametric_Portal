# [H1][CONTRACT_TEMPLATE]
>**Dictum:** *Scaffold for contract tests verifying schema compatibility, service tag shape, and layer composition across package boundaries.*

<br>

<!-- ┌─────────────────────────────────────────────────────────────────────────────┐ -->
<!-- │ Placeholders: ${UPPER_SNAKE_CASE} — replace all before use.                 │ -->
<!-- │  Identity:  PKG_A, PKG_B, BRIEF_DESCRIPTION, SUITE_NAME                     │ -->
<!-- │  Imports:   PKG_A_IMPORTS, PKG_A_PATH, PKG_B_IMPORTS, PKG_B_PATH            │ -->
<!-- │  Schemas:   PKG_A_SCHEMA, PKG_B_SCHEMA                                      │ -->
<!-- │  Services:  SERVICE_TAG_A, MINIMAL_IMPL_A, SERVICE_TAG_B, MINIMAL_IMPL_B    │ -->
<!-- │  Tests:     PROPERTY_ID, PROPERTY_DESCRIPTION, PROPERTY_BODY                │ -->
<!-- │  Params:    ARB_PARAMS, DESTRUCTURED, NUM_RUNS (50-100)                     │ -->
<!-- │  Edges:     EDGE_CASE_ID, EDGE_DESCRIPTION, EDGE_CASE_EFFECTS, EXPECTED     │ -->
<!-- │                                                                             │ -->
<!-- │  No vi.mock -- contract tests use real schemas + Layer.succeed for fakes.   │ -->
<!-- │  Budget: 175 LOC flat cap. See SKILL.md §2 for section allocation.          │ -->
<!-- └─────────────────────────────────────────────────────────────────────────────┘ -->

```typescript
/**
 * [${PKG_A} x ${PKG_B}] contract tests: ${BRIEF_DESCRIPTION}.
 */
import { it, layer } from '@effect/vitest';
import { ${PKG_A_IMPORTS} } from '@parametric-portal/${PKG_A_PATH}';
import { ${PKG_B_IMPORTS} } from '@parametric-portal/${PKG_B_PATH}';
import { Effect, Layer, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
// Schema-derived arbitraries from the exporting package.
// No hand-rolled arbitraries -- schemas are the source of truth.
${ARBITRARIES}

// --- [LAYER] -----------------------------------------------------------------
// Layer.succeed for minimal fakes satisfying each service tag's shape.
// No mocks -- real schemas and service tags with structural fakes only.
const _contractLayer = Layer.merge(
    Layer.succeed(${SERVICE_TAG_A}, ${MINIMAL_IMPL_A}),
    Layer.succeed(${SERVICE_TAG_B}, ${MINIMAL_IMPL_B}),
);

// --- [ALGEBRAIC] -------------------------------------------------------------

layer(_contractLayer)('contract: ${SUITE_NAME}', (it) => {
    // Schema roundtrip: values generated from PkgA decode through PkgB (and vice versa).
    // Service tag shape: minimal implementations satisfy service interface.
    // Layer merge: composed layers build without error.
    // ${PROPERTY_ID}: schema roundtrip
    it.effect.prop('${PROPERTY_ID}: ${PROPERTY_DESCRIPTION}', { ${ARB_PARAMS} }, ({ ${DESTRUCTURED} }) =>
        S.decodeUnknown(${PKG_A_SCHEMA})(${DESTRUCTURED}).pipe(
            Effect.andThen((decoded) => S.decodeUnknown(${PKG_B_SCHEMA})(decoded)),
            Effect.tap((result) => { expect(result).toBeDefined(); }),
            Effect.asVoid,
        ), { fastCheck: { numRuns: ${NUM_RUNS} } });
    // P2: service tag shape
    it.effect('P2: service tags accept minimal implementations', () => Effect.all([
        Effect.provideService(Effect.void, ${SERVICE_TAG_A}, ${MINIMAL_IMPL_A}),
        Effect.provideService(Effect.void, ${SERVICE_TAG_B}, ${MINIMAL_IMPL_B}),
    ]).pipe(Effect.asVoid));
    // P3: layer composition
    it.effect('P3: merged layers compose without error', () =>
        Effect.void.pipe(Effect.provide(_contractLayer), Effect.asVoid));
    // --- [EDGE_CASES] --------------------------------------------------------
    // Cross-package boundary incompatibilities: decode failures, missing fields.
    it.effect('${EDGE_CASE_ID}: ${EDGE_DESCRIPTION}', () => Effect.all([
        ${EDGE_CASE_EFFECTS}
    ]).pipe(Effect.map((results) => expect(results).toEqual(${EXPECTED}))));
});
```

---
## [1][PLACEHOLDER_REFERENCE]
>**Dictum:** *Quick lookup — see inline comments above for usage guidance.*

<br>

| [INDEX] | [PLACEHOLDER]          | [EXAMPLE]                                           |
| :-----: | ---------------------- | --------------------------------------------------- |
|   [1]   | `PKG_A`, `PKG_B`       | `server`, `database`                                |
|   [2]   | `BRIEF_DESCRIPTION`    | `schema compatibility, service tag shape`           |
|   [3]   | `PKG_A_IMPORTS`        | `{ UserSchema, UserService }`                       |
|   [4]   | `PKG_A_PATH`           | `server`                                            |
|   [5]   | `PKG_B_IMPORTS`        | `{ UserRow }`                                       |
|   [6]   | `PKG_B_PATH`           | `database`                                          |
|   [7]   | `PKG_A_SCHEMA`         | `UserSchema`                                        |
|   [8]   | `PKG_B_SCHEMA`         | `UserRow`                                           |
|   [9]   | `SERVICE_TAG_A`        | `UserService`                                       |
|  [10]   | `MINIMAL_IMPL_A`       | `{ findById: () => Effect.succeed(stubUser) }`      |
|  [11]   | `SERVICE_TAG_B`        | `DatabaseClient`                                    |
|  [12]   | `MINIMAL_IMPL_B`       | `{ query: () => Effect.succeed([]) }`               |
|  [13]   | `ARBITRARIES`          | `const _user = Arbitrary.make(UserSchema);`         |
|  [14]   | `SUITE_NAME`           | `'server x database'`                               |
|  [15]   | `PROPERTY_ID`          | `P1`                                                |
|  [16]   | `PROPERTY_DESCRIPTION` | `PkgA schema decodes PkgB-shaped values`            |
|  [17]   | `ARB_PARAMS`           | `input: UserSchema`                                 |
|  [18]   | `DESTRUCTURED`         | `input`                                             |
|  [19]   | `NUM_RUNS`             | `50` (range: 50-100)                                |
|  [20]   | `EDGE_CASE_ID`         | `P4`                                                |
|  [21]   | `EDGE_DESCRIPTION`     | `cross-package decode failures`                     |
|  [22]   | `EDGE_CASE_EFFECTS`    | `S.decodeUnknown(PkgA)({}).pipe(Effect.flip)`       |
|  [23]   | `EXPECTED`             | `[expect.objectContaining({ _tag: 'ParseError' })]` |

## [2][CONVENTIONS]

- **No `vi.mock`** -- contract tests use real schemas and service tags
- **`Layer.succeed(Tag, impl)`** for minimal fakes -- not full mock objects
- **Schema-as-arbitrary** -- pass Schema directly to `it.effect.prop` where possible
- **Cross-package imports** -- import from both packages under contract
- **4-space indentation**, section separators padded to column 80
