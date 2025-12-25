# 0003. ArgoCD ApplicationSet

Date: 2025-01-15
Status: Accepted

---
## Context

Multiple environments (dev, prod) require separate ArgoCD Applications. Manual creation is error-prone and doesn't scale.

---
## Decision

Use **ApplicationSet with Git generator** to auto-create Applications per overlay.

---
## Alternatives Considered

| Option              | Rejected Because                        |
| ------------------- | --------------------------------------- |
| Manual Applications | Doesn't scale, copy-paste errors        |
| App-of-Apps         | Still requires manual child definitions |
| List generator      | Hardcoded values, no auto-discovery     |
| Cluster generator   | Overkill for single-cluster             |

---
## Consequences

[+] Git generator scans `infrastructure/overlays/*`
[+] New overlay directory → automatic Application
[+] Go templating for dynamic naming
[+] Single source of truth for all environments
[+] Consistent naming: `parametric-portal-{overlay}`
[-] Debugging requires understanding Go templates
[-] All overlays use same sync policy
