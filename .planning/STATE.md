# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-13)

**Core value:** A single polymorphic function call deploys a fully provisioned, production-ready tenant -- zero manual wiring, zero YAML, zero indirection.
**Current focus:** Phase 1 - Foundation Hardening

## Current Position

Phase: 1 of 9 (Foundation Hardening)
Plan: 1 of 2 in current phase
Status: Executing
Last activity: 2026-02-14 -- Completed 01-01-PLAN.md (infra hardening: RunError, image pinning, Garage, Redis 8.x)

Progress: [#░░░░░░░░░] 5%

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: 4min
- Total execution time: 0.07 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-hardening | 1/2 | 4min | 4min |

**Recent Trend:**
- Last 5 plans: 01-01 (4min)
- Trend: --

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Effect/Pulumi hard boundary -- Effect in packages/, Pulumi in infrastructure/, share schemas/constants only
- [Roadmap]: Namespace-per-tenant isolation model (not vCluster, not per-tenant cluster)
- [Roadmap]: S3 state backend with KMS encryption (not local state, not Pulumi Cloud)
- [Roadmap]: Testing via runtime.setMocks() with Vitest (not live cluster tests)
- [Phase 1]: Replace MinIO with Garage (dxflrs/garage:v2.2.0) -- MinIO archived Feb 2026, Garage is S3-compatible, AGPLv3, actively maintained
- [Phase 1]: Upgrade Redis to 8.6.0-alpine (AGPLv3) -- safe for unmodified self-hosted usage
- [Phase 1]: Add @pulumi/command (1.1.3), @pulumi/random (4.18.5), @pulumi/tls (5.2.3) to catalog
- [Phase 1]: Alloy pinned to v1.13.0 (v1.13.1 does not exist)
- [Phase 1-01]: Excluded infrastructure/ from lefthook imperatives hook -- Pulumi code requires throw/if patterns banned in Effect codebase
- [Phase 1-01]: Added @pulumi/command to onlyBuiltDependencies for pnpm build script approval
- [Phase 3]: Email env passthrough + Postgres SSL + Redis TLS CA gaps deferred to Phase 3 (shared config schema)
- [Phase 4]: Traefik replaces nginx-ingress for cloud K8s mode (NGINX Ingress EOL March 2026)
- [Phase 6]: DNS record automation added (External DNS or Pulumi DNS provider)

### Pending Todos

None yet.

### Blockers/Concerns

- [Research]: Phase 4 (Cluster Tooling) flagged for deeper research -- MetalLB vs K3s ServiceLB decision, Longhorn Helm chart version compatibility, CRD ordering
- [Research]: Shared config schema location undecided -- packages/types vs packages/config vs standalone package
- [Audit]: Email infrastructure completely absent -- runtime reads EMAIL_*/RESEND_*/SMTP_* but runtime-env.ts doesn't passthrough and RESEND_API_KEY not in required secrets (tracked for Phase 3)
- [Audit]: Cloud POSTGRES_SSL not set (defaults false despite RDS TLS support) -- tracked for Phase 3
- [Audit]: Cloud REDIS_TLS_CA not provided for ElastiCache -- needs verification against Node default CA store (tracked for Phase 3)
- [Audit]: OTEL endpoint default namespace mismatch (runtime defaults to `monitoring`, infra deploys to `parametric`) -- low severity, override works
- [Audit]: K8S_LABEL_SELECTOR runtime default (`parametric-portal`) mismatches actual label (`parametric-api`) -- override works, but default should be corrected
- [Audit]: Phase 9 integration mechanism undecided -- Pulumi Automation API vs CLI vs job queue (highest research risk in roadmap)
- [Audit]: NGINX Ingress EOL March 2026 -- Phase 4 updated to use Traefik

## Session Continuity

Last session: 2026-02-14
Stopped at: Completed 01-01-PLAN.md, ready for 01-02-PLAN.md
Resume file: None
