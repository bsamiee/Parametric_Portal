---
tags: [auth]
summary: auth implementation decisions and patterns
relevantTo: [auth]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# auth

#### [Gotcha] requireRole middleware depends on Session tag being available in Effect context, but this dependency is implicit and not validated at middleware creation time (2026-01-12)
- **Situation:** Middleware chains Session lookup without explicit layer requirement declaration at middleware registration
- **Root cause:** Effect allows implicit tag access through Effect.Service - middleware can call Session.tag without declaring it upfront. Enables flexible composition but creates runtime dependency discovery.
- **How to avoid:** Gained: simpler middleware API, less boilerplate. Lost: compile-time verification that Session is provided. Runtime failures if Session layer missing.

#### [Gotcha] MFA enrollment and first verification are separate operations: enroll generates secret but doesn't enable it; verify confirms user can authenticate and then enables it (2026-01-12)
- **Situation:** Need to prevent accidental MFA lockout if user generates secret but can't scan QR code or loses backup codes
- **Root cause:** Two-phase prevents user from enabling MFA then immediately being unable to authenticate; gives user chance to verify setup works before committing
- **How to avoid:** Extra API call required; more complex state machine; user sees 'MFA pending' state; simpler recovery if initial setup fails