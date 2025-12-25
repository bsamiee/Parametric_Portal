# 0007. Network Policies

Date: 2025-01-15
Status: Accepted

---
## Context

Kubernetes default allows all pod-to-pod communication. Production requires explicit traffic controls.

---
## Decision

Implement **default-deny NetworkPolicies** with explicit allow rules.

---
## Rationale

- Default deny blocks all traffic
- Explicit allows for: Traefik → pods, pods → DNS, API → PostgreSQL/external
- Private CIDR exclusion prevents internal scanning
- Standard Kubernetes API (no CNI-specific features)

---
## Consequences

[+] Lateral movement blocked by default
[+] Explicit traffic flows documented in code
[+] Compliance-friendly audit trail
[-] New services require NetworkPolicy updates
[-] Debugging connectivity requires policy understanding
