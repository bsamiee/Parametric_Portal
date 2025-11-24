# @parametric-portal/types

Type-safe branded primitives, exhaustive pattern matching, UUID v7 generation, and dense utility factories.

## Installation

```bash
pnpm add @parametric-portal/types
```

## Quick Start

```typescript
import { brand, SCHEMAS } from '@parametric-portal/types/branded';
import { DateUtils } from '@parametric-portal/types/dates';
import { useBrandRegistry } from '@parametric-portal/types/registry';
import { Effect } from 'effect';

// 1. Branded Types
const UserId = brand(SCHEMAS.uuid, 'UserId');

// 2. Date Utilities (Effect-based)
const tomorrow = Effect.runSync(DateUtils.addDays(1)(new Date()));

// 3. Brand Registry (Zustand Store)
useBrandRegistry.getState().register('MyBrand');
```

---

## Modules

### 1. Date Utilities (`dates`)

Dense, curried, Effect-based date manipulation factory.

```typescript
import { DateUtils } from '@parametric-portal/types/dates';

// API
DateUtils.addDays(days: number)(date: Date)      // -> Effect<Date>
DateUtils.daysBetween(start, end)                // -> Effect<number>
DateUtils.format(pattern?)(date)                 // -> Effect<string, ParseError>
DateUtils.parse(isoString)                       // -> Effect<Date, ParseError>

// Example
const program = pipe(
    DateUtils.parse('2024-01-01T00:00:00Z'),
    Effect.flatMap(DateUtils.addDays(7)),
    Effect.flatMap(DateUtils.format('yyyy-MM-dd'))
);
```

### 2. Brand Registry (`registry`)

Immutable, schema-validated Zustand store for runtime brand metadata.

```typescript
import { useBrandRegistry } from '@parametric-portal/types/registry';

// API
const { register, unregister, hasBrand, getBrandNames } = useBrandRegistry.getState();

// Usage
register('UserID');
if (hasBrand('UserID')) {
    console.log('Brand registered');
}
```

### 3. Branded Types (`branded`)

Compose type-safe branded primitives via `@effect/schema`.

```typescript
import { brand, SCHEMAS } from '@parametric-portal/types/branded';

const Email = brand(SCHEMAS.email, 'Email');
type Email = S.Schema.Type<typeof Email>;
```

### 4. Identifiers (`identifiers`)

UUID v7 generation with Effect integration.

```typescript
import { generateUuidv7 } from '@parametric-portal/types/identifiers';

const id = await Effect.runPromise(generateUuidv7);
```

### 5. Pattern Matching (`matchers`)

Exhaustive matching for discriminated unions.

```typescript
import { createTagMatcher } from '@parametric-portal/types/matchers';

const match = createTagMatcher<State>();
match({
    loading: () => 'Loading...',
    success: ({ data }) => data,
});
```

---

## License

MIT
