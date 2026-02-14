---
phase: 01-foundation-hardening
plan: 02
subsystem: infra
tags: [pulumi, resource-naming, multi-stack, s3, urn]

# Dependency graph
requires:
  - phase: 01-foundation-hardening/01
    provides: "RunError-based _Ops.fail, pinned images, Garage S3 storage, Redis 8.x"
provides:
  - "Stack-prefixed Pulumi logical names for all ~40 resource constructors"
  - "Stack-scoped S3 bucket physical name (parametric-assets-${stack})"
  - "Multi-stack deployment safety -- no URN or physical name collisions"
affects: [02-testing-quality, 04-cluster-tooling, 09-automation-api]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Stack-prefixed Pulumi logical names via template literals", "Separation of Pulumi logical names from Docker container hostnames and K8s metadata names"]

key-files:
  created: []
  modified:
    - "infrastructure/src/deploy.ts"

key-decisions:
  - "Prefixed garage-rpc-secret, garage-admin-token, and garage-setup resources not listed in original plan -- they are Pulumi resources that would collide across stacks"
  - "Docker container name properties (hostnames) and K8s metadata names intentionally left unprefixed -- they are physical/DNS names, not Pulumi logical names"
  - "Docker network physical name (parametric) left unprefixed -- local daemon concept, not multi-account concern"

patterns-established:
  - "Stack prefix pattern: all Pulumi resource constructors use `${args.stack}-` or `${stack}-` template literals for logical names"
  - "Physical vs logical name discipline: logical names (Pulumi URN identity) are prefixed; physical names (DNS hostnames, K8s metadata, Docker container names) are not"

# Metrics
duration: 5min
completed: 2026-02-14
---

# Phase 1 Plan 2: Stack-Prefixed Resource Naming Summary

**Stack-prefixed Pulumi logical names for all ~40 resource constructors, preventing URN collisions across multi-stack deployments with S3 bucket physical name scoping**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-14T03:13:31Z
- **Completed:** 2026-02-14T03:18:44Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Threaded stack parameter into 3 shared helper functions (_Ops.dockerVol, _Ops.securityGroup, _k8sObserve) and prefixed their resource logical names
- Prefixed all 21 cloud resource constructors and 12 selfhosted resource constructors with `${args.stack}-`
- Changed S3 bucket physical name from `parametric-assets` to `parametric-assets-${args.stack}` for multi-account safety
- Preserved all Docker container `name` properties (inter-container DNS hostnames) and K8s metadata names unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread stack parameter into shared helpers and prefix their resource names** - `a40fab1` (feat)
2. **Task 2: Prefix all resource logical names in _DEPLOY.cloud and _DEPLOY.selfhosted** - `1eb2106` (feat)

## Files Created/Modified
- `infrastructure/src/deploy.ts` - Stack-prefixed logical names for all Pulumi resource constructors; stack parameter threading in helpers; S3 bucket physical name scoping

## Decisions Made
- Prefixed 3 garage-related resources (garage-rpc-secret, garage-admin-token, garage-setup) not explicitly listed in the plan table -- they are Pulumi resources added by Plan 01 (Garage replacing MinIO) that would collide across stacks
- Docker container name properties and K8s metadata names intentionally left unprefixed per plan instructions -- these are physical/DNS names for inter-container communication
- Docker network physical name (`parametric`) left unprefixed -- local daemon concept, not a multi-account concern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Prefixed garage-rpc-secret, garage-admin-token, and garage-setup resources**
- **Found during:** Task 2 (Prefix all resource logical names)
- **Issue:** Plan table listed `data-minio` but Plan 01 replaced MinIO with Garage, introducing 3 new Pulumi resources (random.RandomString x2, command.local.Command x1) not in the original plan table
- **Fix:** Prefixed all 3 garage-related resource logical names with `${args.stack}-`
- **Files modified:** infrastructure/src/deploy.ts
- **Verification:** `grep -c 'args.stack' infrastructure/src/deploy.ts` returns 36 (confirms all resources prefixed)
- **Committed in:** 1eb2106 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Auto-fix necessary for completeness -- leaving 3 resources unprefixed would defeat the multi-stack safety goal. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 (Foundation Hardening) fully complete -- both plans executed
- All Pulumi resources have unique URNs per stack, safe for multi-stack deployments
- Infrastructure ready for Phase 2 testing and quality improvements

## Self-Check: PASSED

- deploy.ts verified present on disk
- Both task commits verified in git log (a40fab1, 1eb2106)

---
*Phase: 01-foundation-hardening*
*Completed: 2026-02-14*
