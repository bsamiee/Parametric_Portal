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

const UserId = brand(SCHEMAS.uuid, 'UserId');
const tomorrow = Effect.runSync(DateUtils.addDays(1)(new Date()));
useBrandRegistry.getState().register('MyBrand');
```

---

## Modules

### Branded Types (`branded`)

Compose type-safe branded primitives via `@effect/schema`.

```typescript
import { brand, SCHEMAS, COMMON_BRANDS } from '@parametric-portal/types/branded';

// Custom brand
const UserId = brand(SCHEMAS.uuid, 'UserId');
type UserId = S.Schema.Type<typeof UserId>;

// Built-in brands: email, hexColor, slug, positiveInt, nonNegativeInt
```

### Date Utilities (`dates`)

Curried, Effect-based date manipulation.

```typescript
import { DateUtils } from '@parametric-portal/types/dates';

DateUtils.addDays(days: number)(date: Date)      // Effect<Date>
DateUtils.daysBetween(start, end)                // Effect<number>
DateUtils.format(pattern?)(date)                 // Effect<string, ParseError>
DateUtils.parse(isoString)                       // Effect<Date, ParseError>
```

### Brand Registry (`registry`)

Zustand store for runtime brand metadata.

```typescript
import { useBrandRegistry } from '@parametric-portal/types/registry';

const { register, unregister, hasBrand, getBrandNames } = useBrandRegistry.getState();
```

### Identifiers (`identifiers`)

UUID v7 generation with Effect.

```typescript
import { generateUuidv7 } from '@parametric-portal/types/identifiers';

const id = await Effect.runPromise(generateUuidv7);
```

### Pattern Matching (`matchers`)

Exhaustive matching for discriminated unions.

```typescript
import { createTagMatcher } from '@parametric-portal/types/matchers';

const match = createTagMatcher<State>();
match({ loading: () => 'Loading...', success: ({ data }) => data });
```

---

## License

MIT
