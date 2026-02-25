# [H1][SURFACE]
>**Dictum:** *Surface is the transport contract authority: one `HttpApi` graph, explicit wire rails, typed boundary errors, and least-privilege client derivation from the same source graph.*

Surface owns protocol semantics only: route graph, transport channels, security scheme contracts, OpenAPI metadata, compatibility classification, and client derivation seams.
Runtime lifecycle, retry/timeout policy, host wiring, and domain translation internals stay owned by `effects.md`, `services.md`, `patterns.md`, and `errors.md`.

---
## [1][CONTRACT_GOVERNANCE]
>**Dictum:** *Govern one monotonic graph and derive reflection, docs, and compatibility from the same value graph.*

Invariants:
- `prefix()` is semantic: route-order mutations are part of contract identity.
- OpenAPI is derived, never hand-authored in parallel.
- Compatibility classification here compares path + payload/success/error AST dimensions.

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Chunk, Match, Option, Schema } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const OpenApiOptions = { additionalPropertiesStrategy: "strict" } as const;
const CursorSchema = Schema.Struct({ value: Schema.String }).annotations({ identifier: "Cursor" });

// --- [SCHEMA] ----------------------------------------------------------------

const PublicAssets = HttpApiGroup.make("assets")
  .add(HttpApiEndpoint.get("list", "/assets").addSuccess(Schema.Array(Schema.String)))
  .add(
    HttpApiEndpoint.get("byId", "/assets/:id")
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Schema.Struct({ id: Schema.String, name: Schema.String }))
  );
const InternalGroup = HttpApiGroup.make("internal")
  .add(HttpApiEndpoint.get("health", "/_internal/health").addSuccess(Schema.String).annotate(OpenApi.Exclude, true));
const BaselineApi = HttpApi.make("surface")
  .add(PublicAssets)
  .add(InternalGroup)
  .prefix("/v1")
  .annotate(OpenApi.Title, "Surface API")
  .annotate(OpenApi.Version, "2.0.0")
  .annotate(HttpApi.AdditionalSchemas, [CursorSchema]);
const CandidateApi = HttpApi.make("surface")
  .add(PublicAssets)
  .add(InternalGroup)
  .prefix("/v2")
  .annotate(OpenApi.Title, "Surface API")
  .annotate(OpenApi.Version, "2.1.0")
  .annotate(HttpApi.AdditionalSchemas, [CursorSchema]);

// --- [FUNCTIONS] -------------------------------------------------------------

const toSnapshot = (api: Parameters<typeof HttpApi.reflect>[0]) => {
  const rows: Array<{
    readonly key: string;
    readonly path: string;
    readonly payloadAst: string;
    readonly successAst: string;
    readonly errorAst: string;
    readonly errorStatuses: ReadonlyArray<number>;
  }> = [];
  HttpApi.reflect(api, {
    predicate: ({ group }) => group.identifier !== "internal",
    onGroup: () => void 0,
    onEndpoint: ({ group, endpoint, payloads, successes, errors }) =>
      void rows.push({
        key: `${group.identifier}:${endpoint.name}:${endpoint.method}`,
        path: endpoint.path,
        payloadAst: Array.from(payloads.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([encoding, schema]) => JSON.stringify([encoding, schema.ast])).join("|"),
        successAst: Array.from(successes.entries()).sort(([a], [b]) => a - b).map(([status, schema]) => JSON.stringify([status, Option.match(schema.ast, { onNone: () => "none", onSome: (ast) => JSON.stringify(ast) })])).join("|"),
        errorAst: Array.from(errors.entries()).sort(([a], [b]) => a - b).map(([status, schema]) => JSON.stringify([status, Option.match(schema.ast, { onNone: () => "none", onSome: (ast) => JSON.stringify(ast) })])).join("|"),
        errorStatuses: Array.from(errors.keys()).sort((a, b) => a - b)
      })
  });
  return rows;
};
type CompatibilityFinding =
  | { readonly _tag: "RemovedEndpoint"; readonly severity: "breaking"; readonly key: string }
  | { readonly _tag: "AddedEndpoint"; readonly severity: "additive"; readonly key: string }
  | { readonly _tag: "ChangedPath"; readonly severity: "breaking"; readonly key: string; readonly from: string; readonly to: string }
  | { readonly _tag: "ChangedSchema"; readonly severity: "breaking"; readonly key: string }
  | { readonly _tag: "AddedErrorStatus"; readonly severity: "potentially-breaking"; readonly key: string; readonly status: number };
const classifyCompatibility = (baseline: ReturnType<typeof toSnapshot>, candidate: ReturnType<typeof toSnapshot>): ReadonlyArray<CompatibilityFinding> => {
  const baselineByKey = new Map(baseline.map((row) => [row.key, row] as const));
  const candidateByKey = new Map(candidate.map((row) => [row.key, row] as const));
  const shared = Array.from(baselineByKey.keys()).filter((key) => candidateByKey.has(key));
  const variants = Chunk.fromIterable([
    ...Array.from(baselineByKey.keys()).filter((key) => !candidateByKey.has(key)).map((key) => ({ _tag: "RemovedEndpoint" as const, key })),
    ...Array.from(candidateByKey.keys()).filter((key) => !baselineByKey.has(key)).map((key) => ({ _tag: "AddedEndpoint" as const, key })),
    ...shared.flatMap((key) => {
      const before = baselineByKey.get(key);
      const after = candidateByKey.get(key);
      return before === undefined || after === undefined || before.path === after.path ? [] : [{ _tag: "ChangedPath" as const, key, from: before.path, to: after.path }];
    }),
    ...shared.flatMap((key) => {
      const before = baselineByKey.get(key);
      const after = candidateByKey.get(key);
      return before === undefined || after === undefined || (before.payloadAst === after.payloadAst && before.successAst === after.successAst && before.errorAst === after.errorAst) ? [] : [{ _tag: "ChangedSchema" as const, key }];
    }),
    ...shared.flatMap((key) => {
      const before = baselineByKey.get(key);
      const after = candidateByKey.get(key);
      return before === undefined || after === undefined ? [] : after.errorStatuses.filter((status) => !before.errorStatuses.includes(status)).map((status) => ({ _tag: "AddedErrorStatus" as const, key, status }));
    })
  ]);
  return Chunk.toReadonlyArray(variants).map((variant) =>
    Match.value(variant).pipe(
      Match.when({ _tag: "RemovedEndpoint" },  ({ key }) => ({ _tag: "RemovedEndpoint", severity: "breaking", key } as const)),
      Match.when({ _tag: "AddedEndpoint" },    ({ key }) => ({ _tag: "AddedEndpoint", severity: "additive", key } as const)),
      Match.when({ _tag: "ChangedPath" },      ({ key, from, to }) => ({ _tag: "ChangedPath", severity: "breaking", key, from, to } as const)),
      Match.when({ _tag: "ChangedSchema" },    ({ key }) => ({ _tag: "ChangedSchema", severity: "breaking", key } as const)),
      Match.when({ _tag: "AddedErrorStatus" }, ({ key, status }) => ({ _tag: "AddedErrorStatus", severity: "potentially-breaking", key, status } as const)),
      Match.exhaustive
    )
  );
};
const GovernanceFindings = classifyCompatibility(toSnapshot(BaselineApi), toSnapshot(CandidateApi));
const renderCompatibilityFinding = (finding: CompatibilityFinding) =>
  Match.value(finding).pipe(
    Match.when({ _tag: "RemovedEndpoint" },  ({ key, severity }) => `${severity}:endpoint removed:${key}`),
    Match.when({ _tag: "AddedEndpoint" },    ({ key, severity }) => `${severity}:endpoint added:${key}`),
    Match.when({ _tag: "ChangedPath" },      ({ key, from, to, severity }) => `${severity}:path changed:${key}:${from}->${to}`),
    Match.when({ _tag: "ChangedSchema" },    ({ key, severity }) => `${severity}:schema changed:${key}`),
    Match.when({ _tag: "AddedErrorStatus" }, ({ key, severity, status }) => `${severity}:error status added:${key}:${status}`),
    Match.exhaustive,
  );
const GovernanceFindingLines = GovernanceFindings.map(renderCompatibilityFinding);
const OpenApiSpec = OpenApi.fromApi(BaselineApi, OpenApiOptions);
```

---
## [2][CHANNEL_ERROR_RAILS]
>**Dictum:** *Channels and error rails are orthogonal contracts: each channel is explicit, each error scope is algebraic.*

Invariants:
- Path/query/header/payload rails remain independently typed.
- Error scope is layered: API-wide, group-local, endpoint-terminal.
- Status-only contracts use `EmptyError` or `asEmpty`, never opaque literals.

```ts
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class ApiUnavailable extends Schema.TaggedError<ApiUnavailable>()("ApiUnavailable",
    { message: Schema.String }, HttpApiSchema.annotations({ status: 503 })
) {}
class TenantBlocked extends Schema.TaggedError<TenantBlocked>()("TenantBlocked",
    { tenantId: Schema.String }, HttpApiSchema.annotations({ status: 403 })
) {}
class AssetMissing extends Schema.TaggedError<AssetMissing>()("AssetMissing",
    { id: Schema.String }, HttpApiSchema.annotations({ status: 404 })
) {}
class QueueConflict extends HttpApiSchema.EmptyError<QueueConflict>()(
    { tag: "QueueConflict", status: 409 }
) {}

// --- [SCHEMA] ----------------------------------------------------------------

const SearchAssets = HttpApiEndpoint.post("search")`/tenants/${HttpApiSchema.param("tenantId", Schema.UUID)}/assets/search`
  .setUrlParams(Schema.Struct({
    limit: HttpApiSchema.param("limit", Schema.NumberFromString),
    cursor: Schema.optional(HttpApiSchema.param("cursor", Schema.String)),
    sinceSequence: Schema.optional(HttpApiSchema.param("sinceSequence", Schema.BigInt))
  }))
  .setHeaders(Schema.Struct({
    "x-trace-id": Schema.String,
    "if-modified-since": Schema.optional(Schema.String)
  }))
  .setPayload(Schema.Struct({ tags: Schema.Array(Schema.String), includeArchived: Schema.Boolean }))
  .addSuccess(Schema.Struct({ asOf: Schema.DateTimeUtc, total: Schema.Number, ids: Schema.Array(Schema.String) }));
const TextIngress = HttpApiEndpoint.post("textIn", "/ingress/text").setPayload(HttpApiSchema.Text()).addSuccess(HttpApiSchema.NoContent);
const UrlEncodedIngress = HttpApiEndpoint.post("urlEncodedIn", "/ingress/form")
  .setPayload(Schema.Struct({ q: Schema.String, limit: Schema.optional(Schema.String) }).pipe(HttpApiSchema.withEncoding({ kind: "UrlParams" })))
  .addSuccess(HttpApiSchema.NoContent);
const BinaryIngress = HttpApiEndpoint.post("binaryIn", "/ingress/binary")
  .setPayload(HttpApiSchema.Uint8Array({ contentType: "application/octet-stream" }))
  .addSuccess(HttpApiSchema.NoContent);
const Enqueue = HttpApiEndpoint.post("enqueue", "/assets/enqueue")
  .setPayload(Schema.Struct({ name: Schema.String }))
  .addSuccess(Schema.Struct({ accepted: Schema.Boolean }).pipe(HttpApiSchema.asEmpty({ status: 202, decode: () => ({ accepted: true }) })))
  .addError(QueueConflict)
  .addError(HttpApiError.NotFound);

// --- [GROUPS] ----------------------------------------------------------------

const SurfaceWithRails = HttpApi.make("surface-rails")
  .addError(ApiUnavailable)
  .add(
    HttpApiGroup.make("assets")
      .addError(TenantBlocked)
      .add(SearchAssets)
      .add(TextIngress)
      .add(UrlEncodedIngress)
      .add(BinaryIngress)
      .add(HttpApiEndpoint.get("byId", "/assets/:id").setPath(Schema.Struct({ id: Schema.String })).addSuccess(Schema.Struct({ id: Schema.String, name: Schema.String })).addError(AssetMissing))
      .add(Enqueue)
  );
```

---
## [3][SECURE_TRANSPORT_BOUNDARIES]
>**Dictum:** *Security schemes and transport modalities are first-class protocol contracts, not post-hoc middleware tricks.*

Invariants:
- Auth schemes declare typed principals at contract level.
- Session rotation is typed transport state, never stringly-typed side-channel state.
- Multipart and SSE contracts remain explicit media semantics.

```ts
import {
  HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware,
  HttpApiSchema, HttpApiSecurity, HttpServerResponse, Multipart
} from "@effect/platform";
import { Chunk, Context, Duration, Effect, Layer, Match, Option, Redacted, Schedule, Schema, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const Principal =     Context.GenericTag<{ readonly id: string; readonly via: "bearer" | "apiKey" | "cookie" }>("Principal");
const VerifyBearer =  Context.GenericTag<(token: Redacted.Redacted) => Effect.Effect<string, Unauthorized>>("VerifyBearer");
const VerifyApiKey =  Context.GenericTag<(token: Redacted.Redacted) => Effect.Effect<string, Unauthorized>>("VerifyApiKey");
const VerifySession = Context.GenericTag<(token: Redacted.Redacted) => Effect.Effect<string, Unauthorized>>("VerifySession");
const RotateSession = Context.GenericTag<(token: Redacted.Redacted) => Effect.Effect<Redacted.Redacted, Unauthorized>>("RotateSession");
const SessionCookie = HttpApiSecurity.apiKey({ key: "session", in: "cookie" });

// --- [ERRORS] ----------------------------------------------------------------

class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", { message: Schema.String }, HttpApiSchema.annotations({ status: 401 })) {}

// --- [MIDDLEWARE] ------------------------------------------------------------

class Auth extends HttpApiMiddleware.Tag<Auth>()("Auth", {
  provides: Principal,
  failure: Unauthorized,
  security: {
    bearer: HttpApiSecurity.bearer,
    apiKey: HttpApiSecurity.apiKey({ key: "x-api-key", in: "header" }),
    cookie: SessionCookie
  }
}) {}
const AuthLive = Layer.effect(Auth, Effect.gen(function* () {
  const verifyBearer = yield* VerifyBearer;
  const verifyApiKey = yield* VerifyApiKey;
  const verifySession = yield* VerifySession;
  return Auth.of({
    bearer: (token) => Effect.map(verifyBearer(token), (id) => ({ id, via: "bearer" as const })),
    apiKey: (token) => Effect.map(verifyApiKey(token), (id) => ({ id, via: "apiKey" as const })),
    cookie: (token) => Effect.map(verifySession(token), (id) => ({ id, via: "cookie" as const }))
  });
}));
class SessionOnly extends HttpApiMiddleware.Tag<SessionOnly>()("SessionOnly", {
  provides: Principal,
  failure: Unauthorized,
  security: { cookie: SessionCookie }
}) {}

// --- [SCHEMA] ----------------------------------------------------------------

const Upload = HttpApiEndpoint.post("upload", "/upload")
  .setPayload(HttpApiSchema.Multipart(Schema.Struct({ file: Multipart.SingleFileSchema, folder: Schema.optional(Schema.String) }), {
    maxParts:       Option.some(4),
    maxFieldSize:   16_384,
    maxFileSize:    Option.some(32_000_000),
    maxTotalSize:   Option.some(64_000_000),
    fieldMimeTypes: ["application/octet-stream", "text/plain"]
  }))
  .addSuccess(Schema.Struct({ path: Schema.String, name: Schema.String }));
const UploadStream = HttpApiEndpoint.post("uploadStream", "/upload-stream")
  .setPayload(HttpApiSchema.MultipartStream(Schema.Struct({ file: Multipart.SingleFileSchema }), {
    maxParts:      Option.some(2),
    maxFieldSize:  16_384,
    maxFileSize:   Option.some(32_000_000),
    maxTotalSize:  Option.some(64_000_000),
    fieldMimeTypes: ["application/octet-stream"]
  }))
  .addSuccess(Schema.String);
const EventStream = HttpApiEndpoint.get("events", "/events")
  .setUrlParams(Schema.Struct({ since: Schema.optional(Schema.String) }))
  .addSuccess(HttpApiSchema.Text({ contentType: "text/event-stream" }));
const SessionApi = HttpApi.make("secure-transport").add(
  HttpApiGroup.make("session")
    .add(HttpApiEndpoint.get("me", "/me").middleware(Auth).addSuccess(Schema.Struct({ id: Schema.String, via: Schema.Literal("bearer", "apiKey", "cookie") })))
    .add(HttpApiEndpoint.post("refresh", "/refresh").middleware(SessionOnly).addSuccess(HttpApiSchema.NoContent))
    .add(Upload)
    .add(UploadStream)
    .add(EventStream)
);

// --- [LAYERS] ----------------------------------------------------------------

const SecureTransportLive = HttpApiBuilder.group(SessionApi, "session", (handlers) =>
  handlers
    .handle("me", () => Principal)
    .handle("refresh", () => Effect.gen(function* () {
      const rotate = yield* RotateSession;
      return yield* HttpApiBuilder.securityDecode(SessionCookie).pipe(
        Effect.flatMap(rotate),
        Effect.tap((nextToken) => HttpApiBuilder.securitySetCookie(SessionCookie, nextToken, { secure: true, httpOnly: true, sameSite: "strict", path: "/" })),
        Effect.as(void 0)
      );
    }))
    .handle("upload", ({ payload }) => {
      const fallbackFileName = "upload.bin";
      const fallbackFolder = "default";
      const safeName = Match.value(payload.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")).pipe(
        Match.when((name) => name === "." || name === ".." || name.startsWith("."), () => fallbackFileName),
        Match.orElse((name) => name)
      );
      const safeFolder = Match.value(payload.folder).pipe(
        Match.when(undefined, () => fallbackFolder),
        Match.when((folder) => /^[a-zA-Z0-9/_-]{1,64}$/.test(folder), (folder) => folder),
        Match.orElse(() => fallbackFolder)
      );
      return Effect.succeed({ path: `/uploads/${safeFolder}/${safeName}`, name: safeName });
    })
    .handle("uploadStream", () => Effect.succeed("accepted"))
    .handleRaw("events", ({ urlParams }) => Effect.succeed(
      HttpServerResponse.stream(
        Stream.merge(
          Stream.fromChunk(Chunk.make(`event:seed\ndata:${urlParams.since ?? "origin"}\n\n`, "event:ready\ndata:ok\n\n")),
          Stream.repeatValue(":hb\n\n").pipe(Stream.schedule(Schedule.spaced(Duration.seconds(15)).pipe(Schedule.jittered))),
          { haltStrategy: "right" }
        ).pipe(Stream.encodeText),
        { contentType: "text/event-stream" }
      )
    ))
);
```

---
## [4][GROUP_COMPLETENESS_PROOFS]
>**Dictum:** *`group` handlers certify endpoint completeness; `handle` and `handleRaw` prove typed and raw response seams explicitly.*

Invariants:
- Every endpoint declared by the group is implemented or compile-time rejected.
- Typed handler inputs are decoded channels, not parsed ad hoc values.
- Raw transport responses are used only for explicit protocol semantics.

```ts
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, HttpServerResponse } from "@effect/platform";
import { Chunk, Context, Effect, Match, Option, Schema, STM, Stream, TMap } from "effect";

// --- [SERVICES] --------------------------------------------------------------

const SequenceTable = Context.GenericTag<TMap.TMap<string, bigint>>("SequenceTable");
const EventsApi = HttpApi.make("events-proof").add(
  HttpApiGroup.make("events")
    .add(
      HttpApiEndpoint.get("list", "/events/:tenantId")
        .setPath(Schema.Struct({ tenantId: Schema.String }))
        .setUrlParams(Schema.Struct({
          limit: Schema.NumberFromString,
          sinceSequence: Schema.optional(HttpApiSchema.param("sinceSequence", Schema.BigInt))
        }))
        .addSuccess(Schema.Array(Schema.String))
    )
    .add(
      HttpApiEndpoint.get("stream", "/events/stream")
        .setUrlParams(Schema.Struct({ since: Schema.optional(Schema.String) }))
        .addSuccess(HttpApiSchema.Text({ contentType: "text/event-stream" }))
    )
);

// --- [LAYERS] ----------------------------------------------------------------

const EventsGroupLive = HttpApiBuilder.group(EventsApi, "events", (handlers) =>
  handlers
    .handle("list", ({ path, urlParams }) => Effect.gen(function* () {
      const table = yield* SequenceTable;
      const boundedLimit = Math.min(Math.max(urlParams.limit, 1), 500);
      const floor = Option.fromNullable(urlParams.sinceSequence).pipe(Option.getOrElse(() => 0n));
      yield* STM.commit(TMap.updateWith(table, path.tenantId, (current) => Option.some(
        Option.match(current, { onNone: () => floor, onSome: (value) => value < floor ? floor : value })
      )));
      const ids = Chunk.fromIterable(Array.from({ length: boundedLimit }, (_, i) => `${path.tenantId}-${floor + globalThis.BigInt(i)}`));
      return Chunk.toReadonlyArray(ids);
    }))
    .handleRaw("stream", ({ urlParams }) => Effect.succeed(
      HttpServerResponse.stream(
        Stream.make(
          Match.value(urlParams.since).pipe(
            Match.when(undefined, () => "data:origin\n\n"),
            Match.orElse((cursor) => `data:${cursor}\n\n`)
          )
        ).pipe(Stream.encodeText),
        { contentType: "text/event-stream" }
      )
    ))
);
```

---
## [5][PROJECTIONS_AND_CLIENTS]
>**Dictum:** *Project the same source graph into server, workflow HTTP/RPC, and least-privilege callers without parallel contract definitions.*

Invariants:
- Contract layer and handler layer are assembled together, host lifecycle is external.
- Workflow projection reuses workflow declarations for both HTTP and RPC surfaces.
- Client derivation is capability-scoped (`makeWith`, `group`, `endpoint`) from one graph.

```ts
import { HttpApi, HttpApiBuilder, HttpApiClient, HttpApiEndpoint, HttpApiGroup, HttpApiScalar, HttpApiSchema, HttpApiSwagger, HttpClient, HttpClientRequest } from "@effect/platform";
import { BrowserHttpClient } from "@effect/platform-browser";
import { RpcServer } from "@effect/rpc";
import { DateTime, Effect, Layer, Schema } from "effect";
import { Workflow, WorkflowEngine, WorkflowProxy, WorkflowProxyServer } from "@effect/workflow";

// --- [CONSTANTS] -------------------------------------------------------------

declare const InjectedHttpClient: HttpClient.HttpClient;
const TimedHttpClient = HttpClient.transformResponse(
  InjectedHttpClient,
  Effect.timeout("5 seconds")
);

// --- [SCHEMA] ----------------------------------------------------------------

const CoreApi = HttpApi.make("surface-projections").add(
  HttpApiGroup.make("health")
    .add(HttpApiEndpoint.get("up", "/up").addSuccess(Schema.String))
    .add(HttpApiEndpoint.get("exportArchive", "/archive").addSuccess(HttpApiSchema.Uint8Array({ contentType: "application/octet-stream" })))
);
const EmailRejected = Schema.Struct({ _tag: Schema.Literal("EmailRejected"), reason: Schema.String });
const EmailWorkflow = Workflow.make({
  name: "EmailWorkflow",
  payload: { id: Schema.String, to: Schema.String },
  success: Schema.Struct({ queuedAt: Schema.DateTimeUtc }),
  error: EmailRejected,
  idempotencyKey: ({ id }) => id
});
const WorkflowApi = HttpApi.make("surface-workflows")
  .addHttpApi(CoreApi)
  .add(WorkflowProxy.toHttpApiGroup("workflows", [EmailWorkflow] as const));
const FullClientFx = HttpApiClient.makeWith(WorkflowApi, {
  baseUrl:    "https://api.example.com",
  httpClient: TimedHttpClient
});
const HealthClientFx = HttpApiClient.group(WorkflowApi, {
  group:      "health",
  baseUrl:    "https://api.example.com",
  httpClient: TimedHttpClient
});
const ArchiveCallFx = HttpApiClient.endpoint(WorkflowApi, {
  group:           "health",
  endpoint:        "exportArchive",
  baseUrl:         "https://api.example.com",
  httpClient:      TimedHttpClient,
  transformClient: HttpClient.mapRequest(HttpClientRequest.setHeader("accept", "application/octet-stream"))
});
const HealthProgram = Effect.gen(function* () {
  const healthClient = yield* HealthClientFx;
  const up = yield* healthClient.up();
  return { up };
});
declare const BinaryExportCall: Effect.Effect<Uint8Array, never, never>;
const BrowserBinaryExportFx = BrowserHttpClient.withXHRArrayBuffer(BinaryExportCall);

// --- [CLASSES] ---------------------------------------------------------------

class WorkflowRpcs extends WorkflowProxy.toRpcGroup([EmailWorkflow] as const) {}

// --- [LAYERS] ----------------------------------------------------------------

const CoreLive = Layer.mergeAll(
  HttpApiBuilder.api(WorkflowApi),
  HttpApiBuilder.group(WorkflowApi, "health", (handlers) =>
    handlers
      .handle("up", () => Effect.succeed("up"))
      .handle("exportArchive", () => Effect.succeed(new Uint8Array([1, 2, 3])))
  ),
  HttpApiBuilder.middlewareOpenApi({ path: "/_internal/openapi.json", additionalPropertiesStrategy: "strict" }),
  HttpApiSwagger.layer({ path: "/_internal/docs" }),
  HttpApiScalar.layer({ path: "/_internal/reference" })
);
const WorkflowRuntime = Layer.mergeAll(
  WorkflowEngine.layerMemory,
  EmailWorkflow.toLayer((_payload, _executionId) => DateTime.now.pipe(Effect.map((queuedAt) => ({ queuedAt }))))
);
const WorkflowHttpLive = CoreLive.pipe(
  Layer.provide(WorkflowProxyServer.layerHttpApi(WorkflowApi, "workflows", [EmailWorkflow] as const)),
  Layer.provide(WorkflowRuntime)
);
const WorkflowRpcLive = RpcServer.layer(WorkflowRpcs).pipe(
  Layer.provide(WorkflowProxyServer.layerRpcHandlers([EmailWorkflow] as const)),
  Layer.provide(WorkflowRuntime)
);
```

---
## [6][REVIEW_GATE]
>**Dictum:** *Surface edits merge only when governance, capability retention, and ownership boundaries all pass.*

Gate matrix (fail on any violation):
- `SG-01` -- Detector: `rg "HttpApi.make\\("` in changed snippet scope. Reject when parallel source graphs define one concern.
- `SG-02` -- Detector: compatibility classifier/snapshot delta. Reject when public delta is unclassified.
- `SG-03` -- Detector: `rg "Schedule|timeout|retry"` in surface-only snippets. Reject when runtime policy leaks into surface ownership.
