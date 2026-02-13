# [H1][CONSOLIDATION]
>**Dictum:** *One polymorphic object replaces ten loose definitions.*

<br>

Dense code through unified objects, namespace merges, IIFE companions, and polymorphic design. Restructure and optimize logic to reduce complexity -- never extract or add helpers.

---
## [1][NAMESPACE_MERGE]
>**Dictum:** *`const X` holds runtime values, `namespace X` holds companion types, single `export { X }` unifies both.*

<br>

Group related schemas, errors, functions, and types under ONE import. Write `Tenant.findById()`, `Tenant.Shape`, `Tenant.Error` -- never scattered imports.

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
const _schema = S.Struct({
    id: S.String.pipe(S.brand('TenantId')),
    name: S.String,
    status: S.Literal('active', 'inactive'),
});

// --- [ERRORS] ----------------------------------------------------------------
class NotFound extends Data.TaggedError('NotFound')<{ readonly id: string }> {}
class Conflict extends Data.TaggedError('Conflict')<{ readonly name: string }> {}

// --- [FUNCTIONS] -------------------------------------------------------------
const findById = Effect.fn('Tenant.findById')((id: string) =>
    Effect.gen(function* () { /* ... */ }));

const create = Effect.fn('Tenant.create')((input: typeof _schema.Type) =>
    Effect.gen(function* () { /* ... */ }));

// --- [EXPORT] ----------------------------------------------------------------
const Tenant = { schema: _schema, findById, create, NotFound, Conflict } as const;
namespace Tenant {
    export type Shape = typeof _schema.Type;
    export type Encoded = typeof _schema.Encoded;
    export type Error = NotFound | Conflict;
}
export { Tenant };
```

[IMPORTANT]:
- [ALWAYS] Place `[EXPORT]` section at file end only -- no inline `export const`.
- [ALWAYS] Provide ONE import giving consumers `X.method()`, `X.Type`, `X.Error`.
- [ALWAYS] Group errors under namespace: `const XError = { A, B } as const; namespace XError { export type Any = A | B; }`.

[CRITICAL]:
- [NEVER] Scattered exports per function/type -- merge into single namespace object.
- [NEVER] Re-export individual members -- consumers import namespace.

[REFERENCE] Error patterns: [->errors-and-services.md](./errors-and-services.md).

---
## [2][IIFE_COMPANION]
>**Dictum:** *Branded primitives bundle schema + operations in a single binding.*

<br>

Apply IIFE for EVERY branded domain primitive. IIFE produces `const` + `type` merge -- write `Timestamp` for both value access and type annotation.

```typescript
const Timestamp = (() => {
    const schema = S.Number.pipe(S.positive(), S.brand('Timestamp'));
    const now = Effect.sync(() => Date.now() as typeof schema.Type);
    const nowSync = () => Date.now() as typeof schema.Type;
    const add = (base: typeof schema.Type, delta: number) =>
        (base + delta) as typeof schema.Type;
    const isExpired = (ts: typeof schema.Type, ttlMs: number) =>
        Date.now() - ts > ttlMs;
    return { schema, now, nowSync, add, isExpired } as const;
})();
type Timestamp = typeof Timestamp.schema.Type;
export { Timestamp };
```

[IMPORTANT]:
- [ALWAYS] IIFE for branded types -- schema + factory + predicates + arithmetic in one object.
- [ALWAYS] `type X = typeof X.schema.Type` immediately after the IIFE.

---
## [3][NO_HAND_ROLLING]
>**Dictum:** *Effect ships 30+ modules. Use them.*

<br>

| [HAND_ROLLED]                    | [EFFECT_MODULE]   | [KEY_APIS]                                         |
| -------------------------------- | ----------------- | -------------------------------------------------- |
| `arr.filter().map()`             | `Array`           | `filterMap`, `groupBy`, `dedupe`, `intersection`   |
| `Object.keys().reduce()`         | `Record`          | `map`, `filter`, `collect`, `fromEntries`          |
| `x != null`                      | `Option`          | `fromNullable`, `map`, `flatMap`, `getOrElse`      |
| `pred1 && pred2`                 | `Predicate`       | `and`, `or`, `not`, `compose`                      |
| `if/switch`                      | `Match`           | `type`, `value`, `tag`, `when`, `exhaustive`       |
| `new Map()` + locks              | `TMap` via `STM`  | `empty`, `get`, `set`, `takeFirst`, `merge`        |
| `Map<K, Fiber>` + cleanup        | `FiberMap`        | `make`, `run`, `remove`, `join`, `awaitEmpty`      |
| Manual retry loops               | `Schedule`        | `exponential`, `jittered`, `intersect`, `upTo`     |
| `EventEmitter`                   | `PubSub`+`Stream` | `fromPubSub`, `broadcast`, `groupByKey`            |
| `let cache; if (!cache)`         | `Effect`          | `cached`, `cachedWithTTL`, `once`                  |
| `Array.find` returns `undefined` | `Array`           | `findFirst` returns `Option<A>`                    |
| Manual `structuredClone`         | `Data`            | `Data.struct`, `Data.tagged` (structural equality) |

Schedule composition replaces manual retry:

```typescript
const retryPolicy = Schedule.exponential('100 millis', 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(4)),
    Schedule.upTo('30 seconds'),
    Schedule.whileInput((error: ServiceError) => error._tag !== 'Fatal'),
);
// One expression replaces 40 lines of manual setTimeout + counter + jitter + cap logic
```

[CRITICAL]:
- [NEVER] Hand-roll what Effect provides -- `Array`, `Record`, `Option`, `Predicate`, `Match`, `TMap`, `FiberMap`, `Schedule`, `PubSub`, `Stream`, `Queue`, `Deferred`, `Semaphore`, `Pool`.

[REFERENCE] Advanced APIs: [->composition.md](./composition.md).

---
## [4][POLYMORPHISM]
>**Dictum:** *Fewer functions, more overloads. If 3+ functions share similar signatures, consolidate into ONE with a discriminated config param.*

<br>

**Pattern 1:** Config-driven polymorphism via discriminated config:

```typescript
const _handle = Effect.fn('Breaker.handle')((
    config: { readonly _tag: 'consecutive'; readonly threshold: number }
         | { readonly _tag: 'sampling'; readonly rate: number; readonly window: Duration.DurationInput },
) => Match.value(config).pipe(
    Match.tag('consecutive', ({ threshold }) => /* ... */),
    Match.tag('sampling', ({ rate, window }) => /* ... */),
    Match.exhaustive,
));
```

**Pattern 2:** Discriminated config with `Match.value` branching:

```typescript
const _sendNotification = Effect.fn('Notify.send')((
    config: { readonly _tag: 'email'; readonly to: string; readonly subject: string }
          | { readonly _tag: 'sms'; readonly phone: string }
          | { readonly _tag: 'push'; readonly deviceToken: string; readonly badge: number },
    body: string,
) => Match.value(config).pipe(
    Match.tag('email', ({ to, subject }) =>
        emailClient.send({ to, subject, body })),
    Match.tag('sms', ({ phone }) =>
        smsGateway.deliver({ phone, body: body.slice(0, 160) })),
    Match.tag('push', ({ deviceToken, badge }) =>
        pushService.dispatch({ deviceToken, badge, body })),
    Match.exhaustive,
));
```

[CRITICAL]:
- [NEVER] Extract helpers to reduce complexity -- restructure and optimize the logic itself.
- [NEVER] Proliferate functions with similar signatures -- consolidate with discriminated config.
- [NEVER] Create wrapper/indirection layers -- every function must justify its existence.

---
## [5][SCHEMA_CONSOLIDATION]
>**Dictum:** *One canonical schema per entity. Derive variants at call site.*

<br>

```typescript
const UserSchema = S.Struct({
    id: S.String.pipe(S.brand('UserId')),
    name: S.String,
    email: S.String.pipe(S.pattern(/@/)),
    role: S.Literal('admin', 'member', 'viewer'),
    createdAt: S.DateTimeUtc,
});

// Derive variants inline -- NO separate CreateUserSchema / UpdateUserSchema
const decode = S.decodeUnknown(UserSchema.pipe(S.pick('name', 'email', 'role')));
const patch = S.decodeUnknown(UserSchema.pipe(S.pick('name', 'email'), S.partial));
```

[CRITICAL]:
- [NEVER] Parallel `XCreateSchema`, `XUpdateSchema`, `XPatchSchema` -- derive via `pick`/`omit`/`partial` at call site.
- [NEVER] Duplicate schema fields across multiple definitions.

