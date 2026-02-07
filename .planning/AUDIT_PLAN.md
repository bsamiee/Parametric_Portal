# BACKEND AUDIT IMPLEMENTATION PLAN — SOURCE OF TRUTH

> ALL AGENTS MUST READ THIS BEFORE STARTING WORK. No freelancing — implement exactly what is specified.

---

## QUALITY STANDARDS (QA ENFORCEMENT)

### FORBIDDEN
- `if` statements → ternary (binary), Match.type/Match.value (exhaustive), Effect control flow
- Module-level type definitions → derive from schemas (`type X = typeof Schema.Type`), inline at call sites
- Single-use functions/constants/helpers → inline into caller
- `any` type → branded types via Schema
- `let`/`var` → `const` only
- `for`/`while` loops → `.map`, `.filter`, `Effect.forEach`
- `try/catch` → Effect error channel
- Default exports → named exports (except `*.config.ts`)
- Barrel files (`index.ts`) → import from source
- Inline exports → declare first, export at file end
- `Function as F` or similar aliasing → inline
- `Boolean.match` when ternary suffices
- Manual `_tag` checks → `Effect.catchTag`
- `JSON.stringify`/`JSON.parse` for Effect schemas → `Schema.encode`/`Schema.decode`
- Raw `fetch()` → `HttpClient` from `@effect/platform`
- `process.env` → Effect `Config`
- `Object.freeze` → `as const`

### REQUIRED
- Maximum Effect library utilization — prefer `@effect/*` over hand-rolling
- Polymorphic functions — single function handles all arities
- Schema-first types — derive, validate at boundaries only
- Section separators (`// --- [LABEL]`) and canonical file order: Types → Schema → Constants → Errors → Services → Functions → Layers → Export
- Tab indentation throughout
- Naming: no 1-3 letter abbreviations for params/fields (import aliases like `S` are OK)
- `Effect.catchTag` for all error matching
- `Schema.encode`/`Schema.decode` at boundaries
- `Data.TaggedError` for domain errors, `Schema.TaggedError` when crossing boundaries
- `pipe()` for linear flows, `Effect.gen` for 3+ dependent operations
- `Effect.all` for independent aggregation

### TELEMETRY NOTE
We use `Telemetry.span` as our tracing pattern — NOT `Effect.fn`. Do NOT convert existing Telemetry.span to Effect.fn. In Phase 5 we may enhance Telemetry.span integration.

---

## PHASE 1: CRITICAL (Runtime / Data Loss / Security)

### P1-T1: Database Schema Fixes
**Findings:** C1, C2, C3, G9
**Files:** `packages/database/migrations/0001_initial.ts`, `packages/database/src/models.ts`, `packages/database/src/repos.ts`
**Scope:**
- C1: Fix `assets.hash` — DDL says NOT NULL but model + CHECK assume nullable. Align: make column nullable OR fix CHECK.
- C2: Add `ValidationFailed` to `job_dlq` `errorReason` CHECK constraint so INSERT succeeds.
- C3: Expand `audit_logs` `operation` CHECK to include ALL app-written values: `sign`, `upload`, `enroll`, `disable`, plus any others found in codebase.
- G9: Change `JobDlq.errorReason` from `S.String` to `S.Literal(...)` matching the expanded CHECK values.

### P1-T2: Crypto Key Rotation + Redacted
**Findings:** C4, G13
**Files:** `packages/server/src/security/crypto.ts`
**Scope:**
- C4: Implement key rotation — version-based keys, key ID embedded in ciphertext envelope, re-encryption workflow.
- G13: Wrap `Crypto.pair` token output in `Redacted<string>` from Effect.

### P1-T3: WebSocket Cross-Pod Broadcast
**Findings:** C5
**Files:** `packages/server/src/infra/cluster.ts` (RPC/pub-sub), websocket file
**Scope:**
- C5: Fix broadcast to deliver messages across pods via Redis pub/sub — not just local `socketsRef` iteration. Use existing CacheService pub/sub channel if available, or add one.

### P1-T4: Middleware Tenant Validation
**Findings:** C6
**Files:** `packages/server/src/middleware.ts`
**Scope:**
- C6: Reject requests with missing `X-App-Id` header with `400 Bad Request`. NEVER silently default to a tenant — this is a data leakage vector.

### P1-QA: Quality Assurance Phase 1
**Scope:** Review ALL Phase 1 changes against quality standards above. Verify:
- No `if` statements introduced
- No module-level type spam
- No single-use helpers/consts
- Effect patterns correct (catchTag, Schema.encode, pipe/gen)
- Schema-first approach
- Strict adherence to finding specifications — nothing extra, nothing missing

---

## PHASE 2: HIGH (Pre-Production Gaps)

### P2-T1: Jobs Infrastructure
**Findings:** H1, H2, H3 (jobs side)
**Files:** `packages/server/src/infra/jobs.ts`
**Scope:**
- H1: Add scheduled job purge — cleanup completed/failed jobs after configurable TTL.
- H2: Add automatic DLQ watcher — periodic check + retry/alert mechanism (not manual-only).
- H3: Accept `requestId`/`ipAddress`/`userAgent` in job payloads for audit correlation.

### P2-T2: Context + Events Correlation
**Findings:** H3 (context side), H4
**Files:** `packages/server/src/context.ts`, `packages/server/src/infra/events.ts`
**Scope:**
- H3: Propagate `requestId`/`ipAddress`/`userAgent` from request context into job creation calls.
- H4: Auto-populate `correlationId` from request context when emitting events.

### P2-T3: Auth Session Limits + Rate Limiting
**Findings:** H5, H6
**Files:** `packages/server/src/domain/auth.ts`
**Scope:**
- H5: Enforce configurable max concurrent sessions per user. Evict oldest on overflow.
- H6: Add OAuth login failure rate limiting — extend ReplayGuard pattern or add dedicated limiter.

### P2-T4: WebSocket Stale Detection + Presence Dedup
**Findings:** H7, H8
**Files:** WebSocket file in `packages/server/src/`
**Scope:**
- H7: Add pong tracking + stale connection reaper (configurable timeout).
- H8: Remove presence tracking from WebSocketService — consolidate exclusively in CacheService.

### P2-T5: Cache Redis Cluster/Sentinel
**Findings:** H9
**Files:** `packages/server/src/platform/cache.ts`
**Scope:**
- H9: Add Redis Cluster/Sentinel mode support. Use Effect Config for mode selection. Ensure all cache operations work in both standalone and cluster mode.

### P2-T6: Purge Effect Config
**Findings:** H10
**Files:** Purge-related file in `packages/server/src/infra/`
**Scope:**
- H10: Replace ALL `process.env` usage with Effect `Config`. This is the only file violating typed config — align with codebase standard.

### P2-QA: Quality Assurance Phase 2
**Scope:** Same criteria as Phase 1 QA, applied to all Phase 2 changes.

---

## PHASE 3: ANTI-PATTERNS

### P3-T1: Observe Cleanup
**Findings:** A1 (audit.ts), A8, A9
**Files:** `packages/server/src/observe/audit.ts`, `packages/server/src/observe/polling.ts`, telemetry files
**Scope:**
- A1: Remove `Function as F` import from `audit.ts` — inline the usage.
- A8: Fix telemetry silent context degradation — `catchAll` on context failure produces incomplete traces. Either propagate the error or use a proper fallback that preserves trace integrity.
- A9: Deduplicate system context wrapping in `polling.ts` — 4x identical code → extract once or refactor to eliminate repetition.

### P3-T2: Utils Cleanup
**Findings:** A1 (transfer.ts), A6
**Files:** `packages/server/src/utils/transfer.ts`, `packages/server/src/utils/circuit.ts`
**Scope:**
- A1: Remove `Function as F` import from `transfer.ts` — inline the usage.
- A6: Remove `_UnknownCause` dead code from `circuit.ts`.

### P3-T3: WebSocket CacheService Wrappers
**Findings:** A2
**Files:** WebSocket file
**Scope:**
- A2: Replace all direct `Effect.tryPromise(() => redis.*)` calls with CacheService wrapper methods.

### P3-T4: Telemetry HttpClient
**Findings:** A3
**Files:** Telemetry route/file using raw `fetch()`
**Scope:**
- A3: Replace raw `fetch()` with `HttpClient` from `@effect/platform`.

### P3-T5: Transfer Route Extraction
**Findings:** A4
**Files:** `apps/api/src/routes/transfer.ts` → new `packages/server/src/domain/transfer.ts` (or `utils/`)
**Scope:**
- A4: Extract 290 lines of business logic from transfer route into a proper TransferService in `packages/server`. Route should only handle HTTP concerns.

### P3-T6: Route Error Matching + Health
**Findings:** A5, A7
**Files:** `apps/api/src/routes/*.ts` (all route files)
**Scope:**
- A5: Replace ALL manual `_tag` checks with `Effect.catchTag` across every route handler.
- A7: Replace `Boolean.match` with ternary in `health.ts` (remove the only usage of Boolean module import).

### P3-T7: Cache Schema.encode
**Findings:** A10
**Files:** `packages/server/src/platform/cache.ts`
**Scope:**
- A10: Replace `JSON.stringify` with `Schema.encode` for all cache value serialization. Use `Schema.decode` for deserialization.

### P3-QA: Quality Assurance Phase 3
**Scope:** Same criteria. Additionally verify all anti-patterns are fully eliminated — not partially fixed.

---

## PHASE 4: GAPS (Missing Functionality)

### P4-T1: Job Repo Enhancement
**Findings:** G8
**Files:** `packages/database/src/repos.ts`
**Scope:** Add to job repository: batch insert, deduplication check, status query methods. Polymorphic — single method per operation handling scalar and array inputs.

### P4-T2: Client.listen LISTEN/NOTIFY
**Findings:** G10
**Files:** `packages/database/src/` (extend client or new module)
**Scope:** Add PostgreSQL LISTEN/NOTIFY stream capability. Return an Effect `Stream` of notifications. Use for real-time event propagation.

### P4-T3: Event Replay
**Findings:** G11
**Files:** `packages/server/src/infra/events.ts`
**Scope:** Add event replay mechanism — ability to replay events from a timestamp or sequence number. Integrate with event store.

### P4-T4: Webhook Ownership Verification
**Findings:** G14
**Files:** `packages/server/src/infra/webhooks.ts`
**Scope:** Add challenge-response endpoint ownership verification before activating webhook subscriptions.

### P4-T5: Asset CRUD Routes
**Findings:** G1
**Files:** `apps/api/src/routes/storage.ts` (extend) or new route
**Scope:** Add individual asset CRUD — create, read, update, delete single assets. Currently only bulk transfer exists.

### P4-T6: User Self-Service Routes
**Findings:** G2
**Files:** `apps/api/src/routes/users.ts`
**Scope:** Add profile update and account deactivation endpoints for authenticated users.

### P4-T7: Auth Account Management
**Findings:** G3, G4
**Files:** Auth-related route files
**Scope:**
- G3: OAuth account linking/unlinking endpoints.
- G4: API key rotation endpoint.

### P4-T8: Tenant Management
**Findings:** G5, G6
**Files:** `apps/api/src/routes/admin.ts` or new tenant route
**Scope:**
- G5: Per-tenant OAuth provider configuration endpoints.
- G6: App/tenant management CRUD.

### P4-T9: Storage Listing
**Findings:** G7
**Files:** `apps/api/src/routes/storage.ts`
**Scope:** Add storage listing/browsing endpoint with pagination, filtering.

### P4-T10: WebAuthn/FIDO2 MFA
**Findings:** G12
**Files:** `packages/server/src/domain/auth.ts` (extend) or new module
**Scope:** Add WebAuthn/FIDO2/passkey MFA support. Integrate with existing auth flow. Use `@simplewebauthn/server` or similar.

### P4-QA: Quality Assurance Phase 4
**Scope:** Same criteria. Verify new endpoints follow existing patterns, schemas are derived not declared, polymorphic where possible.

---

## PHASE 5: OPPORTUNITIES (Full Effect Integration)

### P5-T1: @effect/workflow Full Integration
**Findings:** O1
**Files:** `packages/server/src/infra/jobs.ts` + related
**Scope:** FULL REFACTOR — Expand `@effect/workflow` beyond webhooks to all job types. Durable workflows with compensation, retry, and state persistence. This is not incremental — redesign job execution around workflow primitives.

### P5-T2: Machine + STM/TMap WebSocket Refactor
**Findings:** O2, O5
**Files:** WebSocket file
**Scope:** FULL REFACTOR:
- O2: Rewrite WebSocket connection lifecycle as `@effect/experimental` Machine state machine (states: connecting, authenticated, active, stale, disconnecting).
- O5: Replace `Ref<HashMap>` socket map with `STM/TMap` for proper concurrent access.

### P5-T3: VariantSchema Integration
**Findings:** O3
**Files:** `packages/database/src/models.ts`, schema files in `packages/server/src/`
**Scope:** FULL REFACTOR — Convert discriminated union schemas to `@effect/experimental` `VariantSchema`. Consolidate scattered schema definitions into focused VariantSchema per domain. Goal: fewer standalone schemas, more unified variant-based definitions. Remove as many individual Schema definitions as possible.

### P5-T4: @effect/rpc Expansion
**Findings:** O4
**Files:** `packages/server/src/infra/cluster.ts` + related
**Scope:** FULL REFACTOR — Expand `@effect/rpc` beyond entity RPCs to cover all inter-node operations. Proper RPC definitions with schemas, error types, and tagged services.

### P5-T5: PersistedCache Session Caching
**Findings:** O8
**Files:** `packages/server/src/domain/auth.ts`, `packages/server/src/platform/cache.ts`
**Scope:** Implement `PersistedCache` from Effect for session lookups. Eliminate per-request DB hits for session validation. Cache invalidation on session changes.

### P5-QA: Quality Assurance Phase 5
**Scope:** Comprehensive review of all refactors. Verify full integration of Effect capabilities — not partial adoption. Verify Machine states are exhaustive, VariantSchema covers all variants, RPC definitions are complete, PersistedCache invalidation is correct.

---

## PHASE DEPENDENCIES

```
Phase 1 impl → Phase 1 QA → Phase 2 impl → Phase 2 QA → Phase 3 impl → ...
```

- Phase N QA is blocked by ALL Phase N implementation tasks
- Phase N+1 implementation tasks are blocked by Phase N QA
- Within a phase, all implementation tasks run in PARALLEL (no shared files)

## FILE OWNERSHIP RULES

- ONE agent per file at any given time
- Agents claim files at task start — no competing edits
- If a file needs changes in multiple phases, different agents handle it sequentially
- Cross-file consistency is verified by QA agents

## EXCLUDED FROM IMPLEMENTATION

- O6 (Effect.fn) — We use Telemetry.span; will enhance in telemetry.ts but not replace
- O7 (@effect/platform KeyValueStore) — Not needed
- ioredis abstraction — Not needed
