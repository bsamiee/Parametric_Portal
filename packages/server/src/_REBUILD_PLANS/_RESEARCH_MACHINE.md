# @effect/experimental Machine Research

**Version:** 0.58.0+ | **Updated:** 2026-01-29 | **Scope:** OAuth/MFA state machines for multi-tenant cluster deployment

---

## [1] Core Exports

```typescript
import { Machine } from '@effect/experimental/Machine'
import type { Procedure, SerializableProcedureList } from '@effect/experimental/Machine'
```

| Export | Description |
|--------|-------------|
| `Machine.make` | Create non-serializable machine (in-memory only) |
| `Machine.makeSerializable` | Create machine with schema-backed state persistence |
| `Machine.boot` | Spawn Actor from machine definition (returns `SerializableActor` for serializable machines) |
| `Machine.snapshot` | Encode Actor state for persistence |
| `Machine.restore` | Decode and resume Actor from snapshot |
| `Machine.retry` | Apply retry policy to initialization via Schedule |
| `Machine.NoReply` | Symbol for fire-and-forget handlers |
| `Machine.serializable` | Re-export of SerializableProcedureList module |

---

## [2] Type Signatures

```typescript
import type { MachineContext, MachineDefect, TypeId, SerializableTypeId } from '@effect/experimental/Machine'
import { Array as A, Boolean as B, Clock, DateTime, Duration, Effect, Match, Number as N, Option, Schema as S } from 'effect'

// --- [Machine.make] ----------------------------------------------------------
declare const make: {
  <State, Public extends TaggedRequest.Any, Private extends TaggedRequest.Any, InitErr, R>(
    initialize: Effect.Effect<ProcedureList<State, Public, Private, R>, InitErr, R>
  ): Machine<State, Public, Private, void, InitErr, Exclude<R, Scope | MachineContext>>
  <State, Public extends TaggedRequest.Any, Private extends TaggedRequest.Any, Input, InitErr, R>(
    initialize: Machine.Initialize<Input, State, Public, Private, R, InitErr, R>
  ): Machine<State, Public, Private, Input, InitErr, Exclude<R, Scope | MachineContext>>
}

// --- [Machine.makeSerializable] ----------------------------------------------
declare const makeSerializable: {
  <State, IS, RS, Public extends S.TaggedRequest.All, Private extends S.TaggedRequest.All, InitErr, R>(
    options: { readonly state: S.Schema<State, IS, RS> },
    initialize: Effect.Effect<SerializableProcedureList<State, Public, Private, R>, InitErr, R>
  ): SerializableMachine<State, Public, Private, void, InitErr, Exclude<R, Scope | MachineContext>, RS>
  <State, IS, RS, Input, II, RI, Public extends S.TaggedRequest.All, Private extends S.TaggedRequest.All, InitErr, R>(
    options: { readonly state: S.Schema<State, IS, RS>; readonly input: S.Schema<Input, II, RI> },
    initialize: Machine.InitializeSerializable<Input, State, Public, Private, R, InitErr, R>
  ): SerializableMachine<State, Public, Private, Input, InitErr, Exclude<R, Scope | MachineContext>, RS | RI>
}

// --- [Machine.boot] ----------------------------------------------------------
declare const boot: <M extends Machine.Any>(
  self: M,
  ...[input, options]: [Machine.Input<M>] extends [void]
    ? [input?: void, options?: { readonly previousState?: Machine.State<M> }]
    : [input: Machine.Input<M>, options?: { readonly previousState?: Machine.State<M> }]
) => Effect.Effect<
  M extends { readonly [SerializableTypeId]: SerializableTypeId } ? SerializableActor<M> : Actor<M>,
  never,
  Machine.Context<M> | Scope
>

// --- [Machine.snapshot / restore] --------------------------------------------
declare const snapshot: <State, Public, Private, Input, InitErr, R, SR>(
  self: Actor<SerializableMachine<State, Public, Private, Input, InitErr, R, SR>>
) => Effect.Effect<[input: unknown, state: unknown], ParseResult.ParseError, SR>

declare const restore: <State, Public, Private, Input, InitErr, R, SR>(
  self: SerializableMachine<State, Public, Private, Input, InitErr, R, SR>,
  snapshot: readonly [input: unknown, state: unknown]
) => Effect.Effect<Actor<SerializableMachine<...>>, ParseResult.ParseError, R | SR>
```

---

## [3] Procedure Context

```typescript
// --- [BaseContext] -----------------------------------------------------------
interface BaseContext {
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>
  readonly forkOne: {
    (id: string): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>
    <A, E, R>(effect: Effect.Effect<A, E, R>, id: string): Effect.Effect<void, never, R>
  }
  readonly forkReplace: {
    (id: string): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<void, never, R>
    <A, E, R>(effect: Effect.Effect<A, E, R>, id: string): Effect.Effect<void, never, R>
  }
  readonly unsafeSend: <Req extends TaggedRequest.Any>(request: Req) => Effect.Effect<void>
  readonly unsafeSendAwait: <Req extends TaggedRequest.Any>(request: Req) => Effect.Effect<Request.Success<Req>, Request.Error<Req>>
}

// --- [Procedure.Context] -----------------------------------------------------
interface Context<Requests extends TaggedRequest.Any, Request extends TaggedRequest.Any, State> extends BaseContext {
  readonly request: Request
  readonly state: State
  readonly deferred: Deferred<Request.Success<Request>, Request.Error<Request>>
  readonly send: <Req extends Requests>(req: Req) => Effect.Effect<void>
  readonly sendAwait: <Req extends Requests>(req: Req) => Effect.Effect<Request.Success<Req>, Request.Error<Req>>
  readonly forkWith: {
    (state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<readonly [void, State], never, R>
    <A, E, R>(effect: Effect.Effect<A, E, R>, state: State): Effect.Effect<readonly [void, State], never, R>
  }
  readonly forkOneWith: {
    (id: string, state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<readonly [void, State], never, R>
    <A, E, R>(effect: Effect.Effect<A, E, R>, id: string, state: State): Effect.Effect<readonly [void, State], never, R>
  }
  readonly forkReplaceWith: {
    (id: string, state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<readonly [void, State], never, R>
    <A, E, R>(effect: Effect.Effect<A, E, R>, id: string, state: State): Effect.Effect<readonly [void, State], never, R>
  }
}

// --- [Procedure.Handler] -----------------------------------------------------
type Handler<Request extends TaggedRequest.Any, State, Requests extends TaggedRequest.Any, R> = (
  context: Procedure.Context<Requests | Request, Request, State>
) => Effect.Effect<readonly [response: Request.Success<Request> | NoReply, state: State], Request.Error<Request>, R>

// --- [Actor] -----------------------------------------------------------------
interface Actor<M extends Machine.Any> {
  readonly machine: M
  readonly input: Machine.Input<M>
  readonly send: <Req extends Machine.Public<M>>(request: Req) => Effect.Effect<Request.Success<Req>, Request.Error<Req>>
  readonly join: Effect.Effect<never, Machine.InitError<M> | MachineDefect>
}

// --- [SerializableActor] -----------------------------------------------------
interface SerializableActor<M extends Machine.Any> extends Actor<M> {
  readonly sendUnknown: (request: unknown) => Effect.Effect<unknown, unknown>
}
```

---

## [4] SerializableProcedureList API

```typescript
declare const make: <State>(
  initialState: State,
  options?: { readonly identifier?: string }
) => SerializableProcedureList<State, never, never, never>

declare const add: {
  <Req extends S.TaggedRequest.All, I, ReqR, State, Public, Private, R2>(
    schema: S.Schema<Req, I, ReqR> & { readonly _tag: Req["_tag"] },
    handler: Procedure.Handler<Req, State, Public | Private, R2>
  ): <R>(self: SerializableProcedureList<State, Public, Private, R>) =>
    SerializableProcedureList<State, Req | Public, Private, R | R2 | S.SerializableWithResult.Context<Req>>
}

declare const addPrivate: {
  <Req extends S.TaggedRequest.All, I, ReqR, State, Public, Private, R2>(
    schema: S.Schema<Req, I, ReqR> & { readonly _tag: Req["_tag"] },
    handler: Procedure.Handler<Req, State, Public | Private, R2>
  ): <R>(self: SerializableProcedureList<State, Public, Private, R>) =>
    SerializableProcedureList<State, Public, Private | Req, R | R2 | S.SerializableWithResult.Context<Req>>
}
```

---

## [5] OAuth Flow Machine

```typescript
import { Machine } from '@effect/experimental/Machine'
import { Boolean as B, DateTime, Effect, Match, Option, Schema as S } from 'effect'

// --- [SCHEMA] ----------------------------------------------------------------

class OAuthState extends S.Class<OAuthState>('OAuthState')({
  _phase: S.Literal('idle', 'authorize', 'callback', 'token', 'complete', 'failed'),
  tenantId: S.String,
  provider: S.Literal('google', 'microsoft', 'github'),
  codeVerifier: S.OptionFromNullOr(S.String),
  authorizationCode: S.OptionFromNullOr(S.String),
  accessToken: S.OptionFromNullOr(S.Redacted(S.String)),
  refreshToken: S.OptionFromNullOr(S.Redacted(S.String)),
  expiresAt: S.OptionFromNullOr(S.DateTimeUtc),
  error: S.OptionFromNullOr(S.String),
}) {
  static readonly idle = (tenantId: string): OAuthState => new OAuthState({
    _phase: 'idle', tenantId, provider: 'google',
    codeVerifier: Option.none(), authorizationCode: Option.none(),
    accessToken: Option.none(), refreshToken: Option.none(),
    expiresAt: Option.none(), error: Option.none(),
  })
}

// --- [ERRORS] ----------------------------------------------------------------

class OAuthConfigError extends S.TaggedError<OAuthConfigError>()('OAuthConfigError', { message: S.String }) {}
class OAuthStateError extends S.TaggedError<OAuthStateError>()('OAuthStateError', { message: S.String }) {}
class OAuthCodeError extends S.TaggedError<OAuthCodeError>()('OAuthCodeError', { message: S.String }) {}
class RefreshError extends S.TaggedError<RefreshError>()('RefreshError', { message: S.String }) {}

// --- [REQUESTS] --------------------------------------------------------------

class InitiateOAuth extends S.TaggedRequest<InitiateOAuth>()('InitiateOAuth', {
  failure: OAuthConfigError,
  success: S.Struct({ authorizationUrl: S.String, state: S.String }),
  payload: { provider: S.Literal('google', 'microsoft', 'github'), redirectUri: S.String },
}) {}

class HandleCallback extends S.TaggedRequest<HandleCallback>()('HandleCallback', {
  failure: S.Union(OAuthStateError, OAuthCodeError),
  success: S.Struct({ tokens: S.Struct({ accessToken: S.Redacted(S.String), refreshToken: S.OptionFromNullOr(S.Redacted(S.String)), expiresAt: S.DateTimeUtc }) }),
  payload: { code: S.String, state: S.String },
}) {}

class RefreshTokens extends S.TaggedRequest<RefreshTokens>()('RefreshTokens', {
  failure: RefreshError,
  success: S.Struct({ accessToken: S.Redacted(S.String), expiresAt: S.DateTimeUtc }),
  payload: {},
}) {}

// --- [MACHINE] ---------------------------------------------------------------

const makeOAuthMachine = (tenantId: string) => Machine.makeSerializable(
  { state: OAuthState },
  Effect.succeed(
    Machine.serializable.make<OAuthState>(OAuthState.idle(tenantId), { identifier: `oauth:${tenantId}` }).pipe(
      Machine.serializable.add(InitiateOAuth, (ctx) => Effect.gen(function* () {
        const verifier = yield* generatePKCE
        const authUrl = yield* buildAuthorizationUrl(ctx.request.provider, ctx.request.redirectUri, verifier)
        return [
          { authorizationUrl: authUrl.url, state: authUrl.state },
          new OAuthState({ ...ctx.state, _phase: 'authorize', provider: ctx.request.provider, codeVerifier: Option.some(verifier.codeVerifier) }),
        ] as const
      })),
      Machine.serializable.add(HandleCallback, (ctx) => Effect.gen(function* () {
        yield* Match.value(ctx.state._phase).pipe(
          Match.when('authorize', () => Effect.void),
          Match.orElse(() => Effect.fail(new OAuthStateError({ message: `Invalid phase: ${ctx.state._phase}` }))),
        )
        const verifier = yield* Option.match(ctx.state.codeVerifier, {
          onNone: () => Effect.fail(new OAuthStateError({ message: 'Missing PKCE verifier' })),
          onSome: Effect.succeed,
        })
        const tokens = yield* exchangeCodeForTokens(ctx.request.code, verifier)
        return [
          { tokens },
          new OAuthState({ ...ctx.state, _phase: 'complete', authorizationCode: Option.some(ctx.request.code), accessToken: Option.some(tokens.accessToken), refreshToken: tokens.refreshToken, expiresAt: Option.some(tokens.expiresAt) }),
        ] as const
      })),
      Machine.serializable.add(RefreshTokens, (ctx) => Effect.gen(function* () {
        const refreshToken = yield* Option.match(ctx.state.refreshToken, {
          onNone: () => Effect.fail(new RefreshError({ message: 'No refresh token' })),
          onSome: Effect.succeed,
        })
        const tokens = yield* refreshAccessToken(refreshToken)
        return [
          { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
          new OAuthState({ ...ctx.state, accessToken: Option.some(tokens.accessToken), expiresAt: Option.some(tokens.expiresAt) }),
        ] as const
      })),
    ),
  ),
)
```

---

## [6] MFA Flow Machine

```typescript
import { Machine } from '@effect/experimental/Machine'
import { Boolean as B, DateTime, Duration, Effect, Match, Number as N, Option, Schema as S } from 'effect'

// --- [SCHEMA] ----------------------------------------------------------------

class MFAState extends S.Class<MFAState>('MFAState')({
  _phase: S.Literal('idle', 'challenge_sent', 'verified', 'failed', 'locked'),
  userId: S.String,
  tenantId: S.String,
  method: S.Literal('totp', 'sms', 'email'),
  challengeId: S.OptionFromNullOr(S.String),
  attempts: S.Number,
  maxAttempts: S.Number,
  lockedUntil: S.OptionFromNullOr(S.DateTimeUtc),
  verifiedAt: S.OptionFromNullOr(S.DateTimeUtc),
}) {
  static readonly idle = (userId: string, tenantId: string): MFAState => new MFAState({
    _phase: 'idle', userId, tenantId, method: 'totp',
    challengeId: Option.none(), attempts: 0, maxAttempts: 5,
    lockedUntil: Option.none(), verifiedAt: Option.none(),
  })
}

// --- [ERRORS] ----------------------------------------------------------------

class MFALockedError extends S.TaggedError<MFALockedError>()('MFALockedError', { until: S.DateTimeUtc }) {}
class DeliveryError extends S.TaggedError<DeliveryError>()('DeliveryError', { message: S.String }) {}
class InvalidCodeError extends S.TaggedError<InvalidCodeError>()('InvalidCodeError', { attemptsRemaining: S.Number }) {}
class ChallengeExpiredError extends S.TaggedError<ChallengeExpiredError>()('ChallengeExpiredError', {}) {}

// --- [REQUESTS] --------------------------------------------------------------

class SendChallenge extends S.TaggedRequest<SendChallenge>()('SendChallenge', {
  failure: S.Union(MFALockedError, DeliveryError),
  success: S.Struct({ challengeId: S.String, expiresAt: S.DateTimeUtc }),
  payload: { method: S.Literal('totp', 'sms', 'email') },
}) {}

class VerifyCode extends S.TaggedRequest<VerifyCode>()('VerifyCode', {
  failure: S.Union(MFALockedError, InvalidCodeError, ChallengeExpiredError),
  success: S.Struct({ verified: S.Boolean, verifiedAt: S.DateTimeUtc }),
  payload: { code: S.String },
}) {}

class ResetMFA extends S.TaggedRequest<ResetMFA>()('ResetMFA', {
  failure: S.Never,
  success: S.Struct({ reset: S.Boolean }),
  payload: {},
}) {}

// --- [MACHINE] ---------------------------------------------------------------

const makeMFAMachine = (userId: string, tenantId: string) => Machine.makeSerializable(
  { state: MFAState },
  Effect.succeed(
    Machine.serializable.make<MFAState>(MFAState.idle(userId, tenantId), { identifier: `mfa:${tenantId}:${userId}` }).pipe(
      Machine.serializable.add(SendChallenge, (ctx) => Effect.gen(function* () {
        yield* assertNotLocked(ctx.state)
        const challenge = yield* dispatchChallenge(ctx.request.method, ctx.state.userId)
        return [
          { challengeId: challenge.id, expiresAt: challenge.expiresAt },
          new MFAState({ ...ctx.state, _phase: 'challenge_sent', method: ctx.request.method, challengeId: Option.some(challenge.id), attempts: 0 }),
        ] as const
      })),
      Machine.serializable.add(VerifyCode, (ctx) => Effect.gen(function* () {
        yield* assertNotLocked(ctx.state)
        const challengeId = yield* Option.match(ctx.state.challengeId, {
          onNone: () => Effect.fail(new ChallengeExpiredError()),
          onSome: Effect.succeed,
        })
        const valid = yield* validateCode(challengeId, ctx.request.code)
        return yield* B.match(valid, {
          onTrue: () => DateTime.now.pipe(Effect.map((now) => [
            { verified: true, verifiedAt: now },
            new MFAState({ ...ctx.state, _phase: 'verified', verifiedAt: Option.some(now) }),
          ] as const)),
          onFalse: () => Effect.gen(function* () {
            const attempts = ctx.state.attempts + 1
            return yield* B.match(N.greaterThanOrEqualTo(ctx.state.maxAttempts)(attempts), {
              onTrue: () => DateTime.now.pipe(
                Effect.map((now) => DateTime.addDuration(now, Duration.minutes(15))),
                Effect.tap((lockUntil) => Effect.sync(() => new MFAState({ ...ctx.state, _phase: 'locked', attempts, lockedUntil: Option.some(lockUntil) }))),
                Effect.flatMap((lockUntil) => Effect.fail(new MFALockedError({ until: lockUntil }))),
              ),
              onFalse: () => Effect.fail(new InvalidCodeError({ attemptsRemaining: ctx.state.maxAttempts - attempts })),
            })
          }),
        })
      })),
      Machine.serializable.add(ResetMFA, (ctx) => Effect.succeed([
        { reset: true },
        new MFAState({ ...ctx.state, _phase: 'idle', challengeId: Option.none(), attempts: 0, lockedUntil: Option.none(), verifiedAt: Option.none() }),
      ] as const)),
    ),
  ),
)
```

---

## [7] Cluster Persistence Integration

```typescript
import { Machine } from '@effect/experimental/Machine'
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis'
import { DateTime, Duration, Effect, Option, Schema as S } from 'effect'

// --- [SNAPSHOT SCHEMA] -------------------------------------------------------

class MachineSnapshot extends S.Class<MachineSnapshot>('MachineSnapshot')({
  machineId: S.String,
  tenantId: S.String,
  snapshot: S.Tuple(S.Unknown, S.Unknown),
  createdAt: S.DateTimeUtc,
  expiresAt: S.DateTimeUtc,
}) {}

// --- [PERSISTENCE SERVICE] ---------------------------------------------------

class MachineSnapshotService extends Effect.Service<MachineSnapshotService>()('MachineSnapshotService', {
  effect: Effect.gen(function* () {
    const persistence = yield* PersistenceRedis.ResultPersistence

    const save = <M extends Machine.SerializableMachine.Any>(
      machineId: string,
      tenantId: string,
      actor: Machine.Actor<M>,
      ttl: Duration.Duration,
    ) => Effect.gen(function* () {
      const snapshot = yield* Machine.snapshot(actor)
      const now = yield* DateTime.now
      const record = new MachineSnapshot({ machineId, tenantId, snapshot, createdAt: now, expiresAt: DateTime.addDuration(now, ttl) })
      yield* persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshot).set(record)
      return record
    })

    const restore = <State, Public, Private, Input, InitErr, R, SR>(
      machine: Machine.SerializableMachine<State, Public, Private, Input, InitErr, R, SR>,
      machineId: string,
      tenantId: string,
    ) => persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshot).get.pipe(
      Effect.flatMap(Option.match({
        onNone: () => Machine.boot(machine),
        onSome: (r) => Machine.restore(machine, r.snapshot),
      })),
    )

    const remove = (machineId: string, tenantId: string) =>
      persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshot).remove

    return { save, restore, remove }
  }),
  dependencies: [PersistenceRedis.layerResult],
}) {}
```

---

## [8] Inline Patterns

```typescript
// --- [PHASE GUARD] -----------------------------------------------------------
// Inline Match.value directly in handlers — no helper function needed:
yield* Match.value(ctx.state._phase).pipe(
  Match.when('authorize', () => Effect.void),
  Match.orElse((actual) => Effect.fail(new InvalidPhaseError({ actual, allowed: ['authorize'] }))),
)

// --- [OPTION EXTRACTION] -----------------------------------------------------
// Option.match returns Effect directly — no pipe needed:
const verifier = yield* Option.match(ctx.state.codeVerifier, {
  onNone: () => Effect.fail(new OAuthStateError({ message: 'Missing PKCE verifier' })),
  onSome: Effect.succeed,
})

// --- [BINARY BRANCHING] ------------------------------------------------------
// Boolean.match for exhaustive binary conditions:
yield* B.match(valid, {
  onTrue: () => Effect.succeed(successResult),
  onFalse: () => Effect.fail(new InvalidCodeError({ attemptsRemaining })),
})

// --- [NUMERIC COMPARISON] ----------------------------------------------------
// Number.greaterThanOrEqualTo is curried: (threshold)(value)
B.match(N.greaterThanOrEqualTo(ctx.state.maxAttempts)(attempts), {
  onTrue: () => Effect.fail(new MFALockedError({ until: lockUntil })),
  onFalse: () => Effect.fail(new InvalidCodeError({ attemptsRemaining: ctx.state.maxAttempts - attempts })),
})

// --- [TAG-BASED DISPATCH] ----------------------------------------------------
// Match.tag for discriminated unions — inline, not as helper:
Match.type<InitiateOAuth | HandleCallback | RefreshTokens>().pipe(
  Match.tag('InitiateOAuth', (req) => handleInitiate(state, req)),
  Match.tag('HandleCallback', (req) => handleCallback(state, req)),
  Match.tag('RefreshTokens', (req) => handleRefresh(state, req)),
  Match.exhaustive,
)(request)
```

---

## [9] API Reference Table

| Function | Input | Output | Use Case |
|----------|-------|--------|----------|
| `Machine.make` | `Effect<ProcedureList>` | `Machine<...>` | In-memory state machines |
| `Machine.makeSerializable` | `{ state: Schema }, Effect<SerializableProcedureList>` | `SerializableMachine<...>` | Persistent state machines |
| `Machine.boot` | `Machine, input?, { previousState? }` | `Effect<Actor \| SerializableActor>` | Start machine instance |
| `Machine.snapshot` | `Actor<SerializableMachine>` | `Effect<[input, state]>` | Serialize for persistence |
| `Machine.restore` | `SerializableMachine, [input, state]` | `Effect<Actor>` | Resume from snapshot |
| `Machine.retry` | `Schedule` | `(Machine) => Machine` | Add retry policy to initialization |
| `serializable.make` | `initialState, { identifier? }` | `SerializableProcedureList` | Create procedure list |
| `serializable.add` | `Schema, Handler` | `SerializableProcedureList => ...` | Add public handler |
| `serializable.addPrivate` | `Schema, Handler` | `SerializableProcedureList => ...` | Add private handler |
| `actor.send` | `Request` | `Effect<Response, Error>` | Dispatch request |
| `actor.sendUnknown` | `unknown` | `Effect<unknown, unknown>` | SerializableActor only |
| `actor.join` | - | `Effect<never, InitError \| MachineDefect>` | Await termination |

---

## [10] Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Current time | `Date.now()`, `new Date()` | `DateTime.now` |
| DateTime creation | `new Date(ms)` | `DateTime.unsafeMake(ms)` |
| Duration arithmetic | `ms + Duration.toMillis(...)` | `DateTime.addDuration(dt, duration)` |
| Binary conditions | `if (bool) {...}` | `Boolean.match(bool, { onTrue, onFalse })` |
| Match on boolean | `Match.value(bool).pipe(...)` | `Boolean.match(bool, {...})` |
| Numeric comparison | `a >= b` in `if` | `Number.greaterThanOrEqualTo(b)(a)` + `Boolean.match` |
| Array containment | `.includes(value)` | `Array.contains(value)` |
| Phase guards | Helper function | Inline `Match.value` |
| Clock access | `Effect.clockWith((c) => ...)` | `Clock.currentTimeMillis` or `DateTime.now` |
| Option to Effect | `option.pipe(Effect.flatMap(...))` | `Option.match(option, { onNone, onSome })` |

---

## [11] Common Pitfalls

| Pitfall | Symptom | Solution |
|---------|---------|----------|
| Wrong fork return type | Expecting `Fiber<A, E>` | `fork` returns `Effect<void>`; use `forkWith` for state returns |
| Option.pipe to Effect | Type error on Option | `Option.match` returns Effect directly; no pipe needed |
| Number currying order | Wrong comparison result | `N.greaterThanOrEqualTo(threshold)(value)` — threshold first |
| Actor vs SerializableActor | Missing `sendUnknown` | `Machine.boot` on SerializableMachine returns `SerializableActor` |
| Imperative branching | `if/else` in handlers | Use `Boolean.match` or `Effect.if` |
| Date instead of DateTime | Loses UTC context | Use `DateTime.now`, `DateTime.unsafeMake` |
| Manual ms arithmetic | Error-prone | Use `DateTime.addDuration` |
| Helper function spam | `assertPhase`, etc. | Inline `Match.value` patterns directly |

---

## [12] Sources

- [Machine.ts API](https://effect-ts.github.io/effect/experimental/Machine.ts.html)
- [Procedure.ts API](https://effect-ts.github.io/effect/experimental/Machine/Procedure.ts.html)
- [SerializableProcedureList.ts API](https://effect-ts.github.io/effect/experimental/Machine/SerializableProcedureList.ts.html)
- [GitHub Source](https://github.com/Effect-TS/effect/tree/main/packages/experimental/src/Machine)
