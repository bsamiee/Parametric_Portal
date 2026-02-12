---
name: pulumi-k8s-generator
description: Generate production-ready Pulumi Kubernetes resources in TypeScript following the deploy.ts pattern. Covers Deployments, Services, Ingress, Gateway API, HPA, ConfigMaps, Secrets, PVCs, DaemonSets, NetworkPolicies, PodDisruptionBudgets, ValidatingAdmissionPolicies, and ComponentResource composition.
---

# Pulumi Kubernetes Resource Generator

Generate Pulumi K8s resources in TypeScript following the `infrastructure/src/deploy.ts` pattern: `_CONFIG` + `_Ops` + dispatch table.

**Canonical:** `infrastructure/src/deploy.ts` (207 LOC)
**Provider:** `@pulumi/kubernetes` v4.25+ (Server-Side Apply default, K8s schemas up to 1.35)
**K8s Target:** 1.32-1.35 (sidecar containers GA 1.33, in-place pod resize GA 1.35, Gateway API v1.4 GA, ValidatingAdmissionPolicy GA 1.30+)

## Routing

| Use this skill | Use OTHER skill |
|---|---|
| Create/generate Pulumi K8s resources | `pulumi-k8s-validator`: Validate existing code |
| Build ComponentResource compositions | `k8s-debug`: Debug deployed resources |
| Define multi-resource stacks | `observability-stack`: Observability infra |

**Triggers:** "create", "generate", "build", "scaffold" Pulumi Kubernetes resources/components

## Workflow

### 1. Gather Requirements

| Field | Required | Default | deploy.ts Reference |
|---|---|---|---|
| Deployment mode | YES -- `cloud` (K8s+AWS) or `selfhosted` (Docker) | -- | `_Ops.mode()` (line 64) |
| Resource kind(s) | YES -- Deployment, Service, Ingress, Gateway, HTTPRoute, GRPCRoute, HPA, ConfigMap, Secret, PVC, DaemonSet, NetworkPolicy, PDB, ValidatingAdmissionPolicy, ComponentResource | -- | -- |
| Container image | YES | -- | `input.api.image` (line 163) |
| Port | YES | `4000` | `_CONFIG.ports.api` (line 22) |
| Health paths | YES -- liveness + readiness | `/api/health/liveness`, `/api/health/readiness` | `_CONFIG.k8s.probes` (line 19) |
| CPU/memory | NO -- env-driven or preset | `small` preset | `input.api.cpu`, `input.api.memory` (line 168) |
| HPA min/max/target | NO | env-driven | `input.api.minReplicas/maxReplicas`, `input.hpa.cpuTarget/memoryTarget` (line 174) |
| PVC size | NO | `10Gi` | `storageGi` param in `_k8sObserve` (line 120) |
| Namespace | NO | `parametric` | `_CONFIG.k8s.namespace` (line 18) |

### 2. Lookup API Docs

Try `context7-tools` for `@pulumi/kubernetes` with target resource kind. Fallback: WebSearch `"@pulumi/kubernetes" "<kind>" TypeScript API 2025`.

### 3. Load References

Read at generation time (prior context may be compressed):
1. `references/pulumi_k8s_patterns.md` -- naming, labels, security, mode dispatch
2. `references/resource_templates.md` -- `_CONFIG`/`_Ops`/dispatch, factories, ComponentResource, advanced patterns
3. `infrastructure/src/deploy.ts` -- canonical dense implementation

### 4. Generate Resources

**Architecture (from deploy.ts):**

| Layer | Purpose | Lines |
|---|---|---|
| `_CONFIG` | Immutable `as const` -- ports, labels, probes, images, ingress annotations | 11-24 |
| `_Ops` | Pure factory namespace -- `meta()`, `k8sUrl()`, `secret()`, `compact()`, `fail()` | 28-119 |
| `_k8sObserve` | Array-driven factory: PVC + ConfigMap + Deployment + Service per item | 120-126 |
| `_DEPLOY` | Dispatch table `{ cloud: ..., selfhosted: ... } as const` | 130-195 |
| `deploy` | Entry point: resolves mode, delegates to dispatch table | 199-202 |

**Mode rules (from deploy.ts):**

| Concern | `cloud` (K8s + AWS) | `selfhosted` (Docker) |
|---|---|---|
| Compute | `k8s.apps.v1.Deployment` + Service (**ClusterIP**) (lines 172-173) | `docker.Container` + Traefik labels (line 191) |
| Ingress | `k8s.networking.v1.Ingress` with **nginx** class (line 175) | Traefik reverse proxy (line 192) |
| Scaling | `k8s.autoscaling.v2.HorizontalPodAutoscaler` (line 174) | None |
| Config | ConfigMap + Secret (lines 158-159) | `docker.Container.envs` (line 191) |
| Data | AWS RDS + ElastiCache + S3 (lines 136-145) | Docker containers (lines 182-185) |
| TLS | Ingress TLS spec + nginx ssl-redirect (line 175) | Let's Encrypt via Traefik (line 117) |
| Observe | DaemonSet (Alloy) + `_k8sObserve` factory (lines 147-154) | Docker containers with uploads (lines 187-189) |

**CRITICAL:** Cloud uses ClusterIP + nginx ingress (NOT LoadBalancer + ALB). Selfhosted uses `@pulumi/docker` (NOT Kubernetes).

**Standards:**
- Resources with `requests` + `limits` (env-driven via `input.api.cpu`/`input.api.memory`, line 168)
- Probes: liveness + readiness + startup (from `_CONFIG.k8s.probes`, line 19)
- Security contexts on new workloads (see `_SECURITY` in `references/resource_templates.md`)
- `pulumi.secret()` for sensitive values (line 113)
- `pulumi.interpolate` for string interpolation with `Output<T>` (line 62)
- `as const satisfies` for config objects
- `terminationGracePeriodSeconds: 30` (line 171)

**Resource names (from deploy.ts):**

| Pulumi Name | K8s Kind | Line |
|---|---|---|
| `parametric-ns` | Namespace | 133 |
| `compute-deploy` | Deployment | 172 |
| `compute-svc` | Service (ClusterIP) | 173 |
| `compute-hpa` | HPA (autoscaling/v2) | 174 |
| `compute-ingress` | Ingress (nginx class) | 175 |
| `compute-config` | ConfigMap | 158 |
| `compute-secret` | Secret | 159 |
| `observe-alloy` | DaemonSet | 149 |
| `observe-alloy-svc` | Service | 150 |
| `observe-alloy-cfg` | ConfigMap | 147 |
| `prometheus` | Deployment (via `_k8sObserve`) | 152 |
| `grafana` | Deployment (via `_k8sObserve`) | 153 |

### 5. Validate

Invoke `pulumi-k8s-validator` skill.

### 6. Deliver

```
## Generated Resources
| Resource | Kind | Namespace | Mode |
|----------|------|-----------|------|
```

Include `pulumi preview` / `pulumi up` next steps.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Type errors on k8s resources | API shape changed in provider upgrade | Verify against `@pulumi/kubernetes` v4.25+ API via context7 |
| Preview fails on namespace | Namespace not yet created | Ensure namespace resource created before dependents (use `namespace.metadata.name` Output for implicit dep) |
| Cross-stack reference errors | Format wrong or different backend | Format: `<org>/<project>/<stack>`, same backend required |
| Selfhosted creating k8s resources | Mode violation | Selfhosted uses `@pulumi/docker` only -- check `_Ops.mode()` dispatch |
| `already exists` in preview | Resource in cluster but not in state | `pulumi import <type> <name> <id>` |
| Replace instead of update | Immutable field changed (e.g., selector) | See immutable fields in `pulumi-k8s-validator/references/common_issues.md` |
| EndpointSlice vs Endpoints | Using deprecated Endpoints API | Use EndpointSlice API (Endpoints deprecated K8s 1.33+) |
| Server-Side Apply conflicts | Field manager ownership conflict | `pulumi refresh` to sync state, or set field manager explicitly |
| Gateway API resources not found | GatewayClass CRDs not installed | Install gateway controller CRDs before creating Gateway/HTTPRoute/GRPCRoute |
