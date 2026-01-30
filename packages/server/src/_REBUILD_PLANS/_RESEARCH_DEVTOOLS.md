# [H1][RESEARCH] @effect/experimental DevTools API
>**Status:** Research | **Module:** `@effect/experimental` | **Version:** 1.0.0+

---
## [1][OVERVIEW]
>**Dictum:** *DevTools provides development-time inspection via socket-based telemetry.*

DevTools enables real-time span, metric, and event transmission to external inspection tools. The architecture separates concerns across three modules: **Client** (span submission), **Domain** (protocol schemas), **Server** (telemetry receiver).

| [INDEX] | [MODULE]       | [RESPONSIBILITY]                           |
| :-----: | -------------- | ------------------------------------------ |
|   [1]   | DevTools       | Layer factory with transport selection     |
|   [2]   | DevTools/Client| Client service + tracer integration        |
|   [3]   | DevTools/Domain| Protocol schemas (Span, Metric, Request)   |
|   [4]   | DevTools/Server| Server for receiving telemetry             |

---
## [2][DEVTOOLS_LAYER]
>**Dictum:** *Layer factory selects transport mechanism.*

```typescript
// --- [LAYER_SIGNATURES] ------------------------------------------------------
import { DevTools } from '@effect/experimental';

// Primary: Auto-selects transport, connects to default/custom URL
DevTools.layer(url?: string): Layer.Layer<never>

// Socket: Requires Socket dependency injection
DevTools.layerSocket: Layer.Layer<never, never, Socket.Socket>

// WebSocket: Browser-compatible transport
DevTools.layerWebSocket(url?: string): Layer.Layer<never, never, Socket.WebSocketConstructor>
```

| [INDEX] | [LAYER]          | [TRANSPORT] | [DEPENDENCIES]                | [USE_CASE]               |
| :-----: | ---------------- | ----------- | ----------------------------- | ------------------------ |
|   [1]   | `layer`          | Auto        | None                          | Default integration      |
|   [2]   | `layerSocket`    | Unix/TCP    | `Socket.Socket`               | Node.js server-side      |
|   [3]   | `layerWebSocket` | WebSocket   | `Socket.WebSocketConstructor` | Browser environments     |

---
## [3][CLIENT_MODULE]
>**Dictum:** *Client submits spans and events to DevTools server.*

### [3.1][SERVICE_TAG]
```typescript
// --- [CLIENT_SERVICE] --------------------------------------------------------
import { DevTools } from '@effect/experimental';
import type { Socket } from '@effect/platform';

// Service tag for dependency injection
interface Client extends Effect.Tag<Client, ClientImpl> {}

interface ClientImpl {
  // Submit span or span event for tracing
  readonly unsafeAddSpan: (span: Domain.Span | Domain.SpanEvent) => void;
}
```

### [3.2][CONSTRUCTION]
```typescript
// --- [CLIENT_CONSTRUCTION] ---------------------------------------------------
// Create client instance (requires Scope + Socket)
DevTools.Client.make: Effect.Effect<ClientImpl, never, Scope | Socket.Socket>

// Create Effect Tracer from existing Client
DevTools.Client.makeTracer: (client: Client) => Tracer.Tracer
```

### [3.3][CLIENT_LAYERS]
```typescript
// --- [CLIENT_LAYERS] ---------------------------------------------------------
// Provide Client service (requires Socket)
DevTools.Client.layer: Layer.Layer<Client, never, Socket.Socket>

// Combined: Client + Tracer in single layer
DevTools.Client.layerTracer: Layer.Layer<Tracer.Tracer, never, Socket.Socket>
```

---
## [4][DOMAIN_MODULE]
>**Dictum:** *Domain defines protocol schemas for DevTools communication.*

### [4.1][SPAN_TYPES]
```typescript
// --- [SPAN_SCHEMA] -----------------------------------------------------------
interface Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parent: Option<Span | ExternalSpan>;
  readonly attributes: ReadonlyMap<string, unknown>;
  readonly status: SpanStatus;  // 'Started' | 'Ended'
  readonly startTime: bigint;   // Nanoseconds
  readonly endTime?: bigint;    // Nanoseconds (when ended)
  readonly sampled: boolean;
}

interface ExternalSpan {
  readonly spanId: string;
  readonly traceId: string;
  readonly sampled: boolean;
}

interface SpanEvent {
  readonly spanId: string;
  readonly traceId: string;
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly startTime: bigint;   // Nanoseconds
}
```

### [4.2][METRIC_TYPES]
```typescript
// --- [METRIC_SCHEMA] ---------------------------------------------------------
// Base structure: name, description?, tags
interface MetricBase {
  readonly name: string;
  readonly description?: string;
  readonly tags: ReadonlyArray<readonly [string, string]>;
}

// Counter: Cumulative count
interface Counter extends MetricBase {
  readonly _tag: 'Counter';
  readonly count: number | bigint;
}

// Gauge: Instantaneous value
interface Gauge extends MetricBase {
  readonly _tag: 'Gauge';
  readonly value: number | bigint;
}

// Histogram: Distribution with buckets
interface Histogram extends MetricBase {
  readonly _tag: 'Histogram';
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly sum: number;
  readonly buckets: ReadonlyArray<readonly [number, number]>;
}

// Frequency: Category occurrence counts
interface Frequency extends MetricBase {
  readonly _tag: 'Frequency';
  readonly occurrences: ReadonlyMap<string, number>;
}

// Summary: Statistical summary with quantiles
interface Summary extends MetricBase {
  readonly _tag: 'Summary';
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly sum: number;
  readonly error: number;
  readonly quantiles: ReadonlyArray<readonly [number, Option<number>]>;
}

type Metric = Counter | Gauge | Histogram | Frequency | Summary;
```

### [4.3][PROTOCOL_MESSAGES]
```typescript
// --- [REQUEST_RESPONSE] ------------------------------------------------------
// Client -> Server requests
type Request =
  | { readonly _tag: 'Ping' }
  | { readonly _tag: 'Span'; readonly span: Span }
  | { readonly _tag: 'SpanEvent'; readonly event: SpanEvent }
  | { readonly _tag: 'MetricsSnapshot'; readonly metrics: ReadonlyArray<Metric> };

// Server -> Client responses
type Response =
  | { readonly _tag: 'Pong' }
  | { readonly _tag: 'MetricsRequest' };

// Filtered variants (exclude keepalive)
type Request.WithoutPing = Exclude<Request, { readonly _tag: 'Ping' }>;
type Response.WithoutPong = Exclude<Response, { readonly _tag: 'Pong' }>;
```

---
## [5][SERVER_MODULE]
>**Dictum:** *Server receives telemetry from DevTools clients.*

### [5.1][SERVER_INTERFACE]
```typescript
// --- [SERVER_RUN] ------------------------------------------------------------
import { DevTools } from '@effect/experimental';
import type { SocketServer } from '@effect/platform';

// Client connection interface
interface Client {
  // Queue of incoming requests (excludes Ping)
  readonly queue: Mailbox.ReadonlyMailbox<Request.WithoutPing>;
  // Send response to client
  readonly request: (response: Response) => Effect.Effect<void>;
}

// Run DevTools server with client handler
DevTools.Server.run: <R, E, _>(
  handle: (client: Client) => Effect.Effect<_, E, R>
) => Effect.Effect<never, SocketServer.SocketServerError, R | SocketServer.SocketServer>
```

### [5.2][SERVER_PATTERN]
```typescript
// --- [SERVER_IMPLEMENTATION] -------------------------------------------------
import { DevTools } from '@effect/experimental';
import { Mailbox, Effect, pipe } from 'effect';

const handleClient = (client: DevTools.Server.Client) =>
  Effect.gen(function* () {
    // Process incoming telemetry indefinitely
    yield* pipe(
      Mailbox.take(client.queue),
      Effect.flatMap((request) =>
        Match.value(request).pipe(
          Match.tag('Span', ({ span }) => processSpan(span)),
          Match.tag('SpanEvent', ({ event }) => processEvent(event)),
          Match.tag('MetricsSnapshot', ({ metrics }) => processMetrics(metrics)),
          Match.exhaustive,
        )
      ),
      Effect.forever,
    );
  });

// Server layer composition
const DevToolsServerLayer = DevTools.Server.run(handleClient).pipe(
  Layer.provide(SocketServer.layer({ port: 34437 })),
);
```

---
## [6][INTEGRATION_PATTERNS]
>**Dictum:** *DevTools integrates with existing Telemetry infrastructure.*

### [6.1][DEVELOPMENT_LAYER]
```typescript
// --- [DEV_INTEGRATION] -------------------------------------------------------
import { DevTools } from '@effect/experimental';
import { Layer, Config, Effect, pipe } from 'effect';

// Conditional DevTools based on environment
const DevToolsLayer = Layer.unwrapEffect(
  Config.string('NODE_ENV').pipe(
    Config.withDefault('development'),
    Effect.map((env) =>
      env === 'development'
        ? DevTools.layer('ws://localhost:34437')
        : Layer.empty
    ),
  )
);

// Merge with existing Telemetry.Default
const ObservabilityLayer = Layer.mergeAll(
  Telemetry.Default,
  DevToolsLayer,
);
```

### [6.2][SAFE_CONNECTION_PATTERN]
```typescript
// --- [SAFE_CONNECTION] -------------------------------------------------------
// Test connection before enabling (prevents startup hangs)
const testConnection = (url: string, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.async((resume) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      resume(Effect.succeed(false));
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resume(Effect.succeed(true));
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      ws.close();
      resume(Effect.succeed(false));
    };
  });

// Safe layer with connection test
const SafeDevToolsLayer = Layer.unwrapEffect(
  pipe(
    testConnection('ws://localhost:34437', 1000),
    Effect.map((available) =>
      available ? DevTools.layer('ws://localhost:34437') : Layer.empty
    ),
    Effect.catchAll(() => Effect.succeed(Layer.empty)),
  )
);
```

### [6.3][CUSTOM_TRACER_INTEGRATION]
```typescript
// --- [TRACER_COMPOSITION] ----------------------------------------------------
import { DevTools } from '@effect/experimental';
import { NodeSocket } from '@effect/platform-node';

// Provide DevTools tracer with socket transport
const DevToolsTracerLayer = DevTools.Client.layerTracer.pipe(
  Layer.provide(NodeSocket.layerWebSocket('ws://localhost:34437')),
);

// Compose with OTLP for dual export (OTLP + DevTools)
const DualTracerLayer = Layer.mergeAll(
  Otlp.layerJson({ baseUrl: 'https://collector:4318' }),
  DevToolsTracerLayer,
);
```

---
## [7][SPAN_CORRELATION]
>**Dictum:** *DevTools spans correlate with OTEL spans via shared trace context.*

### [7.1][ATTRIBUTE_MAPPING]
```typescript
// --- [ATTRIBUTE_CORRELATION] -------------------------------------------------
// DevTools Span attributes map to OTEL semantic conventions
const spanAttributeMapping = {
  // DevTools            -> OTEL Semantic Convention
  'exception.type':      'exception.type',
  'exception.message':   'exception.message',
  'exception.stacktrace':'exception.stacktrace',
  'error':               'otel.status_code',  // When true -> ERROR
} as const;

// Attributes auto-captured by Telemetry.span flow through to DevTools
// - tenant.id, request.id, user.id, session.id
// - fiber.id via FiberId.threadName
// - circuit.* (when in circuit context)
```

### [7.2][SPAN_STATUS_MAPPING]
```typescript
// --- [STATUS_MAPPING] --------------------------------------------------------
// DevTools SpanStatus -> OTEL StatusCode
const statusMapping = {
  'Started': 'UNSET',   // Span in progress
  'Ended':   'OK',      // Success completion
  // Error status set via 'error' attribute
} as const;
```

---
## [8][METRICS_INTEGRATION]
>**Dictum:** *DevTools receives metric snapshots from MetricsService.*

### [8.1][METRIC_TYPE_MAPPING]
```typescript
// --- [METRIC_MAPPING] --------------------------------------------------------
// Effect Metric -> DevTools Domain Metric
const metricTypeMapping = {
  // Effect Metric.counter  -> Domain.Counter
  // Effect Metric.gauge    -> Domain.Gauge
  // Effect Metric.histogram-> Domain.Histogram (via timerWithBoundaries)
  // Effect Metric.frequency-> Domain.Frequency
  // Effect Metric.summary  -> Domain.Summary
} as const;

// MetricsService metrics exported via Telemetry.Default OTLP layer
// DevTools receives same metrics via MetricsSnapshot requests
```

---
## [9][CONFIGURATION]
>**Dictum:** *DevTools configuration follows codebase conventions.*

### [9.1][ENVIRONMENT_VARIABLES]
```typescript
// --- [CONFIG] ----------------------------------------------------------------
const DevToolsConfig = {
  // Connection
  url: 'ws://localhost:34437',           // DEVTOOLS_URL
  timeoutMs: 1000,                        // Connection timeout

  // Behavior
  enabled: process.env.NODE_ENV === 'development',

  // Transport selection (auto-detected)
  transport: 'websocket' | 'socket',      // Based on environment
} as const;
```

### [9.2][LAYER_COMPOSITION_ORDER]
```typescript
// --- [LAYER_ORDER] -----------------------------------------------------------
// DevTools must be provided AFTER tracer/metrics layers
const AppLayer = pipe(
  Layer.mergeAll(
    MetricsService.Default,               // [1] Metrics first
    Telemetry.Default,                    // [2] OTLP export + tracer
    DevToolsLayer,                        // [3] DevTools last (consumes tracer)
  ),
  Layer.provide(FetchHttpClient.layer),
);
```

---
## [10][PRODUCTION_CONSIDERATIONS]
>**Dictum:** *DevTools is development-only; disable in production.*

| [INDEX] | [CONCERN]           | [MITIGATION]                                      |
| :-----: | ------------------- | ------------------------------------------------- |
|   [1]   | Performance         | Disable via `Layer.empty` in production           |
|   [2]   | Security            | Never expose DevTools port externally             |
|   [3]   | Startup blocking    | Use safe connection pattern with timeout          |
|   [4]   | Memory overhead     | DevTools maintains span/metric queues             |
|   [5]   | Network traffic     | All spans/metrics transmitted over socket         |

```typescript
// --- [PRODUCTION_GATE] -------------------------------------------------------
const DevToolsLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const env = yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'));
    const enabled = yield* Config.boolean('DEVTOOLS_ENABLED').pipe(Config.withDefault(false));

    if (env === 'production' || !enabled) {
      return Layer.empty;
    }

    // Safe connection test for development
    const available = yield* testConnection('ws://localhost:34437', 1000);
    return available ? DevTools.layer('ws://localhost:34437') : Layer.empty;
  }),
);
```

---
## [11][REFERENCES]

| [INDEX] | [RESOURCE]                    | [URL]                                                                 |
| :-----: | ----------------------------- | --------------------------------------------------------------------- |
|   [1]   | DevTools Client               | https://effect-ts.github.io/effect/experimental/DevTools/Client.ts.html |
|   [2]   | DevTools Domain               | https://effect-ts.github.io/effect/experimental/DevTools/Domain.ts.html |
|   [3]   | DevTools Server               | https://effect-ts.github.io/effect/experimental/DevTools/Server.ts.html |
|   [4]   | DevTools Module               | https://effect-ts.github.io/effect/experimental/DevTools.ts.html        |
|   [5]   | Codebase Telemetry            | `packages/server/src/observe/telemetry.ts`                            |
|   [6]   | Codebase Metrics              | `packages/server/src/observe/metrics.ts`                              |
|   [7]   | Codebase DevTools Integration | `packages/devtools/src/experimental.ts`                               |
