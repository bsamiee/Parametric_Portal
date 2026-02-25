# [H1][EFFECTS]
>**Dictum:** *Effect execution is contract algebra: every constructor, topology, and policy choice fixes observable `A/E/R` behavior.*

<br>

This reference owns runtime decisions that remain after shape and service modeling: entry semantics, topology and loss contracts, `R`-channel supply, and scoped policy rails. Every snippet is pinned to current local typings (`effect@3.19.x`) and keeps branch-free FP+ROP posture. Deep matching, service architecture, and concurrency internals stay in sibling references; this chapter focuses on execution-boundary decisions.

---
## [1][ENTRY_BOUNDARY_AND_CONSTRUCTOR_SEMANTICS]
>**Dictum:** *Boundary constructors define failure semantics first; business flow composes only typed rails.*

<br>

- `Effect.promise` evaluates async code whose rejection/throw path is defect (`die`), not typed `E`.
- `Effect.tryPromise` keeps async boundary recoverable and mappable into domain failure rails.
- `Effect.sync` models synchronous side effects; `Effect.suspend` delays graph construction.
- `Effect.succeed` and `Effect.fail` inject pure values directly into success/error channels.

```ts
import { Data, Effect, Schema as S } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class IntakeError extends Data.TaggedError("IntakeError")<{
  readonly stage:  "decode" | "quota" | "upstream" | "defect";
  readonly reason: "invalid" | "rejected" | "failed" | "unexpected";
  readonly cause?: unknown;
}> {}

// --- [SCHEMA] ----------------------------------------------------------------

const Intake = S.Struct({
  tenantId: S.UUID,
  plan:     S.Literal("free", "pro", "enterprise"),
  quota:    S.Number.pipe(S.int(), S.nonNegative()),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const stableHint = Effect.promise(() => Promise.resolve("edge-cache-hit" as const));
const intakeRail = (input: unknown) =>
  S.decodeUnknown(Intake)(input).pipe(
    Effect.mapError((cause) => new IntakeError({ stage: "decode", reason: "invalid", cause })),
    Effect.filterOrFail(({ quota }) => quota > 0, ({ quota }) => new IntakeError({ stage: "quota", reason: "rejected", cause: quota })),
    Effect.flatMap((request) =>
      Effect.tryPromise(() => Promise.resolve({ tenantId: request.tenantId, features: ["audit", "stream"] as const })).pipe(
        Effect.mapError((cause) => new IntakeError({ stage: "upstream", reason: "failed", cause })),
        Effect.map((upstream) => ({ request, upstream }) as const),
      ),
    ),
    Effect.zip(stableHint),
    Effect.map(([state, cacheHint]) => ({ ...state, cacheHint }) as const),
  );
```

**Laws:**<br>
- constructor choice sets boundary semantics, not implementation detail,
- `tryPromise` is the recoverable async ingress rail, `promise` is defect-only ingress,
- decode and normalization collapse at boundary once; downstream code stays domain-typed.

---
## [2][TOPOLOGY_MODE_AND_LOSS_CONTRACTS]
>**Dictum:** *Topology chooses dependency shape; aggregation mode chooses information-loss semantics.*

<br>

- dependency topology: `flatMap` for dependent steps, `all` for independent fan-in, `race` for success-first latency hedging.
- aggregation mode is contract surface:
  - fail-fast (`all` default),
  - branch-preserving (`mode: "either"`),
  - validation-preserving (`mode: "validate"`),
  - collection-level retention (`partition`, `validateAll`, `validateFirst`).
- compare mode on the same graph shape; changing shape and mode together hides loss semantics.
- choose retention operator only after mode intent is explicit (`either` retains branch success, `validate` retains error position).

```ts
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Chunk, Data, Effect, Either, HashMap, Match, Option, Stream } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class SnapshotError extends Data.TaggedError("SnapshotError")<{
  readonly source: "profile" | "usage" | "entitlements";
  readonly reason: "missing" | "rejected";
}> {}
const snapshotReasonPolicy = {
  missing:  { status: 404, retryable: false },
  rejected: { status: 503, retryable: true  },
} as const satisfies Record<SnapshotError["reason"], { readonly status: 404 | 503; readonly retryable: boolean }>;

// --- [FUNCTIONS] -------------------------------------------------------------

const profile = (tenantId: string) =>
  HttpClient.HttpClient.pipe(
    Effect.map((client) => client.pipe(HttpClient.mapRequest(HttpClientRequest.acceptJson))),
    Effect.flatMap((client) => client.get("https://profile.internal/v1/profile", { urlParams: { tenantId } })),
    Effect.flatMap((response) =>
      HttpClientResponse.matchStatus(response, {
        200: () =>    Effect.succeed({ tenantId, status: "active" as const }),
        404: () =>    Effect.fail(new SnapshotError({ source: "profile", reason: "missing" })),
        orElse: () => Effect.fail(new SnapshotError({ source: "profile", reason: "rejected" })),
      }),
    ),
  );
const usage = (tenantId: string) =>
  Match.value(tenantId).pipe(
    Match.when("tenant-overdue", () => Effect.fail(new SnapshotError({ source: "usage", reason: "rejected" }))),
    Match.orElse((id) => Effect.succeed({ tenantId: id, seatsUsed: 8, apiCalls: 520 } as const)),
  );
const entitlements = (tenantId: string) =>
  Match.value(tenantId).pipe(
    Match.when("tenant-denied", () => Effect.fail(new SnapshotError({ source: "entitlements", reason: "rejected" }))),
    Match.orElse((id) => Effect.succeed({ tenantId: id, features: ["audit", "stream"] as const })),
  );
const snapshotGraph = (tenantId: string) => ({ profile: profile(tenantId), usage: usage(tenantId), entitlements: entitlements(tenantId) } as const);
const byMode = (tenantId: string) => ({
  failFast: Effect.all(snapshotGraph(tenantId)),
  either:   Effect.all(snapshotGraph(tenantId), { mode: "either" }),
  validate: Effect.all(snapshotGraph(tenantId), { mode: "validate" }),
} as const);
const retentionPolicies = (tenantIds: ReadonlyArray<string>) => ({
  partition:     Effect.partition(tenantIds,     (tenantId) => byMode(tenantId).failFast, { concurrency: "unbounded" }),
  validateAll:   Effect.validateAll(tenantIds,   (tenantId) => byMode(tenantId).failFast),
  validateFirst: Effect.validateFirst(tenantIds, (tenantId) => byMode(tenantId).failFast),
} as const);
const summarizeWindows = (tenantIds: ReadonlyArray<string>) =>
  Stream.fromIterable(tenantIds).pipe(
    Stream.mapEffect((tenantId) => byMode(tenantId).either),
    Stream.groupedWithin(64, "750 millis"),
    Stream.map((window) =>
      Chunk.reduce(window, HashMap.empty<"ok" | "error", number>(), (acc, outcomes) =>
        [outcomes.profile, outcomes.usage, outcomes.entitlements].reduce(
          (state, branch) =>
            Either.match(branch, {
              onLeft: () => HashMap.set(state, "error", Option.getOrElse(HashMap.get(state, "error"), () => 0) + 1),
              onRight: () => HashMap.set(state, "ok", Option.getOrElse(HashMap.get(state, "ok"),      () => 0) + 1),
            }),
          acc,
        ),
      ),
    ),
    Stream.runCollect,
  );
```

**Laws:**<br>
- topology selection precedes implementation and is part of API meaning,
- aggregation mode defines retention/loss semantics and therefore return-shape contracts (`validate` preserves error shape, not success retention),
- tagged error reason policy is one canonical lookup (`reason -> policy`) instead of inline handler literals,
- bulk rails (`partition`/`validate*`) express product guarantees, not local optimization.

---
## [3][CONTROL_FLOW_INVARIANTS]
>**Dictum:** *Expression-level routing is mandatory; control structures belong to combinators and tagged rails.*

<br>

Matching taxonomy and pattern inventory live in `matching.md` and `patterns.md`; this section only pins execution-law posture for effect pipelines.

```ts
import { Data, Effect } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class GateError extends Data.TaggedError("GateError")<{
  readonly reason: "quota" | "burst";
  readonly quota:  number;
  readonly burst:  number;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const gateAdmission = (quota: number, burst: number) =>
  Effect.succeed([quota, burst] as const).pipe(
    Effect.filterOrFail(([currentQuota]) => currentQuota > 0, ([currentQuota, currentBurst]) => new GateError({ reason: "quota", quota: currentQuota, burst: currentBurst })),
    Effect.filterOrFail(([currentQuota, currentBurst]) => currentBurst <= currentQuota, ([currentQuota, currentBurst]) => new GateError({ reason: "burst", quota: currentQuota, burst: currentBurst })),
    Effect.map(([currentQuota, currentBurst]) => ({ mode: "admit" as const, quota: currentQuota, burst: currentBurst })),
  );
```

**Laws:**<br>
- route with combinators, not statements,
- keep failures tagged and local to the rail,
- match collapse happens at boundary outputs, never mid-pipeline.

---
## [4][R_CHANNEL_PROVISIONING_AND_CONTEXT_LENSING]
>**Dictum:** *`R` is capability demand; provide late, override deterministically, and narrow context explicitly.*

<br>

- `provide` satisfies graph-level requirements.
- `provideService` and `provideServiceEffect` override capability sources for deterministic runs and tests.
- `mapInputContext` narrows or remaps ambient context without rewriting core logic.
- `Context.Tag`/`Context.GenericTag` model boundary contracts; `Effect.Service` owns module construction/default dependencies.

```ts
import { Context, Data, Effect, Option } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class TenantLifecycleError extends Data.TaggedError("TenantLifecycleError")<{
  readonly operation: "repo.load" | "repo.save" | "audit.publish";
  readonly reason:    "missing" | "write" | "rejected";
  readonly cause?:    unknown;
}> {}

// --- [SERVICES] --------------------------------------------------------------

const TenantRepo = Context.GenericTag<{
  readonly load: (tenantId: string) => Effect.Effect<{ readonly tenantId: string; readonly status: "active" | "suspended" }, TenantLifecycleError>;
  readonly save: (record: { readonly tenantId: string; readonly status: "active" | "suspended" }) => Effect.Effect<{ readonly tenantId: string; readonly status: "active" | "suspended" }, TenantLifecycleError>;
}>("Fx/TenantRepo");
const AuditSink =    Context.GenericTag<{readonly publish: (topic: string, payload: unknown) => Effect.Effect<void, TenantLifecycleError>;}>("Fx/AuditSink");
const AuditTopic =   Context.GenericTag<string>("Fx/AuditTopic");
const RequestTrace = Context.GenericTag<{ readonly traceId: string }>("Fx/RequestTrace");
const AppTrace =     Context.GenericTag<{ readonly correlationId: string }>("Fx/AppTrace");

// --- [FUNCTIONS] -------------------------------------------------------------

const suspendTenant = (tenantId: string) =>
  Effect.gen(function* () {
    const repo = yield* TenantRepo;
    const audit = yield* AuditSink;
    const trace = yield* RequestTrace;
    const maybeTopic = yield* Effect.serviceOption(AuditTopic);
    const loaded = yield* repo.load(tenantId);
    const saved = yield* repo.save({ ...loaded, status: "suspended" });
    yield* Option.match(maybeTopic, {
      onNone: () => Effect.void,
      onSome: (topic) => audit.publish(topic, { tenantId: saved.tenantId, traceId: trace.traceId }),
    });
    return saved;
  });
const tracedRail = suspendTenant("tenant-1").pipe(
  Effect.mapInputContext((ctx) => Context.add(ctx, RequestTrace, { traceId: Context.get(ctx, AppTrace).correlationId })),
);
const runWithOverrides = tracedRail.pipe(
  Effect.provideService(AppTrace, { correlationId: "corr-1" }),
  Effect.provideService(TenantRepo, {
    load: (tenantId) => Effect.succeed({ tenantId, status: "active" as const }),
    save: Effect.succeed,
  }),
  Effect.provideServiceEffect(AuditSink, Effect.succeed({ publish: () => Effect.void })),
);
```

Deep layer and service graph architecture stays owned by `composition.md` and `services.md`; this section keeps only execution-time provisioning law.

---
## [5][SCOPED_POLICY_TIMEOUT_CACHE_AND_HEDGING]
>**Dictum:** *Lifetime, timeout budgets, cache freshness, and cancellation are one policy surface and belong in one rail.*

<br>

**[5.1] Lifetime + timeout + hedging**<br>
Use-scope exit drives the finalizer callback of `acquireRelease`; it does not report finalizer success/failure. Hedge policy is symmetric here: both branches are disconnected so the winner returns immediately and loser cleanup finishes in background.

```ts
import { Clock, Data, Duration, Effect, Exit, Scope } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "closed" | "timeout";
}> {}

// --- [RESOURCES] -------------------------------------------------------------

const makeLease = (id: string) =>
  Effect.acquireRelease(
    Effect.sync(() => ({ id, open: true } as const)),
    (_, useExit) =>
      Exit.match(useExit, {
        onFailure: () => Effect.logWarning(`transport.scope.failure:${id}`),
        onSuccess: () => Effect.logDebug(`transport.scope.success:${id}`),
      }),
  );

// --- [FUNCTIONS] -------------------------------------------------------------

const sendOn = (channel: "primary" | "replica", payload: string) =>
  Effect.succeed(payload).pipe(
    Effect.filterOrFail((body) => body.length > 0, () => new TransportError({ reason: "closed" })),
    Effect.map((body) => [channel, body] as const),
  );
const publishWithBudget = (lease: Effect.Effect<{ readonly id: string; readonly open: boolean }, never, Scope.Scope>, send: Effect.Effect<readonly ["primary" | "replica", string], TransportError>) =>
  Effect.scoped(
    lease.pipe(
      Effect.flatMap((resource) =>
        send.pipe(Effect.map(([channel, payload]) => ({ resourceId: resource.id, channel, payload }) as const)),
      ),
      Effect.timeoutFail({ duration: Duration.seconds(2), onTimeout: () => new TransportError({ reason: "timeout" }) }),
      Effect.flatMap((record) =>
        Clock.currentTimeMillis.pipe(Effect.map((finishedAt) => ({ ...record, finishedAt }) as const)),
      ),
    ),
  );
const hedgedPublish = (payload: string) =>
  Effect.race(
    Effect.disconnect(publishWithBudget(makeLease("transport-1"), sendOn("primary", payload))),
    Effect.disconnect(Effect.sleep("25 millis").pipe(Effect.zipRight(publishWithBudget(makeLease("transport-2"), sendOn("replica", payload))))),
  );
```

**[5.2] Cache setup vs getter/invalidate semantics**<br>
Cache constructors return setup effects. Execute the returned getter to read a value, and execute invalidate explicitly when freshness must be reset.

```ts
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { DateTime, Duration, Effect, Option, Schema as S } from "effect";

// --- [SCHEMAS] ---------------------------------------------------------------

const CachedProfile = S.Struct({
  value:     S.Struct({ profileRevision: S.Number }),
  expiresAt: S.Number,
});

// --- [FUNCTIONS] -------------------------------------------------------------

const cacheRail = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const typed = KeyValueStore.prefix(store, "profile:").forSchema(CachedProfile);
  const [getProfile, invalidateProfile] = yield* Effect.cachedInvalidateWithTTL(
    DateTime.now.pipe(
      Effect.map(DateTime.toEpochMillis),
      Effect.flatMap((now) =>
        typed.get("tenant-1").pipe(
          Effect.flatMap((hit) =>
            Option.match(Option.filter(hit, (entry) => entry.expiresAt > now), {
              onSome: ({ value }) => Effect.succeed(value),
              onNone: () =>
                DateTime.now.pipe(
                  Effect.map((fresh) => ({ value: { profileRevision: DateTime.toEpochMillis(fresh) }, expiresAt: DateTime.toEpochMillis(DateTime.addDuration("5 minutes")(fresh)) })),
                  Effect.tap((entry) => typed.set("tenant-1", entry)),
                  Effect.map((entry) => entry.value),
                ),
            }),
          ),
        ),
      ),
    ),
    Duration.seconds(45),
  );
  const profileFirst = yield* getProfile;
  yield* invalidateProfile;
  const profileSecond = yield* getProfile;
  return { profileFirst, profileSecond } as const;
});
```

**Laws:**<br>
- scoped resources must encode release behavior in-rail,
- timeout and hedge are explicit policy values, never incidental wrappers,
- `cached` yields a getter effect; TTL invalidate variant yields `[getter, invalidate]` and both must be exercised.

---
## [6][EFFECTS_DECISION_MATRIX]
>**Dictum:** *Choose rails by contract, not convenience.*

<br>

| [INDEX] | [API]                            | [CONTRACT]                | [FAILURE]                   | [BOUNDARY]          |
| :-----: | :------------------------------- | :------------------------ | :-------------------------- | :------------------ |
|   [1]   | `Effect.promise`                 | defect-only async ingress | rejection→defect (`die`)    | adapter only        |
|   [2]   | `Effect.tryPromise`              | recoverable async ingress | rejection → typed `E`       | adapter+domain      |
|   [3]   | `Effect.all({ mode })`           | fan-in + loss contract    | fail-fast/either/validate   | aggregation surface |
|   [4]   | `Effect.partition`,`validate*`   | collection retention      | split/all-err/first-succ    | bulk policy         |
|   [5]   | `Effect.cachedFunction`          | keyed memoization         | per-key effectful dedupe    | lookup policy       |
|   [6]   | `Effect.cachedInvalidateWithTTL` | freshness + invalidate    | `[getter, invalidate]` pair | cache ownership     |
|   [7]   | `provide*`,`mapInputContext`     | `R`-channel supply        | deterministic substitution  | execution boundary  |
|   [8]   | `acquireRelease` + timeout       | scoped lifecycle policy   | release typed in-rail       | ownership plane     |
