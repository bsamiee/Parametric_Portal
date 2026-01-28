# Effect-TS Error Architecture: A Comprehensive Guide

## Table of Contents
1. [Error Creation Primitives](#1-error-creation-primitives)
2. [The Error Taxonomy](#2-the-error-taxonomy)
3. [Advanced Composition Patterns](#3-advanced-composition-patterns)
4. [Multi-Layer Architecture](#4-multi-layer-architecture)
5. [Practical Patterns](#5-practical-patterns)
6. [Your Refactored Architecture](#6-your-refactored-architecture)

---
## 1. Error Creation Primitives

### 1.1 Data.TaggedError (Effect Core)
```typescript
import { Data } from 'effect';

class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url: string;
  readonly status: number;
}> {
  override get message() { return `Network failed: ${this.url} (${this.status})`; }
  get isRetryable() { return this.status >= 500; }
}
```

**Characteristics**:
- Structural equality (two errors with same data are `Equal.equals`)
- Immutable (via Data semantics)
- `_tag` discriminant for pattern matching
- Extends `Error` (has stack trace)
- **Not serializable** without explicit handling

**Use case**: Internal domain errors, infrastructure errors, anything that doesn't cross process boundaries.

---
### 1.2 Schema.TaggedError (Effect Schema)
```typescript
import { Schema as S } from 'effect';
import { HttpApiSchema } from '@effect/platform';

// Serializable + HTTP metadata
class NotFoundError extends S.TaggedError<NotFoundError>()('NotFound', {
  resource: S.String,
  id: S.String,
  timestamp: S.DateFromNumber,  // Transforms work!
}, HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })) {
  static readonly of = (resource: string, id: string) => 
    new NotFoundError({ resource, id, timestamp: new Date() });
}
```

**Characteristics**:
- **Serializable** (can encode/decode to JSON)
- Schema validation on construction
- Transform support (DateFromNumber, etc.)
- Annotation support for HTTP/OpenAPI
- Type-safe encode/decode
- **Heavier** than Data.TaggedError

**Use case**: API boundaries, anything that crosses process/network boundaries.

---
### 1.3 Cause<E> - The Error Container
```typescript
import { Cause, Effect } from 'effect';

// Cause is how Effect represents ALL failure modes
type MyCause = 
  | Cause.Fail<MyError>      // Expected failure (E channel)
  | Cause.Die                 // Unexpected defect (never recoverable normally)
  | Cause.Interrupt           // Fiber interruption
  | Cause.Sequential          // Multiple causes in sequence
  | Cause.Parallel            // Multiple causes in parallel
  | Cause.Empty               // No cause
```

**Critical distinction**:
- `Effect.fail(error)` → Expected failure, typed in E channel
- `Effect.die(defect)` → Unexpected defect, NOT in E channel
- `Effect.orDie` → Converts E to defect (removes from type)

---
## 2. The Error Taxonomy

### 2.1 Expected vs Unexpected (Failures vs Defects)

```typescript
// EXPECTED: Part of your API contract, recoverable
// These go in the E channel
type Expected = 
  | ValidationError      // Bad input
  | NotFoundError        // Resource doesn't exist  
  | ConflictError        // Business rule violation
  | AuthError            // Authentication/authorization

// UNEXPECTED: Should never happen, bugs
// These are defects (die)
type Defect =
  | NullPointerAccess    // Programming error
  | InvalidState         // Invariant violation
  | ConfigurationError   // Deployment error
```

**Rule**: If the caller can reasonably handle it → Expected (fail). If it's a bug → Defect (die).

---
### 2.2 Retryable vs Non-Retryable

```typescript
// Encode retry semantics in the type
interface RetryableError {
  readonly _retryable: true;
  readonly retryAfter?: Duration.Duration;
}
interface NonRetryableError {
  readonly _retryable: false;
}
// Use branded types for compile-time enforcement
class TransientNetworkError extends Data.TaggedError('TransientNetwork')<{
  readonly url: string;
  readonly _retryable: true;
}> {
  readonly _retryable = true as const;
}
class ValidationError extends Data.TaggedError('Validation')<{
  readonly field: string;
  readonly _retryable: false;
}> {
  readonly _retryable = false as const;
}

// Type-safe retry logic
const retryOnlyRetryable = <A, E extends { _retryable: boolean }, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry({
      while: (err): err is E & { _retryable: true } => err._retryable === true,
      schedule: Schedule.exponential('100 millis'),
    })
  );
```

---
### 2.3 Error Severity/Channels

```typescript
// Semantic severity as discriminant
type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

class DomainError<Tag extends string, Code extends string> extends Data.TaggedError(Tag)<{
  readonly code: Code;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly context?: Record<string, unknown>;
}> {}
```

---
## 3. Advanced Composition Patterns

### 3.1 Error Hierarchies via Discriminated Unions

```typescript
// Domain-specific error families
class UserNotFound extends Data.TaggedError('UserNotFound')<
  typeof BaseErrorFields & { readonly userId: string }
> {}

class UserSuspended extends Data.TaggedError('UserSuspended')<
  typeof BaseErrorFields & { readonly userId: string; readonly reason: string }
> {}

class UserQuotaExceeded extends Data.TaggedError('UserQuotaExceeded')<
  typeof BaseErrorFields & { readonly userId: string; readonly limit: number }
> {}

// Union type for the domain
type UserError = UserNotFound | UserSuspended | UserQuotaExceeded;

// Exhaustive handling
const handleUserError = (err: UserError): string =>
  Match.value(err).pipe(
    Match.tag('UserNotFound', (e) => `User ${e.userId} not found`),
    Match.tag('UserSuspended', (e) => `User ${e.userId} suspended: ${e.reason}`),
    Match.tag('UserQuotaExceeded', (e) => `User ${e.userId} over quota (${e.limit})`),
    Match.exhaustive,
  );
```

---
### 3.2 Error Aggregation (Parallel Failures)

```typescript
import { Cause, Effect } from 'effect';

// Collecting all errors, not just first
const validateAll = <A, E, R>(
  validations: ReadonlyArray<Effect.Effect<A, E, R>>
): Effect.Effect<ReadonlyArray<A>, ReadonlyArray<E>, R> =>
  Effect.all(validations, { mode: 'validate' });

// Accessing parallel causes
const inspectCause = <E>(cause: Cause.Cause<E>): ReadonlyArray<E> =>
  Cause.failures(cause); // Extracts all Fail<E> from the cause tree
```

---
### 3.3 Error Context Enrichment

```typescript
// Pattern: Wrap errors with context as they bubble up
const enrichWithContext = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  context: Record<string, unknown>
): Effect.Effect<A, E & { readonly context: Record<string, unknown> }, R> =>
  effect.pipe(
    Effect.mapError((err) => ({ ...err, context: { ...(err as any).context, ...context } }))
  );

// Or use Cause.annotate for non-destructive context
const annotateEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  annotation: unknown
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.tapErrorCause((cause) => Effect.sync(() => Cause.annotate(cause, annotation)))
  );
```

---
### 3.4 Error Transformers Across Layers

```typescript
// Infrastructure → Domain transformation
const infra2Domain = (err: InfrastructureError): DomainError =>
  Match.value(err).pipe(
    Match.tag('DatabaseConnectionError', () => DomainError.ServiceUnavailable()),
    Match.tag('NetworkTimeout', () => DomainError.ServiceUnavailable()),
    Match.tag('CacheError', () => DomainError.ServiceDegraded()),
    Match.exhaustive,
  );
// Domain → HTTP transformation  
const domain2Http = (err: DomainError): HttpError =>
  Match.value(err).pipe(
    Match.tag('NotFound', (e) => HttpError.NotFound.of(e.resource, e.id)),
    Match.tag('Validation', (e) => HttpError.Validation.of(e.field, e.details)),
    Match.tag('ServiceUnavailable', () => HttpError.ServiceUnavailable.of('Service temporarily unavailable', 5000)),
    Match.exhaustive,
  );
// Compose in middleware
const handleDomainErrors = <A, R>(
  effect: Effect.Effect<A, DomainError, R>
): Effect.Effect<A, HttpError, R> =>
  effect.pipe(Effect.mapError(domain2Http));
```

---
## 4. Multi-Layer Architecture

### 4.1 The Layer Cake

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP/API Layer                           │
│  Schema.TaggedError + HttpApiSchema annotations             │
│  (Serializable, status codes, OpenAPI)                      │
├─────────────────────────────────────────────────────────────┤
│                   Application Layer                         │
│  Data.TaggedError unions per use-case                       │
│  (Orchestration errors, workflow failures)                  │
├─────────────────────────────────────────────────────────────┤
│                    Domain Layer                             │
│  Data.TaggedError per aggregate/entity                      │
│  (Business rule violations, invariant failures)             │
├─────────────────────────────────────────────────────────────┤
│                 Infrastructure Layer                        │
│  Data.TaggedError per external system                       │
│  (Database, cache, network, filesystem)                     │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Error Flow

```typescript
// 1. Infrastructure throws its own errors
const queryUser = (id: string): Effect.Effect<User, DatabaseError | CacheError, Database> => ...

// 2. Domain catches and transforms
const getUser = (id: string): Effect.Effect<User, UserError, UserRepository> =>
  queryUser(id).pipe(
    Effect.catchTags({
      DatabaseError: (e) => e.code === 'NOT_FOUND' 
        ? Effect.fail(new UserNotFound({ userId: id }))
        : Effect.fail(new UserServiceError({ cause: e })),
      CacheError: () => queryUserFromDb(id), // Fallback
    })
  );

// 3. Application orchestrates
const createOrder = (userId: string, items: Item[]): Effect.Effect<Order, OrderError, Services> =>
  Effect.gen(function* () {
    const user = yield* getUser(userId).pipe(
      Effect.mapError((e) => new OrderError.InvalidUser({ cause: e }))
    );
    // ...
  });

// 4. HTTP transforms to response
const handleCreateOrder = HttpApiBuilder.handler(OrderApi, 'create', ({ payload }) =>
  createOrder(payload.userId, payload.items).pipe(
    Effect.mapError((e) => Match.value(e).pipe(
      Match.tag('InvalidUser', () => HttpError.Validation.of('userId', 'Invalid user')),
      Match.tag('InsufficientInventory', () => HttpError.Conflict.of('inventory', 'Insufficient stock')),
      Match.exhaustive,
    ))
  )
);
```

---
## 5. Practical Patterns

### 5.1 Error Factory with Metadata

```typescript
// Generic error factory with full metadata
const makeError = <Tag extends string>(tag: Tag) =>
  <Fields extends Record<string, unknown>>(defaults?: Partial<Fields>) =>
    class extends Data.TaggedError(tag)<Fields & {
      readonly timestamp: number;
      readonly traceId: Option.Option<string>;
    }> {
      static readonly of = (fields: Fields, traceId?: string) =>
        new this({
          ...defaults,
          ...fields,
          timestamp: Date.now(),
          traceId: Option.fromNullable(traceId),
        } as Fields & { timestamp: number; traceId: Option.Option<string> });
      override get message() {
        return `${tag}: ${JSON.stringify(this)}`;
      }
    };

// Usage
class NetworkError extends makeError('NetworkError')<{
  readonly url: string;
  readonly status: number;
}>({ status: 500 }) {}

const err = NetworkError.of({ url: '/api/users', status: 404 }, 'trace-123');
```

---
### 5.2 Type-Safe Error Codes

```typescript
// Phantom types for error codes
type ErrorCode<Domain extends string, Code extends string> = `${Domain}:${Code}`;

const makeCodedError = <
  Domain extends string,
  Codes extends readonly string[],
>(domain: Domain, codes: Codes) => {
  type Code = Codes[number];
  type FullCode = ErrorCode<Domain, Code>;
  return class extends Data.TaggedError(domain)<{
    readonly code: Code;
    readonly message: string;
    readonly context?: Record<string, unknown>;
  }> {
    get fullCode(): FullCode {
      return `${domain}:${this.code}` as FullCode;
    }
    static readonly codes = codes;
    static readonly is = (code: Code) => (err: unknown): boolean =>
      err instanceof this && err.code === code;
  };
};

// Usage
class UserError extends makeCodedError('User', [
  'NOT_FOUND',
  'SUSPENDED', 
  'QUOTA_EXCEEDED',
  'INVALID_EMAIL',
] as const) {}

const err = new UserError({ code: 'NOT_FOUND', message: 'User not found' });
// err.code is typed as 'NOT_FOUND' | 'SUSPENDED' | 'QUOTA_EXCEEDED' | 'INVALID_EMAIL'
// err.fullCode is 'User:NOT_FOUND'

// Type-safe checking
if (UserError.is('NOT_FOUND')(err)) {
  // err.code is narrowed to 'NOT_FOUND'
}
```

---
### 5.3 Hierarchical Error Namespaces

```typescript
// Build error hierarchies with namespaces
const Errors = {
  User: {
    NotFound: class extends Data.TaggedError('User.NotFound')<{ userId: string }> {},
    Suspended: class extends Data.TaggedError('User.Suspended')<{ userId: string; reason: string }> {},
    Quota: class extends Data.TaggedError('User.Quota')<{ userId: string; limit: number }> {},
  },
  Order: {
    NotFound: class extends Data.TaggedError('Order.NotFound')<{ orderId: string }> {},
    InvalidState: class extends Data.TaggedError('Order.InvalidState')<{ orderId: string; state: string }> {},
  },
  Infra: {
    Database: class extends Data.TaggedError('Infra.Database')<{ operation: string; cause?: unknown }> {},
    Cache: class extends Data.TaggedError('Infra.Cache')<{ key: string; operation: string }> {},
    Network: class extends Data.TaggedError('Infra.Network')<{ url: string; status: number }> {},
  },
} as const;

// Type extraction
type UserError = InstanceType<typeof Errors.User[keyof typeof Errors.User]>;
type OrderError = InstanceType<typeof Errors.Order[keyof typeof Errors.Order]>;
type InfraError = InstanceType<typeof Errors.Infra[keyof typeof Errors.Infra]>;
type AnyError = UserError | OrderError | InfraError;

// Usage
Effect.fail(new Errors.User.NotFound({ userId: '123' }));
```

---
### 5.4 Schema-Based HTTP Errors with Transforms

```typescript
import { Schema as S } from 'effect';
import { HttpApiSchema } from '@effect/platform';

// Reusable error schema components
const ErrorMeta = {
  timestamp: S.DateFromNumber,
  traceId: S.OptionFromNullOr(S.String),
  requestId: S.String,
};
// HTTP error with full metadata and transforms
class ApiValidationError extends S.TaggedError<ApiValidationError>()('Validation', {
  ...ErrorMeta,
  field: S.String,
  message: S.String,
  received: S.Unknown,
  expected: S.String,
}, HttpApiSchema.annotations({ status: 400 })) {
  static readonly of = (field: string, message: string, received: unknown, expected: string) =>
    new ApiValidationError({
      field,
      message,
      received,
      expected,
      timestamp: new Date(),
      traceId: Option.none(),
      requestId: crypto.randomUUID(),
    });
}
// Serialization works automatically
const encoded = S.encodeSync(ApiValidationError)(error);
// { _tag: 'Validation', timestamp: 1234567890, traceId: null, ... }
const decoded = S.decodeSync(ApiValidationError)(encoded);
// ApiValidationError instance with Date object for timestamp
```

---
### 5.5 Error Recovery Strategies

```typescript
// Define recovery strategies as data
type RecoveryStrategy<E, A, R> =
  | { readonly _tag: 'Retry'; readonly schedule: Schedule.Schedule<unknown, E, R> }
  | { readonly _tag: 'Fallback'; readonly value: A }
  | { readonly _tag: 'FallbackEffect'; readonly effect: Effect.Effect<A, never, R> }
  | { readonly _tag: 'Propagate' }
  | { readonly _tag: 'Die' };

const applyRecovery = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  strategy: RecoveryStrategy<E, A, R>
): Effect.Effect<A, E, R> =>
  Match.value(strategy).pipe(
    Match.tag('Retry', ({ schedule }) => Effect.retry(effect, { schedule })),
    Match.tag('Fallback', ({ value }) => Effect.orElseSucceed(effect, () => value)),
    Match.tag('FallbackEffect', ({ effect: fb }) => Effect.orElse(effect, () => fb)),
    Match.tag('Propagate', () => effect),
    Match.tag('Die', () => Effect.orDie(effect)),
    Match.exhaustive,
  );
// Attach strategy to error type
interface RecoverableError {
  readonly recovery: RecoveryStrategy<this, unknown, unknown>;
}
```

---
## 6. Your Refactored Architecture

Based on your multi-tenant monorepo needs:

### 6.1 Core Error Module Structure

```
packages/
  errors/                      # Shared error package
    src/
      base.ts                  # Base error factories
      http.ts                  # HTTP layer (Schema.TaggedError)
      domain.ts                # Domain errors (Data.TaggedError)
      infra.ts                 # Infrastructure (Data.TaggedError)
      transforms.ts            # Cross-layer transformations
```

### 6.2 Base Error Factory

```typescript
// packages/errors/src/base.ts
import { Data, Duration, Option } from 'effect';

// Shared metadata interface
interface ErrorMeta {
  readonly timestamp: number;
  readonly traceId: Option.Option<string>;
  readonly tenantId: Option.Option<string>;
}

// Base factory for all internal errors
export const makeInternalError = <Tag extends string>(tag: Tag) =>
  <Fields extends Record<string, unknown>>() =>
    class extends Data.TaggedError(tag)<Fields & ErrorMeta> {
      static readonly _tag = tag;
      
      static readonly make = (
        fields: Fields,
        meta?: { traceId?: string; tenantId?: string }
      ) => new this({
        ...fields,
        timestamp: Date.now(),
        traceId: Option.fromNullable(meta?.traceId),
        tenantId: Option.fromNullable(meta?.tenantId),
      } as Fields & ErrorMeta);
    };

// Retryable marker
export interface Retryable {
  readonly _retryable: true;
  readonly retryAfter?: Duration.Duration;
}

export interface NonRetryable {
  readonly _retryable: false;
}

export const isRetryable = (err: unknown): err is Retryable =>
  typeof err === 'object' && err !== null && '_retryable' in err && err._retryable === true;
```

### 6.3 Infrastructure Errors

```typescript
// packages/errors/src/infra.ts
import { Duration, Option } from 'effect';
import { makeInternalError, type Retryable, type NonRetryable } from './base.ts';

// Database errors
export class DatabaseConnectionError extends makeInternalError('Infra.Database.Connection')<{
  readonly host: string;
  readonly port: number;
  readonly cause?: unknown;
} & Retryable>() {
  readonly _retryable = true as const;
  readonly retryAfter = Duration.seconds(1);
}

export class DatabaseQueryError extends makeInternalError('Infra.Database.Query')<{
  readonly query: string;
  readonly cause?: unknown;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class DatabaseNotFoundError extends makeInternalError('Infra.Database.NotFound')<{
  readonly table: string;
  readonly id: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

// Cache errors
export class CacheConnectionError extends makeInternalError('Infra.Cache.Connection')<{
  readonly host: string;
  readonly cause?: unknown;
} & Retryable>() {
  readonly _retryable = true as const;
}

export class CacheMissError extends makeInternalError('Infra.Cache.Miss')<{
  readonly key: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

// Network errors  
export class NetworkTimeoutError extends makeInternalError('Infra.Network.Timeout')<{
  readonly url: string;
  readonly durationMs: number;
} & Retryable>() {
  readonly _retryable = true as const;
}

export class NetworkResponseError extends makeInternalError('Infra.Network.Response')<{
  readonly url: string;
  readonly status: number;
  readonly body?: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
  get isServerError() { return this.status >= 500; }
}

// Aggregate types
export type DatabaseError = DatabaseConnectionError | DatabaseQueryError | DatabaseNotFoundError;
export type CacheError = CacheConnectionError | CacheMissError;
export type NetworkError = NetworkTimeoutError | NetworkResponseError;
export type InfraError = DatabaseError | CacheError | NetworkError;
```

### 6.4 Domain Errors

```typescript
// packages/errors/src/domain.ts
import { makeInternalError, type NonRetryable } from './base.ts';

// User domain
export class UserNotFoundError extends makeInternalError('Domain.User.NotFound')<{
  readonly userId: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class UserSuspendedError extends makeInternalError('Domain.User.Suspended')<{
  readonly userId: string;
  readonly reason: string;
  readonly until?: Date;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class UserQuotaExceededError extends makeInternalError('Domain.User.QuotaExceeded')<{
  readonly userId: string;
  readonly resource: string;
  readonly limit: number;
  readonly current: number;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

// Auth domain
export class AuthInvalidCredentialsError extends makeInternalError('Domain.Auth.InvalidCredentials')<{
  readonly method: 'password' | 'token' | 'oauth';
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class AuthSessionExpiredError extends makeInternalError('Domain.Auth.SessionExpired')<{
  readonly sessionId: string;
  readonly expiredAt: Date;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class AuthMfaRequiredError extends makeInternalError('Domain.Auth.MfaRequired')<{
  readonly userId: string;
  readonly methods: ReadonlyArray<'totp' | 'sms' | 'email'>;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

// Tenant domain
export class TenantNotFoundError extends makeInternalError('Domain.Tenant.NotFound')<{
  readonly tenantId: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

export class TenantSuspendedError extends makeInternalError('Domain.Tenant.Suspended')<{
  readonly tenantId: string;
  readonly reason: string;
} & NonRetryable>() {
  readonly _retryable = false as const;
}

// Aggregate types
export type UserError = UserNotFoundError | UserSuspendedError | UserQuotaExceededError;
export type AuthError = AuthInvalidCredentialsError | AuthSessionExpiredError | AuthMfaRequiredError;
export type TenantError = TenantNotFoundError | TenantSuspendedError;
export type DomainError = UserError | AuthError | TenantError;
```

### 6.5 HTTP Errors (API Boundary)

```typescript
// packages/errors/src/http.ts
import { Schema as S, Option } from 'effect';
import { HttpApiSchema } from '@effect/platform';

// Shared HTTP error metadata
const HttpErrorMeta = {
  timestamp: S.DateFromNumber,
  requestId: S.String,
  traceId: S.OptionFromNullOr(S.String),
};

// 400 Bad Request
export class HttpValidationError extends S.TaggedError<HttpValidationError>()('Validation', {
  ...HttpErrorMeta,
  field: S.String,
  message: S.String,
  received: S.optional(S.Unknown),
}, HttpApiSchema.annotations({ status: 400, description: 'Validation failed' })) {
  static readonly of = (field: string, message: string, requestId: string, received?: unknown) =>
    new HttpValidationError({ field, message, requestId, received, timestamp: new Date(), traceId: Option.none() });
}

// 401 Unauthorized  
export class HttpAuthError extends S.TaggedError<HttpAuthError>()('Auth', {
  ...HttpErrorMeta,
  reason: S.Literal('invalid_token', 'expired_token', 'missing_token', 'invalid_credentials'),
}, HttpApiSchema.annotations({ status: 401, description: 'Authentication required' })) {
  static readonly of = (reason: HttpAuthError['reason'], requestId: string) =>
    new HttpAuthError({ reason, requestId, timestamp: new Date(), traceId: Option.none() });
}

// 403 Forbidden
export class HttpForbiddenError extends S.TaggedError<HttpForbiddenError>()('Forbidden', {
  ...HttpErrorMeta,
  reason: S.String,
  requiredPermission: S.optional(S.String),
}, HttpApiSchema.annotations({ status: 403, description: 'Access denied' })) {
  static readonly of = (reason: string, requestId: string, requiredPermission?: string) =>
    new HttpForbiddenError({ reason, requestId, requiredPermission, timestamp: new Date(), traceId: Option.none() });
}

// 404 Not Found
export class HttpNotFoundError extends S.TaggedError<HttpNotFoundError>()('NotFound', {
  ...HttpErrorMeta,
  resource: S.String,
  id: S.optional(S.String),
}, HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })) {
  static readonly of = (resource: string, requestId: string, id?: string) =>
    new HttpNotFoundError({ resource, requestId, id, timestamp: new Date(), traceId: Option.none() });
}

// 409 Conflict
export class HttpConflictError extends S.TaggedError<HttpConflictError>()('Conflict', {
  ...HttpErrorMeta,
  resource: S.String,
  reason: S.String,
}, HttpApiSchema.annotations({ status: 409, description: 'Resource conflict' })) {
  static readonly of = (resource: string, reason: string, requestId: string) =>
    new HttpConflictError({ resource, reason, requestId, timestamp: new Date(), traceId: Option.none() });
}

// 429 Rate Limit
export class HttpRateLimitError extends S.TaggedError<HttpRateLimitError>()('RateLimit', {
  ...HttpErrorMeta,
  retryAfterMs: S.Number,
  limit: S.Number,
  remaining: S.Number,
  resetAt: S.DateFromNumber,
}, HttpApiSchema.annotations({ status: 429, description: 'Rate limit exceeded' })) {
  static readonly of = (retryAfterMs: number, limit: number, remaining: number, resetAt: Date, requestId: string) =>
    new HttpRateLimitError({ retryAfterMs, limit, remaining, resetAt, requestId, timestamp: new Date(), traceId: Option.none() });
}

// 500 Internal
export class HttpInternalError extends S.TaggedError<HttpInternalError>()('Internal', {
  ...HttpErrorMeta,
  message: S.String,
  code: S.optional(S.String),
}, HttpApiSchema.annotations({ status: 500, description: 'Internal server error' })) {
  static readonly of = (message: string, requestId: string, code?: string) =>
    new HttpInternalError({ message, requestId, code, timestamp: new Date(), traceId: Option.none() });
}

// 503 Service Unavailable
export class HttpServiceUnavailableError extends S.TaggedError<HttpServiceUnavailableError>()('ServiceUnavailable', {
  ...HttpErrorMeta,
  reason: S.String,
  retryAfterMs: S.Number,
}, HttpApiSchema.annotations({ status: 503, description: 'Service unavailable' })) {
  static readonly of = (reason: string, retryAfterMs: number, requestId: string) =>
    new HttpServiceUnavailableError({ reason, retryAfterMs, requestId, timestamp: new Date(), traceId: Option.none() });
}

// Aggregate
export type HttpError =
  | HttpValidationError
  | HttpAuthError
  | HttpForbiddenError
  | HttpNotFoundError
  | HttpConflictError
  | HttpRateLimitError
  | HttpInternalError
  | HttpServiceUnavailableError;
```

### 6.6 Cross-Layer Transformers

```typescript
// packages/errors/src/transforms.ts
import { Match, Effect } from 'effect';
import type { InfraError, DomainError } from './index.ts';
import * as Http from './http.ts';

// Infrastructure → Domain (not usually needed, domain catches specific infra errors)

// Domain → HTTP
export const domainToHttp = (err: DomainError, requestId: string): Http.HttpError =>
  Match.value(err).pipe(
    // User errors
    Match.tag('Domain.User.NotFound', (e) => Http.HttpNotFoundError.of('user', requestId, e.userId)),
    Match.tag('Domain.User.Suspended', (e) => Http.HttpForbiddenError.of(`Account suspended: ${e.reason}`, requestId)),
    Match.tag('Domain.User.QuotaExceeded', (e) => Http.HttpRateLimitError.of(60000, e.limit, 0, new Date(Date.now() + 60000), requestId)),
    // Auth errors
    Match.tag('Domain.Auth.InvalidCredentials', () => Http.HttpAuthError.of('invalid_credentials', requestId)),
    Match.tag('Domain.Auth.SessionExpired', () => Http.HttpAuthError.of('expired_token', requestId)),
    Match.tag('Domain.Auth.MfaRequired', () => Http.HttpForbiddenError.of('MFA verification required', requestId)),
    // Tenant errors
    Match.tag('Domain.Tenant.NotFound', (e) => Http.HttpNotFoundError.of('tenant', requestId, e.tenantId)),
    Match.tag('Domain.Tenant.Suspended', (e) => Http.HttpForbiddenError.of(`Tenant suspended: ${e.reason}`, requestId)),
    Match.exhaustive,
  );

// Infrastructure → HTTP (for unhandled infra errors bubbling to API)
export const infraToHttp = (err: InfraError, requestId: string): Http.HttpError =>
  Match.value(err).pipe(
    // Database errors
    Match.tag('Infra.Database.Connection', () => Http.HttpServiceUnavailableError.of('Database unavailable', 5000, requestId)),
    Match.tag('Infra.Database.Query', () => Http.HttpInternalError.of('Database error', requestId, 'DB_QUERY')),
    Match.tag('Infra.Database.NotFound', (e) => Http.HttpNotFoundError.of(e.table, requestId, e.id)),
    // Cache errors - usually not exposed, degrade gracefully
    Match.tag('Infra.Cache.Connection', () => Http.HttpServiceUnavailableError.of('Service degraded', 1000, requestId)),
    Match.tag('Infra.Cache.Miss', () => Http.HttpInternalError.of('Cache miss', requestId, 'CACHE_MISS')),
    // Network errors
    Match.tag('Infra.Network.Timeout', (e) => Http.HttpServiceUnavailableError.of(`Upstream timeout: ${e.url}`, 5000, requestId)),
    Match.tag('Infra.Network.Response', (e) => 
      e.isServerError 
        ? Http.HttpServiceUnavailableError.of('Upstream error', 5000, requestId)
        : Http.HttpInternalError.of(`Upstream responded ${e.status}`, requestId, 'UPSTREAM')
    ),
    Match.exhaustive,
  );

// Effect transformer helper
export const mapDomainErrorToHttp = <A, R>(requestId: string) =>
  <E extends DomainError>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Http.HttpError, R> =>
    effect.pipe(Effect.mapError((e) => domainToHttp(e, requestId)));

export const mapInfraErrorToHttp = <A, R>(requestId: string) =>
  <E extends InfraError>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Http.HttpError, R> =>
    effect.pipe(Effect.mapError((e) => infraToHttp(e, requestId)));
```

---

## Summary: Key Principles

1. **Layer separation**: Infrastructure → Domain → Application → HTTP
2. **Use the right primitive**:
   - `Data.TaggedError` for internal errors
   - `Schema.TaggedError` for API boundaries
3. **Encode semantics in types**: Retryable, severity, recovery strategy
4. **Transform at boundaries**: Don't leak layer-specific errors
5. **Aggregate with union types**: Enable exhaustive `Match` handling
6. **Metadata everywhere**: timestamp, traceId, tenantId
7. **Static factories**: `.of()` or `.make()` for ergonomic construction

Your current approach is *directionally correct* but lacks the systematic layering. The refactored architecture gives you:
- Type-safe exhaustive error handling
- Clear transformation points between layers  
- Reusable error primitives across hundreds of apps
- Serialization only where needed (HTTP boundary)
- Full observability metadata by default