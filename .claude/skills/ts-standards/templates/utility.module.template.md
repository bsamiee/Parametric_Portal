# [H1][UTILITY_MODULE]
>**Dictum:** *Pure utility modules compose typed errors, plain functions, and traced pipelines without service overhead.*

<br>

Produces one self-contained utility module: typed errors, pure `A -> B` functions, and optionally `Effect.fn` traced pipelines. No `Effect.Service`, no Layer, no scoped constructors.

**References:** `errors.md` (error algebra), `types.md` (type extraction), `matching.md` (dispatch)

**Workflow:** fill placeholders -> remove guidance blocks -> verify `pnpm exec nx run-many -t typecheck`

**Placeholders**

| [INDEX] | [PLACEHOLDER]         | [PURPOSE]                                                 |
| :-----: | --------------------- | --------------------------------------------------------- |
|   [1]   | `${ModuleName}`       | PascalCase module export name (`Diff`, `Circuit`)         |
|   [2]   | `${module-docstring}` | Brief JSDoc: purpose, what it replaces, design note       |
|   [3]   | `${effect-imports}`   | Effect ecosystem imports (`Data, Effect, Match, Option`)  |
|   [4]   | `${lib-imports}`      | External lib imports (omit section if none)               |
|   [5]   | `${error-classes}`    | `Data.TaggedError` or `Schema.TaggedError` definitions    |
|   [6]   | `${pure-fns}`         | Plain `A -> B` functions (NOT wrapped in Effect)          |
|   [7]   | `${traced-fns}`       | `Effect.fn` pipelines for effectful operations            |
|   [8]   | `${namespace-types}`  | Inferred types in namespace merge (`typeof X.Type`, etc.) |

```typescript
/**
 * ${module-docstring}
 */
import { ${effect-imports} } from 'effect';
${lib-imports}

// --- [ERRORS] ----------------------------------------------------------------

// Guidance: 1-3 error classes per utility. Use Data.TaggedError for internal
// errors, Schema.TaggedError when errors cross serialization boundaries.
// Static constructors (ErrorClass.of) keep call sites concise.

${error-classes}

// --- [CONSTANTS] -------------------------------------------------------------

// Guidance: omit section entirely if no config/defaults needed.
// Use `as const` on immutable config objects. Prefix with _ for module-private.

const _CONFIG = {
    // known defaults or thresholds
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

// Guidance: pure functions are plain A -> B — NOT wrapped in Effect.
// Effectful pipelines use Effect.fn('ModuleName.method') for tracing.
// No if/switch/try-catch — use Match.value, Option.match, Effect.filterOrFail.
// Ternary allowed for binary conditions with simple expressions.

${pure-fns}

${traced-fns}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const ${ModuleName} = {
    // public API: error constructors, pure functions, traced pipelines
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace ${ModuleName} {
    ${namespace-types}
}

// --- [EXPORT] ----------------------------------------------------------------

export { ${ModuleName} };
```

**Guidance: `${error-classes}`**

Define 1-3 error classes. Prefer `Data.TaggedError` for internal use, `Schema.TaggedError` when errors serialize across boundaries. Add static constructors and override `get message()` for diagnostics.

```typescript
class ${ModuleName}Error extends Data.TaggedError('${ModuleName}Error')<{
    readonly operation: string;
    readonly cause: unknown;
}> {
    static readonly of = (operation: string, cause: unknown) =>
        new ${ModuleName}Error({ cause, operation });
    override get message() {
        return `${ModuleName}Error[${this.operation}]: ${String(this.cause)}`;
    }
}
```

**Guidance: `${pure-fns}`**

Pure functions take values and return values. No Effect wrapping, no service dependencies.

```typescript
const create = <T>(before: T, after: T): ${ModuleName}.Result | null => {
    const ops = computeDifference(before, after);
    return ops.length > 0 ? { ops } : null;
};
```

**Guidance: `${traced-fns}`**

Effectful pipelines use `Effect.fn` for automatic tracing spans. The string argument becomes the span name.

```typescript
const validate = Effect.fn('${ModuleName}.validate')(
    function* (input: unknown) {
        const decoded = yield* S.decodeUnknown(TargetSchema)(input);
        yield* Effect.filterOrFail(
            Effect.succeed(decoded),
            (value) => value.count > 0,
            () => new ${ModuleName}Error({ cause: 'empty', operation: 'validate' }),
        );
        return decoded;
    },
);
```

**Guidance: `${namespace-types}`**

Derive all types from runtime values. No standalone type aliases at module level.

```typescript
export type Error = InstanceType<typeof ${ModuleName}Error>;
export type Config = NonNullable<Parameters<typeof someFn>[1]>;
export type Result = { readonly ops: readonly Operation[] };
```
