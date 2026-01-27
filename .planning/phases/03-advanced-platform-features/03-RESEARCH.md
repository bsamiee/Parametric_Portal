# Phase 3: Advanced Platform Features - Research

**Researched:** 2026-01-27
**Domain:** @effect/platform Worker Pools, @effect/rpc, KeyValueStore.forSchema
**Confidence:** MEDIUM

## Summary

This research covers three primary domains for Phase 3: SerializedWorkerPool for CPU-intensive parsing operations, Effect RPC for type-safe worker communication with streaming, and KeyValueStore.forSchema for typed cache access.

The Effect ecosystem provides comprehensive worker pool abstractions through `@effect/platform` with `SerializedWorkerPool` for schema-validated request/response patterns. For streaming progress updates, the recommended approach is `@effect/rpc` with `Rpc.StreamRequest` which enables type-safe streaming from workers to the main thread. The `KeyValueStore.forSchema` API provides exactly the schema-validated cache access pattern needed.

**Primary recommendation:** Use `@effect/rpc` with `RpcGroup.make()` and `Rpc.make()` for worker communication, leveraging `Rpc.StreamRequest` for progress streaming. Extend CacheService with `KeyValueStore.forSchema` pattern for typed cache access.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/platform` | 0.94.2 | Worker abstractions, SerializedWorkerPool | Official Effect platform package with Worker/WorkerRunner APIs |
| `@effect/platform-node` | 0.104.1 | NodeWorker, NodeWorkerRunner | Node.js worker_threads implementation |
| `@effect/rpc` | 0.73.0 | Type-safe RPC with streaming | Schema-validated request/response with Stream support |
| `effect` | 3.19.15 | Core Effect, Schema, Stream | Foundation for all Effect patterns |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `exceljs` | (existing) | XLSX parsing | Stream-based Excel parsing in workers |
| `jszip` | (existing) | ZIP parsing | Archive handling in workers |
| `papaparse` | (existing) | CSV parsing | Delimited file parsing in workers |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @effect/rpc | Direct WorkerRunner.makeSerialized | RPC adds streaming support + client ergonomics; direct approach is lower-level |
| SerializedWorkerPool | Raw worker_threads | Effect pool adds lifecycle, error handling, schema validation |
| KeyValueStore.forSchema | Custom schema wrapper | forSchema is official API with proper error handling |

**Installation:**
```bash
# Already in workspace catalog - no additional installation needed
```

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
  platform/
    cache.ts         # Extend with forSchema capability
    workers/
      pool.ts        # Worker pool service + RPC client
      transfer.ts    # Transfer parsing worker script (runs IN worker)
      contract.ts    # Shared RPC contract schemas
```

### Pattern 1: RPC-based Worker Communication with Streaming

**What:** Define worker contracts using `RpcGroup.make()` with `Rpc.make()` for streaming requests
**When to use:** Any worker communication requiring progress updates or streaming results
**Example:**
```typescript
// Source: https://dev.to/titouancreach/part-2-how-i-replaced-trpc-with-effect-rpc-in-a-nextjs-app-router-application-streaming-responses-566c
// contract.ts - Shared between main thread and worker
import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema as S } from "effect";

// Progress event schema
const ParseProgress = S.Struct({
  bytesProcessed: S.Number,
  totalBytes: S.Number,
  rowsProcessed: S.Number,
  percentage: S.Number,
  eta: S.Option(S.Number),
});

// Final result schema
const ParseResult = S.Struct({
  items: S.Array(S.Struct({ content: S.String, type: S.String, ordinal: S.Number })),
  errors: S.Array(S.Struct({ code: S.String, ordinal: S.Number, detail: S.Option(S.String) })),
});

// Streaming request - returns Stream of progress, final chunk is result
export class ParseTransfer extends Rpc.StreamRequest<ParseTransfer>()(
  "ParseTransfer",
  {
    payload: {
      presignedUrl: S.String,
      format: S.Literal("xlsx", "csv", "zip", "json", "yaml"),
    },
    success: S.Union(ParseProgress, ParseResult),
    failure: S.Union(ParseError, TimeoutError, WorkerCrashError),
  },
) {}

export class TransferRpc extends RpcGroup.make(ParseTransfer) {}
```

### Pattern 2: Worker Script with RPC Server

**What:** Worker script that handles RPC requests and returns streams
**When to use:** The actual worker file that runs in the worker thread
**Example:**
```typescript
// Source: https://lucas-barake.github.io/rpc-for-workers-in-typescript/
// workers/transfer.ts - Runs in worker thread
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as RpcServer from "@effect/rpc/RpcServer";
import { Effect, Layer, Stream } from "effect";
import { TransferRpc, ParseProgress, ParseResult } from "./contract.ts";

const Live = TransferRpc.toLayer(
  Effect.gen(function* () {
    return {
      ParseTransfer: ({ presignedUrl, format }) =>
        Stream.unwrap(Effect.gen(function* () {
          // Fetch file from presigned URL
          const response = yield* Effect.tryPromise(() => fetch(presignedUrl));
          const totalBytes = Number(response.headers.get("content-length") ?? 0);

          // Return stream with progress updates
          return parseWithProgress(response.body!, format, totalBytes).pipe(
            Stream.map((update) => update), // Progress or final result
          );
        })),
    };
  }),
);

const RpcWorkerServer = RpcServer.layer(TransferRpc).pipe(
  Layer.provide(Live),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
);

NodeRuntime.runMain(NodeWorkerRunner.launch(RpcWorkerServer));
```

### Pattern 3: Worker Pool Client in Main Thread

**What:** Main thread service that manages worker pool and dispatches requests
**When to use:** Service layer that orchestrates parsing operations
**Example:**
```typescript
// Source: https://lucas-barake.github.io/rpc-for-workers-in-typescript/
// platform/workers/pool.ts
import * as NodeWorker from "@effect/platform-node/NodeWorker";
import * as RpcClient from "@effect/rpc/RpcClient";
import { Effect, Layer, Stream } from "effect";
import { TransferRpc, ParseTransfer, ParseProgress, ParseResult } from "./contract.ts";

// Worker pool configuration
const RpcProtocol = RpcClient.layerProtocolWorker({
  size: 4,        // Fixed pool of 4 workers (Claude's discretion)
  concurrency: 1, // One parse operation per worker at a time
}).pipe(
  Layer.provide(NodeWorker.layer(() => new Worker("./transfer.ts"))),
  Layer.orDie,
);

class WorkerPoolService extends Effect.Service<WorkerPoolService>()(
  "server/WorkerPoolService",
  {
    dependencies: [RpcProtocol],
    scoped: Effect.gen(function* () {
      const client = yield* RpcClient.make(TransferRpc);

      return {
        parse: (presignedUrl: string, format: string) =>
          client(new ParseTransfer({ presignedUrl, format })),
      };
    }),
  },
) {}
```

### Pattern 4: KeyValueStore.forSchema for Typed Cache

**What:** Extend CacheService with schema-validated typed access
**When to use:** Session/token cache with compile-time type validation
**Example:**
```typescript
// Source: https://effect.website/docs/platform/key-value-store/
// Extending CacheService with forSchema capability

import { KeyValueStore } from "@effect/platform";
import { Schema as S, Effect, Option } from "effect";

// Domain schemas
const SessionSchema = S.Struct({
  userId: S.String,
  tenantId: S.String,
  expiresAt: S.Number,
  roles: S.Array(S.String),
});
type Session = typeof SessionSchema.Type;

// Registration pattern for domains
const _domains = new Map<string, S.Schema<unknown, unknown>>();

// In CacheService.register at startup
static readonly register = <A, I>(domain: string, schema: S.Schema<A, I>) =>
  Effect.sync(() => _domains.set(domain, schema as S.Schema<unknown, unknown>));

// In CacheService.getSchema - typed get/set
static readonly getSchema = <A, I>(domain: string, key: string) =>
  Effect.gen(function* () {
    const state = yield* CacheService;
    const schema = _domains.get(domain) as S.Schema<A, I>;
    const store = KeyValueStore.forSchema(schema);

    return yield* store.get(key).pipe(
      Effect.catchTag("ParseError", () => Effect.succeed(Option.none())), // Decode failure = cache miss
    );
  });
```

### Pattern 5: Graceful Cancellation with Checkpointing

**What:** Soft timeout with grace period for worker operations
**When to use:** Long-running parsing operations that need clean termination
**Example:**
```typescript
// Source: https://effect.website/docs/resource-management/scope/
// Graceful cancellation pattern

const parseWithGracefulCancel = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
  opts: { softTimeout: Duration; gracePeriod: Duration }
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(operation);

    // Soft timeout - signal to checkpoint
    yield* Effect.sleep(opts.softTimeout);
    yield* Effect.logWarning("Soft timeout reached, requesting checkpoint");

    // Grace period - wait for checkpoint completion
    const result = yield* fiber.pipe(
      Fiber.await,
      Effect.timeout(opts.gracePeriod),
      Effect.flatMap(Option.match({
        onNone: () => Fiber.interrupt(fiber).pipe(Effect.as(Option.none<A>())),
        onSome: (exit) => Effect.succeed(Exit.match(exit, {
          onFailure: (cause) => Option.none<A>(),
          onSuccess: (value) => Option.some(value),
        })),
      })),
    );

    return result;
  });
```

### Anti-Patterns to Avoid

- **Hand-rolling worker message protocol:** Use @effect/rpc for type-safe serialization
- **Passing auth credentials to workers:** Use presigned URLs only
- **Blocking main thread waiting for worker:** Use fiber-based async patterns
- **Ignoring worker crashes:** Handle WorkerCrashError in error union

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worker message serialization | Custom JSON protocol | @effect/rpc with Schema | Schema validation, error propagation, streaming |
| Worker pool management | Manual worker spawning | SerializedWorkerPool | Lifecycle, error recovery, pool sizing |
| Schema-validated cache | Custom JSON parse/validate | KeyValueStore.forSchema | Built-in error handling, Option semantics |
| Progress streaming | postMessage callbacks | Rpc.StreamRequest | Type-safe stream with backpressure |
| Resource cleanup on cancel | Manual try/finally | Effect.addFinalizer + Scope | Guaranteed cleanup even on interruption |

**Key insight:** The Effect ecosystem has mature abstractions for all these concerns. Custom solutions miss edge cases (interruption, error propagation, backpressure) that the official APIs handle.

## Common Pitfalls

### Pitfall 1: Worker Script Bundling with Vite

**What goes wrong:** Worker TypeScript files don't bundle correctly with Vite for Node.js worker_threads
**Why it happens:** Vite's `?worker` suffix is for Web Workers, not node:worker_threads
**How to avoid:**
- Use separate build target for worker scripts
- Or use vite-node wrapper for development
- Configure worker.format: 'es' for ES modules
**Warning signs:** "Cannot find module" errors at runtime

### Pitfall 2: Schema Mismatch Between Main and Worker

**What goes wrong:** Request/response types diverge between threads causing runtime parse errors
**Why it happens:** Contract schema not shared, or different versions imported
**How to avoid:** Single source of truth in `contract.ts`, import in both main and worker
**Warning signs:** ParseError on worker responses

### Pitfall 3: Memory Leaks from Unclosed Worker Pools

**What goes wrong:** Workers accumulate, memory grows without bound
**Why it happens:** Pool not properly scoped, finalizers not registered
**How to avoid:** Use `Effect.scoped` with worker pool creation, rely on Scope cleanup
**Warning signs:** Growing worker thread count in diagnostics

### Pitfall 4: Progress Stream Backpressure Ignored

**What goes wrong:** Worker produces progress faster than main thread consumes, memory bloats
**Why it happens:** Unbounded stream without capacity limits
**How to avoid:** Use Stream.buffer with capacity, or throttle progress emission
**Warning signs:** Memory growth during large file parsing

### Pitfall 5: Decode Failure Not Treated as Cache Miss

**What goes wrong:** Schema change breaks all cached data, requires manual cache flush
**Why it happens:** Treating parse errors as hard failures instead of cache miss
**How to avoid:** Implement decision: decode failure = cache miss, re-fetch fresh
**Warning signs:** Application errors after schema changes

## Code Examples

Verified patterns from official sources:

### Worker Pool with Fixed Size
```typescript
// Source: https://effect-ts.github.io/effect/platform/Worker.ts.html
import * as Worker from "@effect/platform/Worker";
import * as NodeWorker from "@effect/platform-node/NodeWorker";

// Fixed pool of 4 workers
const pool = Worker.makePoolSerialized<TransferRpc>({
  size: 4,
  concurrency: 1,
});

// Usage
const result = yield* pool.executeEffect(new ParseTransfer({ ... }));
```

### Stream Progress from Worker
```typescript
// Source: https://dev.to/titouancreach/part-2-how-i-replaced-trpc-with-effect-rpc
// In worker handler - emit progress stream
const parseWithProgress = (body: ReadableStream, format: string, totalBytes: number) =>
  Stream.async<ParseProgress | ParseResult, ParseError>((emit) => {
    let bytesProcessed = 0;
    let rowsProcessed = 0;
    const startTime = Date.now();

    // ... parsing logic ...

    // Emit progress periodically (every 100 rows or 10KB)
    if (shouldEmitProgress) {
      const elapsed = Date.now() - startTime;
      const rate = bytesProcessed / elapsed;
      const remaining = totalBytes - bytesProcessed;
      const eta = remaining / rate;

      emit.single({
        bytesProcessed,
        totalBytes,
        rowsProcessed,
        percentage: (bytesProcessed / totalBytes) * 100,
        eta: Option.some(eta),
      });
    }

    // Emit final result
    emit.single({ items, errors });
    emit.end();
  });
```

### Typed Cache with Schema
```typescript
// Source: https://effect.website/docs/platform/key-value-store/
import { KeyValueStore } from "@effect/platform";
import { Schema as S, Effect, Option } from "effect";

const TokenSchema = S.Struct({
  accessToken: S.String,
  refreshToken: S.String,
  expiresAt: S.Number,
});

// Create schema store
const tokenStore = KeyValueStore.forSchema(TokenSchema);

// Get with automatic decode, failure = None
const maybeToken = yield* tokenStore.get("token:user123").pipe(
  Effect.catchTag("ParseError", () => Effect.succeed(Option.none())),
);

// Set with automatic encode
yield* tokenStore.set("token:user123", {
  accessToken: "...",
  refreshToken: "...",
  expiresAt: Date.now() + 3600000,
});
```

### Fiber Interruption with Cleanup
```typescript
// Source: https://effect.website/docs/concurrency/fibers/
// Source: https://effect.website/docs/resource-management/scope/
const runWithTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  timeout: Duration,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      // Register cleanup
      yield* Effect.addFinalizer((exit) =>
        Effect.logInfo("Cleanup running", { exit: Exit.isInterrupted(exit) ? "interrupted" : "completed" })
      );

      // Run with timeout - interrupts on expiry
      return yield* effect.pipe(
        Effect.timeout(timeout),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(new TimeoutError()),
          onSome: Effect.succeed,
        })),
      );
    })
  );
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw postMessage | @effect/rpc | Effect 3.0+ | Type-safe, streaming, error propagation |
| Manual JSON.parse | Schema.decodeUnknown | Effect Schema | Runtime validation, branded types |
| Promise.race timeout | Effect.timeout | Effect core | Proper interruption, cleanup |
| Callback-based workers | WorkerRunner.makeSerialized | @effect/platform | Declarative, layer-based |

**Deprecated/outdated:**
- `@effect/schema` standalone package: Now `effect/Schema` (merged into core)
- Manual worker lifecycle: Use WorkerPool with automatic lifecycle

## Open Questions

Things that couldn't be fully resolved:

1. **Vite Worker Bundling for Node.js**
   - What we know: Vite's `?worker` is for Web Workers, not worker_threads
   - What's unclear: Exact configuration for bundling worker scripts with Vite 7 for Node.js
   - Recommendation: May need separate esbuild/rollup config for worker scripts, or use vite-node wrapper

2. **RPC Streaming Backpressure**
   - What we know: Streams have backpressure via Effect
   - What's unclear: How backpressure propagates across worker boundary with RPC
   - Recommendation: Add explicit Stream.buffer with capacity limits on worker side

3. **Worker Crash Recovery Details**
   - What we know: WorkerCrashError is part of error union
   - What's unclear: Automatic restart behavior of SerializedWorkerPool
   - Recommendation: Implement explicit error handling, let caller decide retry

4. **Redis KeyValueStore Backend**
   - What we know: `@effect/experimental` has Redis persistence
   - What's unclear: Direct integration with KeyValueStore interface
   - Recommendation: Continue using existing CacheService Redis integration, wrap with forSchema layer

## Sources

### Primary (HIGH confidence)
- [Worker.ts API](https://effect-ts.github.io/effect/platform/Worker.ts.html) - SerializedWorkerPool, Worker interfaces
- [KeyValueStore Documentation](https://effect.website/docs/platform/key-value-store/) - forSchema, SchemaStore patterns
- [Fiber Documentation](https://effect.website/docs/concurrency/fibers/) - Interruption, cancellation patterns
- [Scope Documentation](https://effect.website/docs/resource-management/scope/) - addFinalizer, resource cleanup

### Secondary (MEDIUM confidence)
- [Effect RPC Workers Example](https://lucas-barake.github.io/rpc-for-workers-in-typescript/) - Complete RPC worker pattern
- [Streaming RPC Article](https://dev.to/titouancreach/part-2-how-i-replaced-trpc-with-effect-rpc-in-a-nextjs-app-router-application-streaming-responses-566c) - Rpc.StreamRequest pattern
- [NodeWorkerRunner API](https://effect-ts.github.io/effect/platform-node/NodeWorkerRunner.ts.html) - Node.js worker runner
- [Vite Worker Options](https://vite.dev/config/worker-options) - Worker bundling configuration

### Tertiary (LOW confidence)
- Worker script bundling with Vite for Node.js - Needs validation spike
- RPC backpressure across worker boundary - Needs testing
- SerializedWorkerPool crash recovery - Needs source code review

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Effect packages, versions from workspace catalog
- Architecture: MEDIUM - Patterns verified via documentation, not codebase examples
- Pitfalls: MEDIUM - Based on general Effect knowledge, some specifics inferred

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - Effect ecosystem is stable but evolving)
