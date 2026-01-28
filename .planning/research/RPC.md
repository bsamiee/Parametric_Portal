# @effect/rpc Research

**Version:** 0.73.0 (from pnpm catalog)
**Researched:** 2026-01-28
**Confidence:** HIGH (official docs, GitHub source, verified examples)

## Executive Summary

`@effect/rpc` provides schema-driven typed RPC with automatic client generation, multiple transports (HTTP, WebSocket, Socket, Worker, stdio), and pluggable serialization. The API mirrors `HttpApiGroup` patterns but adds bidirectional streaming, server push, and cross-process/cross-worker communication. For WebSocket real-time, use `RpcServer.layerProtocolWebsocket` + `RpcClient.layerProtocolSocket`.

**Primary recommendation:** Define `RpcGroup` as shared contract, use `RpcServer.toHttpAppWebsocket` for WS upgrade, `RpcSerialization.layerMsgPack` for binary efficiency.

---

## Core Imports

| Import Path | What It Provides | When to Use |
|-------------|------------------|-------------|
| `@effect/rpc` | `Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`, `RpcMiddleware`, `RpcSerialization`, `RpcSchema` | All RPC operations |
| `@effect/rpc/Rpc` | `Rpc.make` | Define individual RPC endpoints |
| `@effect/rpc/RpcGroup` | `RpcGroup.make` | Group RPCs into contract |
| `@effect/rpc/RpcServer` | `layer`, `toHttpApp`, `toHttpAppWebsocket`, `layerProtocol*` | Server setup |
| `@effect/rpc/RpcClient` | `make`, `layerProtocol*`, `withHeaders` | Client creation |
| `@effect/rpc/RpcMiddleware` | `Tag`, `layerClient` | Cross-cutting concerns |
| `@effect/rpc/RpcSerialization` | `layerJson`, `layerNdjson`, `layerMsgPack` | Encoding configuration |
| `@effect/rpc/RpcSchema` | `Stream` | Streaming response schemas |

---

## Rpc Definition

Individual RPC endpoint with typed payload, success, error, and optional streaming.

```typescript
import { Rpc, RpcGroup } from '@effect/rpc';
import { Schema as S } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class RpcError extends S.TaggedError<RpcError>()('RpcError', {
  code: S.String,
  message: S.String,
}) {}

// --- [RPC_DEFINITIONS] -------------------------------------------------------

const GetUser = Rpc.make('GetUser', {
  payload: { id: S.UUID },
  success: User.json,                    // Your existing model schema
  error: RpcError,
});

const ListUsers = Rpc.make('ListUsers', {
  payload: { cursor: S.optional(S.String), limit: S.optionalWith(S.Int, { default: () => 20 }) },
  success: S.Array(User.json),
  stream: true,                          // Enables Stream<User> return type
});

const Subscribe = Rpc.make('Subscribe', {
  payload: { channel: S.String },
  success: S.Struct({ event: S.String, data: S.Unknown }),
  stream: true,                          // Server push via Stream
});
```

**Key options for `Rpc.make`:**
- `payload` - Request schema (object with schema fields)
- `success` - Response schema
- `error` - Error schema (use `Schema.TaggedError`)
- `stream: true` - Return `Stream` instead of single value

---

## RpcGroup

Group RPCs into shareable contract (analogous to `HttpApiGroup`).

```typescript
// --- [CONTRACT] --------------------------------------------------------------
// packages/shared/src/rpc.ts - shared between server and client

import { Rpc, RpcGroup } from '@effect/rpc';
import { Schema as S } from 'effect';

class ConnectionError extends S.TaggedError<ConnectionError>()('ConnectionError', {
  reason: S.String,
}) {}

export class RealtimeRpcs extends RpcGroup.make(
  Rpc.make('Ping', { success: S.Struct({ pong: S.Literal(true) }) }),
  Rpc.make('Subscribe', {
    payload: { rooms: S.Array(S.String) },
    success: S.Struct({ event: S.String, roomId: S.String, data: S.Unknown }),
    error: ConnectionError,
    stream: true,
  }),
  Rpc.make('Publish', {
    payload: { roomId: S.String, event: S.String, data: S.Unknown },
    success: S.Struct({ delivered: S.Int }),
    error: ConnectionError,
  }),
  Rpc.make('Presence', {
    payload: { roomId: S.String },
    success: S.Array(S.Struct({ userId: S.UUID, joinedAt: S.DateTimeUtc })),
  }),
) {}

// Compose groups via merge
export class ApiRpcs extends RpcGroup.merge(RealtimeRpcs, /* other groups */) {}
```

**RpcGroup methods:**
- `RpcGroup.make(...rpcs)` - Create from Rpc definitions
- `RpcGroup.merge(g1, g2)` - Combine groups
- `.prefix(string)` - Namespace RPCs
- `.middleware(M)` - Apply to all RPCs in group

---

## Server Setup

### WebSocket Protocol (Primary for Real-time)

```typescript
// --- [SERVER] ----------------------------------------------------------------
// apps/api/src/rpc-server.ts

import { RpcServer, RpcSerialization } from '@effect/rpc';
import { Effect, Layer, Stream } from 'effect';
import { RealtimeRpcs } from '@parametric-portal/shared/rpc';

// Handler implementation
const RealtimeLive = RealtimeRpcs.toLayer(
  Effect.gen(function* () {
    const pubsub = yield* PubSubService;  // Your service
    return {
      Ping: () => Effect.succeed({ pong: true as const }),
      Subscribe: ({ rooms }) => pubsub.subscribe(rooms),  // Returns Stream
      Publish: ({ roomId, event, data }) => pubsub.publish(roomId, event, data),
      Presence: ({ roomId }) => pubsub.getPresence(roomId),
    };
  }),
);

// Server layer with WebSocket protocol
const RpcLayer = RpcServer.layer(RealtimeRpcs).pipe(
  Layer.provide(RealtimeLive),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: '/ws/rpc' })),
  Layer.provide(RpcSerialization.layerMsgPack),  // Binary for efficiency
);

// Convert to HttpApp for integration with existing server
export const RpcWebSocketApp = RpcServer.toHttpAppWebsocket(RealtimeRpcs);
```

### HTTP Protocol (For REST-like RPC)

```typescript
const HttpRpcLayer = RpcServer.layer(ApiRpcs).pipe(
  Layer.provide(ApiLive),
  Layer.provide(RpcServer.layerProtocolHttp({ path: '/api/rpc' })),
  Layer.provide(RpcSerialization.layerNdjson),  // Streaming JSON
);

export const RpcHttpApp = RpcServer.toHttpApp(ApiRpcs);
```

### Server Configuration Options

```typescript
RpcServer.layer(Group, {
  disableTracing: false,           // Enable span propagation
  spanPrefix: 'rpc',               // Trace span prefix
  spanAttributes: { service: 'realtime' },
  concurrency: 'unbounded',        // Or number for backpressure
  disableFatalDefects: false,      // Report defects to client
});
```

---

## Client Setup

### WebSocket/Socket Client

```typescript
// --- [CLIENT] ----------------------------------------------------------------
// apps/web/src/rpc-client.ts

import { RpcClient, RpcSerialization } from '@effect/rpc';
import { Socket } from '@effect/platform';
import { Effect, Layer, Stream } from 'effect';
import { RealtimeRpcs } from '@parametric-portal/shared/rpc';

// Protocol layer for WebSocket
const ProtocolLive = RpcClient.layerProtocolSocket({
  url: 'wss://api.example.com/ws/rpc',
  // retry: Schedule.exponential(1000),  // Optional retry
}).pipe(
  Layer.provide(RpcSerialization.layerMsgPack),
);

// Service wrapper
export class RealtimeClient extends Effect.Service<RealtimeClient>()(
  'RealtimeClient',
  {
    dependencies: [ProtocolLive],
    scoped: RpcClient.make(RealtimeRpcs),
  },
) {}
```

### HTTP Client

```typescript
import { FetchHttpClient } from '@effect/platform';

const HttpProtocolLive = RpcClient.layerProtocolHttp({
  url: 'https://api.example.com/api/rpc',
}).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]),
);

export class ApiClient extends Effect.Service<ApiClient>()(
  'ApiClient',
  { dependencies: [HttpProtocolLive], scoped: RpcClient.make(ApiRpcs) },
) {}
```

### Client Usage

```typescript
const program = Effect.gen(function* () {
  const client = yield* RealtimeClient;

  // Single request
  const pong = yield* client.Ping({});

  // Streaming subscription
  const events = yield* client.Subscribe({ rooms: ['room-1', 'room-2'] }).pipe(
    Stream.tap((event) => Effect.log('Received', event)),
    Stream.take(100),
    Stream.runCollect,
  );

  // Publish
  yield* client.Publish({ roomId: 'room-1', event: 'message', data: { text: 'Hello' } });
});

program.pipe(Effect.provide(RealtimeClient.Default), Effect.runPromise);
```

---

## Middleware

### Define Middleware Tag

```typescript
// --- [MIDDLEWARE] ------------------------------------------------------------

import { RpcMiddleware } from '@effect/rpc';
import { Context, Effect, Layer, Schema as S } from 'effect';

// Context provided by middleware
class CurrentUser extends Context.Tag('CurrentUser')<CurrentUser, { id: string; tenantId: string }>() {}

// Middleware tag with configuration
export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  'AuthMiddleware',
  {
    provides: CurrentUser,           // Injects CurrentUser into handler context
    requiredForClient: true,         // Client MUST provide this middleware
    failure: S.TaggedError<AuthError>()('AuthError', { reason: S.String }),
  },
) {}
```

### Server-Side Middleware Implementation

```typescript
const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const sessions = yield* SessionService;
    return AuthMiddleware.of({
      // Receives headers, clientId; returns provided context
      handler: ({ headers }) => Effect.gen(function* () {
        const token = headers.get('authorization')?.replace('Bearer ', '');
        if (!token) return yield* new AuthError({ reason: 'Missing token' });
        const user = yield* sessions.validate(token);
        return { id: user.id, tenantId: user.tenantId };
      }),
    });
  }),
);
```

### Apply Middleware to RPCs

```typescript
// Single RPC
const SecureRpc = Rpc.make('SecureOp', { /* ... */ }).middleware(AuthMiddleware);

// Entire group
export class SecureRpcs extends RpcGroup.make(/* rpcs */).middleware(AuthMiddleware) {}
```

### Client-Side Middleware

```typescript
const ClientAuthLive = RpcMiddleware.layerClient(
  AuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* AuthStore;
    return {
      // Modify outgoing request
      handler: ({ rpc, request }) => Effect.gen(function* () {
        const token = yield* auth.getToken;
        return { ...request, headers: request.headers.set('authorization', `Bearer ${token}`) };
      }),
    };
  }),
);
```

---

## Serialization

| Layer | Format | Framing | Binary | Use Case |
|-------|--------|---------|--------|----------|
| `layerJson` | JSON | Required | No | Simple HTTP |
| `layerNdjson` | NDJSON | Built-in | No | HTTP streaming |
| `layerMsgPack` | MessagePack | Built-in | Yes | WebSocket, performance |
| `layerJsonRpc` | JSON-RPC 2.0 | Required | No | Interop |

**Recommendation:** Use `layerMsgPack` for WebSocket (compact binary, handles Uint8Array natively).

```typescript
// Server
Layer.provide(RpcSerialization.layerMsgPack)

// Client (must match)
Layer.provide(RpcSerialization.layerMsgPack)
```

---

## HttpApiGroup Comparison

| Aspect | HttpApiGroup | RpcGroup |
|--------|--------------|----------|
| Transport | HTTP only | HTTP, WS, Socket, Worker, stdio |
| Streaming | SSE (one-way) | Bidirectional via Stream |
| Server push | No | Yes (stream: true) |
| Middleware | HttpApiMiddleware | RpcMiddleware |
| Schema | HttpApiEndpoint schemas | Rpc.make schemas |
| Client | HttpApiClient | RpcClient.make |
| Error | HttpApiSchema.annotations | Schema.TaggedError |

**Coexistence pattern:**
- Use `HttpApiGroup` for REST endpoints (CRUD, file upload, OpenAPI)
- Use `RpcGroup` for real-time (subscriptions, bidirectional, server push)
- Share domain schemas between both

```typescript
// Shared schema
export class User extends Schema.Class<User>('User')({ id: S.UUID, name: S.String }) {}

// REST endpoint uses it
HttpApiEndpoint.get('getUser', '/:id').addSuccess(User)

// RPC uses same schema
Rpc.make('GetUser', { payload: { id: S.UUID }, success: User })
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| WS message routing | Manual dispatch tables | `RpcServer.layerProtocolWebsocket` |
| Request/response correlation | requestId tracking | Built into `RpcMessage` |
| Client type safety | Manual type casts | `RpcClient.make(Group)` |
| Stream serialization | Custom framing | `RpcSchema.Stream` + `RpcSerialization` |
| Error propagation | Custom error envelope | `Rpc.make({ error: ... })` |
| Reconnection | Manual retry logic | `RpcClient.layerProtocolSocket` with `retry` |
| Middleware composition | Manual pre/post hooks | `RpcMiddleware.Tag` |
| Trace propagation | Manual span passing | Built-in with `disableTracing: false` |

---

## Code Patterns

### Full WebSocket Server Integration

```typescript
// --- [INTEGRATION] -----------------------------------------------------------
// apps/api/src/server.ts

import { HttpApp, HttpMiddleware, HttpServer } from '@effect/platform';
import { RpcServer, RpcSerialization } from '@effect/rpc';
import { Effect, Layer } from 'effect';
import { ParametricApi } from './api.ts';           // Existing HTTP API
import { RealtimeRpcs } from './rpc/contract.ts';
import { RealtimeLive } from './rpc/handlers.ts';

// HTTP API router (existing)
const HttpApiLive = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(/* handlers */));

// RPC WebSocket app
const RpcApp = RpcServer.toHttpAppWebsocket(RealtimeRpcs).pipe(
  Effect.provide(RealtimeLive),
  Effect.provide(RpcSerialization.layerMsgPack),
);

// Compose: mount RPC at /ws/rpc, REST at /api
const App = HttpApp.empty.pipe(
  HttpApp.mount('/ws/rpc', RpcApp),
  HttpApp.mount('/api', HttpApiLive),
  HttpMiddleware.logger,
);

// Serve
const serve = HttpServer.serve(App).pipe(
  Layer.provide(HttpServer.layerConfig({ port: 3000 })),
);
```

### Stream Handler Pattern

```typescript
// Server handler returning Stream
Subscribe: ({ rooms }) => Effect.gen(function* () {
  const pubsub = yield* PubSubService;
  return Stream.fromPubSub(pubsub.topic).pipe(
    Stream.filter((msg) => rooms.includes(msg.roomId)),
    Stream.map((msg) => ({ event: msg.event, roomId: msg.roomId, data: msg.payload })),
  );
}),
```

### Error Recovery Pattern

```typescript
// Client with typed error handling
yield* client.Subscribe({ rooms: ['room-1'] }).pipe(
  Stream.catchTag('ConnectionError', (err) =>
    Stream.fromEffect(Effect.logWarning('Connection lost', err)).pipe(
      Stream.flatMap(() => Stream.retry(Schedule.exponential(1000))),
    ),
  ),
);
```

---

## Sources

### PRIMARY (HIGH confidence)
- [GitHub: @effect/rpc README](https://github.com/Effect-TS/effect/blob/main/packages/rpc/README.md)
- [Effect RPC Docs](https://effect-ts.github.io/effect/docs/rpc)
- [RpcServer.ts API](https://effect-ts.github.io/effect/rpc/RpcServer.ts.html)
- [RpcClient.ts API](https://effect-ts.github.io/effect/rpc/RpcClient.ts.html)
- [RpcMiddleware.ts API](https://effect-ts.github.io/effect/rpc/RpcMiddleware.ts.html)
- [RpcSerialization.ts API](https://effect-ts.github.io/effect/rpc/RpcSerialization.ts.html)

### SECONDARY (MEDIUM confidence)
- [Typeonce: Effect RPC HTTP Example](https://www.typeonce.dev/snippet/effect-rpc-http-client-complete-example)
- [Effect RPC for Workers](https://lucas-barake.github.io/rpc-for-workers-in-typescript/)
- [Effect 3.14 Release](https://effect.website/blog/releases/effect/314/)

### TERTIARY (LOW confidence)
- WebSearch results for patterns (verified against official sources)
