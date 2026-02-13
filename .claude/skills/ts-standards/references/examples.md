# [H1][EXAMPLES]
>**Dictum:** *Concrete code examples anchor abstract standards.*

<br>

Companion reference for [SKILL.md](../SKILL.md). Each section below corresponds to a SKILL.md section and provides detailed code examples.

---
## [SECTION_3][ALGEBRAIC_DATA_TYPES]
>**Dictum:** *Make illegal states unrepresentable through algebraic type encoding.*

<br>

### Sum Types via Data.TaggedEnum

```typescript
type Status = Data.TaggedEnum<{
    Active: {}
    Inactive: { readonly since: Date }
    Pending: { readonly reason: string }
}>
const Status = Data.taggedEnum<Status>()

// Exhaustive $match, type-safe $is, structural equality
const describe = Status.$match({
    Active: () => "Active",
    Inactive: ({ since }) => `Inactive since ${since.toISOString()}`,
    Pending: ({ reason }) => `Pending: ${reason}`,
})
```

### Product Types via Schema.Struct

```typescript
const UserSchema = S.Struct({
    id: S.String.pipe(S.brand("UserId")),
    email: S.String.pipe(S.pattern(/@/), S.brand("Email")),
    role: S.Literal("admin", "member", "guest"),
})
type User = typeof UserSchema.Type
```

### Tagged Errors

```typescript
// Domain error (internal)
class AuthError extends Data.TaggedError("AuthError")<{
    readonly reason: string
}> {}

// Boundary error (API/RPC -- needs serialization)
class ApiError extends S.TaggedError<ApiError>()("ApiError", {
    statusCode: S.Number,
    message: S.String,
}) {}
```

---
## [SECTION_4][PATTERN_MATCHING]
>**Dictum:** *Exhaustive matching guarantees every variant is handled.*

<br>

### Match.type -- Reusable Matcher Function

```typescript
const area = Match.type<Shape>().pipe(
    Match.tag("Circle", ({ radius }) => Math.PI * radius ** 2),
    Match.tag("Rectangle", ({ width, height }) => width * height),
    Match.tag("Triangle", ({ base, height }) => 0.5 * base * height),
    Match.exhaustive,
)
```

### Match.value -- Inline Dispatch on Concrete Value

```typescript
const result = Match.value(response).pipe(
    Match.tag("Success", ({ body }) => renderBody(body)),
    Match.tag("NotFound", ({ path }) => render404(path)),
    Match.exhaustive,
)
```

---
## [SECTION_7][SERVICE_ARCHITECTURE]
>**Dictum:** *Services declare interfaces; Layers provide implementations.*

<br>

### Complete Service Definition with Layer

```typescript
class UserRepo extends Context.Tag("UserRepo")<UserRepo, {
    readonly findById: (id: UserId) => Effect.Effect<User, UserNotFound>
    readonly save: (user: User) => Effect.Effect<void, DatabaseError>
}>() {}

const UserRepoLive = Layer.effect(UserRepo, Effect.gen(function* () {
    const sql = yield* SqlClient
    return {
        findById: Effect.fn("UserRepo.findById")((id) => pipe(
            sql`SELECT * FROM users WHERE id = ${id}`,
            Effect.flatMap(Schema.decodeUnknown(UserSchema)),
            Effect.mapError(() => new UserNotFound({ id })),
        )),
        save: Effect.fn("UserRepo.save")((user) => pipe(
            sql`INSERT INTO users ${sql.insert(user)}`,
            Effect.mapError((cause) => new DatabaseError({ cause })),
        )),
    }
}))
```

---
## [SECTION_8][ERROR_HANDLING]
>**Dictum:** *Errors are values in the type signature.*

<br>

### Catch Specific Error by Tag

```typescript
// Catch specific error by tag
const withFallback = program.pipe(
    Effect.catchTag("UserNotFound", () => Effect.succeed(defaultUser)),
)
```

### Transform Domain Errors to HTTP at Boundary

```typescript
// Transform domain errors to HTTP at boundary with exhaustive matching
const httpProgram = domainProgram.pipe(
    Effect.mapError((error) =>
        Match.value(error).pipe(
            Match.tag("UserNotFound", (e) => HttpError.NotFound.of("user", e.id)),
            Match.tag("DatabaseError", (e) => HttpError.Internal.of("DB failure", e.cause)),
            Match.exhaustive,
        ),
    ),
)
```
