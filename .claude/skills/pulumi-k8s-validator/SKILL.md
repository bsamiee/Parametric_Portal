---
name: pulumi-k8s-validator
description: Read-only validator for Pulumi Kubernetes infrastructure. Checks TypeScript types, preview output, security posture, and production readiness.
---

# Pulumi Kubernetes Validator

READ-ONLY validator. Analyzes infrastructure code, proposes improvements. Does NOT modify files.

**Provider:** `@pulumi/kubernetes` v4.25+ | **K8s Target:** 1.32-1.35
**Canonical:** `infrastructure/src/deploy.ts` (207 LOC)

| Use this skill | Use OTHER skill |
|----------------|-----------------|
| Validate/audit Pulumi K8s code | **pulumi-k8s-generator**: Create new resources |
| Type-check resource definitions | **k8s-debug**: Debug deployed resources |
| Security + production readiness review | **dockerfile-validator**: Container image builds |

## Validation Workflow

### Stage 1: TypeScript Type Check

```bash
pnpm exec nx run infrastructure:typecheck
```

| Error Pattern | Category | Typical Cause |
|---------------|----------|---------------|
| `Property 'X' does not exist on type 'Y'` | Typo / wrong field name | API changed between provider versions |
| `Property 'X' is missing in type 'Y'` | Required field omitted | New required field in v4.25+ |
| `Type 'A' is not assignable to type 'B'` | Value type mismatch | `string` where `Output<string>` expected |
| `Cannot find module '@pulumi/kubernetes'` | Missing dependency | Run `pnpm install` |

Record each error with file, line, and category.

### Stage 2: Pulumi Preview

```bash
pulumi preview --diff
```

Flags: `--expect-no-changes` (drift), `--target <urn>` (scoped), `--refresh` (stale state), `--stack <name>`.

| Outcome | Action |
|---------|--------|
| Success | Record plan summary (creates/updates/deletes), continue |
| No stack selected | Document skip, continue to Stage 3 |
| Provider/connection error | Document skip, continue to Stage 3 |
| Resource validation error | Record errors with URNs, continue |

Interpret diff symbols and errors via `references/common_issues.md`.

### Stage 3: Security Posture Review [MANDATORY]

Read infrastructure source files. Check against `references/validation_checklist.md` Security section.

**deploy.ts-specific checks:**
- `_Ops.secret()` used for all sensitive env vars (deploy.ts:113) -- verified
- `k8s.core.v1.Secret` used with `stringData` for secrets (deploy.ts:159) -- verified
- No security contexts on pod specs (deploy.ts:171) -- known gap, flag as [WARN]
- Alloy DaemonSet has resource limits (deploy.ts:148) -- verified
- No NetworkPolicy defined -- flag as [WARN]

### Stage 4: Production Readiness Review [MANDATORY]

Read infrastructure source files. Check against `references/validation_checklist.md` Reliability/Networking/Storage/Observability/Naming sections.

**deploy.ts-specific checks:**
- Liveness + readiness + startup probes configured (deploy.ts:19) -- verified
- Resource requests + limits on API container (deploy.ts:168) -- verified (env-driven)
- `terminationGracePeriodSeconds: 30` set (deploy.ts:171) -- verified
- HPA with CPU + memory metrics (deploy.ts:174) -- verified
- Ingress TLS configured (deploy.ts:175) -- verified
- No PodDisruptionBudget -- flag as [WARN] for replicas >= 2
- No pod anti-affinity -- flag as [WARN]
- No topology spread constraints -- flag as [INFO]
- Image tags: `grafana/alloy:latest`, `grafana/grafana:latest`, `prom/prometheus:latest` (deploy.ts:14) -- flag as [WARN] for production
- No ValidatingAdmissionPolicy for security enforcement -- flag as [INFO]
- No Gateway API resources (still using Ingress) -- flag as [INFO]

### Stage 5: Report [MANDATORY]

**NEVER** modify files, offer to apply fixes, or prompt user for changes.

1. **Load references** (if any issues found): read both `references/` files.
2. **Summary table**:

| Stage | Status | Issues |
|-------|--------|--------|
| 1. TypeScript | [PASS] | 0 errors |
| 2. Preview | [PASS] | 3 resources planned |
| 3. Security | [WARN] | Missing securityContext on 2 containers |
| 4. Readiness | [WARN] | Missing probes on 1 deployment |

3. **Severity classification**:

| Severity | Checks |
|----------|--------|
| `[ERROR]` | TS errors, preview failures, running as root, privileged container, host namespace access, missing resource requests, missing liveness/readiness probes, secrets in ConfigMap/env, wildcard RBAC |
| `[WARN]` | Missing security context fields, no resource limits, no PDB, no NetworkPolicy, `:latest`/untagged image, missing standard labels, no anti-affinity, no dedicated ServiceAccount |
| `[INFO]` | Missing startup probe, Prometheus annotations, topology spread, HPA behavior tuning, storage class, OTEL config, Gateway API migration, ValidatingAdmissionPolicy |

4. **Per-issue detail**: file:line, before/after TypeScript, reason, complexity `[Simple]`/`[Medium]`/`[Complex]`.
5. **Final summary**: project, stack, status, error/warn/info counts, proposed change count, next steps.

## Parallel Execution

- Stage 1 + Stage 3: run simultaneously (compiler + source analysis)
- Stage 2: after Stage 1 passes
- Stage 5: after all stages complete
