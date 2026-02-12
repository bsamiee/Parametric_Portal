# Common Pulumi Kubernetes Issues

> Provider: `@pulumi/kubernetes` v4.25+ | K8s 1.32-1.35
> Canonical: `infrastructure/src/deploy.ts` (207 LOC)

## Issue Reference

| # | Issue | Symptom | Root Cause | Fix |
|---|-------|---------|------------|-----|
| 1 | Wrong cluster target | Resources deploy to wrong cluster | Default provider uses kubeconfig current-context | Pass `{ provider }` to every `k8s.*` resource |
| 2 | Missing `dependsOn` | Intermittent creation-order failures | String namespace refs skip implicit dep tracking | Use `namespace.metadata.name` (Output) for implicit dep, or `{ dependsOn: [ns] }` |
| 3 | Auto-naming surprises | Names like `api-abc1234`; rename triggers replacement | Pulumi appends random suffix by default | Omit `metadata.name` unless external systems require stable names (deploy.ts uses `_Ops.meta()` with optional name) |
| 4 | `ignoreChanges` overuse | Preview clean but cluster has drifted | Broad paths like `spec` silence all diffs | Target specific fields: `["spec.replicas"]`, never `["spec"]` |
| 5 | Missing `registerOutputs` | ComponentResource outputs missing from stack output | Pulumi needs signal that child registration is complete | Call `this.registerOutputs({...})` at end of constructor |
| 6 | Secrets in ConfigMap | Passwords visible in K8s API and Pulumi preview | ConfigMap data is plaintext in etcd | Use `k8s.core.v1.Secret` + `pulumi.secret()` + `secretKeyRef` (deploy.ts:113,159 does this correctly) |
| 7 | Missing namespace | Resources land in `default` namespace | `metadata.namespace` omitted | Always set namespace; prefer Output ref from Namespace resource for implicit dep |
| 8 | Immutable field change | Preview shows replace instead of update | K8s forbids updating certain fields after creation | See Immutable Fields table; may require delete+create |
| 9 | Missing `parent` | Children appear at state tree root | No `{ parent: this }` in child opts | Pass `{ parent: this }` on every child inside ComponentResource |
| 10 | Unnecessary `interpolate` | Complexity for no benefit | Template has no `Output<T>` values | Use plain strings when no outputs involved; `pulumi.interpolate` only when mixing `Output<T>` |
| 11 | Unpinned image tags | Non-deterministic deploys; rollback impossible | `:latest` or partial tags resolve to different digests | Pin to `image:v1.2.3` or digest `@sha256:...` |
| 12 | Server-Side Apply conflicts | "conflict" errors on previously client-side-applied resources | v4+ default SSA conflicts with old annotations | `pulumi refresh` to sync state, or set `enableServerSideApply: false` temporarily |
| 13 | Deprecated Endpoints API | Warnings on K8s 1.33+ about Endpoints | Endpoints deprecated in favor of EndpointSlice | Migrate to EndpointSlice API; no Pulumi-side change needed if using Service |
| 14 | Gateway API CRD missing | Resource creation fails with "no matches for kind" | GatewayClass/Gateway/HTTPRoute CRDs not installed | Install gateway controller first (envoy-gateway, nginx-gateway-fabric, etc.) |
| 15 | Sidecar not recognized | Init container with restartPolicy: Always not behaving as sidecar | K8s <1.33 or feature gate disabled | Verify cluster is 1.33+; check `SidecarContainers` feature gate |
| 16 | In-place resize rejected | Pod resize patch fails | K8s <1.35 or feature gate disabled | Verify cluster is 1.35+; check `InPlacePodVerticalScaling` feature gate |

## Preview Output Guide

### Diff Symbols

| Symbol | Meaning | Risk Level | What to Verify |
|--------|---------|-----------|----------------|
| `+` | Create | Low | Name, namespace, config correctness |
| `-` | Delete | **Critical** | Confirm intentional; check for orphaned dependents |
| `~` | Update in-place | Medium | Review changed fields for unintended drift |
| `+-` | Replace (create-before-delete) | Medium | Safe ordering; old removed after new is ready |
| `-+` | Replace (delete-before-create) | **Critical** | **Downtime**; old deleted before new exists |

### Preview Errors

| Error Pattern | Cause | Resolution |
|---------------|-------|------------|
| `already exists` | Resource in cluster but not in Pulumi state | `pulumi import <type> <name> <id>` |
| `is immutable` | Changing a field K8s forbids updating | See Immutable Fields; may need replacement |
| `provider not configured` | Missing/misconfigured K8s provider | Check kubeconfig context or explicit provider |
| `failed to read resource state` | Resource deleted outside Pulumi | `pulumi refresh` to sync state |
| `replacing ...` when `~` expected | Immutable field triggered replacement | Review trigger field; `ignoreChanges` if intentional |
| `timeout waiting for ...` | Resource stuck in pending state | Check pod events: `kubectl describe pod <name> -n parametric` |
| `connection refused` | Cluster unreachable | Verify kubeconfig, VPN, cluster status |
| `Unauthorized` | Invalid or expired credentials | Refresh: `aws eks update-kubeconfig --name <cluster>` (EKS) |
| `conflict: ...manager` | Server-Side Apply field ownership conflict | `pulumi refresh` or set field manager explicitly |
| `no matches for kind` | CRD not installed in cluster | Install CRDs before creating custom resources (Gateway API, cert-manager, etc.) |

## Validation Priority

| Priority | Check | Stage | Severity |
|----------|-------|-------|----------|
| 1 | TypeScript compilation errors | 1 | Critical |
| 2 | Missing `metadata.namespace` | 1/3 | Critical |
| 3 | Secrets in ConfigMap or env | 3 | Critical |
| 4 | Privileged / host namespace access | 3 | Critical |
| 5 | Missing security context | 3 | High |
| 6 | `:latest` / untagged images | 3 | High |
| 7 | Missing health probes | 4 | High |
| 8 | Missing resource requests | 4 | High |
| 9 | No PodDisruptionBudget (replicas >= 2) | 4 | High |
| 10 | No NetworkPolicy | 3 | Medium |
| 11 | Replacement triggers in preview | 2 | Medium |
| 12 | Missing `dependsOn` for ordering | 2 | Medium |
| 13 | `ignoreChanges` overuse | 2 | Medium |
| 14 | Missing `registerOutputs` | 1 | Medium |
| 15 | No topology spread / anti-affinity | 4 | Low |
| 16 | No ValidatingAdmissionPolicy | 3 | Low |
| 17 | Using Ingress instead of Gateway API | 4 | Low |

## Immutable Fields

| Resource | Immutable Fields | Consequence of Change |
|----------|-----------------|----------------------|
| Deployment | `spec.selector.matchLabels` | Replacement (downtime risk) |
| StatefulSet | `spec.selector.matchLabels`, `spec.serviceName`, `spec.volumeClaimTemplates` | Replacement (PVC orphaning risk) |
| Service | `spec.clusterIP`, `spec.type` (some cases) | Replacement (new ClusterIP assigned) |
| PVC | `spec.storageClassName`, `spec.accessModes`, `spec.resources.requests.storage` (shrink only) | Replacement (data loss risk) |
| Job | `spec.selector`, `spec.template` | Replacement |
| Namespace | `metadata.name` | Replacement (cascading delete of all resources) |
| DaemonSet | `spec.selector.matchLabels` | Replacement |

## Cross-Resource Consistency Checks

These checks verify that interconnected resources reference each other correctly.

| Check | Resources Involved | What to Verify | Severity |
|-------|-------------------|----------------|----------|
| Selector alignment | Deployment + Service | `Service.spec.selector` matches `Deployment.spec.selector.matchLabels` | Critical |
| Port consistency | Deployment + Service + Ingress | Container `containerPort` = Service `targetPort` = Ingress backend `port.number` | Critical |
| Label consistency | Deployment + HPA + PDB | HPA `scaleTargetRef.name` matches Deployment name; PDB `selector.matchLabels` matches Deployment labels | Critical |
| Namespace consistency | All resources | All resources in same namespace; Service and Ingress reference correct Service name | High |
| Secret reference validity | Deployment + Secret | `secretRef.name` in envFrom matches actual Secret resource name | High |
| ConfigMap reference validity | Deployment + ConfigMap | `configMapRef.name` in envFrom matches actual ConfigMap resource name | High |
| PVC claim reference | Deployment + PVC | `persistentVolumeClaim.claimName` matches PVC metadata name | High |
| Ingress TLS secret | Ingress + Secret | `tls.secretName` references existing TLS secret with `tls.crt` and `tls.key` | Medium |
| HPA target exists | HPA + Deployment | `scaleTargetRef.name` resolves to an existing Deployment/StatefulSet | Medium |
| NetworkPolicy selector | NetworkPolicy + Deployment | `podSelector.matchLabels` matches target workload labels | Medium |
| Gateway parentRef | HTTPRoute + Gateway | `parentRefs.name` matches Gateway name in same or specified namespace | Medium |
