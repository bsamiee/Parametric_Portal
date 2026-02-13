# [H1][COMMON_ISSUES]
>**Dictum:** *Known issues have deterministic diagnostic paths.*

<br>

Provider: current stable `@pulumi/kubernetes` | K8s 1.32-1.35 | Canonical: `infrastructure/src/deploy.ts` (207 LOC)

---
## [1][ISSUE_REFERENCE]
>**Dictum:** *Each issue maps symptom to root cause to fix.*

<br>

| #   | Issue                             | Symptom                                                             | Root Cause                                               | Fix                                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Wrong cluster target              | Resources deploy to wrong cluster                                   | Default provider uses kubeconfig current-context         | Pass `{ provider }` to every `k8s.*` resource                         |
| 2   | Missing `dependsOn`               | Intermittent creation-order failures                                | String namespace refs skip implicit dep tracking         | Use `namespace.metadata.name` (Output) for implicit dep               |
| 3   | Auto-naming surprises             | Rename triggers replacement                                         | Pulumi appends random suffix by default                  | Omit `metadata.name` unless stable names required                     |
| 4   | `ignoreChanges` overuse           | Preview clean but cluster drifted                                   | Broad paths like `spec` silence all diffs                | Target specific fields: `["spec.replicas"]`                           |
| 5   | Missing `registerOutputs`         | ComponentResource outputs missing                                   | Pulumi needs signal that child registration is complete  | Call `this.registerOutputs({...})` at constructor end                 |
| 6   | Secrets in ConfigMap              | Passwords visible in K8s API/preview                                | ConfigMap data is plaintext in etcd                      | Use `Secret` + `pulumi.secret()` + `secretKeyRef` (deploy.ts:113,159) |
| 7   | Missing namespace                 | Resources land in `default`                                         | `metadata.namespace` omitted                             | Set namespace; prefer Output ref for implicit dep                     |
| 8   | Immutable field change            | Preview shows replace instead of update                             | K8s forbids updating certain fields                      | See Immutable Fields table; may require delete+create                 |
| 9   | Missing `parent`                  | Children at state tree root                                         | No `{ parent: this }` in child opts                      | Pass `{ parent: this }` on every ComponentResource child              |
| 10  | Unpinned image tags               | Non-deterministic deploys                                           | `:latest` resolves to different digests                  | Pin to `image:v1.2.3` or digest `@sha256:...`                         |
| 11  | SSA conflicts                     | "conflict" errors on previously client-side-applied resources       | v4+ SSA conflicts with old annotations                   | `pulumi refresh` or `enableServerSideApply: false` temporarily        |
| 12  | Gateway API CRD missing           | "no matches for kind"                                               | CRDs not installed                                       | Install gateway controller before Gateway/HTTPRoute                   |
| 13  | Sidecar not recognized            | Init container with `restartPolicy: Always` not behaving as sidecar | K8s <1.33 or feature gate disabled                       | Verify cluster 1.33+; check `SidecarContainers` gate                  |
| 14  | In-place resize rejected          | Pod resize patch fails                                              | K8s <1.35 or feature gate disabled                       | Verify cluster 1.35+; check `InPlacePodVerticalScaling` gate          |
| 15  | Healthcheck port mismatch         | Probes fail but app runs fine                                       | Probe port differs from `containerPort`                  | Ensure probe port matches `_CONFIG.ports.api` (4000)                  |
| 16  | `:latest` on observe images       | Non-deterministic observe stack                                     | deploy.ts:14 uses `:latest` for alloy/grafana/prometheus | Pin to specific versions for production                               |
| 17  | DRA ResourceClaim not bound       | Pod pending with claim not allocated                                | DRA driver not installed or device unavailable           | Verify ResourceClass and device plugin running                        |
| 18  | VolumeAttributesClass not applied | Storage params unchanged after update                               | K8s <1.35 or CSI driver unsupported                      | Check CSI driver docs; verify 1.35+ cluster                           |
| 19  | Topology routing not working      | Traffic still crosses zones                                         | Service missing annotation or EndpointSlices disabled    | Add `service.kubernetes.io/topology-mode: auto`                       |

---
## [2][PREVIEW_OUTPUT]
>**Dictum:** *Preview symbols encode risk level.*

<br>

| Symbol | Meaning                        | Risk     | Verify                                         |
| ------ | ------------------------------ | -------- | ---------------------------------------------- |
| `+`    | Create                         | Low      | Name, namespace, config correctness            |
| `-`    | Delete                         | Critical | Confirm intentional; check orphaned dependents |
| `~`    | Update in-place                | Medium   | Review changed fields for unintended drift     |
| `+-`   | Replace (create-before-delete) | Medium   | Safe ordering; old removed after new ready     |
| `-+`   | Replace (delete-before-create) | Critical | Downtime; old deleted before new exists        |

| Error Pattern          | Cause                            | Fix                                        |
| ---------------------- | -------------------------------- | ------------------------------------------ |
| `already exists`       | Resource in cluster not in state | `pulumi import <type> <name> <id>`         |
| `is immutable`         | Changing forbidden field         | See Immutable Fields; may need replacement |
| `conflict: ...manager` | SSA field ownership conflict     | `pulumi refresh` or set field manager      |
| `no matches for kind`  | CRD not installed                | Install CRDs before custom resources       |
| `timeout waiting for`  | Resource stuck pending           | Check pod events: `kubectl describe pod`   |

---
## [3][IMMUTABLE_FIELDS]
>**Dictum:** *Immutable field changes trigger replacement with data risk.*

<br>

| Resource    | Immutable Fields                                                 | Consequence                    |
| ----------- | ---------------------------------------------------------------- | ------------------------------ |
| Deployment  | `spec.selector.matchLabels`                                      | Replacement (downtime risk)    |
| StatefulSet | `spec.selector`, `spec.serviceName`, `spec.volumeClaimTemplates` | Replacement (PVC orphaning)    |
| Service     | `spec.clusterIP`, `spec.type` (some cases)                       | Replacement (new ClusterIP)    |
| PVC         | `spec.storageClassName`, `spec.accessModes`, storage (shrink)    | Replacement (data loss)        |
| Namespace   | `metadata.name`                                                  | Replacement (cascading delete) |
| DaemonSet   | `spec.selector.matchLabels`                                      | Replacement                    |

---
## [4][CROSS_RESOURCE_CHECKS]
>**Dictum:** *Interconnected resources require consistency validation.*

<br>

| Check                  | Resources                        | Verify                                                                   | Severity |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------ | -------- |
| Selector alignment     | Deployment + Service + HPA + PDB | `Service.spec.selector` == `Deployment.spec.selector.matchLabels`        | Critical |
| Port chain             | Deployment + Service + Ingress   | `containerPort` == Service `targetPort` == Ingress backend `port.number` | Critical |
| Namespace uniformity   | All resources                    | All related resources in same namespace                                  | High     |
| Secret/ConfigMap refs  | Deployment + Secret/ConfigMap    | `envFrom` names match actual resource names                              | High     |
| PVC claim refs         | Deployment + PVC                 | `claimName` matches PVC metadata name                                    | High     |
| HPA scaleTargetRef     | HPA + Deployment                 | `name` matches Deployment metadata name                                  | Medium   |
| NetworkPolicy selector | NetworkPolicy + Deployment       | `podSelector.matchLabels` matches workload labels                        | Medium   |
| Gateway parentRef      | HTTPRoute + Gateway              | `parentRefs.name` matches Gateway name                                   | Medium   |

---
## [5][VALIDATION_PRIORITY]
>**Dictum:** *Priority ordering ensures critical issues surface first.*

<br>

| Priority | Check                                | Stage | Severity |
| -------- | ------------------------------------ | ----- | -------- |
| 1        | TypeScript compilation errors        | 1     | Critical |
| 2        | Missing `metadata.namespace`         | 1/3   | Critical |
| 3        | Secrets in ConfigMap or env          | 3     | Critical |
| 4        | Privileged / host namespace access   | 3     | Critical |
| 5        | Missing security context             | 3     | High     |
| 6        | `:latest` / untagged images          | 3     | High     |
| 7        | Missing health probes                | 4     | High     |
| 8        | Missing resource requests            | 4     | High     |
| 9        | No PDB (replicas >= 2)               | 4     | High     |
| 10       | No NetworkPolicy                     | 3     | Medium   |
| 11       | No topology spread / anti-affinity   | 4     | Low      |
| 12       | Using Ingress instead of Gateway API | 4     | Low      |
