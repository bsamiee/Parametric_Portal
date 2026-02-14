# [H1][ERRORS_AND_SERVICES]
>**Dictum:** *Typed errors constrain failure surfaces; compact services constrain public APIs.*

<br>

Use this reference to keep service interfaces small and error boundaries exhaustive.

---
## [1][ERROR_TAXONOMY]
>**Dictum:** *Domain and boundary errors have different responsibilities.*

<br>

| [INDEX] | [TYPE]               | [WHEN]                           |
| :-----: | -------------------- | -------------------------------- |
|   [1]   | `Data.TaggedError`   | internal/domain orchestration    |
|   [2]   | `Schema.TaggedError` | boundary/network serialization   |
|   [3]   | `Effect.die`         | defects/programmer invariants    |

[CRITICAL]:
- [NEVER] string errors or generic `Error` in Effect domain flows.
- [NEVER] leak broad internal unions to HTTP/RPC edges.

---
## [2][BOUNDARY_COLLAPSE]
>**Dictum:** *Map internal unions into boundary-safe unions exhaustively.*

<br>

Use [SNIP-05](./snippets.md#snip-05boundary_error_collapse).

[IMPORTANT]:
- [ALWAYS] map with `Match.exhaustive`.
- [ALWAYS] collapse to small, documented boundary variants.

---
## [3][SERVICE_SURFACE_COMPRESSION]
>**Dictum:** *A service should expose capabilities, not implementation detail sprawl.*

<br>

Use [SNIP-03](./snippets.md#snip-03capability_groups).

[IMPORTANT]:
- [ALWAYS] expose grouped capabilities (`read`, `write`, `admin`) when method count grows.
- [ALWAYS] keep public method count stable while extending internal behavior.

[CRITICAL]:
- [NEVER] append one new top-level method per new behavior variant.

---
## [4][SERVICE_DEFINITION]
>**Dictum:** *`Effect.Service` centralizes tag, constructor mode, and layer generation.*

<br>

```typescript
class FeatureService extends Effect.Service<FeatureService>()('app/FeatureService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const db = yield* DatabaseService;
        const run = Effect.fn('FeatureService.run')((command: Command) => execute(db, command));
        return { run } as const;
    }),
}) {}
```

| [INDEX] | [MODE]    | [WHEN]                               |
| :-----: | --------- | ------------------------------------ |
|   [1]   | `succeed` | static implementation, no deps       |
|   [2]   | `effect`  | deps, no resource cleanup required   |
|   [3]   | `scoped`  | resource acquisition + cleanup       |

---
## [5][LAYER_AND_RESOURCE_DISCIPLINE]
>**Dictum:** *Acquire resources in scoped services and compose layers by dependency direction.*

<br>

```typescript
const AppLayer = Layer.mergeAll(AuthService.Default, FeatureService.Default)
    .pipe(Layer.provideMerge(DatabaseService.Default));
```

```typescript
const resource = Effect.acquireRelease(open(), (handle) => close(handle));
```

[CRITICAL]:
- [NEVER] leave cleanup outside scope semantics.
- [NEVER] flatten all concerns into one mega-layer with implicit ordering.
