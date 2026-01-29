/**
 * ClusterService facade for multi-pod coordination via @effect/cluster.
 * Single import point for all cluster operations (send/broadcast/singleton).
 * Entity sharding, shard ownership via advisory locks, distributed message routing.
 */
import { Duration, Effect, Match, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

// Branded type for idempotency keys with validation
const IdempotencyKey = S.String.pipe(
  S.minLength(1),
  S.maxLength(255),
  S.pattern(/^[a-zA-Z0-9:_-]+$/),
  S.brand('IdempotencyKey'),
);

// Snowflake ID schema - uses string representation for external boundaries
// Internal routing uses the raw bigint; external APIs receive string form
const SnowflakeId = S.String.pipe(
  S.pattern(/^\d{18,19}$/),
  S.brand('SnowflakeId'),
);

// Message payload schemas using Schema.Class for opacity + methods
// Note: Schema.Class auto-generates validated make() constructor - no custom one needed
class ProcessPayload extends S.Class<ProcessPayload>('ProcessPayload')({
  data: S.Unknown,
  entityId: SnowflakeId,
  idempotencyKey: S.optional(IdempotencyKey),
}) {}

class StatusPayload extends S.Class<StatusPayload>('StatusPayload')({
  entityId: SnowflakeId,
}) {}

class StatusResponse extends S.Class<StatusResponse>('StatusResponse')({
  status: S.Literal('idle', 'processing', 'complete', 'failed'),
  updatedAt: S.Number,
}) {}

// --- [ERRORS] ----------------------------------------------------------------

// Schema.TaggedError for cross-process RPC boundary (serializable)
// Data.TaggedError is for internal errors only - Entity RPC needs serialization
// Include ALL @effect/cluster error variants for complete error handling
class ClusterError extends S.TaggedError<ClusterError>()('ClusterError', {
  cause: S.optional(S.Unknown),
  entityId: S.optional(S.String),
  reason: S.Literal(
    'AlreadyProcessingMessage',   // Entity currently handling a request
    'EntityNotAssignedToRunner',  // Message for unmanaged entity
    'MailboxFull',                // Entity mailbox at capacity
    'MalformedMessage',           // Deserialization failure
    'PersistenceError',           // Storage backend error
    'RunnerNotRegistered',        // Runner not in cluster
    'RunnerUnavailable',          // Runner offline
    'SendTimeout',                // Message delivery timeout
    'Suspended',                  // Entity suspended awaiting signal (Phase 6 DurableDeferred)
    'RpcClientError',             // Wraps RpcClientError for Phase 7 WebSocket RPC failures
    'SerializationError',         // MsgPack/JSON decode failures
  ),
  requestId: S.optional(S.String),    // RPC request ID for correlation/distributed tracing
  resumeToken: S.optional(S.String),  // Enable manual resume via DurableDeferred pattern (Phase 6)
}) {
  // Factory methods for all @effect/cluster error variants
  static readonly fromAlreadyProcessing = (entityId: string, cause?: unknown) =>
    new ClusterError({ cause, entityId, reason: 'AlreadyProcessingMessage' });
  static readonly fromEntityNotAssigned = (entityId: string, cause?: unknown) =>
    new ClusterError({ cause, entityId, reason: 'EntityNotAssignedToRunner' });
  static readonly fromMailboxFull = (entityId: string, cause?: unknown) =>
    new ClusterError({ cause, entityId, reason: 'MailboxFull' });
  static readonly fromMalformedMessage = (cause?: unknown) =>
    new ClusterError({ cause, reason: 'MalformedMessage' });
  static readonly fromPersistence = (cause?: unknown) =>
    new ClusterError({ cause, reason: 'PersistenceError' });
  static readonly fromRunnerNotRegistered = (cause?: unknown) =>
    new ClusterError({ cause, reason: 'RunnerNotRegistered' });
  static readonly fromRunnerUnavailable = (entityId: string, cause?: unknown) =>
    new ClusterError({ cause, entityId, reason: 'RunnerUnavailable' });
  static readonly fromSendTimeout = (entityId: string, cause?: unknown) =>
    new ClusterError({ cause, entityId, reason: 'SendTimeout' });
  static readonly fromSuspended = (entityId: string, resumeToken: string) =>
    new ClusterError({ entityId, reason: 'Suspended', resumeToken });
  static readonly fromRpcClientError = (entityId: string, cause: unknown, requestId?: string) =>
    new ClusterError({ cause, entityId, reason: 'RpcClientError', requestId });
  static readonly fromSerializationError = (cause?: unknown) =>
    new ClusterError({ cause, reason: 'SerializationError' });
}

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
  entity: {
    concurrency: 1,
    mailboxCapacity: 100,  // Explicit capacity - prevents OOM
    maxIdleTime: Duration.minutes(5),
  },
  retry: {
    defect: {
      base: Duration.millis(100),
      factor: 2,
      maxAttempts: 5,  // For entity defect recovery
    },
    transient: {
      base: Duration.millis(50),
      maxAttempts: 3,  // For MailboxFull, SendTimeout
    },
  },
  sla: {
    sendTimeout: Duration.millis(100),  // ROADMAP: "Entity message sent on Pod A reaches handler on Pod B within 100ms"
  },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

// Handler interface covers all 11 ClusterError variants for Match.exhaustive
const _handleClusterError = <A>(error: ClusterError, handlers: {
  readonly onAlreadyProcessing: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onEntityNotAssigned: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onMailboxFull: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onMalformedMessage: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onPersistence: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onRunnerNotRegistered: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onRunnerUnavailable: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onSendTimeout: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onSuspended: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onRpcClientError: (e: ClusterError) => Effect.Effect<A, never, never>;
  readonly onSerializationError: (e: ClusterError) => Effect.Effect<A, never, never>;
}): Effect.Effect<A, never, never> => Match.value(error.reason).pipe(
  Match.when('AlreadyProcessingMessage', () => handlers.onAlreadyProcessing(error)),
  Match.when('EntityNotAssignedToRunner', () => handlers.onEntityNotAssigned(error)),
  Match.when('MailboxFull', () => handlers.onMailboxFull(error)),
  Match.when('MalformedMessage', () => handlers.onMalformedMessage(error)),
  Match.when('PersistenceError', () => handlers.onPersistence(error)),
  Match.when('RunnerNotRegistered', () => handlers.onRunnerNotRegistered(error)),
  Match.when('RunnerUnavailable', () => handlers.onRunnerUnavailable(error)),
  Match.when('SendTimeout', () => handlers.onSendTimeout(error)),
  Match.when('Suspended', () => handlers.onSuspended(error)),
  Match.when('RpcClientError', () => handlers.onRpcClientError(error)),
  Match.when('SerializationError', () => handlers.onSerializationError(error)),
  Match.exhaustive,
);

// Error tag for metrics labeling
const _errorTag = (error: ClusterError): string => error.reason;

// --- [SERVICES] --------------------------------------------------------------

// Service stub - full implementation in Plan 02
class _ClusterServiceImpl extends Effect.Service<_ClusterServiceImpl>()('server/Cluster', {
  effect: Effect.gen(function* () {
    // Dependencies will be added in Plan 02
    return {
      broadcast: (_entityType: string, _request: unknown): Effect.Effect<void, ClusterError, never> =>
        Effect.fail(ClusterError.fromRunnerNotRegistered(new Error('Not implemented'))),
      isLocal: (_entityId: string): Effect.Effect<boolean, never, never> =>
        Effect.succeed(false),
      send: <R>(_entityId: string, _request: R): Effect.Effect<void, ClusterError, never> =>
        Effect.fail(ClusterError.fromRunnerNotRegistered(new Error('Not implemented'))),
    };
  }),
}) {}

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const ClusterService = {
  Config: _CONFIG,
  Error: ClusterError,
  errorTag: _errorTag,
  handleError: _handleClusterError,
  // Payload schemas for external use
  Payload: {
    Process: ProcessPayload,
    Status: StatusPayload,
  },
  Response: {
    Status: StatusResponse,
  },
  // Service implementation access
  Service: _ClusterServiceImpl,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace ClusterService {
  export type Error = InstanceType<typeof ClusterError>;
  export type ErrorReason = Error['reason'];
  export type Config = typeof _CONFIG;
  export type IdempotencyKey = typeof IdempotencyKey.Type;
  export type SnowflakeId = typeof SnowflakeId.Type;
  export type ProcessPayload = InstanceType<typeof ClusterService.Payload.Process>;
  export type StatusPayload = InstanceType<typeof ClusterService.Payload.Status>;
  export type StatusResponse = InstanceType<typeof ClusterService.Response.Status>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { ClusterService };
