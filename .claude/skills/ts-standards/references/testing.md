# [H1][TESTING]
>**Dictum:** *Tests prove algebraic laws, isolate layers, and kill mutants -- deterministic time, property oracles, stub layers only.*

Cross-references: `services.md [4]` (Layer.succeed test doubles), `effects.md [1]` (Effect.gen composition), `CLAUDE.md [1.1]` (test/mutate commands)

---
## [1][EFFECT_VITEST_HARNESS]
>**Dictum:** *it.effect auto-injects TestServices; it.scoped adds Scope finalizers; it.live bypasses virtual time.*

Import `it` from `@effect/vitest`, `expect` from `vitest`. `it.effect` injects TestClock, TestRandom, TestConsole automatically. `it.scoped` runs Scope finalizers after assertion (acquireRelease cleanup). `it.live` / `it.scopedLive` use real time -- reserve for GC staleness windows, halfOpen timers, real I/O where virtual time is insufficient. `it.flakyTest` retries intermittently-failing tests.

```typescript
// --- [IMPORTS] ---------------------------------------------------------------
import { it, layer } from '@effect/vitest';
import { assertNone, assertSome } from '@effect/vitest/utils';
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, Ref, TestClock, TestRandom } from 'effect';
import { describe, expect } from 'vitest';
// --- [INLINE_OVERRIDE] ------------------------------------------------------
// why: Effect.provideService for single-dep override -- lighter than full Layer
it.effect('dispatches to correct channel', () =>
    Effect.gen(function* () {
        const result = yield* IngestionService.ingest('tenant-1', '{"event":"created"}');
        expect(result.accepted).toBe(true);
    }).pipe(Effect.provideService(IngestionService, {
        ingest: () => Effect.succeed({ accepted: true }),
    } as never)),
);
// why: Effect.flip inverts error to success channel -- assert typed error
it.effect('rejects invalid payload', () =>
    Effect.gen(function* () {
        const error = yield* IngestionService.ingest('t', 'bad').pipe(Effect.flip);
        expect(error._tag).toBe('IngestError');
    }).pipe(Effect.provideService(IngestionService, {
        ingest: () => Effect.fail(new IngestError({ operation: 'parse', reason: 'normalize' })),
    } as never)),
);
// --- [REF_TESTCLOCK_FIBER] ---------------------------------------------------
// why: canonical virtual-time retry test -- Ref counter + fork + TestClock + Fiber.await
it.effect('retry exhausts after N attempts', () =>
    Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail({ _tag: 'Transient', message: 'down' })),
        );
        const fiber = yield* pipe(
            Resilience.run('retry-test', failing, { retry: 'brief', circuit: false, timeout: false }),
            Effect.exit,
            Effect.fork,
        );
        yield* TestClock.adjust(Duration.seconds(30));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Ref.get(counter)).toBe(2);
    }).pipe(Effect.provide(Resilience.Layer)),
);
// --- [LIVE_TEST] -------------------------------------------------------------
// why: real timers for GC staleness -- virtual time cannot trigger wall-clock eviction
it.live('gc evicts stale circuits', () =>
    Effect.gen(function* () {
        yield* Circuit.make('stale-entry');
        yield* Effect.sleep(Duration.millis(50));
        expect(yield* Circuit.gc(25 as never)).toEqual({ removed: 1 });
    }).pipe(Effect.provide(Circuit.Layer)),
);
// why: scoped + live for halfOpen probe requiring real sleep
it.scopedLive('halfOpen probe resets circuit', () =>
    Effect.gen(function* () {
        const cb = yield* Circuit.make('probe', {
            breaker: { _tag: 'consecutive', threshold: 2 },
            halfOpenAfter: Duration.millis(100),
            persist: false,
        });
        yield* Effect.forEach([1, 2], () =>
            cb.execute(Effect.fail(new Error('trip'))).pipe(Effect.ignore),
        );
        expect(cb.state).toBe('Open');
        yield* Effect.sleep(Duration.millis(120));
        expect(yield* cb.execute(Effect.succeed('probe'))).toBe('probe');
    }).pipe(Effect.provide(Resilience.Layer)),
);
// --- [TESTRANDOM] ------------------------------------------------------------
// why: deterministic random for sampling/A-B tests
it.effect('deterministic random via feedIntegers', () =>
    Effect.gen(function* () {
        yield* TestRandom.feedIntegers(7, 3, 9);
        const first = yield* Effect.random.pipe(Effect.flatMap((r) => r.nextInt));
        expect(first).toBe(7);
    }),
);
```

---
## [2][PROPERTY_TESTS]
>**Dictum:** *Schema-direct for codec round-trips; fc.* for constrained input generation. Expected values are mathematical laws, never pasted output.*

`it.effect.prop` accepts `Schema.Schema.Any` (auto-generates fast-check Arbitrary internally) or `FC.Arbitrary<T>` for constrained domains. Schema-direct eliminates `Arbitrary.make()` wrapping. `fastCheck: { numRuns }` scales with test cost: 50 integration, 100 codecs, 200 pure laws.

```typescript
// --- [SCHEMA_DIRECT] ---------------------------------------------------------
// why: identity law -- decode(encode(x)) === x proves codec round-trip invariant
it.effect.prop('P1: preferences roundtrip identity',
    { prefs: NotificationService.Preferences },
    ({ prefs }) => Effect.gen(function* () {
        const encoded = yield* S.encode(NotificationService.Preferences)(prefs);
        const decoded = yield* S.decodeUnknown(NotificationService.Preferences)(encoded);
        expect(decoded).toEqual(prefs);
    }),
    { fastCheck: { numRuns: 100 } },
);
// --- [FC_ARBITRARIES] --------------------------------------------------------
// why: complement law -- retryable XOR non-retryable partitions error space
it.effect.prop('P2: non-retryable tags bypass retry',
    { tag: fc.constantFrom('Auth', 'Conflict', 'Forbidden', 'Gone', 'NotFound') },
    ({ tag }) => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail({ _tag: tag, message: `${tag} error` })),
        );
        const fiber = yield* pipe(
            Resilience.run(`noretry-${tag}`, failing, { retry: 'patient', circuit: false, timeout: false }),
            Effect.fork,
        );
        yield* TestClock.adjust(Duration.seconds(60));
        yield* Fiber.await(fiber);
        expect(yield* Ref.get(counter)).toBe(1);
    }).pipe(Effect.provide(Resilience.Layer)),
    { fastCheck: { numRuns: 7 } },
);
// why: inverse law -- encode then decode yields Option.some of original
it.effect.prop('P3: cursor encode/decode inverse',
    { id: fc.uuid(), v: fc.integer() },
    ({ id, v }) => Effect.gen(function* () {
        expect(yield* Page.decode(Page.encode(id, v, S.Int), S.Int))
            .toEqual(Option.some({ id, v }));
    }),
    { fastCheck: { numRuns: 100 } },
);
// why: boundary law -- in-range accepts, out-of-range rejects, omission defaults
it.effect.prop('P4: schema boundary validation',
    { maxAttempts: fc.integer({ min: -5, max: 15 }) },
    ({ maxAttempts }) => Effect.sync(() => {
        const result = S.decodeUnknownEither(RequestSchema)({ maxAttempts });
        expect(Either.isRight(result)).toBe(maxAttempts >= 1 && maxAttempts <= 10);
    }),
    { fastCheck: { numRuns: 200 } },
);
```

---
## [3][LAYER_TESTING]
>**Dictum:** *layer() shares one Layer build across describe; Layer.succeed(Tag, stub) for minimal fakes. 175 LOC cap per spec file.*

`layer(testLayer)('name', (it) => { ... })` builds Layer once for the block. `layer()` signature: `(layer, options?: { memoMap?, timeout?, excludeTestServices? }) => (name, fn) => void`. Use `Layer.provide` chaining for transitive deps. Test file organization: docstring, imports, constants, algebraic (P-prefixed), edge cases (E-prefixed).

```typescript
// --- [STUB_LAYER] ------------------------------------------------------------
// why: Layer.succeed(Tag, stub as never) -- real interface, no mock library
const _stubSql = Object.assign(
    (_tpl: TemplateStringsArray, ..._vals: ReadonlyArray<unknown>) =>
        Effect.succeed([_row]) as never,
    { withTransaction: <A, E, R>(eff: Effect.Effect<A, E, R>) => eff },
) as never;
const _testLayer = DatabaseService.Default.pipe(
    Layer.provide(Layer.succeed(SqlClient.SqlClient, _stubSql)),
    Layer.provide(Layer.succeed(PgClient.PgClient, _pg)),
);
// --- [LAYER_BLOCK] -----------------------------------------------------------
layer(_testLayer)('DatabaseService', (it) => {
    it.effect('exposes expected repo keys', () =>
        Effect.gen(function* () {
            const db = yield* DatabaseService;
            expect(Object.keys(db).sort()).toContain('users');
        }),
    );
    it.scoped('withTransaction delegates to stub', () =>
        Effect.gen(function* () {
            const db = yield* DatabaseService;
            expect(yield* db.withTransaction(Effect.succeed(42))).toBe(42);
        }),
    );
});
// --- [PARAMETERIZED] ---------------------------------------------------------
it.effect.each([
    ['owner', true], ['admin', true], ['viewer', false],
] as const)('E1: role %s can-write=%s', ([role, expected]) =>
    Effect.sync(() => { expect(canWrite(role)).toBe(expected); }),
);
// --- [ERROR_INSPECTION] ------------------------------------------------------
// why: Effect.exit + Cause.pretty for multi-cause error chain inspection
it.effect('E2: timeout produces TimeoutError in cause', () =>
    Effect.gen(function* () {
        const fiber = yield* pipe(
            Resilience.run('timeout-test', Effect.sleep(Duration.seconds(10)), {
                circuit: false, retry: false, timeout: Duration.millis(50),
            }),
            Effect.exit,
            Effect.fork,
        );
        yield* TestClock.adjust(Duration.millis(50));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.match(exit, {
            onFailure: (cause) => Cause.pretty(cause),
            onSuccess: () => '',
        })).toContain('TimeoutError');
    }).pipe(Effect.provide(Resilience.Layer)),
);
// --- [ASSERTION_HELPERS] -----------------------------------------------------
// why: typed narrowing -- compile error if wrong branch
it.effect('E3: assertNone/assertSome narrow at call site', () =>
    Effect.sync(() => {
        assertNone(Option.none());
        assertSome(Option.some(42), 42);
    }),
);
```

---
## [4][MUTATION_TESTING]
>**Dictum:** *Stryker.JS mutation thresholds are CI-enforced invariants; P/E prefixes enable triage.*

`pnpm test:mutate` runs incremental mutation testing via `@stryker-mutator/vitest-runner`. `pnpm clean` first for fresh baseline. Stryker config lives at `stryker.config.mjs`.

```javascript
// stryker.config.mjs (abbreviated)
const config = {
    mutate: [
        'packages/server/src/**/*.ts',
        'packages/database/src/**/*.ts',
        'apps/api/src/**/*.ts',
        '!apps/api/src/routes/**/*.ts',
    ],
    mutator: { excludedMutations: ['UpdateOperator', 'OptionalChaining'] },
    testRunner: 'vitest',
    checkers: ['typescript'],
    incremental: true,
    thresholds: { high: 80, low: 60, break: 50 },
};
```

| [INDEX] | [THRESHOLD] | [MEANING]                                                   |
| :-----: | ----------- | ----------------------------------------------------------- |
|   [1]   | `high: 80`  | Target kill ratio -- green status in reports                |
|   [2]   | `low: 60`   | Investigation trigger -- yellow status, triage surviving P- |
|   [3]   | `break: 50` | Build failure -- unconditional CI gate                      |

**P/E triage**: surviving mutants in P-tests indicate law violations (algebraic invariant gap). Surviving mutants in E-tests indicate boundary gaps (missing edge case). Prioritize P-test gaps first -- higher mutant-kill per LOC.

---
## [5][FILE_ORGANIZATION]
>**Dictum:** *175 LOC cap; docstring, imports, constants, algebraic (P), edge cases (E).*

```typescript
/** Module tests: <1-line scope description>. */
import { it, layer } from '@effect/vitest';
import { assertNone, assertSome } from '@effect/vitest/utils';
import { Effect, FastCheck as fc, Option, Ref, TestClock } from 'effect';
import { describe, expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
const _row = { id: 'id-1', name: 'test' } as const;
// --- [ALGEBRAIC] -------------------------------------------------------------
// P1: ...  P2: ...  P3: ...
// --- [EDGE_CASES] ------------------------------------------------------------
// E1: ...  E2: ...  E3: ...
```

---
## [6][RULES]

[ALWAYS]:
- Import `it` from `@effect/vitest`, `expect` from `vitest` (provides TestServices auto-injection).
- Pass `Schema` directly to `it.effect.prop` for codec round-trips (framework generates Arbitrary internally).
- Use `fc.*` arbitraries for constrained domains (`constantFrom`, `integer({ min, max })`).
- Derive expected values from mathematical oracles: identity, complement, inverse, boundary (external truth).
- Use `it.scoped` when the test body yields `acquireRelease` resources (finalizers run after assertion).
- Use `it.live` / `it.scopedLive` only when real time/IO is required (GC windows, halfOpen probes).
- Use `layer(Layer)('name', (it) => {...})` to share one Layer build across a describe block.
- Use `Effect.provideService(Tag, stub as never)` for single-service inline override (most common DI pattern).
- Use `Layer.succeed(Tag, stub)` for multi-dep test layers (no `vi.mock`, no `vi.fn` for Effect services).
- Use `Ref.make` + `Effect.fork` + `TestClock.adjust` + `Fiber.await` + `Ref.get` for retry verification.
- Use `Effect.exit` + `Cause.pretty` for multi-cause error chain inspection.
- Prefix algebraic properties `P1:`, `P2:`; edge cases `E1:`, `E2:` (mutation triage targeting).
- Keep `fastCheck: { numRuns }` proportional: 50 integration, 100 codecs, 200 pure laws.
- Use `assertNone`/`assertSome`/`assertSuccess`/`assertFailure` from `@effect/vitest/utils` (typed narrowing).
- 175 LOC cap per spec file -- split by domain boundary.

[NEVER]:
- Use `Arbitrary.make()` -- pass Schema directly to `it.effect.prop`.
- Import `TestClock` and yield it -- `TestClock.adjust` is a module function, not a service tag.
- Use `vi.mock`/`vi.fn` for Effect services -- use `Layer.succeed`/`Effect.provideService` instead.
- Share mutable state across tests at module scope -- reset in each test body.
- Use `it.live` for unit tests -- reserve for tests requiring real time/IO.
- Assert only the success path -- always cover failure channel with `Effect.flip` or `Effect.exit`.
- Wrap `Effect.sync` bodies in `Effect.gen` when no `yield*` is needed.

---
## [7][QUICK_REFERENCE]

| [INDEX] | [API]                                       | [USE_WHEN]                                            |
| :-----: | ------------------------------------------- | ----------------------------------------------------- |
|   [1]   | `it.effect('name', () => Effect.gen(...))`  | Standard Effect test with auto-injected TestServices  |
|   [2]   | `it.scoped('name', () => Effect.gen(...))`  | Test body yields `acquireRelease` resources           |
|   [3]   | `it.live('name', () => Effect.gen(...))`    | Real time/IO required (GC, halfOpen probes)           |
|   [4]   | `it.scopedLive('name', () => Effect.gen())` | Scoped resources + real time                          |
|   [5]   | `it.flakyTest('name', () => ..., timeout)`  | Intermittently-failing test with retry                |
|   [6]   | `it.effect.prop('P', {k: Schema}, fn)`      | Algebraic property -- Schema as generator             |
|   [7]   | `it.effect.prop('P', {k: fc.arb}, fn)`      | Constrained domain via FC.Arbitrary                   |
|   [8]   | `it.effect.each([...])('name', fn)`         | Parameterized -- deterministic variants, no shrinking |
|   [9]   | `layer(Layer)('name', (it) => {...})`       | Share one Layer build across describe block           |
|  [10]   | `Effect.provideService(Tag, stub as never)` | Single-service inline override -- most common DI      |
|  [11]   | `Layer.succeed(Tag, stub)`                  | Minimal fake -- real interface, no mock lib           |
|  [12]   | `Effect.flip`                               | Error channel as success -- assert typed error        |
|  [13]   | `Effect.exit` + `Cause.pretty`              | Multi-cause error chain inspection                    |
|  [14]   | `TestClock.adjust("1 second")`              | Advance virtual time -- no real `Effect.sleep`        |
|  [15]   | `TestRandom.feedIntegers` / `feedDoubles`   | Deterministic random for sampling/A-B tests           |
|  [16]   | `Ref + fork + TestClock + Fiber.await`      | Canonical retry verification composition              |
|  [17]   | `assertNone`/`assertSome`/`assertSuccess`   | Typed narrowing from `@effect/vitest/utils`           |
|  [18]   | `fastCheck: { numRuns: N }`                 | 50 cost-heavy, 100 codecs, 200 pure laws              |
