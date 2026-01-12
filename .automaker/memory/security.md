---
tags: [security]
summary: security implementation decisions and patterns
relevantTo: [security]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# security

### Role level comparison uses numeric hierarchy from SCHEMA_TUNING as source of truth, checked with >= operator (2026-01-12)
- **Context:** Needed to determine if user role meets minimum required role for endpoint access
- **Why:** Single source of truth prevents role hierarchy drift. Numeric comparison is fail-safe: if hierarchy undefined, comparison uses undefined/NaN which fails safely closed (denies access). String comparisons are ambiguous.
- **Rejected:** Hard-coded role comparisons per endpoint, or role names as strings with list membership checks. Would allow inconsistent hierarchies across codebase.
- **Trade-offs:** Gained: single authority for role hierarchy, fail-safe default (deny if level undefined). Lost: need to maintain SCHEMA_TUNING hierarchy consistency.
- **Breaking if changed:** If SCHEMA_TUNING.roleLevels values are changed or roles reordered, access control inverts silently. numeric level 0='owner' instead of 'guest' would invert all checks. No validation that levels are monotonic.

### Implemented backup codes with SHA-256 hashing before storage rather than storing recovery codes plaintext or reversibly encrypted (2026-01-12)
- **Context:** Recovery codes are single-use authentication factors; need to validate them without storing originals
- **Why:** Hash-based validation prevents database compromise from exposing all backup codes at once; single-use removal pattern ensures each code can only authenticate once
- **Rejected:** Plaintext (unacceptable security risk), reversible encryption (defeats purpose of hashing), storing only count (can't detect if codes are valid)
- **Trade-offs:** Cannot recover lost codes for user; user must regenerate MFA; simple validation logic
- **Breaking if changed:** Removing hashing makes codes recoverable from database dump; changing single-use removal would allow replay attacks

#### [Pattern] Generated 10 recovery codes of 8 characters each rather than longer codes or different quantity (2026-01-12)
- **Problem solved:** Need backup authentication factor if authenticator app is lost but secure enough to discourage casual attacks
- **Why this works:** 8 chars = ~2^42 entropy per code, 10 codes = broad coverage; aligns with industry standards (Okta, Google, Microsoft use similar); balance between memorability and security
- **Trade-offs:** Fixed quantity means no flexibility; user might exhaust codes if device lost repeatedly; printable format easier to store

### Return QR data URL and backup codes only on successful enrollment, never on subsequent requests (2026-01-12)
- **Context:** Backup codes are sensitive; user should store them immediately and never need to retrieve again
- **Why:** Reduces exposure window; if user has codes, doesn't need to re-request; codes only shown once prevents accidental disclosure; user forced to store properly
- **Rejected:** Allow re-fetching backup codes (increases attack surface), return partial data (confusing UX)
- **Trade-offs:** User cannot retrieve lost backup codes without re-enrolling; simpler, more secure; may require user education
- **Breaking if changed:** Adding code retrieval endpoint doubles attack surface; changing to always-returnable makes codes easier to intercept