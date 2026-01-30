# @effect/experimental Machine Research

**Version:** 0.58.0+ | **Updated:** 2026-01-29 | **Scope:** OAuth/MFA state machines for multi-tenant cluster deployment

---

## [1] Core Exports

```typescript
import { Machine } from '@effect/experimental/Machine'
import type { Procedure, ProcedureList, SerializableProcedureList } from '@effect/experimental/Machine'
```

| Export | Description |
|--------|-------------|
| `Machine.make` | Create non-serializable machine (in-memory only) |
| `Machine.makeSerializable` | Create machine with schema-backed state persistence |
| `Machine.boot` | Spawn Actor from machine definition |
| `Machine.snapshot` | Encode Actor state for persistence |
| `Machine.restore` | Decode and resume Actor from snapshot |
| `Machine.retry` | Apply retry policy to initialization |
| `Machine.NoReply` | Symbol for fire-and-forget handlers |
| `Machine.procedures` | Re-export of ProcedureList module |
| `Machine.serializable` | Re-export of SerializableProcedureList module |

---

## [2] Type Signatures

### Machine Factory Functions

```typescript
// --- [Machine.make] ----------------------------------------------------------
declare const make: {
  // Void input variant
  <State, Public extends TaggedRequest.Any, Private extends TaggedRequest.Any, InitErr, R>(
    initialize: Effect.Effect<ProcedureList<State, Public, Private, R>, InitErr, R>
  ): Machine<State, Public, Private, void, InitErr, Exclude<R, Scope | MachineContext>>

  // Input variant
  <State, Public extends TaggedRequest.Any, Private extends TaggedRequest.Any, Input, InitErr, R>(
    initialize: Machine.Initialize<Input, State, Public, Private, R, InitErr, R>
  ): Machine<State, Public, Private, Input, InitErr, Exclude<R, Scope | MachineContext>>
}

// --- [Machine.makeSerializable] ----------------------------------------------
declare const makeSerializable: {
  // Void input variant
  <State, IS, RS, Public extends Schema.TaggedRequest.All,
   Private extends Schema.TaggedRequest.All, InitErr, R>(
    options: { readonly state: Schema.Schema<State, IS, RS> },
    initialize: Effect.Effect<SerializableProcedureList<State, Public, Private, R>, InitErr, R>
  ): SerializableMachine<State, Public, Private, void, InitErr, Exclude<R, Scope | MachineContext>, RS>

  // Input variant
  <State, IS, RS, Input, II, RI, Public extends Schema.TaggedRequest.All,
   Private extends Schema.TaggedRequest.All, InitErr, R>(
    options: { readonly state: Schema.Schema<State, IS, RS>; readonly input: Schema.Schema<Input, II, RI> },
    initialize: Machine.InitializeSerializable<Input, State, Public, Private, R, InitErr, R>
  ): SerializableMachine<State, Public, Private, Input, InitErr, Exclude<R, Scope | MachineContext>, RS | RI>
}
```

### Runtime Functions

```typescript
// --- [Machine.boot] ----------------------------------------------------------
declare const boot: <M extends Machine.Any>(
  self: M,
  ...[input, options]: [Machine.Input<M>] extends [void]
    ? [input?: void, options?: { readonly previousState?: Machine.State<M> }]
    : [input: Machine.Input<M>, options?: { readonly previousState?: Machine.State<M> }]
) => Effect.Effect<Actor<M>, never, Machine.Context<M> | Scope>

// --- [Machine.snapshot] ------------------------------------------------------
declare const snapshot: <State, Public, Private, Input, InitErr, R, SR>(
  self: Actor<SerializableMachine<State, Public, Private, Input, InitErr, R, SR>>
) => Effect.Effect<[input: unknown, state: unknown], ParseResult.ParseError, SR>

// --- [Machine.restore] -------------------------------------------------------
declare const restore: <State, Public, Private, Input, InitErr, R, SR>(
  self: SerializableMachine<State, Public, Private, Input, InitErr, R, SR>,
  snapshot: readonly [input: unknown, state: unknown]
) => Effect.Effect<Actor<SerializableMachine<...>>, ParseResult.ParseError, R | SR>
```

### Procedure Types

```typescript
// --- [Procedure.Handler] -----------------------------------------------------
type Handler<Request extends TaggedRequest.Any, State, Requests extends TaggedRequest.Any, R> = (
  context: Procedure.Context<Requests | Request, Request, State>
) => Effect.Effect<
  readonly [response: Request.Success<Request> | NoReply, state: State],
  Request.Error<Request>,
  R
>

// --- [Procedure.Context] -----------------------------------------------------
interface Context<Requests extends TaggedRequest.Any, Request extends TaggedRequest.Any, State> {
  readonly request: Request
  readonly state: State
  readonly deferred: Deferred<Request.Success<Request>, Request.Error<Request>>
  send<Req extends Requests>(req: Req): Effect.Effect<void>
  sendAwait<Req extends Requests>(req: Req): Effect.Effect<Request.Success<Req>, Request.Error<Req>>
  fork<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Fiber<A, E>>
  forkWith(state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Fiber<A, E>>
  forkOneWith(id: string, state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Fiber<A, E>>
  forkReplaceWith(id: string, state: State): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Fiber<A, E>>
}

// --- [Actor] -----------------------------------------------------------------
interface Actor<M extends Machine.Any> {
  readonly machine: M
  readonly input: Machine.Input<M>
  send<Req extends Machine.Public<M>>(request: Req): Effect.Effect<Request.Success<Req>, Request.Error<Req>>
  readonly join: Effect.Effect<never, Machine.InitError<M> | MachineDefect>
}
```

---

## [3] SerializableProcedureList API

```typescript
// --- [make] ------------------------------------------------------------------
declare const make: <State>(
  initialState: State,
  options?: { readonly identifier?: string }
) => SerializableProcedureList<State, never, never, never>

// --- [add] -------------------------------------------------------------------
declare const add: {
  <Req extends Schema.TaggedRequest.All, I, ReqR, State, Public, Private, R2>(
    schema: Schema.Schema<Req, I, ReqR> & { readonly _tag: Req["_tag"] },
    handler: Procedure.Handler<Req, State, Public | Private, R2>
  ): <R>(
    self: SerializableProcedureList<State, Public, Private, R>
  ) => SerializableProcedureList<State, Req | Public, Private, R | R2 | Schema.SerializableWithResult.Context<Req>>
}

// --- [addPrivate] ------------------------------------------------------------
declare const addPrivate: {
  <Req extends Schema.TaggedRequest.All, I, ReqR, State, Public, Private, R2>(
    schema: Schema.Schema<Req, I, ReqR> & { readonly _tag: Req["_tag"] },
    handler: Procedure.Handler<Req, State, Public | Private, R2>
  ): <R>(
    self: SerializableProcedureList<State, Public, Private, R>
  ) => SerializableProcedureList<State, Public, Private | Req, R | R2 | Schema.SerializableWithResult.Context<Req>>
}
```

---

## [4] OAuth Flow Machine

```typescript
import { Machine } from '@effect/experimental/Machine'
import { Data, Effect, Match, Option, Schema as S } from 'effect'

// --- [SCHEMA] ----------------------------------------------------------------

const OAuthStateSchema = S.Struct({
  _phase: S.Literal('idle', 'authorize', 'callback', 'token', 'complete', 'failed'),
  tenantId: S.String,
  provider: S.Literal('google', 'microsoft', 'github'),
  codeVerifier: S.OptionFromNullOr(S.String),
  authorizationCode: S.OptionFromNullOr(S.String),
  accessToken: S.OptionFromNullOr(S.Redacted(S.String)),
  refreshToken: S.OptionFromNullOr(S.Redacted(S.String)),
  expiresAt: S.OptionFromNullOr(S.DateTimeUtc),
  error: S.OptionFromNullOr(S.String),
})
type OAuthState = typeof OAuthStateSchema.Type

// --- [REQUESTS] --------------------------------------------------------------

class InitiateOAuth extends S.TaggedRequest<InitiateOAuth>()('InitiateOAuth', {
  failure: S.TaggedError<{ readonly _tag: 'OAuthConfigError'; readonly message: string }>('OAuthConfigError'),
  success: S.Struct({ authorizationUrl: S.String, state: S.String }),
  payload: { provider: S.Literal('google', 'microsoft', 'github'), redirectUri: S.String },
}) {}

class HandleCallback extends S.TaggedRequest<HandleCallback>()('HandleCallback', {
  failure: S.Union(
    S.TaggedError<{ readonly _tag: 'OAuthStateError'; readonly message: string }>('OAuthStateError'),
    S.TaggedError<{ readonly _tag: 'OAuthCodeError'; readonly message: string }>('OAuthCodeError'),
  ),
  success: S.Struct({ tokens: S.Struct({ accessToken: S.Redacted(S.String), refreshToken: S.OptionFromNullOr(S.Redacted(S.String)), expiresAt: S.DateTimeUtc }) }),
  payload: { code: S.String, state: S.String },
}) {}

class RefreshTokens extends S.TaggedRequest<RefreshTokens>()('RefreshTokens', {
  failure: S.TaggedError<{ readonly _tag: 'RefreshError'; readonly message: string }>('RefreshError'),
  success: S.Struct({ accessToken: S.Redacted(S.String), expiresAt: S.DateTimeUtc }),
  payload: {},
}) {}

type OAuthRequest = InitiateOAuth | HandleCallback | RefreshTokens

// --- [MACHINE] ---------------------------------------------------------------

const makeOAuthMachine = (tenantId: string) => Machine.makeSerializable(
  { state: OAuthStateSchema },
  Effect.succeed(
    Machine.serializable.make<OAuthState>(
      { _phase: 'idle', tenantId, provider: 'google', codeVerifier: Option.none(), authorizationCode: Option.none(), accessToken: Option.none(), refreshToken: Option.none(), expiresAt: Option.none(), error: Option.none() },
      { identifier: `oauth:${tenantId}` },
    )
    .pipe(
      Machine.serializable.add(InitiateOAuth, (ctx) =>
        Effect.gen(function* () {
          const verifier = yield* generatePKCE
          const authUrl = yield* buildAuthorizationUrl(ctx.request.provider, ctx.request.redirectUri, verifier)
          const next: OAuthState = { ...ctx.state, _phase: 'authorize', provider: ctx.request.provider, codeVerifier: Option.some(verifier.codeVerifier) }
          return [{ authorizationUrl: authUrl.url, state: authUrl.state }, next] as const
        }),
      ),
      Machine.serializable.add(HandleCallback, (ctx) =>
        Effect.gen(function* () {
          yield* Match.value(ctx.state._phase).pipe(
            Match.when('authorize', () => Effect.void),
            Match.orElse(() => Effect.fail(new OAuthStateError({ message: `Invalid phase: ${ctx.state._phase}` }))),
          )
          const verifier = yield* Option.match(ctx.state.codeVerifier, { onNone: () => Effect.fail(new OAuthStateError({ message: 'Missing PKCE verifier' })), onSome: Effect.succeed })
          const tokens = yield* exchangeCodeForTokens(ctx.request.code, verifier)
          const next: OAuthState = { ...ctx.state, _phase: 'complete', authorizationCode: Option.some(ctx.request.code), accessToken: Option.some(tokens.accessToken), refreshToken: tokens.refreshToken, expiresAt: Option.some(tokens.expiresAt) }
          return [{ tokens }, next] as const
        }),
      ),
      Machine.serializable.add(RefreshTokens, (ctx) =>
        Effect.gen(function* () {
          const refreshToken = yield* Option.match(ctx.state.refreshToken, { onNone: () => Effect.fail(new RefreshError({ message: 'No refresh token' })), onSome: Effect.succeed })
          const tokens = yield* refreshAccessToken(refreshToken)
          const next: OAuthState = { ...ctx.state, accessToken: Option.some(tokens.accessToken), expiresAt: Option.some(tokens.expiresAt) }
          return [{ accessToken: tokens.accessToken, expiresAt: tokens.expiresAt }, next] as const
        }),
      ),
    ),
  ),
)

// --- [RUNTIME] ---------------------------------------------------------------

const oauthFlow = Effect.gen(function* () {
  const actor = yield* Machine.boot(makeOAuthMachine('tenant-123'))
  const initResult = yield* actor.send(new InitiateOAuth({ provider: 'google', redirectUri: 'https://app.example.com/callback' }))
  // ... user redirected to initResult.authorizationUrl ...
  // ... callback received ...
  const callbackResult = yield* actor.send(new HandleCallback({ code: 'auth-code', state: initResult.state }))
  // Persist for cluster recovery
  const snapshot = yield* Machine.snapshot(actor)
  yield* persistSnapshot('oauth', 'tenant-123', snapshot)
  return callbackResult.tokens
})
```

---

## [5] MFA Flow Machine

```typescript
import { Machine } from '@effect/experimental/Machine'
import { Data, Duration, Effect, Match, Option, Schema as S } from 'effect'

// --- [SCHEMA] ----------------------------------------------------------------

const MFAStateSchema = S.Struct({
  _phase: S.Literal('idle', 'challenge_sent', 'verified', 'failed', 'locked'),
  userId: S.String,
  tenantId: S.String,
  method: S.Literal('totp', 'sms', 'email'),
  challengeId: S.OptionFromNullOr(S.String),
  attempts: S.Number,
  maxAttempts: S.Number,
  lockedUntil: S.OptionFromNullOr(S.DateTimeUtc),
  verifiedAt: S.OptionFromNullOr(S.DateTimeUtc),
})
type MFAState = typeof MFAStateSchema.Type

// --- [REQUESTS] --------------------------------------------------------------

class SendChallenge extends S.TaggedRequest<SendChallenge>()('SendChallenge', {
  failure: S.Union(
    S.TaggedError<{ readonly _tag: 'MFALockedError'; readonly until: typeof S.DateTimeUtc.Type }>('MFALockedError'),
    S.TaggedError<{ readonly _tag: 'DeliveryError'; readonly message: string }>('DeliveryError'),
  ),
  success: S.Struct({ challengeId: S.String, expiresAt: S.DateTimeUtc }),
  payload: { method: S.Literal('totp', 'sms', 'email') },
}) {}

class VerifyCode extends S.TaggedRequest<VerifyCode>()('VerifyCode', {
  failure: S.Union(
    S.TaggedError<{ readonly _tag: 'MFALockedError'; readonly until: typeof S.DateTimeUtc.Type }>('MFALockedError'),
    S.TaggedError<{ readonly _tag: 'InvalidCodeError'; readonly attemptsRemaining: number }>('InvalidCodeError'),
    S.TaggedError<{ readonly _tag: 'ChallengeExpiredError' }>('ChallengeExpiredError'),
  ),
  success: S.Struct({ verified: S.Boolean, verifiedAt: S.DateTimeUtc }),
  payload: { code: S.String },
}) {}

class ResetMFA extends S.TaggedRequest<ResetMFA>()('ResetMFA', {
  failure: S.Never,
  success: S.Struct({ reset: S.Boolean }),
  payload: {},
}) {}

type MFARequest = SendChallenge | VerifyCode | ResetMFA

// --- [MACHINE] ---------------------------------------------------------------

const makeMFAMachine = (userId: string, tenantId: string) => Machine.makeSerializable(
  { state: MFAStateSchema },
  Effect.succeed(
    Machine.serializable.make<MFAState>(
      { _phase: 'idle', userId, tenantId, method: 'totp', challengeId: Option.none(), attempts: 0, maxAttempts: 5, lockedUntil: Option.none(), verifiedAt: Option.none() },
      { identifier: `mfa:${tenantId}:${userId}` },
    )
    .pipe(
      Machine.serializable.add(SendChallenge, (ctx) =>
        Effect.gen(function* () {
          yield* assertNotLocked(ctx.state)
          const challenge = yield* dispatchChallenge(ctx.request.method, ctx.state.userId)
          const next: MFAState = { ...ctx.state, _phase: 'challenge_sent', method: ctx.request.method, challengeId: Option.some(challenge.id), attempts: 0 }
          return [{ challengeId: challenge.id, expiresAt: challenge.expiresAt }, next] as const
        }),
      ),
      Machine.serializable.add(VerifyCode, (ctx) =>
        Effect.gen(function* () {
          yield* assertNotLocked(ctx.state)
          const challengeId = yield* Option.match(ctx.state.challengeId, { onNone: () => Effect.fail(new ChallengeExpiredError()), onSome: Effect.succeed })
          const valid = yield* validateCode(challengeId, ctx.request.code)
          if (valid) {
            const now = yield* Effect.clockWith((c) => c.currentTimeMillis).pipe(Effect.map((ms) => new Date(ms)))
            const next: MFAState = { ...ctx.state, _phase: 'verified', verifiedAt: Option.some(now) }
            return [{ verified: true, verifiedAt: now }, next] as const
          }
          const attempts = ctx.state.attempts + 1
          if (attempts >= ctx.state.maxAttempts) {
            const lockUntil = yield* Effect.clockWith((c) => c.currentTimeMillis).pipe(Effect.map((ms) => new Date(ms + Duration.toMillis(Duration.minutes(15)))))
            const next: MFAState = { ...ctx.state, _phase: 'locked', attempts, lockedUntil: Option.some(lockUntil) }
            return yield* Effect.fail(new MFALockedError({ until: lockUntil }))
          }
          const next: MFAState = { ...ctx.state, attempts }
          return yield* Effect.fail(new InvalidCodeError({ attemptsRemaining: ctx.state.maxAttempts - attempts }))
        }),
      ),
      Machine.serializable.add(ResetMFA, (ctx) =>
        Effect.succeed([
          { reset: true },
          { ...ctx.state, _phase: 'idle', challengeId: Option.none(), attempts: 0, lockedUntil: Option.none(), verifiedAt: Option.none() },
        ] as const),
      ),
    ),
  ),
)
```

---

## [6] Polymorphic Match Patterns

```typescript
// --- [STATE TRANSITION GUARDS] -----------------------------------------------

const assertPhase = <S extends { readonly _phase: string }>(
  state: S,
  ...allowed: readonly S['_phase'][]
) => Match.value(state._phase).pipe(
  Match.whenOr(...allowed.map(p => Match.when(p, () => Effect.void))),
  Match.orElse((actual) => Effect.fail(new InvalidPhaseError({ actual, allowed }))),
)

// --- [POLYMORPHIC HANDLER DISPATCH] ------------------------------------------

const dispatchHandler = <State extends { readonly _phase: string }, Req extends { readonly _tag: string }>(
  state: State,
  request: Req,
) => Match.type<Req>().pipe(
  Match.tag('InitiateOAuth', (req) => handleInitiate(state, req)),
  Match.tag('HandleCallback', (req) => handleCallback(state, req)),
  Match.tag('RefreshTokens', (req) => handleRefresh(state, req)),
  Match.tag('SendChallenge', (req) => handleSendChallenge(state, req)),
  Match.tag('VerifyCode', (req) => handleVerifyCode(state, req)),
  Match.exhaustive,
)(request)

// --- [PHASE-BASED STATE MACHINE PATTERN] -------------------------------------

const transitionPhase = <Phase extends string>(
  current: Phase,
  transitions: Record<Phase, readonly Phase[]>,
  target: Phase,
): Effect.Effect<Phase, InvalidTransitionError> =>
  Match.value(transitions[current]?.includes(target) ?? false).pipe(
    Match.when(true, () => Effect.succeed(target)),
    Match.when(false, () => Effect.fail(new InvalidTransitionError({ from: current, to: target }))),
    Match.exhaustive,
  )
```

---

## [7] Cluster Persistence Integration

```typescript
import { Machine } from '@effect/experimental/Machine'
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis'
import { Effect, Layer, Schema as S } from 'effect'

// --- [SNAPSHOT SCHEMA] -------------------------------------------------------

const MachineSnapshotSchema = S.Struct({
  machineId: S.String,
  tenantId: S.String,
  snapshot: S.Tuple(S.Unknown, S.Unknown),
  createdAt: S.DateTimeUtc,
  expiresAt: S.DateTimeUtc,
})

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
      const now = yield* Effect.clockWith((c) => c.currentTimeMillis)
      const record = { machineId, tenantId, snapshot, createdAt: new Date(now), expiresAt: new Date(now + Duration.toMillis(ttl)) }
      yield* persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshotSchema).set(record)
      return record
    })

    const restore = <State, Public, Private, Input, InitErr, R, SR>(
      machine: Machine.SerializableMachine<State, Public, Private, Input, InitErr, R, SR>,
      machineId: string,
      tenantId: string,
    ) => Effect.gen(function* () {
      const store = persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshotSchema)
      const record = yield* store.get
      return yield* Option.match(record, {
        onNone: () => Machine.boot(machine),
        onSome: (r) => Machine.restore(machine, r.snapshot),
      })
    })

    const remove = (machineId: string, tenantId: string) =>
      persistence.make(`machine:${tenantId}:${machineId}`, MachineSnapshotSchema).remove

    return { save, restore, remove }
  }),
  dependencies: [PersistenceRedis.layerResult],
}) {}

// --- [CLUSTER ACTOR RECOVERY] ------------------------------------------------

const recoverOrBoot = <M extends Machine.SerializableMachine.Any>(
  machine: M,
  machineId: string,
  tenantId: string,
) => Effect.gen(function* () {
  const snapshotService = yield* MachineSnapshotService
  return yield* snapshotService.restore(machine, machineId, tenantId)
})
```

---

## [8] API Reference Table

| Function | Input | Output | Use Case |
|----------|-------|--------|----------|
| `Machine.make` | `Effect<ProcedureList>` | `Machine<...>` | In-memory state machines |
| `Machine.makeSerializable` | `{ state: Schema }, Effect<SerializableProcedureList>` | `SerializableMachine<...>` | Persistent state machines |
| `Machine.boot` | `Machine, input?, { previousState? }` | `Effect<Actor>` | Start machine instance |
| `Machine.snapshot` | `Actor<SerializableMachine>` | `Effect<[input, state]>` | Serialize for persistence |
| `Machine.restore` | `SerializableMachine, [input, state]` | `Effect<Actor>` | Resume from snapshot |
| `Machine.retry` | `Schedule` | `(Machine) => Machine` | Add retry policy |
| `serializable.make` | `initialState, { identifier? }` | `SerializableProcedureList` | Create procedure list |
| `serializable.add` | `Schema, Handler` | `SerializableProcedureList => SerializableProcedureList` | Add public handler |
| `serializable.addPrivate` | `Schema, Handler` | `SerializableProcedureList => SerializableProcedureList` | Add private handler |
| `actor.send` | `Request` | `Effect<Response, Error>` | Dispatch request |
| `actor.join` | - | `Effect<never, InitError \| MachineDefect>` | Await termination |

---

## [9] Sources

- [Machine.ts API](https://effect-ts.github.io/effect/experimental/Machine.ts.html)
- [Procedure.ts API](https://effect-ts.github.io/effect/experimental/Machine/Procedure.ts.html)
- [ProcedureList.ts API](https://effect-ts.github.io/effect/experimental/Machine/ProcedureList.ts.html)
- [SerializableProcedureList.ts API](https://effect-ts.github.io/effect/experimental/Machine/SerializableProcedureList.ts.html)
- [GitHub Source](https://github.com/Effect-TS/effect/tree/main/packages/experimental/src/Machine)
