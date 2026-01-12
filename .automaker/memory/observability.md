---
tags: [observability]
summary: observability implementation decisions and patterns
relevantTo: [observability]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# observability

#### [Pattern] Telemetry utilities (annotateSpanWithApp, withAppSpan) designed to be safe no-ops when RequestContext unavailable (2026-01-12)
- **Problem solved:** Not all code paths have access to RequestContext (e.g., health checks, middleware setup phase)
- **Why this works:** Prevents null reference errors or crashes if telemetry code runs before context established. Defensive programming for distributed tracing integration.
- **Trade-offs:** Gained: telemetry utilities can be called anywhere without guards. Lost: silent failures if context not propagated (harder to debug missing app labels).

### Metrics use 'unknown' app label fallback instead of omitting label when RequestContext unavailable (2026-01-12)
- **Context:** HTTP metrics need app label for multi-tenant observability but not all requests have RequestContext
- **Why:** Metric cardinality stays bounded ('unknown' value is constant). If metrics omit label in some cases, observability system sees partial dimensions (same metric with/without label), creating query confusion.
- **Rejected:** Omitting app label when unavailable or using null - creates metric dimension inconsistency (same metric with different label sets)
- **Trade-offs:** Gained: consistent metric schema. Lost: 'unknown' bucket obscures requests that should have app context (may hide bugs in context propagation).
- **Breaking if changed:** If metric schema removes 'unknown' app label, queries for app-specific metrics break for unauthenticated requests that currently report under 'unknown'