# 0001. Temporal/Time Handling

Date: 2025-12-31
Status: Accepted

---
## Context

Codebase contained three conflicting temporal paradigms:

1. **`types.Timestamp`** - Branded epoch milliseconds for storage
2. **Effect `Duration`** - Native Effect duration constructors
3. **`temporal.ts`** - Custom wrapper around Effect `DateTime`

The `temporal.ts` wrapper was dead code (used only in its own tests), created naming collision with zustand temporal API, and duplicated Effect's native `DateTime` module functionality.

Effect v3.6.0+ provides comprehensive `DateTime` and `Duration` modules with full Effect integration, timezone support via `CurrentTimeZone` Layer, and calendar-aware arithmetic.

---
## Decision

**Delete `temporal.ts`** and adopt unified two-tier approach:

| Layer        | Type                        | Use Case                            |
| ------------ | --------------------------- | ----------------------------------- |
| **Storage**  | `types.Timestamp` (branded) | Database columns, serialization     |
| **Logic**    | Effect `DateTime`           | Domain operations, Effect pipelines |
| **Duration** | Effect `Duration`           | Time spans (already idiomatic)      |

**Package Organization**:

| Package           | Contains                             |
| ----------------- | ------------------------------------ |
| `packages/types/` | `Timestamp`, `DurationMs` primitives |
| Effect library    | `DateTime`, `Duration` modules       |

---
## Alternatives Considered

| Option                          | Rejected Because                                   |
| ------------------------------- | -------------------------------------------------- |
| Keep `temporal.ts` wrapper      | Dead code, duplicates Effect, naming collision     |
| Replace Timestamp with DateTime | Breaking change to database schemas, unnecessary   |
| Custom temporal utilities       | Effect DateTime already provides all functionality |
| date-fns / dayjs                | Non-Effect integration, breaks monadic composition |

---
## Consequences

[+] Single source of truth: Effect `DateTime` for logic, `Timestamp` for storage
[+] Full Effect integration: `DateTime.now` returns `Effect.Effect<DateTime.Utc>`
[+] Timezone support via `CurrentTimeZone` Layer
[+] Calendar-aware arithmetic: `DateTime.add(dt, { months: 1 })`
[+] No wrapper maintenance burden
[+] Resolves `TemporalApi` naming collision with zustand
[-] Must convert between `Timestamp` and `DateTime` at boundaries
[-] Learning curve for Effect DateTime API

---
## Usage Patterns

### Storage (Database)
```typescript
// Use branded Timestamp for epoch milliseconds
timestamp: types.Timestamp.nowSync()
```

### Domain Logic (Effect Pipeline)
```typescript
import { DateTime } from 'effect'

const now = yield* DateTime.now
const future = DateTime.add(now, { days: 7 })
const epochMs = DateTime.toEpochMillis(future)
```

### Duration Constants
```typescript
import { Duration } from 'effect'

const durations = {
    session: Duration.days(7),
    accessToken: Duration.minutes(15),
}
const ms = Duration.toMillis(durations.session)
```

### Expiry Checks
```typescript
const isExpired = (date: Date): Effect.Effect<boolean> =>
    DateTime.now.pipe(
        Effect.map(now => DateTime.greaterThan(now, DateTime.unsafeFromDate(date)))
    )
```

---
## Files Changed

| Action | File                                      |
| ------ | ----------------------------------------- |
| DELETE | `packages/runtime/src/temporal.ts`        |
| DELETE | `packages/runtime/tests/temporal.spec.ts` |
| KEEP   | `packages/types/src/types.ts` (Timestamp) |
| KEEP   | Effect `DateTime` / `Duration` usage      |
