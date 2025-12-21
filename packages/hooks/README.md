# [H1][HOOKS]
>**Dictum:** *Effect runtime integrates with React via managed fibers and async state machines.*

<br>

React 19 hooks bridging Effect runtime with async state, Suspense, transitions, forms, and stores.

---
## [1][INSTALLATION]
>**Dictum:** *Single dependency enables full Effect-React integration.*

<br>

```bash
pnpm add @parametric-portal/hooks
```

---
## [2][ARCHITECTURE]
>**Dictum:** *Factory pattern enables runtime injection per component subtree.*

<br>

All hook factories require a `RuntimeApi` from `createRuntimeHooks`. This enables Effect layer substitution per React subtree.

```typescript
import { createRuntimeHooks, createAppRuntime } from '@parametric-portal/hooks/runtime';
import { createAsyncHooks } from '@parametric-portal/hooks/async';
import { Layer } from 'effect';

// 1. Create runtime from Effect layers
const AppLayer = Layer.mergeAll(HttpClient.layer, Logger.layer);
const runtime = createAppRuntime(AppLayer);

// 2. Create runtime hooks
const runtimeApi = createRuntimeHooks<AppServices>();
const { RuntimeProvider, useRuntime, RuntimeContext } = runtimeApi;

// 3. Create domain hooks
const { useQuery, useMutation, useQueryCached, useQueryRetry } = createAsyncHooks(runtimeApi);

// 4. Provide runtime to React tree
<RuntimeProvider runtime={runtime}>
  <App />
</RuntimeProvider>
```

---
## [3][RUNTIME]
>**Dictum:** *Context injection enables layer substitution per subtree.*

<br>

### [3.1][FACTORY]

```typescript
import { createRuntimeHooks, createAppRuntime, RUNTIME_TUNING } from '@parametric-portal/hooks/runtime';
import type { RuntimeApi, RuntimeConfig } from '@parametric-portal/hooks/runtime';

const runtimeApi = createRuntimeHooks<AppServices>({ name: 'AppRuntime' });
const runtime = createAppRuntime(AppLayer);
```

---
### [3.2][API_MEMBERS]

| [INDEX] | [MEMBER]          | [TYPE]                            | [PURPOSE]                          |
| :-----: | ----------------- | --------------------------------- | ---------------------------------- |
|   [1]   | `RuntimeContext`  | `Context<ManagedRuntime \| null>` | React context for runtime          |
|   [2]   | `RuntimeProvider` | `Component`                       | Context provider                   |
|   [3]   | `useRuntime`      | `() => ManagedRuntime`            | Access runtime (throws if missing) |

---
### [3.3][USAGE]

```typescript
// In component
const runtime = useRuntime();
const result = await runtime.runPromise(myEffect);

// Fork fiber
const fiber = runtime.runFork(longRunningEffect);
await runtime.runPromise(Fiber.interrupt(fiber));
```

---
## [4][ASYNC]
>**Dictum:** *Managed fibers synchronize Effect execution with React state.*

<br>

### [4.1][FACTORY]

```typescript
import { createAsyncHooks, ASYNC_HOOKS_TUNING } from '@parametric-portal/hooks/async';
import type { AsyncHooksApi, AsyncHooksConfig } from '@parametric-portal/hooks/async';

const { useQuery, useMutation, useQueryCached, useQueryRetry } =
  createAsyncHooks(runtimeApi, { timestampProvider: Date.now });
```

---
### [4.2][HOOKS]

| [INDEX] | [HOOK]           | [SIGNATURE]                                          | [PURPOSE]                  |
| :-----: | ---------------- | ---------------------------------------------------- | -------------------------- |
|   [1]   | `useQuery`       | `<A, E>(effect, deps) => AsyncState<A, E>`           | Declarative data fetching  |
|   [2]   | `useMutation`    | `<A, E, I>(fn) => MutationState<A, I, E>`            | Imperative mutations       |
|   [3]   | `useQueryCached` | `<A, E>(effect, ttl, deps) => CachedState<A, E>`     | TTL-cached queries         |
|   [4]   | `useQueryRetry`  | `<A, E>(effect, schedule, deps) => RetryState<A, E>` | Retry with Effect Schedule |

---
### [4.3][USE_QUERY]

```typescript
const state = useQuery(
  fetchUser(userId),
  [userId]
);

// state: AsyncState<User, Error>
// { _tag: 'Idle' } | { _tag: 'Loading', startedAt } | { _tag: 'Success', data, timestamp } | { _tag: 'Failure', error, timestamp }
```

---
### [4.4][USE_MUTATION]

```typescript
const { mutate, reset, state } = useMutation((id: string) => deleteUser(id));

<Button onClick={() => mutate(userId)}>Delete</Button>
<Button onClick={reset}>Cancel</Button>
```

---
### [4.5][USE_QUERY_CACHED]

```typescript
const { state, invalidate } = useQueryCached(
  fetchConfig,
  Duration.minutes(5),
  []
);

<Button onClick={invalidate}>Refresh</Button>
```

---
### [4.6][USE_QUERY_RETRY]

```typescript
const { state, attempts } = useQueryRetry(
  fetchData,
  Schedule.exponential(Duration.seconds(1)),
  [dataId]
);

// attempts tracks retry count
```

---
## [5][STORE]
>**Dictum:** *useSyncExternalStore bridges StoreSlice with React rendering.*

<br>

### [5.1][FACTORY]

```typescript
import { createStoreHooks, STORE_HOOKS_TUNING } from '@parametric-portal/hooks/store';
import type { StoreHooksApi, StoreHooksConfig } from '@parametric-portal/hooks/store';

const { useStoreSlice, useStoreSelector, useStoreActions, useSubscriptionRef } =
  createStoreHooks({ enableDevtools: true, name: 'AppStore' });
```

---
### [5.2][HOOKS]

| [INDEX] | [HOOK]               | [SIGNATURE]                            | [PURPOSE]                           |
| :-----: | -------------------- | -------------------------------------- | ----------------------------------- |
|   [1]   | `useStoreSlice`      | `<T>(slice) => T`                      | Subscribe to full slice state       |
|   [2]   | `useStoreSelector`   | `<T, S>(slice, selector) => S`         | Subscribe with selector             |
|   [3]   | `useStoreActions`    | `<T, A>(slice) => StoreActions<T> & A` | Access slice actions                |
|   [4]   | `useSubscriptionRef` | `<A>(ref) => A`                        | Subscribe to Effect SubscriptionRef |

---
### [5.3][USAGE]

```typescript
// Full slice subscription
const count = useStoreSlice(counterSlice);

// Selector subscription (re-renders only when selected value changes)
const doubled = useStoreSelector(counterSlice, (s) => s * 2);

// Access actions
const { increment, decrement, reset } = useStoreActions(counterSlice);
```

---
### [5.4][DEVTOOLS]

Redux DevTools integration enabled via `enableDevtools: true`:

```typescript
const storeHooks = createStoreHooks({
  enableDevtools: true,
  name: 'MyApp',
});
```

Actions appear as `MyApp/sliceName/UPDATE` in DevTools.

---
## [6][BOUNDARY]
>**Dictum:** *Effect Cause integration enables structured error handling.*

<br>

### [6.1][FACTORY]

```typescript
import { createBoundaryHooks, BOUNDARY_HOOKS_TUNING } from '@parametric-portal/hooks/boundary';
import type { BoundaryHooksApi, BoundaryState } from '@parametric-portal/hooks/boundary';

const { useEffectBoundary } = createBoundaryHooks(runtimeApi);
```

---
### [6.2][USE_EFFECT_BOUNDARY]

```typescript
const { state, error, reset } = useEffectBoundary(
  riskyEffect,
  [dependency]
);

// error: Cause.Cause<E> | null - Full Effect Cause for structured errors
// reset: () => void - Reset to idle state

{error && (
  <ErrorFallback
    error={error}
    reset={reset}
  />
)}
```

---
### [6.3][ERROR_FALLBACK_PROPS]

| [INDEX] | [PROP]  | [TYPE]           | [PURPOSE]               |
| :-----: | ------- | ---------------- | ----------------------- |
|   [1]   | `error` | `Cause.Cause<E>` | Structured Effect error |
|   [2]   | `reset` | `() => void`     | Reset handler           |

---
## [7][FORM]
>**Dictum:** *Schema validation integrates with React 19 useActionState.*

<br>

### [7.1][FACTORY]

```typescript
import { createActionStateHooks, useFormField, FORM_HOOKS_TUNING } from '@parametric-portal/hooks/form';
import type { ActionStateHooksApi, FormFieldState } from '@parametric-portal/hooks/form';

// useFormField is standalone (no runtime required)
const { field, setValue, setTouched, validate } = useFormField('email', '', emailSchema);

// useActionStateEffect requires runtime
const { useActionStateEffect } = createActionStateHooks(runtimeApi);
```

---
### [7.2][HOOKS]

| [INDEX] | [HOOK]                 | [SIGNATURE]                                                | [PURPOSE]                               |
| :-----: | ---------------------- | ---------------------------------------------------------- | --------------------------------------- |
|   [1]   | `useFormField`         | `<V>(name, initial, schema) => FormFieldState<V>`          | Standalone field with schema validation |
|   [2]   | `useActionStateEffect` | `<A, E, I>(action, initial) => [state, dispatch, pending]` | Bridge useActionState with Effect       |

---
### [7.3][USE_FORM_FIELD]

```typescript
import { Schema as S } from '@effect/schema';

const emailSchema = S.String.pipe(S.pattern(/@/));

const { field, setValue, setTouched, validate } = useFormField('email', '', emailSchema);

<input
  value={field.value}
  onChange={(e) => setValue(e.target.value)}
  onBlur={() => {
    setTouched();
    validate();  // Synchronous validation
  }}
/>

{field.errors.map((e) => <span key={e.rule}>{e.message}</span>)}

// field.state: 'pristine' | 'touched' | 'dirty'
```

---
### [7.4][USE_ACTION_STATE_EFFECT]

```typescript
const [state, dispatch, isPending] = useActionStateEffect(
  (input: FormData) => submitForm(input),
  mkIdle()
);

<form action={dispatch}>
  <button disabled={isPending}>Submit</button>
</form>
```

---
## [8][SUSPENSE]
>**Dictum:** *React 19 use() enables Effect integration with Suspense boundaries.*

<br>

### [8.1][FACTORY]

```typescript
import { createSuspenseHooks, SUSPENSE_HOOKS_TUNING } from '@parametric-portal/hooks/suspense';
import type { SuspenseHooksApi, EffectResource } from '@parametric-portal/hooks/suspense';

const { useEffectSuspense, useEffectResource } = createSuspenseHooks(runtimeApi);
```

---
### [8.2][HOOKS]

| [INDEX] | [HOOK]              | [SIGNATURE]                              | [PURPOSE]              |
| :-----: | ------------------- | ---------------------------------------- | ---------------------- |
|   [1]   | `useEffectSuspense` | `<A, E>(effect) => A`                    | Suspend until resolved |
|   [2]   | `useEffectResource` | `<A, E>(effect) => EffectResource<A, E>` | Preloadable resource   |

---
### [8.3][USE_EFFECT_SUSPENSE]

```typescript
// Must be wrapped in <Suspense>
function UserProfile({ userId }: { userId: string }) {
  const user = useEffectSuspense(fetchUser(userId));
  return <div>{user.name}</div>;
}

<Suspense fallback={<Spinner />}>
  <UserProfile userId="123" />
</Suspense>
```

---
### [8.4][USE_EFFECT_RESOURCE]

```typescript
const resource = useEffectResource(fetchData);

// Preload on hover
<button onMouseEnter={resource.preload}>
  Load Data
</button>

// Read in Suspense boundary
<Suspense fallback={<Spinner />}>
  <DataView resource={resource} />
</Suspense>

// In DataView
const data = resource.read();  // Suspends if pending
```

---
### [8.5][RESOURCE_STATUS]

| [INDEX] | [STATUS]   | [DESCRIPTION]     |
| :-----: | ---------- | ----------------- |
|   [1]   | `idle`     | Not started       |
|   [2]   | `pending`  | Promise in flight |
|   [3]   | `resolved` | Success           |
|   [4]   | `rejected` | Error             |

---
## [9][TRANSITION]
>**Dictum:** *React 19 concurrent features integrate with Effect fibers.*

<br>

### [9.1][FACTORY]

```typescript
import { createTransitionHooks, TRANSITION_HOOKS_TUNING } from '@parametric-portal/hooks/transition';
import type { TransitionHooksApi, TransitionState, OptimisticState } from '@parametric-portal/hooks/transition';

const { useEffectTransition, useOptimisticEffect } = createTransitionHooks(runtimeApi);
```

---
### [9.2][HOOKS]

| [INDEX] | [HOOK]                | [SIGNATURE]                                                  | [PURPOSE]                 |
| :-----: | --------------------- | ------------------------------------------------------------ | ------------------------- |
|   [1]   | `useEffectTransition` | `<A, E>(effect) => TransitionState<A, E>`                    | Non-blocking state update |
|   [2]   | `useOptimisticEffect` | `<A, E>(current, updateFn, effect) => OptimisticState<A, E>` | Optimistic UI with Effect |

---
### [9.3][USE_EFFECT_TRANSITION]

```typescript
const { isPending, start, state } = useEffectTransition(
  searchUsers(query)
);

<input onChange={(e) => {
  setQuery(e.target.value);
  start();  // Non-blocking update
}} />

{isPending && <Spinner />}
```

---
### [9.4][USE_OPTIMISTIC_EFFECT]

```typescript
const { optimisticState, addOptimistic, state } = useOptimisticEffect(
  todos,
  (current, newTodo) => [...current, newTodo],
  (newTodo) => api.createTodo(newTodo)
);

// Show optimistic UI immediately
<TodoList items={optimisticState} />

// Trigger optimistic update
addOptimistic({ id: 'temp', text: 'New Todo' });

// state tracks actual API result
```

---
## [10][MODULE_SUMMARY]
>**Dictum:** *Module catalog enables targeted imports.*

<br>

| [INDEX] | [MODULE]     | [FACTORY]                | [PRIMARY_HOOKS]                              |
| :-----: | ------------ | ------------------------ | -------------------------------------------- |
|   [1]   | `runtime`    | `createRuntimeHooks`     | `useRuntime`                                 |
|   [2]   | `async`      | `createAsyncHooks`       | `useQuery`, `useMutation`                    |
|   [3]   | `store`      | `createStoreHooks`       | `useStoreSlice`, `useStoreSelector`          |
|   [4]   | `boundary`   | `createBoundaryHooks`    | `useEffectBoundary`                          |
|   [5]   | `form`       | `createActionStateHooks` | `useFormField`*, `useActionStateEffect`      |
|   [6]   | `suspense`   | `createSuspenseHooks`    | `useEffectSuspense`, `useEffectResource`     |
|   [7]   | `transition` | `createTransitionHooks`  | `useEffectTransition`, `useOptimisticEffect` |

*`useFormField` is standalone (no factory required)

---
## [11][REQUIREMENTS]
>**Dictum:** *Peer dependencies enforce compatible runtime.*

<br>

| [INDEX] | [DEPENDENCY]             |    [VERSION] |
| :-----: | ------------------------ | -----------: |
|   [1]   | React                    | 19+ (canary) |
|   [2]   | effect                   |        3.19+ |
|   [3]   | @effect/schema           |        0.75+ |
|   [4]   | @parametric-portal/types |    workspace |
