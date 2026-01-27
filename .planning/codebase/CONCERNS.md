# Codebase Concerns

**Analysis Date:** 2026-01-26

## Tech Debt

**AI Registry Model Layer Type Naming:**
- Issue: `AiModelLayer` type in `packages/ai/src/registry.ts:105-106` has confusing naming that doesn't clearly indicate it's a Layer type inferred from factory functions
- Files: `packages/ai/src/registry.ts`
- Impact: Type naming obscures semantics; consumers may misunderstand that this is a `Layer<LanguageModel>` that can fail with `ConfigError`
- Fix approach: Rename to `AiModelLayerType` or `CreateModelLayerType` for clarity, add comment documenting it as `Layer<LanguageModel, ConfigError>`

**Rate Limit Store Fail-Open Pattern:**
- Issue: `packages/server/src/security/rate-limit.ts:70-73` implements fail-open when Redis becomes unavailable, logs warning but allows all requests through
- Files: `packages/server/src/security/rate-limit.ts`
- Impact: Rate limiting entirely disabled on store failures; API becomes vulnerable to abuse if Redis backend fails
- Fix approach: Implement in-memory fallback bucket per request IP, use application-level circuit breaker to track store failures and switch strategy
- Priority: High - security boundary degradation

**TOTP Replay Detection Fail-Open:**
- Issue: `packages/server/src/security/totp-replay.ts:35-37` silently fails-open when replay store check errors, returns `alreadyUsed: false` without proper tracking
- Files: `packages/server/src/security/totp-replay.ts`
- Impact: MFA bypass possible if RateLimiterStore backend fails; user can repeat valid TOTP codes
- Fix approach: Track store failures separately, force re-verification or MFA lockout if store unavailable for threshold duration
- Priority: Critical - MFA security gap

**Audit Dead-Letter File System Optional:**
- Issue: `packages/server/src/observe/audit.ts:52-56` logs warning if dead-letter enabled but FileSystem service unavailable, but continues without error
- Files: `packages/server/src/observe/audit.ts`
- Impact: Security audit trail loss during file system issues; operational events not persisted to fallback medium
- Fix approach: Either fail startup if dead-letter required, or provide database fallback table for failed audit entries
- Priority: Medium - auditability degradation

**Job Queue Adaptive Polling Hard-Coded:**
- Issue: `packages/server/src/infra/jobs.ts:41` uses fixed polling intervals (1s busy, 10s idle) in constant configuration without env override
- Files: `packages/server/src/infra/jobs.ts`
- Impact: Cannot tune polling strategy per deployment environment (development vs production); fixed CPU usage pattern
- Fix approach: Move `poll.busy` and `poll.idle` to Config layer with defaults, allow environment override
- Priority: Low - operational flexibility

---

## Security Considerations

**TOTP Code Window Acceptance:**
- Risk: MFA time-window tolerance of ±1 period (`totp.window: [1, 1]`) accepts 3 consecutive TOTP codes (valid window + neighbor windows)
- Files: `packages/server/src/domain/mfa.ts:22`
- Current mitigation: Replay guard checks to prevent same code reuse within window
- Recommendations: Document attack surface (network delay tolerance), consider reducing window to [0, 1] if server time sync is guaranteed
- Priority: Medium - acceptable with explicit operational assumption

**Rate Limit IP Detection on Proxies:**
- Risk: IP extraction logic in `packages/server/src/middleware.ts:41-54` uses trusted CIDR list but proxy header validation minimal
- Files: `packages/server/src/middleware.ts`
- Current mitigation: Config defaults to `proxy.enabled: false`; explicit CIDR allowlist
- Recommendations: Add logging/metrics for header-based IP extraction, implement rate limit by `x-request-id` as fallback
- Priority: Medium - IP spoofing on shared proxies

**Cookie Encryption at Domain Layer:**
- Risk: OAuth state cookies created/set in `packages/server/src/context.ts` but comment states encryption "handled at domain layer (oauth.ts)"
- Files: `packages/server/src/context.ts:8`, `packages/server/src/domain/oauth.ts`
- Current mitigation: HttpOnly flag, SameSite=lax, Secure flag when HTTPS
- Recommendations: Verify oauth.ts actually encrypts state cookie before delivery; audit oauth.ts for proper PKCE state validation
- Priority: Medium - potential CSRF/state leakage

---

## Performance Bottlenecks

**Batch Delete Limit 1000 Hard-Coded:**
- Problem: `packages/server/src/infra/storage.ts:15` caps S3 delete batch to 1000 objects per API call
- Files: `packages/server/src/infra/storage.ts`
- Cause: S3 API technical limit, but no tuning per deletion size or object type
- Improvement path: Measure batch delete latency, consider size-aware batching (smaller batches for large objects), expose as configurable
- Priority: Low - only impacts bulk delete operations

**Storage Multipart Upload Part Size Fixed at 5MB:**
- Problem: `packages/server/src/infra/storage.ts:16` uses fixed 5MB parts for multipart uploads; no adaptation for network conditions
- Files: `packages/server/src/infra/storage.ts`
- Cause: Simple configuration; no connection speed detection
- Improvement path: Expose as environment variable, consider dynamic adjustment based on upload latency
- Priority: Low - standard for many SDKs

**Metrics Aggregation at Polling Service Interval:**
- Problem: `packages/server/src/observe/polling.ts:57-60` polls job queue depth every 30 seconds; alerts generated per poll cycle
- Files: `packages/server/src/observe/polling.ts`
- Cause: Fixed interval polling without reactive triggering
- Improvement path: Implement job status event subscription instead of polling (pg.listen already available via JobService pattern)
- Priority: Medium - unnecessary latency for queue depth alerting

---

## Fragile Areas

**TOTP Verification Time Step Calculation:**
- Files: `packages/server/src/domain/mfa.ts:80-98`
- Why fragile: Uses `Math.floor(now / (periodSec * 1000))` to calculate time step; clock skew or timezone issues could cause verification failures
- Safe modification: Do not change time window calculation without comprehensive test suite covering leap seconds, DST transitions, client clock drift
- Test coverage: TOTP verification tested with `verifySync` from otplib; edge cases around period boundaries not explicitly covered
- Priority: High - MFA availability risk

**Audit Operation String Parsing:**
- Files: `packages/server/src/observe/audit.ts:26-35`
- Why fragile: Parses `Subject.operation` format with indexOf('.'). Invalid format silently converts to `security.<operation>` with `valid: false`
- Safe modification: All callers must use string literals or enums for operation names; document valid formats explicitly
- Test coverage: Format validation and fallback behavior appears untested
- Priority: Medium - audit trail data quality

**Storage Adapter Overload Resolution:**
- Files: `packages/server/src/infra/storage.ts:60-64`, `77-81`, `92-96`, `104-108`
- Why fragile: Polymorphic API using `Array.isArray()` runtime checks to dispatch single vs batch operations; casts used extensively
- Safe modification: Add explicit overload signatures and strong typing before extending API surface (e.g., adding `putStream()`)
- Test coverage: Type safety relies on overload declarations; runtime behavior verified but polymorphism not type-safe
- Priority: Medium - API surface extensibility

**Job Handler HashMap Mutation:**
- Files: `packages/server/src/infra/jobs.ts:57`, `142-147`
- Why fragile: JobService.register() mutates handlers HashMap; concurrent registration during startup could race
- Safe modification: Finalize all handlers during Layer composition before job processing starts; prevent runtime registration
- Test coverage: Handler registration tested but concurrent registration scenario not covered
- Priority: High - job processing reliability

---

## Scaling Limits

**In-Memory TOTP Lockout Map:**
- Current capacity: Per-worker memory; TMap cleaned every 1 minute with 900s max lockout duration
- Limit: Worker process restart loses all lockout state; multi-worker deployments have per-worker lockout state
- Scaling path: Extract lockout state to Redis/PostgreSQL for cross-worker consistency; implement distributed semaphore
- Priority: High - multi-worker deployments

**Job Queue Lock Duration:**
- Current capacity: 5-minute lock (`packages/server/src/infra/jobs.ts:40`) prevents job starvation
- Limit: Long-running jobs (>5 min) may be claimed by second worker, causing duplicate execution attempts
- Scaling path: Implement adaptive lock duration based on estimated job execution time; support explicit lock renewal within handler
- Priority: Medium - affects job reliability at scale

**Storage Batch Concurrency Fixed at 10:**
- Current capacity: 10 concurrent S3 operations per request
- Limit: Cannot tune per API profile (listing vs deletion); single request can consume all connection pool on small instances
- Scaling path: Make concurrency configurable per operation type and operation (batch.concurrency → batch.{put,get,delete}.concurrency)
- Priority: Low - tuning available per deployment

---

## Dependencies at Risk

**Node 25 Pre-Release Requirement:**
- Risk: `package.json` enforces `node: 25.2.1` (unreleased/bleeding-edge); upgrading Node requires testing entire stack
- Impact: Tooling instability, library compatibility gaps, security patches may lag
- Migration plan: Pin to Node 24 LTS once 25 becomes stable; review @effect stack for Node 25 compatibility guarantees
- Priority: Medium - long-term maintenance

**TypeScript 6.0-dev Dependency:**
- Risk: `package.json` uses `typescript: 6.0.0-dev.20251125` (development build)
- Impact: Type checking results may differ from released 6.0; breaking changes possible in RC/final release
- Migration plan: Test against TypeScript 6.0 RC once available; establish process for major TS upgrades
- Priority: Medium - build stability

**SonarCloud Quality Gate Relaxed:**
- Risk: CHANGELOG notes "upgrade jspdf to 4.0.0 and relax SonarCloud quality gate" suggests gate lowered to pass jspdf issues
- Impact: Code quality standards may have been weakened; should verify current thresholds
- Migration plan: Review sonar-project.properties; restore original thresholds or document exceptions per rule
- Priority: Low - quality tooling alignment

---

## Test Coverage Gaps

**Cookie Management Lacks Coverage:**
- What's not tested: `packages/server/src/context.ts:77-83` cookie get/set/clear operations; cookie encryption/decryption flow
- Files: `packages/server/src/context.ts`
- Risk: Cookie modifications (MaxAge, SameSite, Secure) could silently fail if HttpServerResponse.setCookie API changes
- Priority: Medium - authentication boundary

**Middleware Composition Untested:**
- What's not tested: Global middleware order (trace → security → metrics → xForwardedHeaders); interaction between context middleware and auth middleware
- Files: `packages/server/src/middleware.ts`
- Risk: Middleware ordering bugs could allow unauthenticated requests or expose internal tracing headers
- Priority: High - request processing pipeline

**Error Handling in Storage Stream Processing:**
- What's not tested: Error handling during stream collection in `packages/server/src/infra/storage.ts:66-76` (S3 stream chunk errors)
- Files: `packages/server/src/infra/storage.ts`
- Risk: Large file downloads could fail mid-stream with incomplete error reporting
- Priority: Medium - large object handling

**Rate Limiter Store Fallback Scenarios:**
- What's not tested: Store failure behavior in `packages/server/src/security/rate-limit.ts:70-74` under high load; fallback bucket allocation
- Files: `packages/server/src/security/rate-limit.ts`
- Risk: Memory exhaustion if fallback uses unbounded buckets during extended Redis outage
- Priority: High - resilience verification

**Circuit Breaker State Transitions:**
- What's not tested: Full lifecycle in `packages/server/src/infra/jobs.ts:60-65` (open → half-open → closed transitions); interaction with job retry logic
- Files: `packages/server/src/infra/jobs.ts`
- Risk: Circuit breaker could stay open indefinitely or transition at unexpected times
- Priority: Medium - database resilience

---

## Missing Critical Features

**Manual Job Cancellation:**
- Problem: JobService supports only enqueue/process/retry/deadLetter; no cancel operation
- Blocks: Long-running job cancellation, cleanup of queued jobs for deleted resources
- Recommendation: Add `cancel(jobId)` with audit log, update job_queue table schema if needed
- Priority: Medium - operational feature

**Admin Rate Limit Bypass:**
- Problem: Rate limiting applies uniformly; no bypass for admin operations or internal services
- Blocks: Support tickets, data recovery operations, internal tools during incidents
- Recommendation: Add `admin` role check in `packages/server/src/security/rate-limit.ts:apply()` before rate limit check
- Priority: Low - operational convenience

**Configurable Audit Retention Policy:**
- Problem: No automatic audit log purging; dead-letter file can grow unbounded
- Blocks: Compliance (GDPR right to be forgotten), cost control (storage growth)
- Recommendation: Add audit.retention config (e.g., 90 days default) with age-based cleanup
- Priority: Medium - compliance/operations

**Storage Adapter Encryption at Rest:**
- Problem: S3 storage configured without server-side encryption mention; tenant data isolation via path prefix only
- Blocks: At-rest encryption guarantee, key rotation strategy
- Recommendation: Add ServerSideEncryption config to S3 client; document key management approach
- Priority: High - security requirement

---

## Known Operational Gaps

**No Graceful Shutdown for Job Processing:**
- Problem: `packages/server/src/infra/jobs.ts:43` documents shutdown interval/maxWait but no formal shutdown hook implementation visible
- Files: `packages/server/src/infra/jobs.ts`
- Workaround: Relies on Effect runtime cleanup
- Recommendation: Expose JobService.shutdown() that drains in-flight jobs and releases semaphore
- Priority: High - deployment safety

**Metrics Cardinality Unbounded for Tenant Labels:**
- Problem: `packages/server/src/observe/metrics.ts` and references use `MetricsService.label({ tenant: ctx.tenantId })` for all metrics
- Files: `packages/server/src/observe/metrics.ts`
- Risk: One metric per unique tenant ID (unbounded cardinality) could exhaust Prometheus memory with many tenants
- Recommendation: Implement metric cardinality limits or bucket tenants by sharding key
- Priority: Medium - observability scalability

---

*Concerns audit: 2026-01-26*
