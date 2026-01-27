---
phase: 01-platform-api-adoption
plan: 02
subsystem: api
tags: [effect, cookies, schema-validation, http, platform-api]

# Dependency graph
requires:
  - phase: none
    provides: n/a
provides:
  - Typed cookie read/write operations via @effect/platform
  - Schema validation at read boundary
  - Pre-built accessors for refreshToken, oauthState, sessionToken
  - const+namespace merge pattern for unified Cookies export
affects: [01-03, oauth-refactor, auth-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - HttpServerRequest.schemaCookies for typed cookie parsing
    - HttpServerResponse.setCookie/expireCookie for cookie mutations
    - const+namespace merge for combined value and type exports
    - Option.none for missing optional cookies (not errors)

key-files:
  created:
    - packages/server/src/http/cookies.ts
  modified: []

key-decisions:
  - "Schema validation at read boundary - ParseError propagates to caller"
  - "Missing optional cookies return Option.none, not errors"
  - "Cookie encryption remains domain concern in oauth.ts, not in cookies module"

patterns-established:
  - "http/ module pattern: dense FP code with const+namespace merge export"
  - "Schema-first cookie parsing via schemaCookies"
  - "Pre-built accessors for common cookie access patterns"

# Metrics
duration: 2min
completed: 2026-01-26
---

# Phase 01 Plan 02: Cookies Module Summary

**Typed cookie operations via @effect/platform schemaCookies with schema validation at boundary and const+namespace merge export**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T04:07:54Z
- **Completed:** 2026-01-27T04:09:56Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created unified cookies module using @effect/platform primitives directly
- Schema validation at read boundary eliminates manual cookie parsing
- Pre-built accessors (refreshToken, oauthState, sessionToken) for common patterns
- const+namespace merge provides unified Cookies export with both values and types

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cookies module with schema validation** - `35278dc` (feat)
2. **Task 2: Add cookie type discriminators and namespace** - completed within Task 1 (no separate commit needed)

**Plan metadata:** pending

## Files Created/Modified

- `packages/server/src/http/cookies.ts` - Unified cookie operations with schema validation

## Decisions Made

- Used HttpServerRequest.schemaCookies for all cookie reading (not manual parsing)
- ParseError propagates to caller - they decide how to handle via catchTag
- Missing optional cookies return Option.none() - not an error condition
- Encryption stays in oauth.ts domain layer - cookies module only handles I/O

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cookies module ready for oauth.ts and auth routes to migrate to
- Pattern established for future http/ modules (stream.ts, cache.ts, resilience.ts)
- HttpServerRequest.schemaCookies pattern validated for typed cookie access

---
*Phase: 01-platform-api-adoption*
*Completed: 2026-01-26*
