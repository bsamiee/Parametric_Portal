# [H1][INTEGRATION_TEMPLATE]
>**Dictum:** *Scaffold for integration tests using testcontainers and/or MSW for boundary testing.*

<br>

<!-- ┌─────────────────────────────────────────────────────────────────────────────┐ -->
<!-- │ Placeholders: ${UPPER_SNAKE_CASE} — replace all before use.                 │ -->
<!-- │  Identity:  MODULE_NAME, BRIEF_DESCRIPTION, SUITE_NAME                      │ -->
<!-- │  Imports:   SOURCE_IMPORTS, SOURCE_PATH, EFFECT_IMPORTS, CONTAINER_IMPORTS  │ -->
<!-- │  Setup:     STATIC_CONSTANTS, ARBITRARIES                                   │ -->
<!-- │  Infra:     CONTAINER_SETUP, CONTAINER_START, CONTAINER_STOP                │ -->
<!-- │  Layer:     LAYER_COMPOSITION, LAYER_NAME                                   │ -->
<!-- │  Tests:     PROPERTY_ID, LAW_NAME, PROPERTY_DESCRIPTION, PROPERTY_BODY      │ -->
<!-- │  Params:    ARB_PARAMS, DESTRUCTURED, NUM_RUNS (15-50)                      │ -->
<!-- │  Errors:    ERROR_ID, ERROR_DESCRIPTION, ERROR_EFFECTS, EXPECTED            │ -->
<!-- │                                                                             │ -->
<!-- │  Conditional: CONTAINER_IMPORTS — use MSW imports when mocking HTTP.        │ -->
<!-- │  Budget: 175 LOC flat cap. See SKILL.md §2 for section allocation.          │ -->
<!-- └─────────────────────────────────────────────────────────────────────────────┘ -->

```typescript
/**
 * ${MODULE_NAME} integration tests: ${BRIEF_DESCRIPTION}.
 */
import { it, layer } from '@effect/vitest';
import { ${SOURCE_IMPORTS} } from '@parametric-portal/server/${SOURCE_PATH}';
import { ${EFFECT_IMPORTS} } from 'effect';
import { ${CONTAINER_IMPORTS} } from 'testcontainers';
import { expect, afterAll, beforeAll } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
// Test configuration for container setup: ports, credentials, timeouts.
// Schema-derived arbitraries: _ prefix + Arbitrary.make(Schema).

${STATIC_CONSTANTS}
${ARBITRARIES}

// --- [CONTAINERS] ------------------------------------------------------------
// Declare container references here; populate in beforeAll.
// Use GenericContainer for custom images, specialized containers for Postgres/Redis.

${CONTAINER_SETUP}

// --- [LAYER] -----------------------------------------------------------------
// Compose real service layer with container-provided connection config.
// ConfigProvider overrides bind service to ephemeral container ports.

${LAYER_COMPOSITION}

// --- [LIFECYCLE] -------------------------------------------------------------
// 60s timeout for container startup; cleanup in afterAll is mandatory.

beforeAll(async () => {
    ${CONTAINER_START}
}, 60_000);

afterAll(async () => {
    ${CONTAINER_STOP}
});

layer(${LAYER_NAME})('${SUITE_NAME}', (it) => {
    // --- [ALGEBRAIC] ---------------------------------------------------------
    // Roundtrip properties: insert-then-query, set-then-get, serialize-deserialize.
    // Lower NUM_RUNS (15-50) due to container overhead per case.

    // ${PROPERTY_ID}: ${LAW_NAME}
    it.effect.prop('${PROPERTY_ID}: ${PROPERTY_DESCRIPTION}', { ${ARB_PARAMS} }, ({ ${DESTRUCTURED} }) =>
        Effect.gen(function* () {
            ${PROPERTY_BODY}
        }), { fastCheck: { numRuns: ${NUM_RUNS} } });

    // --- [ERROR_PATHS] -------------------------------------------------------
    // Boundary error conditions: connection failure, constraint violation, timeout.
    // Aggregate independent checks with Effect.all for density.

    it.effect('${ERROR_ID}: ${ERROR_DESCRIPTION}', () => Effect.all([
        ${ERROR_EFFECTS}
    ]).pipe(Effect.map((results) => expect(results).toEqual(${EXPECTED}))));
});
```

---
## [1][PLACEHOLDER_REFERENCE]
>**Dictum:** *Quick lookup — see inline comments above for usage guidance.*

<br>

| [PLACEHOLDER]          | [EXAMPLE]                                   |
| ---------------------- | ------------------------------------------- |
| `MODULE_NAME`          | `DatabaseService`, `CacheService`           |
| `BRIEF_DESCRIPTION`    | `PostgreSQL roundtrip, Redis cache ops`     |
| `SOURCE_IMPORTS`       | `DatabaseService`, `CacheService`           |
| `SOURCE_PATH`          | `platform/database`, `platform/cache`       |
| `EFFECT_IMPORTS`       | `Effect, FastCheck as fc, Layer`            |
| `CONTAINER_IMPORTS`    | `GenericContainer, Wait`                    |
| `STATIC_CONSTANTS`     | `const DB_CONFIG = { ... } as const;`       |
| `ARBITRARIES`          | `const _record = Arbitrary.make(Schema);`   |
| `CONTAINER_SETUP`      | `const _pg = ...` (populated in beforeAll)  |
| `LAYER_COMPOSITION`    | `const _layer = Svc.Default.pipe(...)`      |
| `CONTAINER_START`      | `await container.start()`                   |
| `CONTAINER_STOP`       | `await container.stop()`                    |
| `LAYER_NAME`           | `_integrationLayer`                         |
| `SUITE_NAME`           | `'DatabaseService Integration'`             |
| `PROPERTY_ID`          | `P1`                                        |
| `LAW_NAME`             | `roundtrip (inverse)`                       |
| `PROPERTY_DESCRIPTION` | `insert then query returns same record`     |
| `ARB_PARAMS`           | `record: _record`                           |
| `DESTRUCTURED`         | `record`                                    |
| `PROPERTY_BODY`        | `const id = yield* Svc.insert(record); ...` |
| `NUM_RUNS`             | `30` (range: 15-50)                         |
| `ERROR_ID`             | `P3`                                        |
| `ERROR_DESCRIPTION`    | `connection failure`                        |
| `ERROR_EFFECTS`        | `Svc.query('bad').pipe(Effect.flip)`        |
| `EXPECTED`             | `['CONNECTION_ERROR']`                      |
