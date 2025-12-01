# @parametric-portal/types

Ultra-strong type primitives with Effect pipelines: branded types via @effect/schema, ts-pattern matching, Option monads, immer immutability, UUID v7.

## Installation

```bash
pnpm add @parametric-portal/types
```

## Modules

### Types (`types`)

Branded schemas, UUID v7, ts-pattern matching, and Option monads.

```typescript
import { createTypes, TYPES_TUNING } from '@parametric-portal/types/types';
import type { Email, Percentage, Url } from '@parametric-portal/types/types';
import { Effect } from 'effect';

// Initialize with optional config
const types = Effect.runSync(createTypes({ cacheCapacity: 500 }));

// Generate UUIDv7
const id = Effect.runSync(types.generateUuidv7);

// Branded schemas (11 types via @effect/schema)
types.brands.email         // Email
types.brands.hexColor      // HexColor
types.brands.isoDate       // IsoDate
types.brands.nonEmptyString // NonEmptyString
types.brands.percentage    // Percentage (0-100)
types.brands.positiveInt   // PositiveInt
types.brands.safeInteger   // SafeInteger
types.brands.slug          // Slug
types.brands.url           // Url
types.brands.uuidv7        // Uuidv7

// ts-pattern exhaustive matching
const result = types.match(value)
  .with({ _tag: 'loading' }, () => 'Loading...')
  .with({ _tag: 'success' }, (v) => v.data)
  .exhaustive();

// Option monad helpers
const maybeValue = types.Option.fromNullable(input);
types.Option.match(maybeValue, {
  onNone: () => 'fallback',
  onSome: (v) => v.toString(),
});

// Pattern matching utilities
types.P.string  // String pattern
types.P.number  // Number pattern
```

**API**:
- `createTypes(config?) => Effect<TypesApi>`
- `TypesApi.generateUuidv7` - Generate UUID v7
- `TypesApi.brands` - 11 pre-built branded schemas (@effect/schema)
- `TypesApi.schemas` - Validation schemas (non-branded)
- `TypesApi.patterns` - Regex patterns
- `TypesApi.match` - ts-pattern match function (exhaustive)
- `TypesApi.P` - ts-pattern predicates
- `TypesApi.Option` - Effect Option monad

### Temporal (`temporal`)

Effect-based date operations, immer-powered state, and Zustand registry.

```typescript
import { createTemporal, TEMPORAL_TUNING } from '@parametric-portal/types/temporal';

const temporal = createTemporal({ defaultDateFormat: 'yyyy-MM-dd' });

// Date operations (Effect-based)
const tomorrow = Effect.runSync(temporal.addDays(1)(new Date()));
const days = Effect.runSync(temporal.daysBetween(start, end));
const formatted = Effect.runSync(temporal.formatDate()(new Date()));
const parsed = Effect.runSync(temporal.parse('2024-01-01'));

// Immer produce for immutable updates
const nextState = temporal.produce(state, (draft) => {
  draft.items.push({ id: 1, name: 'New' });
});

// Brand registry (Zustand + Immer)
const registry = temporal.createRegistry();
registry.register('MyBrand');
registry.hasBrand('MyBrand'); // true
registry.getBrandNames(); // ['MyBrand']
registry.clear(); // Clear all
```

**API**:
- `createTemporal(config?) => TemporalApi`
- `TemporalApi.addDays(n)(date)` - Add days
- `TemporalApi.daysBetween(start, end)` - Days difference
- `TemporalApi.formatDate(fmt?)(date)` - Format date
- `TemporalApi.parse(str)` - Parse ISO date
- `TemporalApi.produce` - Immer produce function
- `TemporalApi.createRegistry()` - Zustand + Immer brand store

## Requirements

- **effect** 3.19+
- **@effect/schema** 0.75+
- **ts-pattern** 5.9+
- **immer** 11.0+
- **date-fns** 4.1+
- **zustand** 5.0+

**License**: MIT
