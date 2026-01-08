# Parametric Portal — Agent Context

## [1][DISCOVERY]

**Before writing code:**
1. Read `pnpm-workspace.yaml` — understand catalog versions (Effect 3.19, React 19 canary, TS 6.0-dev, Vite 7, Tailwind 4)
2. Search existing packages for similar functionality
3. Use existing infrastructure — never duplicate

---

## [2][PACKAGE_MAP]

| Package | Purpose | Use For |
|---------|---------|---------|
| `types/types.ts` | Branded primitives | `DurationMs`, `Timestamp`, `Email`, `Hex8`, `Hex64`, `Uuidv7` |
| `types/schema.ts` | Database schema | `UserId`, `SessionId`, `ApiKeyId`, tables, row/insert schemas |
| `types/app-error.ts` | Client errors | `AppError.from('Browser', 'CLIPBOARD_READ')` |
| `types/ui.ts` | Tailwind + RAC constants | `TW.colorStep`, `RAC.boolean` |
| `types/async.ts` | Async state | `AsyncState<T, E>` |
| `server/http-errors.ts` | HTTP errors | `HttpError.NotFound`, `HttpError.Auth`, `HttpError.chain` |
| `server/api.ts` | API contract | `ParametricApi`, `HttpApiGroup`, `Pagination` |
| `database/client.ts` | DB layer | `Drizzle`, `Database`, `PgLive` |
| `database/repos.ts` | Repositories | `DatabaseService` with SqlResolver batching |
| `runtime/runtime.ts` | React bridge | `Runtime.Provider`, `Runtime.use` |
| `theme/colors.ts` | Color system | `OklchColor`, `ThemeError` |

---

## [3][INFRASTRUCTURE_RULES]

**Errors:**
- Client/browser errors → `AppError` from `types/app-error.ts`
- HTTP API errors → `HttpError` from `server/http-errors.ts`
- Theme errors → `ThemeError` from `theme/colors.ts`

**IDs:**
- Database IDs → `UserId`, `SessionId`, etc. from `types/schema.ts`
- Generic UUIDs → `Uuidv7` from `types/types.ts`

**Durations:**
- Timestamps → `Timestamp` from `types/types.ts`
- Durations → `DurationMs` from `types/types.ts` OR `Duration` from Effect

**Expanding Infrastructure:**
- New branded type → add to `types/types.ts`
- New error domain → add to `types/app-error.ts` B constant
- New HTTP error → add to `server/http-errors.ts`
- New database entity → add to `types/schema.ts` (tables, relations, schemas)

---

## [4][EFFECT_PATTERNS]

**Service definition:**
```typescript
class MyService extends Effect.Service<MyService>()('domain/MyService', {
    dependencies: [OtherService.Default],
    effect: Effect.gen(function* () {
        const other = yield* OtherService;
        return { /* service interface */ };
    }),
}) {
    static readonly layer = this.Default.pipe(Layer.provide(OtherService.layer));
}
```

**Config from env:**
```typescript
const PgLive = PgClient.layerConfig({
    password: Config.redacted('POSTGRES_PASSWORD'),
    host: Config.string('HOST').pipe(Config.withDefault('localhost')),
});
```

---

## [5][CONSTANT_PATTERN]

**Single frozen B per file:**
```typescript
const B = Object.freeze({
    bounds: Object.freeze({ min: 0, max: 100 }),
    durations: { session: Duration.days(7), refresh: Duration.days(30) },
}) satisfies DeepReadonly<{...}>;
```

**Export as `*_TUNING`:** `export { B as DOMAIN_TUNING };`

---

## [6][NAMESPACE_PATTERN]

**Unify schema + operations:**
```typescript
const DurationMs = Object.freeze({
    ...make(DurationMsSchema),  // decode, encode, is, schema
    add: (a, b) => (a + b) as DurationMs,
    fromSeconds: (s) => (s * 1000) as DurationMs,
    zero: 0 as DurationMs,
});
```

---

## [7][IMPORTS]

```typescript
// Effect
import { Array as A, Effect, Layer, Option, pipe, Record as R, Schema as S } from 'effect';

// Internal
import { DurationMs, Timestamp } from '@parametric-portal/types/types';
import { UserId, users } from '@parametric-portal/types/schema';
import { AppError } from '@parametric-portal/types/app-error';
import { HttpError } from '@parametric-portal/server/http-errors';

// Types
import type { DeepReadonly } from 'ts-essentials';
```

---

## [8][CLI]

```bash
pnpm exec nx run-many -t typecheck
pnpm exec nx run-many -t test
pnpm exec nx run <project>:dev
```

---

## [9][PROHIBITED]

- `any` — branded types via @effect/schema
- `let`/`var` — `const` only
- `if/else` chains — dispatch tables
- `try/catch` — Effect error channel
- Default exports — named exports (except *.config.ts)
- Barrel files — direct imports
- Re-exports — each module owns exports
- Duplicating infrastructure — use existing packages
