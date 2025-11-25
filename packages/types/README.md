# @parametric-portal/types

Unified type-safe primitives with Effect pipelines: branded types, UUID v7, pattern matching, date utilities.

## Installation

```bash
pnpm add @parametric-portal/types
```

## Modules

### Types (`types`)

Branded schemas, UUID v7, and exhaustive pattern matching.

```typescript
import { createTypes, TYPES_TUNING } from '@parametric-portal/types/types';
import { Effect } from 'effect';

// Initialize with optional config
const types = Effect.runSync(createTypes({ cacheCapacity: 500 }));

// Generate UUIDv7
const id = Effect.runSync(types.generateUuidv7);

// Branded schemas
types.brands.email      // Email branded type
types.brands.hexColor   // HexColor branded type  
types.brands.uuidv7     // Uuidv7 branded type
types.schemas.positiveInt // Schema validators

// Pattern matching
const matcher = types.createTagMatcher<MyUnion>();
matcher({ loading: () => '...', success: (v) => v.data })({ _tag: 'loading' });
```

**API**:
- `createTypes(config?) => Effect<TypesApi>`
- `TypesApi.generateUuidv7` - Generate UUID v7
- `TypesApi.brands` - Pre-built branded schemas
- `TypesApi.schemas` - Validation schemas
- `TypesApi.createTagMatcher()` - Discriminated union matcher
- `TypesApi.matchTag(value, cases)` - Direct pattern match

### Utils (`utils`)

Effect-based date utilities and Zustand brand registry.

```typescript
import { createUtils, UTILS_TUNING } from '@parametric-portal/types/utils';

const utils = createUtils({ defaultDateFormat: 'yyyy-MM-dd' });

// Date operations
const tomorrow = Effect.runSync(utils.addDays(1)(new Date()));
const days = Effect.runSync(utils.daysBetween(start, end));
const formatted = Effect.runSync(utils.formatDate()(new Date()));
const parsed = Effect.runSync(utils.parse('2024-01-01'));

// Brand registry (Zustand)
const registry = utils.createRegistry();
registry.register('MyBrand');
registry.hasBrand('MyBrand'); // true
registry.getBrandNames(); // ['MyBrand']
```

**API**:
- `createUtils(config?) => UtilsApi`
- `UtilsApi.addDays(n)(date)` - Add days
- `UtilsApi.daysBetween(start, end)` - Days difference
- `UtilsApi.formatDate(fmt?)(date)` - Format date
- `UtilsApi.parse(str)` - Parse ISO date
- `UtilsApi.createRegistry()` - Zustand brand store

## Requirements

- **effect** 3.19+
- **@effect/schema** 0.75+
- **date-fns** 4.1+
- **zustand** 5.0+

**License**: MIT
