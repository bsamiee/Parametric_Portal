# [H1][PATTERNS]
>**Dictum:** *Concrete BAD/GOOD pairs anchor abstract standards to compilable code.*

<br>

Condensed pattern reference. SKILL.md [3]-[8] contain authoritative code examples. Patterns below provide quick-reference forbidden-to-replacement mappings.

---
## [1][ALGEBRAIC_DATA_TYPES]
>**Dictum:** *Tagged enums encode data and behavior; schemas derive types; brands prevent confusion.*

| [INDEX] | [FORBIDDEN]                                        | [REPLACEMENT]                                     |
| :-----: | -------------------------------------------------- | ------------------------------------------------- |
|   [1]   | `type S = "a" \| "b"` with per-variant data        | `Data.TaggedEnum<{ A: {...}; B: {...} }>`         |
|   [2]   | Separate generic types losing variant relationship | `Data.TaggedEnum.WithGenerics<N>` + interface     |
|   [3]   | `interface X` alongside `Schema X` (dual defs)     | `type X = typeof XSchema.Type` (single source)    |
|   [4]   | `throw new Error(msg)` (untyped)                   | `Data.TaggedError("Tag")<{...}>` (domain)         |
|   [5]   | Untyped boundary errors                            | `S.TaggedError<E>()("Tag", {...})` (serializable) |

---
## [2][EXHAUSTIVE_PATTERN_MATCHING]
>**Dictum:** *Match.exhaustive turns missing cases into compile errors.*

| [INDEX] | [FORBIDDEN]                                    | [REPLACEMENT]                                             |
| :-----: | ---------------------------------------------- | --------------------------------------------------------- |
|   [6]   | `Record<string, () => void>` dispatch table    | `Match.type<T>().pipe(Match.tag(...), Match.exhaustive)`  |
|   [7]   | `if (x._tag === ...) else if (x._tag === ...)` | `Match.type<T>().pipe(Match.tag(...), Match.exhaustive)`  |
|   [8]   | `switch (x._tag) { case ... default: ... }`    | `Match.type` + `Match.exhaustive` (zero boilerplate)      |
|   [9]   | Nested ternaries / if-else on primitive values | `Match.value(n).pipe(Match.when(...), Match.orElse(...))` |
|  [10]   | Multiple tags lacking combined handler         | `Match.tag("A", "B", () => ...)` (multi-tag)              |
|  [11]   | Branches returning inconsistent types          | `Match.withReturnType<T>()` (enforced return type)        |
|  [12]   | `instanceof` without structured matching       | `Match.when(Match.instanceOf(T), ...)` (class matching)   |

**Decision:** `Match.type` for reusable matchers. `Match.value` for inline dispatch. Pure data lookups (`Record<string, string>`) allowed for static mappings with no behavior.

---
## [3][TYPE_LEVEL_PROGRAMMING]
>**Dictum:** *Branded types prevent primitive confusion. Conditional types dispatch at compile time.*

| [INDEX] | [FORBIDDEN]                       | [REPLACEMENT]                                               |
| :-----: | --------------------------------- | ----------------------------------------------------------- |
|  [13]   | `string` for domain identifiers   | `S.String.pipe(S.pattern(...), S.brand("UserId"))`          |
|  [14]   | Type annotation widening literals | `as const satisfies T` (shape check + literal preservation) |
|  [15]   | Manual generic argument passing   | `<const T>` type parameters (literal inference)             |
|  [16]   | Manual resource cleanup           | `using handle = yield* resource` (TS 6.0+ `Symbol.dispose`) |

---
## [4][EFFECT_COMPOSITION]
>**Dictum:** *pipe for linear flows; gen for sequential; fn for traced methods.*

| [INDEX] | [FORBIDDEN]                        | [REPLACEMENT]                                                |
| :-----: | ---------------------------------- | ------------------------------------------------------------ |
|  [17]   | Nested function calls `f(g(h(x)))` | `pipe(x, h, g, f)` (left-to-right)                           |
|  [18]   | `.then().catch()` Promise chains   | `Effect.gen(function*() { ... })` (top-to-bottom)            |
|  [19]   | Bare function without trace span   | `Effect.fn("Service.method")(...)` (automatic span)          |
|  [20]   | Sequential independent effects     | `Effect.all({...}, { concurrency: "unbounded" })` (parallel) |

**Tracing:** `Effect.fn` for service methods. `Telemetry.routeSpan` for route handlers. Neither for pure functions.

---
## [5][ERROR_MODELING]
>**Dictum:** *Errors are typed values -- catchTag for recovery, mapError for transformation.*

| [INDEX] | [FORBIDDEN]                          | [REPLACEMENT]                                               |
| :-----: | ------------------------------------ | ----------------------------------------------------------- |
|  [21]   | `try/catch` with `unknown` error     | `Effect.tryPromise` + `Data.TaggedError` (typed channel)    |
|  [22]   | `throw new Error(msg)` string errors | `Effect.fail(new TaggedError({...}))` + `catchTag` recovery |
|  [23]   | `catch + rethrow` error wrapping     | `Effect.mapError` + `Match.exhaustive` (boundary mapping)   |

---
## [6][FUNCTIONAL_TRANSFORMS]
>**Dictum:** *Pure transforms over mutable accumulation. Option over null checks.*

| [INDEX] | [FORBIDDEN]                          | [REPLACEMENT]                                               |
| :-----: | ------------------------------------ | ----------------------------------------------------------- |
|  [24]   | `let arr = []; for ... push`         | `.filter(...).map(...)` or `Effect.forEach` (pure pipeline) |
|  [25]   | `if (x !== null && x !== undefined)` | `Option.fromNullable(x).pipe(Option.map(...))` (composable) |

---
## [7][CODE_ORGANIZATION]
>**Dictum:** *Schema-derived guards. Export sections. Effect over async.*

| [INDEX] | [FORBIDDEN]                                   | [REPLACEMENT]                                                 |
| :-----: | --------------------------------------------- | ------------------------------------------------------------- |
|  [26]   | Hand-rolled `isX(v): v is X` type guard       | `S.is(XSchema)` (derived from single source of truth)         |
|  [27]   | Scattered `export const` throughout file      | `[EXPORT]` section at file end with gathered exports          |
|  [28]   | `async function f()` (untyped errors)         | `Effect.fn("f")((...args) => Effect.gen(...))` (typed triple) |
|  [29]   | `class X extends Base` (inheritance coupling) | `Context.Tag` + `Layer` (composable dependency injection)     |

---
## [8][SOURCES]

- [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)
- [Effect Data Module](https://effect.website/docs/data-types/data/)
- [Effect Error Management](https://effect.website/docs/error-management/expected-errors/)
- [Effect Building Pipelines](https://effect.website/docs/getting-started/building-pipelines/)
- [Effect Services](https://effect.website/docs/requirements-management/services/)
- [Effect Schema](https://effect.website/docs/schema/basic-usage/)
- [Effect Branded Types](https://effect.website/docs/code-style/branded-types/)
- [TypeScript 6.0 Release Notes](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/)
