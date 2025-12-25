# [H1][ARCHITECTURE_DECISION_RECORDS]
>**Dictum:** *Documented rationale prevents decision re-litigation.*

<br>

Architecture Decision Records (ADRs) for infrastructure choices. Each record captures context, decision, and tradeoffs for significant architectural decisions.

---
## [1][INDEX]

| [ADR] | [TITLE]                 | [STATUS] | [DATE]     |
| :---: | ----------------------- | -------- | ---------- |
| 0001  | K3s                     | Accepted | 2025-01-15 |
| 0002  | Kustomize               | Accepted | 2025-01-15 |
| 0003  | ArgoCD ApplicationSet   | Accepted | 2025-01-15 |
| 0004  | Traefik HelmChartConfig | Accepted | 2025-01-15 |
| 0005  | Sealed Secrets          | Accepted | 2025-01-15 |
| 0006  | Mise                    | Accepted | 2025-01-15 |
| 0007  | Network Policies        | Accepted | 2025-01-15 |
| 0008  | Multi-Domain            | Accepted | 2025-12-25 |

---
## [2][FORMAT]

Each ADR follows this structure:

```markdown
# [NUMBER]. [TITLE]

Date: YYYY-MM-DD
Status: Accepted | Proposed | Deprecated | Superseded

## Context
[Problem or requirement driving this decision]

## Decision
[What we chose to do]

## Alternatives Considered
[Other options evaluated and why rejected]

## Consequences
[+] Positive outcomes
[-] Negative outcomes or tradeoffs
```

---
## [3][LIFECYCLE]

| [STATUS]   | [MEANING]                                   |
| ---------- | ------------------------------------------- |
| Proposed   | Under discussion, not yet implemented       |
| Accepted   | Approved and implemented                    |
| Deprecated | No longer recommended, kept for history     |
| Superseded | Replaced by newer ADR (link to replacement) |
