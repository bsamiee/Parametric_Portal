# Codebase Concerns

**Analysis Date:** 2025-02-13

## Test Coverage Gaps

**Database layer untested:**
- What's not tested: Factory `resolve()` polymorphic queries, predicate matching, JSONB operations
- Files: `packages/database/src/factory.ts` (506 lines), `packages/database/src/repos.ts` (282 lines)
- Risk: Schema validation mismatch between client and database query results; silent null coercion
- Priority: High

**Search ranking system untested:**
- What's not tested: RRF (reciprocal rank fusion) weighting, semantic vector scoring, trigram similarity thresholds
- Files: `packages/database/src/search.ts` (304 lines)
- Risk: Search quality degradation undetected; miscalibrated weights harm relevance
- Priority: High

**DLQ replay and event sourcing untested:**
- What's not tested: Job workflow state transitions, DLQ watcher auto-replay logic, event persistence race conditions
- Files: `packages/server/src/infra/jobs.ts` (576 lines), `packages/server/src/infra/events.ts` (319 lines)
- Risk: Lost jobs, duplicate processing, event journal corruption
- Priority: High

**WebSocket rooms and presence untested:**
- What's not tested: Cross-instance broadcast, room join/leave consistency, presence staleness cleanup
- Files: `packages/server/src/platform/websocket.ts` (361 lines)
- Risk: Orphaned room state on pod failure; stale presence metadata
- Priority: Medium

**OAuth flow edge cases untested:**
- What's not tested: State rotation on refresh, provider capability fallback, MFA enrollment during OAuth handshake
- Files: `packages/server/src/domain/auth.ts` (502 lines)
- Risk: Silent auth bypass in edge cases, token refresh loops
- Priority: High

**Test file count:** 9 files total (9 test suites)
**Active src coverage:** ~15 packages / 46 active source files ≈ ~19% coverage by file count
**Explicit coverage:** Only utility functions (`crypto.spec.ts`, `diff.spec.ts`, `transfer.spec.ts`, `resilience.spec.ts`) + minimal integration tests

---

## Large File Complexity

**`packages/server/src/api.ts` (970 lines):**
- Issue: Single monolithic HTTP API group definition with 50+ endpoints
- Files: `packages/server/src/api.ts`
- Impact: Hard to locate endpoints; difficult to add/modify error handling across groups; no logical separation
- Fix approach: Refactor into smaller group files (`auth-group.ts`, `admin-group.ts`, etc.); export and compose in api.ts

**`packages/components/src/schema.ts` (927 lines):**
- Issue: All component schemas in one file; interdependent variant definitions
- Files: `packages/components/src/schema.ts`
- Impact: Merge conflicts on schema changes; slow IDE type checking; tight coupling
- Fix approach: Split by domain (`button-schema.ts`, `form-schema.ts`, etc.); use barrel re-export

**`packages/database/src/factory.ts` (506 lines):**
- Issue: Polymorphic repo factory with 3+ type levels (`Pred`, `Config`, `_ResolverSurface`)
- Files: `packages/database/src/factory.ts`
- Impact: Type inference sprawl; difficult to add new repo operations; hard to debug predicate parsing
- Fix approach: Extract predicate builder into separate module; document type relationships with examples

**`packages/infra/jobs.ts` (576 lines):**
- Issue: Job lifecycle + DLQ watcher + entity sharding state machine in single file
- Files: `packages/server/src/infra/jobs.ts`
- Impact: Interdependent concerns (workflow, entity, watcher); hard to reason about state transitions
- Fix approach: Extract DLQ watcher into separate service; consider jobs and cluster orchestration as separate layers

**`packages/components/src/selection.ts` (784 lines):**
- Issue: Selection state machine with multi-select, range, and keyboard logic interleaved
- Files: `packages/components/src/selection.ts`
- Impact: State explosion risk; keyboard handling hard to test; edge cases in interaction model
- Fix approach: Separate keyboard handler, range logic, and state machine into distinct modules

---

## Error Handling & Observability

**Unstructured async error handling in JSON.parse sites:**
- Issue: 5+ locations use JSON.parse with Either.try but no context on parsing failure
- Files: `packages/server/src/utils/transfer.ts` (line 55), `packages/server/src/middleware.ts`, `packages/server/src/platform/streaming.ts`, `packages/server/src/security/policy.ts`
- Impact: Malformed JSON silently becomes `Parse[INVALID_RECORD]`; hard to debug client payload issues
- Fix approach: Wrap JSON.parse in Context.json decoder that preserves raw payload in error; add telemetry span

**Single `throw new Error()` in codebase:**
- Issue: Only one throw found in `packages/server/src/observe/telemetry.ts`; all other errors properly Effect-encoded
- Files: `packages/server/src/observe/telemetry.ts`
- Impact: If telemetry initialization fails with thrown Error, it bypasses Effect error channel
- Fix approach: Convert to Effect.fail; ensure telemetry failures don't crash startup

---

## Performance & Scaling

**Database query performance:**
- Issue: Search RRF combines 5 ranked result sets (FTS, trigram similarity, trigram word match, semantic, phonetic); no index analysis for `document_hash` or embedding vector scans
- Files: `packages/database/src/search.ts` (lines 48-100)
- Impact: Complex CTEs may timeout on large document sets; embedding scans unoptimized without pgvector index
- Fix approach: Benchmark RRF weights on 10M+ document corpus; ensure HNSW index on embeddings; profile CTE cardinality

**WebSocket room broadcasts cross-instance:**
- Issue: All instances pub/sub on Redis channel `ws:broadcast` for room/direct/broadcast messages; no message deduplication or backpressure
- Files: `packages/server/src/platform/websocket.ts` (line 55 mentions broadcast channel)
- Impact: Broadcast storms on multi-pod deployments; no rate limiting on message publication
- Fix approach: Add stream buffering; implement per-room message dedup; limit broadcast message size

**Cache eviction race condition:**
- Issue: Cache invalidation via event subscription but no guarantee all instances process before new value written
- Files: `packages/server/src/platform/cache.ts` (PersistedCache integration), `packages/server/src/security/policy.ts` (line 55 event subscription)
- Impact: Cache inconsistency window (50-500ms) where stale permissions served
- Fix approach: Use versioned cache keys; implement write-through invalidation with locking

**Job processing pool limits not respected:**
- Issue: Job pool configured with `critical: 4, high: 3, normal: 2, low: 1` but no enforcement on concurrent mailbox submissions
- Files: `packages/server/src/infra/jobs.ts` (line 29 `_CONFIG.pools`)
- Impact: High-priority jobs may wait behind normal queue; no adaptive backpressure
- Fix approach: Implement priority-aware queue; measure p99 latency per priority level

---

## Security & Secrets

**Redacted configuration incomplete:**
- Issue: Redis password, TLS keys, OAuth secrets marked `Config.redacted()` but may appear in logs/traces
- Files: `packages/server/src/platform/cache.ts` (lines 51, 61, 64-68, 72)
- Impact: Sensitive data risk if logs are unsanitized; @effect/opentelemetry spans may include redacted values unredacted
- Fix approach: Audit all telemetry exporters for redacted value handling; test with real secrets in staging

**OAuth state parameter rotation:**
- Issue: `_STATE_KEY` generates TTL-based cache key but state rotation on token refresh not tested
- Files: `packages/server/src/domain/auth.ts` (line 48 state key generation, session refresh logic untested)
- Impact: Concurrent auth flows may share state; refresh token update race condition
- Fix approach: Add CSRF state per-session with version counter; test concurrent OAuth + token refresh

**WebAuthn challenge TTL enforcement:**
- Issue: Challenge stored 5-minute TTL but no validation on signature timestamp against challenge creation time
- Files: `packages/server/src/domain/auth.ts` (line 46 `challengeTtl`)
- Impact: Replayed credentials from earlier sessions may bypass time-based validation
- Fix approach: Store challenge creation time; validate signature timestamp within ±5sec of creation

---

## Data Integrity & Consistency

**DLQ source tracking insufficient:**
- Issue: DLQ entries reference `sourceId` (job ID or event ID) but no cross-table FK validation
- Files: `packages/server/src/infra/jobs.ts` (lines 61-79 DLQ replay), `packages/database/migrations/0001_initial.ts` (line 11 FK relaxation)
- Impact: Orphaned DLQ entries after source deletion; manual cleanup required; replay logic can't detect invalid references
- Fix approach: Add DLQ cleanup phase in app purge handler; validate sourceId existence before replay

**Event journal partition fragmentation:**
- Issue: Partitions created monthly for `audit_logs` and `notifications` based on `uuid_extract_timestamp(id)`; no partition compaction or pruning
- Files: `packages/database/migrations/0001_initial.ts` (lines 9-10 partition strategy)
- Impact: Unbounded growth; old partitions never dropped; table bloat over 2+ years
- Fix approach: Implement pg_partman auto-drop policy; test with 36+ month history

**Transaction isolation for concurrent updates:**
- Issue: JSONB field updates (e.g., `Update.jsonb.set()`) use raw SQL without explicit serialization level
- Files: `packages/database/src/factory.ts` (lines 68-75 JsonbSetOp, JsonbDelOp)
- Impact: Concurrent JSONB mutations may lose updates; settings/preferences can diverge
- Fix approach: Use advisory locks for sensitive JSONB fields; document isolation requirements per table

---

## Migration & Deployment

**Database migration rollback not tested:**
- Issue: No backward-compatibility migration (down/rollback) for any schema changes; migration is one-way
- Files: `packages/database/migrations/0001_initial.ts`
- Impact: Production schema changes require manual recovery; no version pinning strategy
- Fix approach: Create migration versioning system; implement down() for each up() migration

**Vendor extensions optional, not enforced:**
- Issue: pg_stat_statements, pgaudit, pg_partman marked "unavailable exception" and silently skipped
- Files: `packages/database/migrations/0001_initial.ts` (lines 27-36)
- Impact: Observability/audit features disabled without visibility; production monitoring degrades silently
- Fix approach: Require critical extensions at startup; fail fast if pgaudit/pg_partman unavailable

---

## Type System & Type Checking

**ts-toolbelt usage not quarantined:**
- Issue: Type-level operations (object merging, key unions) may be directly used in public APIs
- Files: `packages/database/src/field.ts` (imports type-fest, ts-toolbelt; line 7-8)
- Impact: Public API types become opaque; IDE autocomplete breaks; downstream type checking slow
- Fix approach: Verify all ts-toolbelt types remain in `types/internal/`; don't leak to public exports

**Implicit any in polymorphic factories:**
- Issue: `Config<M>` generic uses `M extends Model.AnyNoContext` but resolve specs use string keys that aren't validated against `M['fields']`
- Files: `packages/database/src/factory.ts` (lines 29-50 ResolveDirectSpec, ResolveJoinSpec)
- Impact: Invalid field names silently become unresolvable; no compile-time validation
- Fix approach: Use branded string types for field names; validate resolve config against model schema at layer composition time

---

## Known Bugs & Workarounds

**Biome formatter disabled for indentation preservation:**
- Issue: Biome formatter is all-or-nothing; inlining breaks with strict formatting
- Files: `.planning/codebase/` reference in MEMORY.md; `packages/server/biome.json` override
- Impact: Manual whitespace management required; team must use VSCode 4-space settings; CI formatting checks limited
- Workaround: Biome runs linting only, not formatting; VSCode configured with 4-space indent + `editor.detectIndentation: false`
- Fix approach: None practical; accept as design constraint; document in CONTRIBUTING.md

**Forward reference in class extends clause:**
- Issue: Cache.ts statics referenced before class body completion
- Files: `packages/server/src/platform/cache.ts` (MEMORY.md note: module-level factories required)
- Impact: TypeScript error if helper functions move into class body
- Workaround: Keep factories module-level; class statics reference _makeKv, _makeSets post-definition
- Fix approach: Refactor to factory class pattern; extract factory into separate module

---

## Fragile Areas

**Cache invalidation logic across services:**
- Files: `packages/server/src/platform/cache.ts`, `packages/server/src/security/policy.ts`, `packages/server/src/domain/auth.ts`
- Why fragile: Event-driven invalidation with no ordering guarantees; concurrent writes may race invalidation
- Safe modification: Add version counters to cache keys; test invalidation ordering with concurrent mutations
- Test coverage: No explicit cache coherency tests; only integration tests for policy/auth

**WebSocket room state machine:**
- Files: `packages/server/src/platform/websocket.ts` (Machine lifecycle, TMap room tracking)
- Why fragile: Local TMap state per instance; no distributed consensus on room membership; reaper interval race conditions
- Safe modification: Add tests for room cleanup after connection drop; verify no orphaned sockets across pod restarts
- Test coverage: No test for room persistence after pod crash

**Job state transitions with DLQ fallback:**
- Files: `packages/server/src/infra/jobs.ts` (workflow state machine, DLQ insertion)
- Why fragile: Job failure -> DLQ insertion is not atomic; system crash between state change and DLQ write loses record
- Safe modification: Use saga pattern with compensation; test with chaos engineering (pod kills during job transition)
- Test coverage: Only happy-path workflow tests in transfer.spec.ts; no failure scenarios

---

## Scaling Limits

**Redis Sentinel mode auto-failover untested:**
- Current capacity: Sentinel nodes configured in `_CONFIG.sentinelNodes` with fallback to default
- Limit: No test for failover behavior; unclear if reconnection succeeds after primary drop
- Scaling path: Add integration test with Docker Sentinel cluster; measure failover time and connection recovery
- Files: `packages/server/src/platform/cache.ts` (lines 58-72)

**Session cache capacity defaults to 5000:**
- Current capacity: `SESSION_CACHE_CAPACITY` env var defaults to 5000; LRU eviction unknown
- Limit: Over 10k concurrent users, cache hitrate drops; database load spikes
- Scaling path: Profile cache hitrate in production; implement adaptive TTL based on eviction rate; document capacity planning
- Files: `packages/server/src/domain/auth.ts` (lines 41-43 sessionCache config)

**Search document corpus scaling:**
- Current capacity: RRF candidates limited to 300 per ranking method; may miss relevant results in 10M+ corpus
- Limit: 50+ second response time observed on fuzzy + semantic combined search with large vector dimensions
- Scaling path: Implement streaming result delivery; use approximate nearest neighbor search (HNSW); add search budget/timeout
- Files: `packages/database/src/search.ts` (line 14 `candidate: 300`)

**Job mailbox backpressure:**
- Current capacity: Mailbox capacity 100 per entity; pool sizes 4/3/2/1 for critical/high/normal/low
- Limit: Burst of 500+ jobs may fill all mailboxes; no global throttling
- Scaling path: Implement circuit breaker on job submission; add queue depth metrics; test with 10x normal load
- Files: `packages/server/src/infra/jobs.ts` (line 27 mailbox/pool config, line 100 mailboxCapacity)

---

## Dependencies at Risk

**ioredis peer dependency versions:**
- Risk: ioredis used with custom RedisOptions types; @effect/experimental/Persistence/Redis may diverge on major versions
- Impact: Sentinel mode reconnection or async/await semantics could break; no lock-step versioning
- Migration plan: Pin ioredis to exact version in pnpm-workspace.yaml; test major version upgrades in staging
- Files: `packages/server/src/platform/cache.ts`

**exceljs and jszip dynamic imports:**
- Risk: Imported on-demand via Effect.promise; bundler may not tree-shake properly; filesize bloat if used in browser
- Impact: Client-side transfer.ts bundle includes exceljs (1.2MB); server-only code leaked to client
- Migration plan: Move transfer.ts import to server-only layer; use @parametric-portal/server exports with conditional imports
- Files: `packages/server/src/utils/transfer.ts` (line 15 dynamic imports)

**@simplewebauthn/server vendor updates:**
- Risk: WebAuthn spec evolving; @simplewebauthn may lag; attested credential formats may be deprecated
- Impact: User registration fails if browser uses new attestation format not yet supported by lib
- Migration plan: Pin to stable version; test with latest browser WebAuthn implementations; monitor @simplewebauthn releases
- Files: `packages/server/src/domain/auth.ts`

---

## Documentation & Known Limitations

**Migration versioning missing:**
- Problem: No way to know which migrations have run; up-only design with no rollback
- Impact: Impossible to pin production to exact schema version; blue/green deployments risky
- Blocks: Database schema versioning strategy

**Search performance tuning undocumented:**
- Problem: RRF weights (fts: 0.3, fuzzy: 0.08, semantic: 0.2) hardcoded with no guidance on tuning
- Impact: Teams can't optimize search quality without reading source; no A/B testing framework
- Blocks: Search quality improvements, multi-tenant relevance tuning

**Pool sizing not documented:**
- Problem: Job pool sizes (critical: 4, high: 3, normal: 2, low: 1) set with no rationale or tuning guidance
- Impact: Teams don't know how to size for their workload; no capacity planning docs
- Blocks: Horizontal scaling strategy

---

*Concerns audit: 2025-02-13*
