# [H1][VALIDATION]
>**Dictum:** *Schema validates at boundaries, encodes at exits, and refines through typed pipelines -- never imperatively.*

Cross-references: `types.md` (type definitions, brands), `errors.md` (error class definitions), `persistence.md` (field modifiers)

---
## [1][DECODE_ENCODE]
>**Dictum:** *Trust level of input determines which decode variant to use.*

| [INDEX] | [FUNCTION]                 | [TRUST]          | [RETURNS]                     | [WHEN]                                    |
| :-----: | -------------------------- | ---------------- | ----------------------------- | ----------------------------------------- |
|   [1]   | `S.decodeUnknown(X)`       | Untrusted        | `Effect<Type, ParseError>`    | HTTP body, WebSocket msg, env vars, JSON  |
|   [2]   | `S.decodeUnknownSync(X)`   | Untrusted (sync) | `Type` (throws `ParseError`)  | Startup config, CLI args -- no Effect ctx |
|   [3]   | `S.decodeUnknownEither(X)` | Untrusted (pure) | `Either<Type, ParseError>`    | Validation without Effect or exceptions   |
|   [4]   | `S.decodeSync(X)`          | Trusted          | `Type` (throws on violation)  | Known-valid defaults, test fixtures       |
|   [5]   | `S.encodeSync(X)`          | Type -> Encoded  | `Encoded` (throws on failure) | Serialize for wire/storage                |
|   [6]   | `S.encodeUnknownSync(X)`   | Relaxed encode   | `Encoded` (throws on failure) | Encode with relaxed input typing          |

```typescript
import { Effect, Match, ParseResult, Schema as S, pipe } from 'effect';

// --- boundary: untrusted HTTP body -> Effect pipeline
const parseBody = (raw: unknown) => pipe(
    S.decodeUnknown(CreateOrder)(raw),
    Effect.mapError((error) =>
        Validation.of('parse_failed', ParseResult.TreeFormatter.formatErrorSync(error))
    ),
);

// --- startup: sync decode, no Effect context available
const _APP_CONFIG = S.decodeUnknownSync(AppConfigSchema)(process.env);

// --- pure validation: no Effect, no exceptions
const validateCursor = (raw: unknown) => pipe(
    S.decodeUnknownEither(CursorSchema)(raw),
    Either.mapLeft((error) => ParseResult.ArrayFormatter.formatErrorSync(error)),
);

// --- trusted: known-valid construction
const defaultPage = S.decodeSync(PageSchema)({ limit: 25, offset: 0 });

// --- encode for wire
const toJson = S.encodeSync(OrderSchema)(order);
```

**Rule**: `decodeUnknown` at every boundary. `decodeSync` only for values the program itself constructed. `encode` when serializing outbound.

---
## [2][VALIDATE_AND_GUARD]
>**Dictum:** *Type guards narrow without Effect; assertions fail-fast without wrapping.*

| [INDEX] | [FUNCTION]      | [RETURNS]                        | [WHEN]                                       |
| :-----: | --------------- | -------------------------------- | -------------------------------------------- |
|   [1]   | `S.validate(X)` | Validates without transforms     | Check conformance; skip decode/encode codecs |
|   [2]   | `S.is(X)`       | `(u: unknown) => u is Type`      | Type guard for conditional narrowing         |
|   [3]   | `S.asserts(X)`  | `(u: unknown) => asserts u is T` | Fail-fast precondition; throws on violation  |

```typescript
const isEmail = S.is(Email);
const assertEmail = S.asserts(Email);

// type guard -- narrows without Effect wrapping
const result = isEmail(input)
    ? Effect.succeed(input)
    : Effect.fail(Validation.of('invalid_email'));

// assertion -- fail-fast in trusted internal paths
assertEmail(config.adminEmail);
```

---
## [3][FILTER]
>**Dictum:** *S.filter adds custom predicates beyond built-in refinements; message annotations produce human-readable errors.*

### [3.1] Built-in filters -- use FIRST before custom `S.filter`

| [INDEX] | [FILTER]        | [APPLIES_TO] | [EXAMPLE]                           |
| :-----: | --------------- | ------------ | ----------------------------------- |
|   [1]   | `S.minLength`   | String/Array | `S.String.pipe(S.minLength(1))`     |
|   [2]   | `S.maxLength`   | String/Array | `S.String.pipe(S.maxLength(255))`   |
|   [3]   | `S.pattern`     | String       | `S.String.pipe(S.pattern(/^\d+$/))` |
|   [4]   | `S.between`     | Number       | `S.Int.pipe(S.between(0, 100))`     |
|   [5]   | `S.positive`    | Number       | `S.Number.pipe(S.positive())`       |
|   [6]   | `S.nonNegative` | Number       | `S.Number.pipe(S.nonNegative())`    |
|   [7]   | `S.int`         | Number       | `S.Number.pipe(S.int())`            |
|   [8]   | `S.nonEmpty`    | String/Array | `S.String.pipe(S.nonEmpty())`       |

### [3.2] Custom filter -- predicate return types

| [INDEX] | [RETURN]           | [MEANING]                                       |
| :-----: | ------------------ | ----------------------------------------------- |
|   [1]   | `true`/`undefined` | Passes validation                               |
|   [2]   | `false`            | Fails with no custom message                    |
|   [3]   | `string`           | Fails with returned string as error message     |
|   [4]   | `ParseIssue`       | Fails with structured error including path info |

```typescript
// approach 1: return string from predicate (inline message)
const WebhookUrl = S.String.pipe(
    S.filter((url) =>
        (URL.canParse(url) && new URL(url).protocol === 'https:')
        || 'Expected valid HTTPS URL'
    ),
    S.brand('WebhookUrl'),
);

// approach 2: message annotation (second argument -- supports override)
const PortNumber = S.Int.pipe(
    S.filter((port) => port >= 1 && port <= 65535, {
        message: () => 'Port must be between 1 and 65535',
    }),
    S.brand('Port'),
);

// approach 3: structured ParseIssue for path-aware errors
const PasswordStrength = S.String.pipe(
    S.filter((value, _options, ast) =>
        value.length >= 12
            ? undefined
            : new ParseResult.Type(ast, value, 'Password must be at least 12 characters'),
    ),
);
```

### [3.3] Annotations on filters

```typescript
// title + description for OpenAPI; message for validation errors
const Percentage = S.Int.pipe(
    S.between(0, 100),
    S.annotations({
        title: 'Percentage',
        description: 'Integer between 0 and 100 inclusive',
    }),
);

// message annotation with override: true replaces ALL nested messages
const StrictEmail = S.String.pipe(
    S.pattern(/^[^@]+@[^@]+\.[^@]+$/),
    S.filter((value) => !value.includes('..'), {
        message: () => 'Invalid email format',
        override: true,
    }),
);
```

---
## [4][TRANSFORM]
>**Dictum:** *Transforms are bidirectional codecs -- decode and encode are symmetric inverses.*

### [4.1] S.transform -- infallible (pure A <-> B)

```typescript
const BoolFromString = S.transform(
    S.Literal('on', 'off'), S.Boolean,
    {
        strict: true,
        decode: (source) => source === 'on',
        encode: (value) => value ? 'on' as const : 'off' as const,
    },
);

const NormalizedHue = S.transform(S.Number, S.Number, {
    strict: true,
    decode: (hue) => ((hue % 360) + 360) % 360,
    encode: (hue) => hue,
});
```

### [4.2] S.transformOrFail -- fallible (returns ParseResult)

```typescript
const SafeJsonParse = S.transformOrFail(S.String, S.Unknown, {
    strict: true,
    decode: (input, options, ast) => {
        try { return ParseResult.succeed(JSON.parse(input)); }
        catch { return ParseResult.fail(new ParseResult.Type(ast, input, 'Invalid JSON')); }
    },
    encode: (value) => ParseResult.succeed(JSON.stringify(value)),
});
```

**Callback signature**: `(value, options: ParseOptions, ast: Transformation) => ParseResult`. The `options` parameter carries parse configuration -- do not discard with `_`.

---
## [5][COMPOSE_AND_PARSEJSON]
>**Dictum:** *S.compose chains codecs end-to-end; S.parseJson decodes JSON strings in one step.*

### [5.1] S.compose -- chain A->B with B->C to get A->C

```typescript
// Base64URL string -> decoded string -> parsed JSON -> typed struct
const Cursor = S.compose(
    S.StringFromBase64Url,
    S.parseJson(S.Struct({ id: S.String, version: S.optional(S.Int) })),
);
// Decode: "eyJpZCI6ImFiYyJ9" -> { id: "abc" }
// Encode: { id: "abc" } -> "eyJpZCI6ImFiYyJ9" (bidirectional)
```

### [5.2] S.parseJson -- JSON string to typed value

```typescript
// single-step: raw JSON string -> validated typed object
const EventPayload = S.parseJson(S.Struct({
    type: S.Literal('webhook', 'cron', 'manual'),
    data: S.Unknown,
    timestamp: S.Number,
}));
// S.decodeUnknownSync(EventPayload)('{"type":"webhook","data":{},"timestamp":1}')
```

---
## [6][TEMPLATE_LITERAL_PARSER]
>**Dictum:** *S.TemplateLiteralParser validates AND extracts structured segments from strings.*

```typescript
// TemplateLiteral: validates pattern, returns raw string
const UserKeyPattern = S.TemplateLiteral(S.Literal('user:'), S.String);
type UserKeyPattern = typeof UserKeyPattern.Type; // `user:${string}`

// TemplateLiteralParser: validates AND parses into tuple
const UserKeyParser = S.TemplateLiteralParser(S.Literal('user:'), S.String);
// S.decodeUnknownSync(UserKeyParser)('user:abc123') -> ['user:', 'abc123']
// Use Parser when extracting segments; use plain TemplateLiteral for pattern validation only
```

---
## [7][ERROR_FORMATTING]
>**Dictum:** *TreeFormatter for human-readable logs; ArrayFormatter for structured error responses.*

```typescript
// TreeFormatter -- hierarchical string for logging
const formatTree = (error: ParseResult.ParseError): string =>
    ParseResult.TreeFormatter.formatErrorSync(error);
// "Expected string, actual number
//   └─ at path: /email"

// ArrayFormatter -- structured array for API responses
const formatArray = (error: ParseResult.ParseError) =>
    ParseResult.ArrayFormatter.formatErrorSync(error);
// [{ _tag: 'Type', path: ['email'], message: 'Expected string, actual number' }]

// boundary pattern: decode + format in one pipeline
const parseSafe = (schema: S.Schema<unknown>) => (raw: unknown) => pipe(
    S.decodeUnknownEither(schema)(raw),
    Either.mapLeft((error) => ParseResult.TreeFormatter.formatErrorSync(error)),
);
```

**Import**: Both formatters accessed via `ParseResult` namespace from `effect` -- not direct path imports.

---
## [8][BOUNDARY_RULES]
>**Dictum:** *Decode at ingress, brand through domain, encode at egress.*

| [INDEX] | [LAYER]  | [PATTERN]                            | [RATIONALE]                                |
| :-----: | -------- | ------------------------------------ | ------------------------------------------ |
|   [1]   | Ingress  | `S.decodeUnknown(X)(raw)`            | Untrusted input enters typed domain        |
|   [2]   | Domain   | Branded types flow; no re-validation | Schema validated at boundary; trust inside |
|   [3]   | Egress   | `S.encodeSync(X)(value)`             | Typed value serialized for wire/storage    |
|   [4]   | Internal | `S.decodeSync(X)(known)`             | Program-constructed values; trusted        |

```typescript
// ingress: HTTP handler decodes untrusted body
const handler = Effect.gen(function* () {
    const raw = yield* HttpServerRequest.schemaBodyJson(CreateOrder);
    const result = yield* OrderService.create(raw);
    return result;
});

// egress: encode for wire before sending
const respond = (order: Order) => pipe(
    S.encodeSync(Order.json)(order),
    Effect.succeed,
);
```

---
## [9][ERROR_SYMPTOMS]
>**Dictum:** *Symptom table diagnoses structural defects -- consult FIRST when triaging.*

| [INDEX] | [SYMPTOM]                                    | [CAUSE]                          | [FIX]                                                     |
| :-----: | :------------------------------------------- | :------------------------------- | :-------------------------------------------------------- |
|   [1]   | `JSON.parse()` without schema                | Unvalidated deserialization      | `S.decodeUnknown(S.parseJson(X))(raw)`                    |
|   [2]   | `as unknown as T` cast                       | Unsafe cast bypassing codec      | `S.decodeUnknown(X)(input)` at boundary                   |
|   [3]   | `if (!valid) return Error`                   | Imperative validation            | `S.filter` with message annotation                        |
|   [4]   | Manual JSON parse + validate in two steps    | Missing compose pipeline         | `S.parseJson(TargetSchema)` or `S.compose` chain          |
|   [5]   | `unknown` param without decode               | Unvalidated boundary input       | `S.decodeUnknown(Schema)(input)` at entry                 |
|   [6]   | `.catch` on decode with no formatting        | Opaque parse errors              | `ParseResult.TreeFormatter.formatErrorSync` at boundary   |
|   [7]   | Raw `string` in domain function signatures   | Primitive obsession              | `S.brand('Name')` + decode at boundary                    |
|   [8]   | `S.optional` when sensible default exists    | Missing default semantics        | `S.optionalWith(schema, { default: () => value })`        |
|   [9]   | Separate `CreateX`/`UpdateX` schema files    | Projection proliferation         | `S.Struct(X.fields).pipe(S.pick(...))` at call site       |
|  [10]   | `S.decodeUnknownSync` inside Effect pipeline | Sync decode losing error channel | `S.decodeUnknown(X)` returns `Effect` -- use in gen/pipe  |
|  [11]   | `S.filter` when built-in suffices            | Redundant custom predicate       | `S.minLength`, `S.pattern`, `S.between`, `S.positive`     |
|  [12]   | Missing `message` on custom `S.filter`       | Opaque "predicate failed" error  | Add `{ message: () => '...' }` or return string from pred |
|  [13]   | Manual string splitting after validation     | Missing TemplateLiteralParser    | `S.TemplateLiteralParser(...)` extracts segments directly |
|  [14]   | `S.Class` for internal config object         | Schema wrapping non-boundary     | Plain object + `typeof` + `as const`                      |
|  [15]   | `try { JSON.parse } catch` in Effect code    | Exception-based JSON handling    | `S.parseJson(X)` or `S.transformOrFail` with ParseResult  |

---
## [10][DETECTION_HEURISTICS]
>**Dictum:** *Grep patterns flag validation-specific violations.*

| [INDEX] | [PATTERN]                            | [DETECTS]                        | [SEV] |
| :-----: | ------------------------------------ | -------------------------------- | :---: |
|   [1]   | `JSON\.parse\(`                      | Unvalidated deserialization      | HIGH  |
|   [2]   | `as unknown as`                      | Unsafe cast bypassing schema     | HIGH  |
|   [3]   | `S\.decodeUnknownSync` in Effect gen | Sync decode losing error channel |  MED  |
|   [4]   | `\.catch\(` near decode call         | Swallowed parse error            |  MED  |
|   [5]   | `S\.filter` without `message`        | Missing human-readable error msg |  LOW  |
|   [6]   | `S\.Class.*(?!Model\|Tagged)`        | Schema.Class for non-entity      |  MED  |
|   [7]   | `try\s*\{` near `JSON`               | Exception-based JSON handling    | HIGH  |

---
## [11][QUICK_REFERENCE]
>**Dictum:** *Decision table maps intent to Schema API.*

| [INDEX] | [NEED]                       | [API]                                        | [SECTION] |
| :-----: | ---------------------------- | -------------------------------------------- | :-------: |
|   [1]   | Parse untrusted input        | `S.decodeUnknown(X)`                         |    [1]    |
|   [2]   | Parse without Effect         | `S.decodeUnknownEither(X)`                   |    [1]    |
|   [3]   | Construct known-valid value  | `S.decodeSync(X)`                            |    [1]    |
|   [4]   | Serialize for wire           | `S.encodeSync(X)`                            |    [1]    |
|   [5]   | Type guard                   | `S.is(X)`                                    |    [2]    |
|   [6]   | Fail-fast assertion          | `S.asserts(X)`                               |    [2]    |
|   [7]   | Custom predicate refinement  | `S.filter(pred, { message })`                |    [3]    |
|   [8]   | Bidirectional pure codec     | `S.transform(From, To, { decode, encode })`  |    [4]    |
|   [9]   | Bidirectional fallible codec | `S.transformOrFail(From, To, { ... })`       |    [4]    |
|  [10]   | Chain two codecs             | `S.compose(A_to_B, B_to_C)`                  |    [5]    |
|  [11]   | JSON string to typed value   | `S.parseJson(X)`                             |    [5]    |
|  [12]   | Extract segments from string | `S.TemplateLiteralParser(...)`               |    [6]    |
|  [13]   | Human-readable error string  | `ParseResult.TreeFormatter.formatErrorSync`  |    [7]    |
|  [14]   | Structured error array       | `ParseResult.ArrayFormatter.formatErrorSync` |    [7]    |
|  [15]   | Diagnose structural defect   | Error symptom table                          |    [9]    |

**Last Verified:** 2026-02-23
