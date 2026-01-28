# Codebase Concerns

**Analysis Date:** 2026-01-28

## Tech Debt

**Error Architecture Inconsistency:**
- Issue: Multiple error handling patterns coexist without unified approach. Mix of `Data.TaggedError`, `Schema.TaggedError`, and raw `Error` objects. Planning document `error-refactoring.md` exists but not implemented.
- Files: `packages/types/src/app-error.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/transfer.ts`, `apps/api/src/routes/audit.ts`, `packages/server/src/domain/mfa.ts`, `packages/server/src/domain/session.ts`, `packages/database/src/factory.ts`
- Impact: Inconsistent error handling makes it difficult to predict error behavior across layers. Missing exhaustive type-safe error handling via `Match.exhaustive`. Error transformations between layers (Infrastructure → Domain → HTTP) are ad-hoc rather than systematic.
- Fix approach: Implement systematic layering per `error-refactoring.md`: Infrastructure errors use `Data.TaggedError`, HTTP boundary uses `Schema.TaggedError` with serialization, add cross-layer transformers with `Match.exhaustive` pattern matching.

**Type Safety Compromises with `any`:**
- Issue: Strategic use of `any` types in middleware composition and generic factory functions to work around TypeScript limitations.
- Files: `packages/runtime/src/store/factory.ts` (lines 18-20, 59-60, 69-70, 150, 186, 192-195), `apps/api/src/routes/transfer.ts` (line 156), `packages/ai/src/registry.ts` (line 105 TODO comment)
- Impact: Type safety holes in Zustand store middleware chain and Effect AI registry. Biome lint rules explicitly allow these exceptions, but they create potential runtime issues.
- Fix approach: Replace `any` with proper generic constraints. For store factory, use conditional types and mapped types. For AI registry, fix naming confusion noted in TODO comment at line 105.

**Naming Confusion in AI Registry:**
- Issue: Explicit TODO comment: "FIX NAMNG OF THIS TO NOT BE CONFUSING" for `AiModelLayer` type.
- Files: `packages/ai/src/registry.ts` (line 105)
- Impact: Confusing API surface for AI model layer construction.
- Fix approach: Rename `AiModelLayer` to more accurately reflect it provides `LanguageModel` via Layer composition.

**`@ts-expect-error` Directive:**
- Issue: Single use of TypeScript error suppression for fake-indexeddb type mismatch.
- Files: `packages/test-utils/src/setup.ts` (line 21)
- Impact: Type safety bypass in test utilities. Library types don't match package.json exports.
- Fix approach: Update fake-indexeddb types or create proper type declaration override file.

**Polymorphic Repository Type Casting:**
- Issue: Unsafe type cast in `insertMany` implementation circumvents type system.
- Files: `packages/database/src/repos.ts` (line 133)
- Impact: `insertMany(prepared) as Effect.Effect<readonly Asset[], unknown>` loses type information from repository factory pattern.
- Fix approach: Refactor repository factory to properly infer batch insert return types without casting.

**DISPATCH_TABLES Label Violation:**
- Issue: `error-refactoring.md` shows `DISPATCH_TABLES` section label, but CLAUDE.md explicitly forbids this label in the FORBIDDEN list.
- Files: `error-refactoring.md` (line 50), `CLAUDE.md` (line 160)
- Impact: Inconsistency between example documentation and coding standards.
- Fix approach: Replace `DISPATCH_TABLES` with standard dispatch pattern without special label in error-refactoring.md.

## Known Bugs

**No Critical Bugs Identified:**
- All TODO/FIXME comments are documentation or enhancement notes rather than bug markers.
- No patterns of `return null`/`return []`/`return {}` stubs found (only 6 instances, all legitimate early returns).
- No unhandled error cases detected in critical paths.

## Security Considerations

**Token Storage XSS Trade-off:**
- Risk: Access tokens returned in JSON body are vulnerable to XSS extraction.
- Files: `apps/api/src/routes/auth.ts` (lines 4-11 security design comment)
- Current mitigation: Short expiry (7 days), refresh token rotation, HttpOnly cookies for refresh tokens. Design is intentional trade-off for stateless API authentication.
- Recommendations: Document XSS prevention requirements for frontend consumers. Consider adding Content-Security-Policy headers. Audit for potential XSS vectors in client apps.

**Row Level Security (RLS) Enforcement:**
- Risk: Database security relies on PostgreSQL RLS policies being correctly configured.
- Files: `packages/database/migrations/0001_initial.ts` (lines 902-946), `packages/database/src/client.ts`
- Current mitigation: All tables have RLS enabled with `FORCE ROW LEVEL SECURITY`. Migration 0001 sets up comprehensive RLS policies. Security functions use `SECURITY INVOKER` pattern.
- Recommendations: Add integration tests to verify RLS policies prevent unauthorized access. Monitor for RLS bypass attempts in audit logs.

**Encrypted Data Handling:**
- Risk: OAuth tokens and API keys stored encrypted in database rely on application-level encryption/decryption.
- Files: `apps/api/src/routes/auth.ts` (lines 73-84), `packages/server/src/security/crypto.ts`
- Current mitigation: Crypto service handles encryption/decryption. Keys stored as encrypted buffers.
- Recommendations: Audit key rotation procedures. Ensure encryption keys are never logged or exposed in error messages.

**Rate Limiting Coverage:**
- Risk: Not all endpoints have explicit rate limiting applied.
- Files: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/audit.ts`, `apps/api/src/routes/transfer.ts`
- Current mitigation: `CacheService.rateLimit()` wrapper applied to most handlers with different limits ('auth', 'api', 'mutation', 'mfa').
- Recommendations: Audit all endpoints to ensure rate limiting is consistently applied. Document rate limit tiers and their use cases.

## Performance Bottlenecks

**Transfer Import Batch Processing:**
- Problem: Large file imports process in batches but could overwhelm memory with binary assets.
- Files: `apps/api/src/routes/transfer.ts` (lines 94-192)
- Cause: Batch size limit (`Transfer.limits.batchSize`) controls DB inserts but doesn't limit concurrent S3 uploads. `concurrency: 10` for S3 uploads in `prepareItem` could cause memory pressure with large binary files.
- Improvement path: Add memory-aware backpressure to S3 upload stream. Consider streaming directly to S3 without holding full binary content in memory.

**Search Refresh Synchronization:**
- Problem: Search index refresh after bulk import is fire-and-forget with warning-only error handling.
- Files: `apps/api/src/routes/transfer.ts` (lines 176-178)
- Cause: `search.refresh(appId)` errors are caught and logged as warnings but don't block import completion. Could lead to stale search results.
- Improvement path: Consider background job queue for search refresh with retry logic rather than inline fire-and-forget.

**Stream Processing in Export:**
- Problem: Binary export path buffers entire result in memory before streaming response.
- Files: `apps/api/src/routes/transfer.ts` (lines 61-73)
- Cause: `Transfer.exportBinary()` returns full result with count before creating response. Not true streaming for binary formats.
- Improvement path: Implement true streaming for binary exports using `HttpServerResponse.stream()` similar to text export path.

## Fragile Areas

**Multi-Tenant Context Propagation:**
- Files: `packages/server/src/context.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/audit.ts`, `apps/api/src/routes/transfer.ts`
- Why fragile: Tenant ID (`appId`) and session context flow through Effect context. If context is lost or incorrectly scoped, RLS policies could fail or apply wrong tenant isolation.
- Safe modification: Always use `Context.Request.tenantId` and `Context.Request.session` rather than passing tenant IDs as parameters. Never bypass Effect context in middleware chain.
- Test coverage: No explicit multi-tenant isolation tests found. Need tests verifying tenant A cannot access tenant B resources.

**MFA Verification Flow:**
- Files: `apps/api/src/routes/auth.ts` (lines 130-169), `packages/server/src/domain/mfa.ts`, `packages/server/src/domain/session.ts`
- Why fragile: MFA state tracked in session (`mfaPending`, `verifiedAt`). Complex interaction between enrollment, verification, and recovery code flows. Rate limiting critical to prevent brute force.
- Safe modification: Always use `Middleware.requireMfaVerified` for protected endpoints. Never manually check MFA state. Respect rate limits in `CacheService.rateLimit('mfa', ...)`.
- Test coverage: MFA flows need comprehensive integration tests covering enrollment → verification → recovery → disable lifecycle.

**Effect Error Channel Type Inference:**
- Files: Throughout codebase (107 occurrences of `Effect.mapError`/`Effect.catchAll`/`Effect.catchTag`)
- Why fragile: Error channel types must be manually maintained when composing Effects. Type widening can hide errors, type narrowing can cause type errors.
- Safe modification: Always use `Match.exhaustive` when handling error unions. Explicitly type Effect return signatures for public APIs. Avoid `unknown` in error channel.
- Test coverage: No compile-time enforcement of exhaustive error handling. Consider custom lint rule.

**FORBIDDEN Section Labels Usage:**
- Files: All source files must follow section label standards from `CLAUDE.md`
- Why fragile: CLAUDE.md forbids specific labels (`Helpers`, `Handlers`, `Utils`, `Config`, `DISPATCH_TABLES`) but `error-refactoring.md` and some code may use them.
- Safe modification: Use only approved labels from CLAUDE.md section 5. Replace forbidden labels during refactoring.
- Test coverage: No automated enforcement of section label standards.

## Scaling Limits

**Audit Log Growth:**
- Current capacity: Unbounded growth in `audit_logs` table.
- Limit: No automatic archival or retention policy visible in migrations.
- Scaling path: Implement time-based partitioning for audit logs. Add retention policy and archival to cold storage after N days.

**Session Table Growth:**
- Current capacity: `purge_sessions` function exists but no visible scheduled execution.
- Files: `packages/database/src/repos.ts` (line 46), `packages/database/migrations/0001_initial.ts`
- Limit: Expired sessions accumulate until purge is called.
- Scaling path: Schedule periodic purge jobs for sessions, refresh tokens, API keys, OAuth accounts. All have purge functions but no scheduler visible.

**Asset Storage Cleanup:**
- Current capacity: Soft-deleted assets with S3 references can be queried but cleanup requires explicit purge.
- Files: `packages/database/src/repos.ts` (lines 128-132), `packages/server/src/infra/handlers/purge-assets.ts`
- Limit: S3 storage costs grow if purge jobs don't run regularly.
- Scaling path: Verify purge-assets handler is scheduled correctly. Consider S3 lifecycle policies as backup.

## Dependencies at Risk

**Experimental Effect Packages:**
- Risk: Using `@effect/experimental` (version 0.58.0) in production.
- Files: `pnpm-workspace.yaml` (line 18), `packages/devtools/src/experimental.ts`, `apps/api/package.json`
- Impact: API instability, breaking changes between releases. DevTools integration uses experimental features.
- Migration plan: Monitor Effect ecosystem for graduation of experimental features to stable. Currently using `DevTools`, `Machine`, `VariantSchema`, `RateLimiter`. Plan migration as features stabilize.

**mise Experimental Features:**
- Risk: `mise.toml` has `experimental = true` flag enabled globally.
- Files: `mise.toml` (line 5, line 131)
- Impact: Tool behavior could change unexpectedly with mise updates.
- Migration plan: Review mise changelog before updates. Test thoroughly in CI before production deployment.

## Missing Critical Features

**Comprehensive Test Suite:**
- Problem: Zero test files found in codebase.
- Blocks: Confident refactoring, regression prevention, deployment safety.
- Files: No `*.test.ts`, `*.spec.ts`, or test directories found.
- Priority: High - Critical for production system

**Background Job Scheduling:**
- Problem: Purge functions exist but no visible job scheduler.
- Blocks: Automatic cleanup of expired sessions, tokens, deleted assets.
- Files: `packages/database/src/repos.ts` (purge functions defined), `packages/server/src/infra/jobs.ts` (job infrastructure exists)
- Priority: High - Required for operational health

**Multi-Tenant Isolation Tests:**
- Problem: Complex RLS policies with no visible isolation verification.
- Blocks: Confidence in tenant data isolation.
- Files: `packages/database/migrations/0001_initial.ts` (RLS policies)
- Priority: High - Security critical

## Test Coverage Gaps

**Zero Test Files:**
- What's not tested: Entire codebase has no automated tests.
- Files: All application code in `apps/`, `packages/`
- Risk: Cannot verify correctness of complex Effect composition, error handling, multi-tenant isolation, MFA flows, transfer import/export, search functionality, or any other business logic.
- Priority: Critical

**Test Infrastructure Exists:**
- Files: `packages/test-utils/src/harness.ts`, `packages/test-utils/src/effect-test.ts`, `packages/test-utils/src/setup.ts`
- Context: Test utilities are built (Vitest setup, Effect matchers, test harness) but unused.
- Priority: High - Foundation exists, need to write actual tests

**Critical Paths to Test:**
- OAuth authentication flow (`apps/api/src/routes/auth.ts`)
- Transfer import/export with XLSX/binary formats (`apps/api/src/routes/transfer.ts`)
- MFA enrollment and verification (`packages/server/src/domain/mfa.ts`, `packages/server/src/domain/session.ts`)
- Multi-tenant RLS enforcement (`packages/database/src/client.ts`)
- Error transformation across layers (all route handlers)
- Repository batch operations (`packages/database/src/repos.ts`)
- Priority: Critical

---

*Concerns audit: 2026-01-28*
