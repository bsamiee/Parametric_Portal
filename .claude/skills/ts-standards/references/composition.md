# [H1][COMPOSITION]
>**Dictum:** *Composition is typed graph algebra: model edges, eliminate requirements once, and encode visibility as explicit policy.*

<br>

Composition owns graph geometry, not service semantics or runtime policy. This reference is declaration-only and compile-focused: snippets target current `effect@3.19.18` and installed Effect-* APIs, keep branch-free FP+ROP composition, and avoid wrapper indirection. Root assembly is a one-time boundary operation; feature modules export partial layers that remain composable.

---
## [1][COMPOSITION_LAWS]
>**Dictum:** *Graph laws are stronger than conventions because wiring, visibility, and topology transitions remain type-auditable.*

<br>

- Encode dependencies with raw `Layer` combinators; do not hide DAG semantics behind helpers.
- Keep dynamic graph choice in-layer with `unwrapEffect`, `unwrapScoped`, `flatMap`, `match`, `matchCause`.
- Model visibility intentionally with `provide` and `provideMerge`; never rely on accidental exposure.
- Shape boundary outputs with `project`, `passthrough`, `discard`, `effectDiscard`, `scopedDiscard`.
- Use collection-driven mapping (`HashMap`, `HashSet`, `Chunk`) when topology must stay data-driven.
- Treat Effect-* packages as first-class graph nodes; composition wires nodes, sibling references own behavior.

---
## [2][REQUIREMENT_ELIMINATION_AND_VISIBILITY]
>**Dictum:** *`provide` removes satisfied requirements; `provideMerge` preserves selected upstream outputs for downstream consumers.*

<br>

```ts
import { PlatformConfigProvider } from "@effect/platform";
import { ConfigProvider, Context, Effect, Layer } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const Host =     Context.GenericTag<string>("Cmp/Host");
const Port =     Context.GenericTag<number>("Cmp/Port");
const Token =    Context.GenericTag<string>("Cmp/Token");
const Endpoint = Context.GenericTag<string>("Cmp/Endpoint");
const Header =   Context.GenericTag<string>("Cmp/Header");

// --- [LAYERS] ----------------------------------------------------------------

const Network =       Layer.mergeAll(Layer.succeed(Host, "db.internal"), Layer.succeed(Port, 5432));
const Credentials =   Layer.succeed(Token, "token.live");
const EndpointLayer = Layer.effect(Endpoint, Effect.all([Host, Port]).pipe(Effect.map(([host, port]) => `${host}:${port}`)));
const HeaderLayer =   Layer.effect(Header, Effect.all([Endpoint, Token]).pipe(Effect.map(([endpoint, token]) => `${token}@${endpoint}`)));
const ConfigSources = Layer.mergeAll(PlatformConfigProvider.layerDotEnvAdd(".env"), PlatformConfigProvider.layerFileTreeAdd({ rootDirectory: "config" }));
const HeaderWithEndpoint =     Layer.mergeAll(HeaderLayer, EndpointLayer).pipe(Layer.provide(Network), Layer.provide(Credentials));
const HeaderWithConfigInputs = HeaderWithEndpoint.pipe(Layer.provideMerge(ConfigSources), Layer.provideMerge(Layer.setConfigProvider(ConfigProvider.fromEnv())));

// --- [EXPORT] ----------------------------------------------------------------

export { ConfigSources, Credentials, EndpointLayer, HeaderLayer, HeaderWithConfigInputs, HeaderWithEndpoint, Network };
```

---
## [3][BOUNDARY_OUTPUT_SHAPING]
>**Dictum:** *Boundary shape is a contract budget: export only the minimum surface that downstream graphs require.*

<br>

```ts
import { KeyValueStore } from "@effect/platform";
import { Context, Layer, Schema } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const Config =       Context.GenericTag<{ readonly endpoint: string; readonly region: string }>("Cmp/Config");
const Endpoint =     Context.GenericTag<string>("Cmp/OutEndpoint");
const SessionStore = Context.GenericTag<KeyValueStore.KeyValueStore>("Cmp/SessionStore");

// --- [LAYERS] ----------------------------------------------------------------

const ConfigLayer =       Layer.succeed(Config, { endpoint: "https://edge.internal", region: "us-east-1" });
const EndpointOnly =      ConfigLayer.pipe(Layer.project(Config, Endpoint, ({ endpoint }) => endpoint));
const SessionStoreLayer = KeyValueStore.layerMemory.pipe(Layer.project(KeyValueStore.KeyValueStore, SessionStore, (store) => KeyValueStore.prefix(store, "tenant:")));
const SessionSchema =     KeyValueStore.layerSchema(Schema.Struct({ endpoint: Schema.String, region: Schema.String }), "Cmp/SessionSchema");
const TypedSessionStore = SessionSchema.layer.pipe(Layer.provide(KeyValueStore.layerMemory));
const BoundaryGraph =     Layer.mergeAll(EndpointOnly, SessionStoreLayer, TypedSessionStore);

// --- [EXPORT] ----------------------------------------------------------------

export { BoundaryGraph, ConfigLayer, EndpointOnly, SessionStoreLayer, TypedSessionStore };
```

---
## [4][DYNAMIC_TOPOLOGY_SELECTION]
>**Dictum:** *Dynamic edges belong inside `Layer` selection operators; call-sites remain static and branch-free.*

<br>

```ts
import { FetchHttpClient, KeyValueStore } from "@effect/platform";
import { BrowserHttpClient, BrowserKeyValueStore } from "@effect/platform-browser";
import { Context, Effect, Layer, Match } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const RuntimeModeValue = {
  fetch: "fetch",
  xhr: "xhr",
} as const satisfies Record<"fetch" | "xhr", string>;
const ReplicaModeValue = {
  primary: "primary",
  replica: "replica",
} as const satisfies Record<"primary" | "replica", string>;
const TagId = {
  runtimeMode: "Cmp/RuntimeMode",
  replicaMode: "Cmp/ReplicaMode",
  connectionName: "Cmp/ConnectionName",
} as const satisfies Record<"runtimeMode" | "replicaMode" | "connectionName", string>;
const RuntimeMode =    Context.GenericTag<(typeof RuntimeModeValue)[keyof typeof RuntimeModeValue]>(TagId.runtimeMode);
const ReplicaMode =    Context.GenericTag<(typeof ReplicaModeValue)[keyof typeof ReplicaModeValue]>(TagId.replicaMode);
const ConnectionName = Context.GenericTag<string>(TagId.connectionName);

// --- [CONSTANTS] -------------------------------------------------------------

const Connection = {
  primary: "primary-conn",
  replica: "replica-conn",
} as const satisfies Record<"primary" | "replica", string>;
const ReleaseLog = {
  primary: "release.primary",
  replica: "release.replica",
} as const satisfies Record<"primary" | "replica", string>;

// --- [LAYERS] ----------------------------------------------------------------

const DynamicTransport = Layer.unwrapEffect(
  RuntimeMode.pipe(
    Effect.map((mode) =>
      Match.value(mode).pipe(
        Match.when(RuntimeModeValue.fetch, () => FetchHttpClient.layer),
        Match.when(RuntimeModeValue.xhr,   () => BrowserHttpClient.layerXMLHttpRequest),
        Match.exhaustive,
      ),
    ),
  ),
);
const DynamicStore = Layer.unwrapEffect(
  RuntimeMode.pipe(
    Effect.map((mode) =>
      Match.value(mode).pipe(
        Match.when(RuntimeModeValue.fetch, () => KeyValueStore.layerMemory),
        Match.when(RuntimeModeValue.xhr,   () => BrowserKeyValueStore.layerSessionStorage),
        Match.exhaustive,
      ),
    ),
  ),
);
const DynamicConnection = Layer.unwrapScoped(
  ReplicaMode.pipe(
    Effect.map((mode) =>
      Match.value(mode).pipe(
        Match.when(ReplicaModeValue.primary, () =>
          Layer.scoped(
            ConnectionName,
            Effect.acquireRelease(
              Effect.succeed(Connection.primary),
              () => Effect.logDebug(ReleaseLog.primary),
            ),
          ),
        ),
        Match.when(ReplicaModeValue.replica, () =>
          Layer.scoped(
            ConnectionName,
            Effect.acquireRelease(
              Effect.succeed(Connection.replica),
              () => Effect.logDebug(ReleaseLog.replica),
            ),
          ),
        ),
        Match.exhaustive,
      ),
    ),
  ),
);
const DynamicGraph = Layer.mergeAll(DynamicTransport, DynamicStore, DynamicConnection).pipe(
  Layer.provide(Layer.succeed(RuntimeMode, RuntimeModeValue.xhr)),
  Layer.provide(Layer.succeed(ReplicaMode, ReplicaModeValue.replica)),
);

// --- [EXPORT] ----------------------------------------------------------------

export { DynamicConnection, DynamicGraph, DynamicStore, DynamicTransport };
```

---
## [5][ERROR_AWARE_GRAPH_REWRITES]
>**Dictum:** *Use layer-level error algebra (`match`, `matchCause`, `mapError`, `retry`) to keep rewrites explicit and typed.*

<br>

```ts
import { Context, Data, Effect, Layer, Match } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class ProvisioningRail extends Data.TaggedError("ProvisioningRail")<{
  readonly operation: "tenant.guard";
  readonly reason:    "invalid-tenant";
  readonly tenant:    string;
}> {}

// --- [SERVICES] --------------------------------------------------------------

const Tenant = Context.GenericTag<string>("Cmp/Tenant");
const Topic =  Context.GenericTag<string>("Cmp/Topic");

// --- [CONSTANTS] -------------------------------------------------------------

const TenantInput =   Layer.succeed(Tenant, "tenant_01");
const GuardedTenant = Layer.unwrapEffect(Tenant.pipe(Effect.map((tenant) => Match.value(tenant.startsWith("tenant_")).pipe(Match.when(true, () => Layer.succeed(Tenant, tenant)), Match.orElse(() => Layer.fail(new ProvisioningRail({ operation: "tenant.guard", reason: "invalid-tenant", tenant })))))));
const TopicLayer = GuardedTenant.pipe(Layer.flatMap((context) => Layer.succeed(Topic, `${Context.get(context, Tenant)}.events`)));
const TopicWithFallback = TopicLayer.pipe(Layer.match({ onFailure: () => Layer.succeed(Topic, "tenant_default.events"), onSuccess: (context) => Layer.succeed(Topic, Context.get(context, Topic)) }));

// --- [EXPORT] ----------------------------------------------------------------

export { GuardedTenant, TenantInput, TopicLayer, TopicWithFallback };
```

---
## [6][MEMOIZATION_AND_FRESHNESS]
>**Dictum:** *Default sharing is graph-level optimization; `fresh` is explicit re-allocation and `memoize` is explicit stabilization.*

<br>

```ts
import { Context, Effect, Layer } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const Seed = Context.GenericTag<number>("Cmp/Seed");
const A =    Context.GenericTag<number>("Cmp/A");
const B =    Context.GenericTag<number>("Cmp/B");

// --- [LAYERS] ----------------------------------------------------------------

const SeedLive =        Layer.effect(Seed, Effect.succeed(5).pipe(Effect.tap(() => Effect.logDebug("seed.init"))));
const ALive =           Layer.effect(A, Seed.pipe(Effect.map((seed) => seed + 1)));
const BLive =           Layer.effect(B, Seed.pipe(Effect.map((seed) => seed + 2)));
const SharedSeedGraph = Layer.mergeAll(ALive.pipe(Layer.provide(SeedLive)), BLive.pipe(Layer.provide(SeedLive)));
const FreshSeedGraph =  Layer.mergeAll(ALive.pipe(Layer.provide(Layer.fresh(SeedLive))), BLive.pipe(Layer.provide(Layer.fresh(SeedLive))));
const ManualMemoGraph = Effect.scoped(Layer.memoize(SeedLive).pipe(Effect.map((memoized) => Layer.mergeAll(ALive.pipe(Layer.provide(memoized)), BLive.pipe(Layer.provide(memoized)))), Effect.flatMap(Layer.build)));

// --- [EXPORT] ----------------------------------------------------------------

export { ALive, BLive, FreshSeedGraph, ManualMemoGraph, SeedLive, SharedSeedGraph };
```

---
## [7][EFFECT_STAR_CROSS_LIBRARY_COMPOSITION]
>**Dictum:** *Effect-* modules are first-class graph inputs; compose transport, policy, and storage with the same layer algebra.*

<br>

Use this section as the single ownership point for HTTP+KV graph wiring; reuse `HttpClient.withTracerPropagation`, `KeyValueStore.prefix`, and `KeyValueStore.layerSchema` patterns from here rather than re-declaring them elsewhere.

```ts
import { FetchHttpClient, HttpClient, KeyValueStore } from "@effect/platform";
import { BrowserHttpClient, BrowserKeyValueStore } from "@effect/platform-browser";
import { Context, Effect, Layer, Match } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const ClientModeValue = {
  fetch: "fetch",
  xhr: "xhr",
} as const satisfies Record<"fetch" | "xhr", string>;
const TagId = {
  clientMode: "Cmp/ClientMode",
  sessionStore: "Cmp/SessionStore",
} as const satisfies Record<"clientMode" | "sessionStore", string>;
const ClientMode =          Context.GenericTag<(typeof ClientModeValue)[keyof typeof ClientModeValue]>(TagId.clientMode);
const SessionStore =        Context.GenericTag<KeyValueStore.KeyValueStore>(TagId.sessionStore);
const SessionPrefix =       "session:" as const;
const BrowserResponseType = "arraybuffer" as const;

// --- [LAYERS] ----------------------------------------------------------------

const BaseClientLayer = Layer.unwrapEffect(
  ClientMode.pipe(
    Effect.map((mode) =>
      Match.value(mode).pipe(
        Match.when(ClientModeValue.fetch, () => FetchHttpClient.layer),
        Match.when(ClientModeValue.xhr,   () => BrowserHttpClient.layerXMLHttpRequest),
        Match.exhaustive,
      ),
    ),
  ),
);
const TracingPolicyLayer = HttpClient.layerMergedContext(HttpClient.HttpClient.pipe(Effect.map(HttpClient.withTracerPropagation(true)), Effect.map(HttpClient.filterStatusOk)));
const StrictClientLayer = TracingPolicyLayer.pipe(Layer.provide(BaseClientLayer));
const SessionStoreLayer = BrowserKeyValueStore.layerLocalStorage.pipe(Layer.project(KeyValueStore.KeyValueStore, SessionStore, (store) => KeyValueStore.prefix(store, SessionPrefix)));
const BrowserArrayBufferClient = BrowserHttpClient.layerXMLHttpRequest.pipe(Layer.locally(BrowserHttpClient.currentXHRResponseType, BrowserResponseType));
const BrowserInfra = Layer.mergeAll(StrictClientLayer, SessionStoreLayer).pipe(Layer.provide(Layer.succeed(ClientMode, ClientModeValue.xhr)));

// --- [EXPORT] ----------------------------------------------------------------

export { BaseClientLayer, BrowserArrayBufferClient, BrowserInfra, SessionStoreLayer, StrictClientLayer };
```

---
## [8][ROOT_ASSEMBLY_ONCE]
>**Dictum:** *Entrypoints assemble one root graph; modules export partial layers and never rebuild roots locally.*

<br>

Use this assembly boundary to consume specialized layers from sibling references (for example, `surface.md` HTTP layers) instead of re-declaring those concerns in composition.

```ts
import { HttpClient } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const Platform = Context.GenericTag<string>("Cmp/Platform");
const Infra =    Context.GenericTag<string>("Cmp/Infra");
const Domain =   Context.GenericTag<string>("Cmp/Domain");
const Surface =  Context.GenericTag<string>("Cmp/Surface");

// --- [LAYERS] ----------------------------------------------------------------

const PlatformLayer = Layer.succeed(Platform, "platform.ready");
const InfraLayer =    Layer.effect(Infra,   Effect.all([Platform, HttpClient.HttpClient]).pipe(Effect.map(([platform]) => `${platform}.infra.ready`)));
const DomainLayer =   Layer.effect(Domain,  Infra.pipe(Effect.map((infra) =>    `${infra}.domain.ready` )));
const SurfaceLayer =  Layer.effect(Surface, Domain.pipe(Effect.map((domain) =>  `${domain}.surface.ready`)));
const Root = SurfaceLayer.pipe(Layer.provide(DomainLayer), Layer.provide(InfraLayer), Layer.provide(PlatformLayer));

// --- [EXPORT] ----------------------------------------------------------------

export { DomainLayer, InfraLayer, PlatformLayer, Root, SurfaceLayer };
```

---
## [9][LAYER_FUSION_AND_NORMALIZATION]
>**Dictum:** *Fuse parallel nodes with `zipWith` and normalize exports with `map`/`match` so downstream contracts stay minimal.*

<br>

```ts
import { Context, Layer } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const Left =     Context.GenericTag<{ readonly endpoint: string }>("Cmp/FuseLeft");
const Right =    Context.GenericTag<{ readonly region: string }>("Cmp/FuseRight");
const Contract = Context.GenericTag<{ readonly endpoint: string; readonly region: string }>("Cmp/FuseContract");

// --- [LAYERS] ----------------------------------------------------------------

const LeftLayer =     Layer.succeed(Left,  { endpoint: "https://edge.internal" });
const RightLayer =    Layer.succeed(Right, { region: "us-east-1"               });
const Fused =         Layer.zipWith(LeftLayer, RightLayer, Context.merge);
const ContractLayer = Fused.pipe(Layer.map((context) => Context.empty().pipe(Context.add(Contract, { endpoint: Context.get(context, Left).endpoint, region: Context.get(context, Right).region }))));

// --- [EXPORT] ----------------------------------------------------------------

export { ContractLayer, Fused, LeftLayer, RightLayer };
```

---
## [10][NON_NEGOTIABLES]
>**Dictum:** *Top-tier composition is deterministic graph intent: explicit requirements, explicit visibility, explicit topology transitions.*

<br>

[IMPORTANT]:
- [ALWAYS] Keep graph choice and rewrites inside `Layer` combinators.
- [ALWAYS] Model visibility via `provide`, `provideMerge`, and `project`.
- [ALWAYS] Use collection-driven topology (`HashMap`, `HashSet`, `Chunk`) where routing must stay data-driven.
- [ALWAYS] Treat Effect-* layers as first-class graph nodes.
- [ALWAYS] Assemble roots once at entrypoints and keep feature graphs partial.

[CRITICAL]:
- [NEVER] Add wrapper helpers that obscure graph semantics.
- [NEVER] Execute effects at import time in reference snippets.
