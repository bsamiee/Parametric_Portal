# 0002. Kustomize

Date: 2025-01-15
Status: Accepted

---
## Context

Kubernetes manifest management requires templating, environment overlays, and image tag updates. Must integrate with ArgoCD.

---
## Decision

Use **Kustomize v5.5** for manifest management. No Helm charts for application manifests.

---
## Alternatives Considered

| Option     | Rejected Because                                  |
| ---------- | ------------------------------------------------- |
| Helm       | Templating complexity, chart maintenance overhead |
| Jsonnet    | Additional language to learn, less common         |
| cdk8s      | TypeScript compilation step, overkill for scope   |
| Plain YAML | No environment differentiation                    |

---
## Consequences

[+] Native to kubectl (`kubectl apply -k`)
[+] Native ArgoCD support (no plugins)
[+] Base/overlay pattern matches dev/prod separation
[+] JSON patches for surgical modifications
[+] No templating language—YAML in, YAML out
[+] Zero runtime dependencies
[-] Complex transformations harder than Helm functions
[-] No dependency management (charts pull dependencies)
