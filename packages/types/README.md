# [H1][TYPES]
>**Dictum:** *Branded types enforce domain invariants at compile time.*

<br>

Ultra-strong type primitives with Effect pipelines: branded types via @effect/schema, ts-pattern matching, Option monads, immer immutability, UUID v7.

---
## [1][INSTALLATION]
>**Dictum:** *Single dependency enables full type infrastructure.*

<br>

```bash
pnpm add @parametric-portal/types
```

---
## [2][TYPES]
>**Dictum:** *Branded schemas prevent invalid data at system boundaries.*

<br>

### [2.1][FACTORY]

```typescript
import { createTypes, TYPES_TUNING } from '@parametric-portal/types/types';
import type { Email, Percentage, Url, Uuidv7 } from '@parametric-portal/types/types';
import { Effect } from 'effect';

const types = Effect.runSync(createTypes({ cacheCapacity: 500 }));

// Generate UUIDv7
const id = Effect.runSync(types.generateUuidv7);

// Validate cached (5-min TTL)
const valid = Effect.runSync(types.isUuidv7Cached(id));

// Type guard
types.isUuidv7(someValue);
```

---
### [2.2][BRANDS]

| [INDEX] | [BRAND]          | [CONSTRAINT]         | [PATTERN]              |
| :-----: | ---------------- | -------------------- | ---------------------- |
|   [1]   | `email`          | valid email format   | RFC 5322               |
|   [2]   | `hexColor`       | `#RRGGBB` format     | `/^#[0-9A-Fa-f]{6}$/`  |
|   [3]   | `isoDate`        | ISO 8601 date string | `YYYY-MM-DD`           |
|   [4]   | `nonEmptyString` | length > 0           | truthy string          |
|   [5]   | `nonNegativeInt` | integer >= 0         | `Number.isInteger`     |
|   [6]   | `percentage`     | integer 0-100        | `[0, 100]`             |
|   [7]   | `positiveInt`    | integer > 0          | `Number.isInteger`     |
|   [8]   | `safeInteger`    | within safe range    | `MIN/MAX_SAFE_INTEGER` |
|   [9]   | `slug`           | URL-safe kebab-case  | `/^[a-z][a-z0-9-]*$/`  |
|  [10]   | `url`            | valid HTTP/HTTPS URL | URL constructor        |
|  [11]   | `uuidv7`         | UUID v7 format       | RFC 9562               |

**Access:** `types.brands.email`, `types.brands.hexColor`, etc.

---
### [2.3][API_MEMBERS]

| [INDEX] | [MEMBER]            | [TYPE]                              | [PURPOSE]                         |
| :-----: | ------------------- | ----------------------------------- | --------------------------------- |
|   [1]   | `generateUuidv7`    | `Effect<Uuidv7>`                    | Generate UUID v7                  |
|   [2]   | `isUuidv7`          | `(u: unknown) => u is Uuidv7`       | Type guard                        |
|   [3]   | `isUuidv7Cached`    | `(uuid: string) => Effect<boolean>` | Cached validation (5-min TTL)     |
|   [4]   | `createIdGenerator` | `<A>(schema) => Effect<A>`          | Factory for branded ID generators |
|   [5]   | `brands`            | frozen object                       | 11 branded schemas                |
|   [6]   | `schemas`           | frozen object                       | Unbranded validation schemas      |
|   [7]   | `patterns`          | frozen object                       | 6 regex patterns                  |
|   [8]   | `match`             | function                            | ts-pattern match (exhaustive)     |
|   [9]   | `P`                 | object                              | ts-pattern predicates             |
|  [10]   | `Option`            | module                              | Effect Option monad               |

---
### [2.4][PATTERN_MATCHING]

```typescript
// Exhaustive matching via ts-pattern
const result = types.match(value)
  .with({ _tag: 'loading' }, () => 'Loading...')
  .with({ _tag: 'success' }, (v) => v.data)
  .exhaustive();

// Pattern predicates
types.P.string  // String pattern
types.P.number  // Number pattern
types.P.when((x) => x > 0)  // Custom predicate
```

---
### [2.5][OPTION_MONAD]

```typescript
const maybeValue = types.Option.fromNullable(input);

types.Option.match(maybeValue, {
  onNone: () => 'fallback',
  onSome: (v) => v.toString(),
});

types.Option.isSome(maybeValue);
types.Option.isNone(maybeValue);
```

---
## [3][TEMPORAL]
>**Dictum:** *Date operations compose via Effect pipelines.*

<br>

### [3.1][FACTORY]

```typescript
import { createTemporal, TEMPORAL_TUNING } from '@parametric-portal/types/temporal';
import { Effect } from 'effect';

const temporal = createTemporal({ defaultDateFormat: 'yyyy-MM-dd' });
```

---
### [3.2][DATE_OPERATIONS]

| [INDEX] | [OPERATION]   | [SIGNATURE]                                   | [PURPOSE]              |
| :-----: | ------------- | --------------------------------------------- | ---------------------- |
|   [1]   | `addDays`     | `(n: number) => (date: Date) => Effect<Date>` | Add days (curried)     |
|   [2]   | `daysBetween` | `(start: Date, end: Date) => Effect<number>`  | Calculate difference   |
|   [3]   | `formatDate`  | `(fmt?) => (date: Date) => Effect<string>`    | Format date (curried)  |
|   [4]   | `parse`       | `(input: string) => Effect<Date>`             | Parse ISO date string  |
|   [5]   | `produce`     | `typeof produce`                              | Immer produce function |

```typescript
const tomorrow = Effect.runSync(temporal.addDays(1)(new Date()));
const days = Effect.runSync(temporal.daysBetween(start, end));
const formatted = Effect.runSync(temporal.formatDate()(new Date()));
const parsed = Effect.runSync(temporal.parse('2024-01-01'));
```

---
### [3.3][BRAND_REGISTRY]

```typescript
const registry = temporal.createRegistry();

registry.register('MyBrand');
registry.hasBrand('MyBrand');     // true
registry.getBrandNames();         // ['MyBrand']
registry.unregister('MyBrand');
registry.clear();                 // Clear all
```

| [INDEX] | [METHOD]        | [TYPE]                        | [PURPOSE]        |
| :-----: | --------------- | ----------------------------- | ---------------- |
|   [1]   | `register`      | `(name: string) => void`      | Register brand   |
|   [2]   | `unregister`    | `(name: string) => void`      | Unregister brand |
|   [3]   | `hasBrand`      | `(name: string) => boolean`   | Check existence  |
|   [4]   | `getBrandNames` | `() => ReadonlyArray<string>` | Get all names    |
|   [5]   | `clear`         | `() => void`                  | Clear registry   |

---
## [4][API]
>**Dictum:** *Discriminated unions model HTTP response states.*

<br>

### [4.1][FACTORY]

```typescript
import { createApi, API_TUNING } from '@parametric-portal/types/api';
import { Effect } from 'effect';

const api = Effect.runSync(createApi<User>({ defaultPageSize: 20 }));
```

---
### [4.2][RESPONSE_TYPES]

| [INDEX] | [TYPE]                 | [DISCRIMINATOR]      | [FIELDS]                                             |
| :-----: | ---------------------- | -------------------- | ---------------------------------------------------- |
|   [1]   | `ApiSuccess<T>`        | `_tag: 'ApiSuccess'` | `data: T`, `status: 200-299`                         |
|   [2]   | `ApiError`             | `_tag: 'ApiError'`   | `code: string`, `message: string`, `status: 400-599` |
|   [3]   | `PaginatedResponse<T>` | `_tag: 'ApiSuccess'` | `data: T[]`, `pagination: PaginationMeta`            |

---
### [4.3][API_MEMBERS]

| [INDEX] | [MEMBER]    | [TYPE]                                                | [PURPOSE]                    |
| :-----: | ----------- | ----------------------------------------------------- | ---------------------------- |
|   [1]   | `success`   | `(data: T, status?) => ApiSuccess<T>`                 | Create success (default 200) |
|   [2]   | `error`     | `(status, code, message) => ApiError`                 | Create error                 |
|   [3]   | `paginated` | `(data, pagination, status?) => PaginatedResponse<T>` | Create paginated             |
|   [4]   | `isSuccess` | `(response) => response is ApiSuccess<T>`             | Type guard                   |
|   [5]   | `isError`   | `(response) => response is ApiError`                  | Type guard                   |
|   [6]   | `fold`      | `<R>(response, handlers) => R`                        | Exhaustive pattern match     |
|   [7]   | `map`       | `<U>(response, f) => ApiResponse<U>`                  | Functor map (success only)   |
|   [8]   | `schemas`   | frozen object                                         | 8 validation schemas         |

```typescript
const response = api.success({ id: 1, name: 'User' });
const errorResponse = api.error(404, 'NOT_FOUND', 'User not found');

api.fold(response, {
  onSuccess: (data, status) => data,
  onError: (error) => null,
});
```

---
## [5][ASYNC]
>**Dictum:** *State machines model async lifecycle transitions.*

<br>

### [5.1][FACTORY]

```typescript
import { createAsync, ASYNC_TUNING, mkIdle, mkLoading, mkSuccess, mkFailure } from '@parametric-portal/types/async';
import { Effect } from 'effect';

const async = Effect.runSync(createAsync<User, Error>());
```

---
### [5.2][STATES]

| [INDEX] | [STATE]      | [DISCRIMINATOR]   | [FIELDS]                        |
| :-----: | ------------ | ----------------- | ------------------------------- |
|   [1]   | `Idle`       | `_tag: 'Idle'`    | none                            |
|   [2]   | `Loading`    | `_tag: 'Loading'` | `startedAt: number`             |
|   [3]   | `Success<A>` | `_tag: 'Success'` | `data: A`, `timestamp: number`  |
|   [4]   | `Failure<E>` | `_tag: 'Failure'` | `error: E`, `timestamp: number` |

---
### [5.3][API_MEMBERS]

| [INDEX] | [MEMBER]    | [TYPE]                              | [PURPOSE]                  |
| :-----: | ----------- | ----------------------------------- | -------------------------- |
|   [1]   | `idle`      | `Idle`                              | Pre-created idle instance  |
|   [2]   | `loading`   | `() => Loading`                     | Create loading state       |
|   [3]   | `success`   | `(data: A) => Success<A>`           | Create success state       |
|   [4]   | `failure`   | `(error: E) => Failure<E>`          | Create failure state       |
|   [5]   | `isIdle`    | type guard                          | Check idle                 |
|   [6]   | `isLoading` | type guard                          | Check loading              |
|   [7]   | `isSuccess` | type guard                          | Check success              |
|   [8]   | `isFailure` | type guard                          | Check failure              |
|   [9]   | `fold`      | `<R>(state, handlers) => R`         | Exhaustive pattern match   |
|  [10]   | `map`       | `<B>(state, f) => AsyncState<B, E>` | Functor map (success only) |

```typescript
async.fold(state, {
  onIdle: () => 'Idle',
  onLoading: (startedAt) => 'Loading...',
  onSuccess: (data, ts) => data.name,
  onFailure: (error, ts) => error.message,
});
```

---
## [6][FORMS]
>**Dictum:** *Schema-driven validation enforces field constraints.*

<br>

### [6.1][FACTORY]

```typescript
import { createForm, FORM_TUNING } from '@parametric-portal/types/forms';
import { Effect } from 'effect';

const form = Effect.runSync(createForm<{ email: string; age: number }>());
```

---
### [6.2][TYPES]

| [INDEX] | [TYPE]              | [DISCRIMINATOR]             | [FIELDS]                                           |
| :-----: | ------------------- | --------------------------- | -------------------------------------------------- |
|   [1]   | `ValidationError`   | `_tag: 'ValidationError'`   | `field`, `message`, `rule`                         |
|   [2]   | `ValidationSuccess` | `_tag: 'ValidationSuccess'` | `field`                                            |
|   [3]   | `FormField<T>`      | none                        | `name`, `value`, `initialValue`, `state`, `errors` |
|   [4]   | `FormState<T>`      | `_tag: 'FormState'`         | `fields`, `isValid`, `isSubmitting`, `submitCount` |

**Field States:** `'pristine'` | `'touched'` | `'dirty'`

---
### [6.3][API_MEMBERS]

| [INDEX] | [MEMBER]         | [TYPE]                                           | [PURPOSE]              |
| :-----: | ---------------- | ------------------------------------------------ | ---------------------- |
|   [1]   | `createField`    | `<V>(name, initialValue) => FormField<V>`        | Create field           |
|   [2]   | `setFieldValue`  | `<K>(state, name, value) => FormState<T>`        | Update + mark dirty    |
|   [3]   | `touchField`     | `<K>(state, name) => FormState<T>`               | Mark touched           |
|   [4]   | `validateField`  | `<V>(field, schema) => Effect<ValidationResult>` | Schema validation      |
|   [5]   | `getFieldErrors` | `(state, name) => ValidationError[]`             | Get field errors       |
|   [6]   | `isFormValid`    | `(state) => boolean`                             | Check all fields valid |
|   [7]   | `success`        | `(field) => ValidationSuccess`                   | Create success result  |
|   [8]   | `error`          | `(field, rule, message) => ValidationError`      | Create error result    |
|   [9]   | `fold`           | `<R>(result, handlers) => R`                     | Pattern match result   |

---
## [7][STORES]
>**Dictum:** *Slice composition enables modular state management.*

<br>

### [7.1][FACTORY]

```typescript
import { createStore, STORE_TUNING } from '@parametric-portal/types/stores';
import { Effect } from 'effect';

const store = Effect.runSync(createStore());
```

---
### [7.2][SLICE_CREATION]

```typescript
const counterSlice = store.createSlice({
  name: 'counter',
  initialState: 0,
  actions: (set, get) => ({
    increment: () => set(get() + 1),
    decrement: () => set(get() - 1),
  }),
});

counterSlice.actions.increment();
counterSlice.getState();  // 1
counterSlice.actions.reset();  // built-in
```

---
### [7.3][COMBINED_STORES]

```typescript
const combined = store.combineSlices({
  counter: counterSlice,
  user: userSlice,
});

combined.getState();  // { counter: 0, user: null }
combined.subscribe((state) => console.log(state));
```

---
### [7.4][BUILT_IN_ACTIONS]

| [INDEX] | [ACTION] | [TYPE]                           | [PURPOSE]        |
| :-----: | -------- | -------------------------------- | ---------------- |
|   [1]   | `set`    | `(value: T) => T`                | Replace state    |
|   [2]   | `update` | `(updater: (prev: T) => T) => T` | Transform state  |
|   [3]   | `reset`  | `() => T`                        | Reset to initial |

---
## [8][REQUIREMENTS]
>**Dictum:** *Peer dependencies enforce compatible runtime.*

<br>

| [INDEX] | [DEPENDENCY]   | [VERSION] |
| :-----: | -------------- | --------: |
|   [1]   | effect         |     3.19+ |
|   [2]   | @effect/schema |     0.75+ |
|   [3]   | ts-pattern     |      5.9+ |
|   [4]   | immer          |     11.0+ |
|   [5]   | date-fns       |      4.1+ |
|   [6]   | zustand        |      5.0+ |
