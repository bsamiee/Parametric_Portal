# Surface

Surface owns protocol semantics: route graphs, transport channels, security schemes, compatibility classification, and client derivation. Runtime lifecycle and domain translation stay owned by `effects.md`, `composition.md`, and `errors.md`.


## Contract governance

`HttpApi.reflect` traverses group→endpoint→schema topology. A self-deriving vocabulary collapses the type/const/policy triad: ONE `as const` object encodes variant tags AND policy axes — `keyof typeof` extracts the discriminant, the generic intersection `Diff<T>` narrows per-tag, and the factory spreads policy into instances without lookup. `OpenApi.fromApi` projects the same graph into an OpenAPI spec alongside structural findings — one graph, multiple derivations.

```ts
import { HttpApi, OpenApi } from "@effect/platform"
import { Array as A, HashMap, Match, pipe } from "effect"

const _Diff = {
  RemovedEndpoint: { severity: "breaking",  gate: "reject" }, AddedEndpoint: { severity: "additive", gate: "allow" },
  PathMutation:    { severity: "breaking",  gate: "reject" }, SchemaMutation: { severity: "breaking", gate: "review" },
  MethodChanged:   { severity: "breaking",  gate: "reject" },
} as const satisfies Record<string, { severity: "breaking" | "additive"; gate: "reject" | "allow" | "review" }>

type Diff<T extends keyof typeof _Diff = keyof typeof _Diff> = { readonly _tag: T; readonly key: string } & (typeof _Diff)[T]
const Diff = <T extends keyof typeof _Diff>(tag: T, key: string): Diff<T> => ({ _tag: tag, key, ..._Diff[tag] })

const classifyApi = <A extends HttpApi.HttpApi.Any>(baseline: A, candidate: A) => {
  const snap = (api: A) => {
    const acc: Array<readonly [string, { method: string; path: string; ast: string }]> = []
    HttpApi.reflect(api, { onGroup: () => {}, onEndpoint: ({ group, endpoint, successes }) => acc.push([
      `${group.identifier}::${endpoint.name}`, { method: endpoint.method ?? "GET", path: endpoint.path,
        ast: pipe(A.fromIterable(successes), A.map(([s, { ast }]) => JSON.stringify([s, ast])), A.join("|")) }]) })
    return HashMap.fromIterable(acc)
  }
  const [b, c] = [snap(baseline), snap(candidate)]
  return { spec: OpenApi.fromApi(candidate), findings: pipe(
    A.union(A.fromIterable(HashMap.keys(b)), A.fromIterable(HashMap.keys(c))),
    A.flatMap((key) => Match.value([HashMap.get(b, key), HashMap.get(c, key)] as const).pipe(
      Match.when([{ _tag: "Some" }, { _tag: "None" }], () => [Diff("RemovedEndpoint", key)]),
      Match.when([{ _tag: "None" }, { _tag: "Some" }], () => [Diff("AddedEndpoint",   key)]),
      Match.when([{ _tag: "Some" }, { _tag: "Some" }], ([bv, cv]) =>
        bv.value.method !== cv.value.method ? [Diff("MethodChanged",  key)]
        : bv.value.path !== cv.value.path   ? [Diff("PathMutation",   key)]
        : bv.value.ast  !== cv.value.ast    ? [Diff("SchemaMutation", key)] : []),
      Match.orElse(() => [])))) }
}
```

Adding a variant requires ONE entry in `_Diff` — `Diff<T>` and factory derive automatically via `keyof typeof _Diff`. `HashMap.get` returns `Option`, forcing structural narrowing via `Match.when` on the `(Option, Option)` pair. `acc.push` mutation is inherent to `HttpApi.reflect`'s callback API; `endpoint.method` is narrowed via nullish-coalescing since wildcard endpoints omit it.


## Channel error rails

One polymorphic `Fault` class with `reason` discriminant replaces scattered error classes. `_FaultPolicy` maps each reason to `{ status, retryable, log }` — computed getters project policy from structure. `HttpApiSchema.annotations` binds the default status; the getter overrides per-reason.

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform"
import { Effect, Schema } from "effect"

const _FaultPolicy = {
  ServiceUnavailable: { status: 503, retryable: true,  log: Effect.logError   },
  Unauthorized:       { status: 401, retryable: false, log: Effect.logWarning },
  TenantBlocked:      { status: 403, retryable: false, log: Effect.logWarning },
  NotFound:           { status: 404, retryable: false, log: Effect.logInfo    },
} as const satisfies Record<string, { status: number; retryable: boolean; log: (...args: ReadonlyArray<unknown>) => Effect.Effect<void> }>

class Fault extends Schema.TaggedError<Fault>()("Fault", {
  reason: Schema.Literal(...(Object.keys(_FaultPolicy) as [keyof typeof _FaultPolicy, ...(keyof typeof _FaultPolicy)[]])),
  context: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}, HttpApiSchema.annotations({ status: 500 })) {
  get policy()    { return _FaultPolicy[this.reason] }
  get status()    { return this.policy.status       }
  get retryable() { return this.policy.retryable    }
  get log()       { return this.policy.log          }
}

const Api = HttpApi.make("rails").addError(Fault).add(
  HttpApiGroup.make("tenants")
    .add(HttpApiEndpoint.get("byId", "/tenants/:id").setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Schema.Struct({ id: Schema.String, name: Schema.String })))
    .add(HttpApiEndpoint.post("create", "/tenants").setPayload(Schema.Struct({ name: Schema.String }))
      .addSuccess(Schema.Struct({ id: Schema.String }))))
```

Error union is singular: `Fault` propagates to all endpoints via `.addError`. `new Fault({ reason: "NotFound", context: { id } })` yields 404 via the `status` getter; `fault.log("context")` emits at the vocabulary-determined level. Adding a reason requires one vocabulary entry — the `Literal` spread and all getters derive automatically.


## Secure transport boundaries

`HttpApiMiddleware.Tag` declares security schemes with typed credentials. `Auth` reuses `Fault` — verifier failures return `new Fault({ reason: "Unauthorized" })` rather than declaring a parallel error type. `Principal.via` literal derives from `_schemes` keys via `Object.keys` spread — no parallel literal list. `Record.map` projects each scheme key into a principal-returning handler.

```ts
import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform"
import { Context, Effect, Layer, Redacted, Record, Schema } from "effect"

const _schemes = {
  bearer: HttpApiSecurity.bearer,
  apiKey: HttpApiSecurity.apiKey({ key: "x-api-key", in: "header" }),
  cookie: HttpApiSecurity.apiKey({ key: "session",   in: "cookie" }),
} as const
type Via = keyof typeof _schemes

class Principal extends Schema.Class<Principal>("Principal")({ id: Schema.String, via: Schema.Literal(...(Object.keys(_schemes) as [Via, ...Via[]])) }) {
  get isSession() { return this.via === "cookie" }
}

class Auth extends HttpApiMiddleware.Tag<Auth>()("Auth", {
  provides: Principal,
  failure:  Fault,
  security: _schemes,
}) {
  static readonly Verifier = Context.GenericTag<(t: Redacted.Redacted, via: Via) => Effect.Effect<string, Fault>>("Auth/Verifier")
  static readonly Live = Layer.effect(Auth, Effect.map(Auth.Verifier, (verify) =>
    Auth.of(Record.map(_schemes, (_, via) => (t: Redacted.Redacted) => Effect.map(verify(t, via as Via), (id) => new Principal({ id, via: via as Via }))))))
}
```

One `Verifier` tag accepts `(token, via)` and returns `Effect<string, Fault>` — the layer projects it across all scheme keys via `Record.map`. Adding a scheme requires one `_schemes` entry; `Principal.via` literal and `Auth.security` derive automatically. `Principal.isSession` computes session semantics from the `via` discriminant.


## Group completeness proofs

`HttpApiBuilder.group` is a total function — the type signature encodes which `handle`/`handleRaw` calls remain open, and the builder narrows with each handled endpoint until exhaustion is a compile-time proof. `STM.commit` wraps the entire read-update-derive cycle as one linearizable transaction — no interleaving between `TMap.getOrElse`, `TMap.set`, and the `Array.makeBy` derivation.

```ts
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, HttpServerResponse } from "@effect/platform"
import { Array as A, Effect, Number as N, Option, Schema, STM, Stream, TMap } from "effect"

const Api = HttpApi.make("events").add(
  HttpApiGroup.make("events")
    .add(HttpApiEndpoint.get("list", "/events/:tenant")
      .setPath(Schema.Struct({ tenant: Schema.String }))
      .setUrlParams(Schema.Struct({ limit: Schema.NumberFromString, since: Schema.optional(Schema.BigInt) }))
      .addSuccess(Schema.Array(Schema.String)))
    .add(HttpApiEndpoint.get("stream", "/events/:tenant/stream")
      .setPath(Schema.Struct({ tenant: Schema.String }))
      .setUrlParams(Schema.Struct({ cursor: Schema.optional(Schema.BigInt) }))
      .addSuccess(HttpApiSchema.Text({ contentType: "text/event-stream" }))))

const Live = (seq: TMap.TMap<string, bigint>) => HttpApiBuilder.group(Api, "events", (h) => h
  .handle("list", ({ path, urlParams }) => STM.commit(
    TMap.getOrElse(seq, path.tenant, () => 0n).pipe(
      STM.tap((floor) => TMap.set(seq, path.tenant, Option.getOrElse(urlParams.since, () => floor))),
      STM.map((floor) => A.makeBy(N.clamp(urlParams.limit, { minimum: 1, maximum: 500 }), (i) => `${path.tenant}:${floor + BigInt(i)}`)))))
  .handleRaw("stream", ({ path, urlParams }) => Effect.succeed(HttpServerResponse.stream(
    Stream.unfold(Option.getOrElse(urlParams.cursor, () => 0n), (c) => Option.some([`data:${path.tenant}:${c}\n\n`, c + 1n] as const)).pipe(
      Stream.take(100), Stream.encodeText),
    { contentType: "text/event-stream" }))))
```

`TMap.getOrElse → STM.tap(TMap.set) → STM.map` composes as a single atomic pipeline — no interleaving between read and write. `Number.clamp` bounds the limit; `Array.makeBy` generates the sequence; BigInt arithmetic tracks cursors. `Stream.unfold` generates SSE frames lazily from a BigInt seed bounded by `Stream.take`; `handleRaw` escapes the typed success channel for protocol-native media.


## Graph projections

One `HttpApi` graph sources server handlers, HTTP clients, and workflow proxies — `HttpApiClient.makeWith` for full-graph, `.group` and `.endpoint` for narrowed capability scopes. `WorkflowProxy.toHttpApiGroup` derives HTTP groups from workflow definitions. `_Gate` vocabulary + `Gate.$match` drive exhaustive classification.

```ts
import { HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, HttpClient } from "@effect/platform"
import { Array as A, Data, Effect, Layer, pipe, Schema } from "effect"
import { Workflow, WorkflowEngine, WorkflowProxy, WorkflowProxyServer } from "@effect/workflow"

const Ingest = Workflow.make({ name: "Ingest", payload: Schema.Struct({ id: Schema.String }), success: Schema.String, error: Schema.Never, idempotencyKey: ({ id }) => id })
const Api = HttpApi.make("surface")
  .add(HttpApiGroup.make("health")
    .add(HttpApiEndpoint.get("up", "/up").addSuccess(Schema.String))
    .add(HttpApiEndpoint.get("archive", "/archive").addSuccess(HttpApiSchema.Uint8Array({ contentType: "application/octet-stream" }))))
  .add(WorkflowProxy.toHttpApiGroup("ingest", [Ingest] as const))

const Clients = {
  full:    HttpApiClient.makeWith(Api, { baseUrl: "https://api.x", httpClient: HttpClient.Default }),
  health:  HttpApiClient.group(Api,    { group: "health", baseUrl: "https://api.x", httpClient: HttpClient.Default }),
  archive: HttpApiClient.endpoint(Api, { group: "health", endpoint: "archive", baseUrl: "https://api.x", httpClient: HttpClient.Default }),
} as const

const ServerLive = Layer.mergeAll(
  HttpApiBuilder.api(Api),
  HttpApiBuilder.group(Api, "health", (h) => h.handle("up", () => Effect.succeed("ok")).handle("archive", () => Effect.succeed(new Uint8Array([1])))),
  WorkflowProxyServer.layerHttpApi(Api, "ingest", [Ingest] as const))
  .pipe(Layer.provide(Layer.mergeAll(WorkflowEngine.layerMemory, Ingest.toLayer(({ id }) => Effect.succeed(id)))))

const _Gate = {
  SG01: { label: "single-graph",  severity: "reject" }, SG02: { label: "compat-delta",  severity: "reject" },
  SG03: { label: "surface-bound", severity: "reject" },
} as const satisfies Record<string, { label: string; severity: "reject" | "warn" }>

type Gate = Data.TaggedEnum<{ SG01: { parallel: boolean }; SG02: { unclassified: boolean }; SG03: { policyLeak: boolean } }>
const Gate = Data.taggedEnum<Gate>()

const runGate = (gs: ReadonlyArray<Gate>) => pipe(
  A.map(gs, Gate.$match({ SG01: ({ parallel }) => ({ pass: !parallel, ..._Gate.SG01 }), SG02: ({ unclassified }) => ({ pass: !unclassified, ..._Gate.SG02 }), SG03: ({ policyLeak }) => ({ pass: !policyLeak, ..._Gate.SG03 }) })),
  (r) => ({ pass: A.every(r, (x) => x.pass), results: r }),
  Effect.succeed)
```

`Clients` vocabulary scopes capability statically — callers cannot invoke undeclared endpoints or groups. `_Gate` encodes review criteria; `Gate.$match` folds each variant into `{ pass, ...policy }`, spreading vocabulary fields. `A.every` collapses to a boolean gate — CI exits on `!pass`. Adding a gate variant requires one `_Gate` entry and one `$match` arm; the compiler enforces exhaustion at both sites.
