# [H1][VALIDATION]
>**Dictum:** *Validation catches defects before deployment.*

<br>

K8s 1.32-1.35 | current stable `@pulumi/kubernetes` | Canonical: `infrastructure/src/deploy.ts` (207 LOC)

**Validation stages:**
1. TypeScript type check: `pnpm exec nx run infrastructure:typecheck`
2. Preview: `pulumi preview --diff` (flags: `--expect-no-changes`, `--target <urn>`, `--refresh`, `--stack <name>`)
3. Security + reliability audit against checklists below
4. Cross-resource consistency checks

---
## [1][PREVIEW_OUTPUT]
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
## [2][IMMUTABLE_FIELDS]
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
## [3][CROSS_RESOURCE_CHECKS]
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
## [4][SECURITY_CHECKLIST]
>**Dictum:** *Security violations are highest-priority findings.*

<br>

### [4.1][POD_SECURITY_CONTEXT]

Applies to: Deployment, StatefulSet, DaemonSet, Job, CronJob pod specs.

| Field                                   | Severity | WHY                                                                 |
| --------------------------------------- | -------- | ------------------------------------------------------------------- |
| `runAsNonRoot: true`                    | Critical | Root containers escape to host via kernel exploits                  |
| `runAsUser: 1000`                       | High     | Image default UID may be 0; explicit non-root prevents drift        |
| `fsGroup: 2000`                         | Medium   | Mounted volumes inherit this GID; prevents permission denied on PVC |
| `seccompProfile.type: "RuntimeDefault"` | High     | Restricts syscall surface; blocks container breakout paths          |

**deploy.ts status:** No pod security context (line 171). Known gap.

### [4.2][CONTAINER_SECURITY_CONTEXT]

Applies to: every container (including init containers and K8s 1.33+ sidecar containers).

| Field                               | Severity | WHY                                                     |
| ----------------------------------- | -------- | ------------------------------------------------------- |
| `allowPrivilegeEscalation: false`   | Critical | Blocks setuid/setgid binaries from gaining root         |
| `readOnlyRootFilesystem: true`      | Critical | Prevents malware persistence; add `emptyDir` for `/tmp` |
| `capabilities.drop: ["ALL"]`        | Critical | Removes all 41 Linux capabilities; add back only needed |
| `privileged: true`                  | Critical | Full host access; remove and use specific capabilities  |
| `hostNetwork/hostPID/hostIPC: true` | Critical | Shares host namespaces; remove unless node-level agent  |

### [4.3][SECRETS_AND_RBAC]

| Check                                       | Severity | deploy.ts Status                                   |
| ------------------------------------------- | -------- | -------------------------------------------------- |
| No secrets in ConfigMap `data`              | Critical | PASS -- uses `Secret` with `stringData` (line 159) |
| No plain text secrets in `env.value`        | Critical | PASS -- uses `secretRef`                           |
| `pulumi.secret()` wraps sensitive values    | Critical | PASS -- `_Ops.secret()` (line 113)                 |
| ServiceAccount per workload (not `default`) | Medium   | Gap -- uses default SA                             |
| No wildcard RBAC resources or verbs         | Critical | N/A -- no RBAC defined                             |

---
## [5][RELIABILITY_CHECKLIST]
>**Dictum:** *Reliability gaps cause production incidents.*

<br>

### [5.1][IMAGE_TAGS]

| Check                        | Severity | deploy.ts Status                                           |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| No `:latest` tag             | High     | WARN -- observe images use `:latest` (line 14)             |
| No untagged images           | High     | PASS                                                       |
| Pin to full semver or digest | Medium   | PASS for postgres/redis; WARN for alloy/grafana/prometheus |

### [5.2][HEALTH_PROBES]

| Probe     | Severity | Guidelines                                                                | deploy.ts Status    |
| --------- | -------- | ------------------------------------------------------------------------- | ------------------- |
| Liveness  | Critical | Lightweight; no external deps; `periodSeconds: 10`, `failureThreshold: 3` | PASS (line 19)      |
| Readiness | Critical | May check deps; `periodSeconds: 5`, `failureThreshold: 3`                 | PASS (line 19)      |
| Startup   | Low      | `failureThreshold * periodSeconds` >= max startup time                    | PASS -- 150s window |

### [5.3][RESOURCES_AND_DISRUPTION]

| Check                                              | Severity | deploy.ts Status                              |
| -------------------------------------------------- | -------- | --------------------------------------------- |
| `requests.cpu` + `requests.memory` set             | Critical | PASS -- env-driven (line 168)                 |
| `limits.memory` set                                | Critical | PASS -- `limits == requests` = Guaranteed QoS |
| PDB for `replicas >= 2`                            | High     | WARN -- no PDB defined                        |
| Pod anti-affinity                                  | Medium   | WARN -- not configured                        |
| `topologySpreadConstraints`                        | Low      | INFO -- not configured                        |
| Rolling update: `maxSurge: 1`, `maxUnavailable: 0` | Medium   | Uses default strategy                         |

### [5.4][K8S_1.33-1.35_FEATURES]

| Check                                              | Severity | WHY                                                                |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| DRA ResourceClaim for structured resources         | Low      | GA 1.35; GPUs/FPGAs claimed vs node-level taints                   |
| Topology-aware routing annotation                  | Low      | `service.kubernetes.io/topology-mode` enables zone-aware endpoints |
| VolumeAttributesClass for storage tuning           | Low      | Modify IOPS/throughput without PVC recreation                      |
| Sidecar `restartPolicy: Always` on init containers | Low      | GA 1.33; replaces DaemonSet sidecar pattern                        |
| In-place resize `resizePolicy` per container       | Low      | Controls whether resize requires restart                           |

---
## [6][NETWORKING_CHECKLIST]
>**Dictum:** *Network isolation prevents lateral movement.*

<br>

| Check                                             | Severity | deploy.ts Status                               |
| ------------------------------------------------- | -------- | ---------------------------------------------- |
| Default-deny NetworkPolicy                        | Medium   | WARN -- none defined                           |
| Ingress TLS configured                            | Medium   | PASS (line 175)                                |
| Service type appropriate (ClusterIP for internal) | Low      | PASS (line 173)                                |
| Gateway API readiness                             | Low      | INFO -- uses Ingress; Gateway API is successor |

---
## [7][STORAGE_AND_OBSERVABILITY]
>**Dictum:** *Storage and observability gaps compound reliability risk.*

<br>

| Check                            | Severity | deploy.ts Status                       |
| -------------------------------- | -------- | -------------------------------------- |
| PVC access mode matches workload | Medium   | PASS -- RWO for single-pod             |
| Storage class specified          | Low      | Uses default class                     |
| Prometheus annotations           | Low      | Not set on compute pods                |
| OTEL endpoint configured         | Low      | PASS -- via `_Ops.runtime()` (line 94) |

---
## [8][NAMING_AND_LABELS]
>**Dictum:** *Consistent naming enables discovery and monitoring.*

<br>

| Label                                  | Severity | deploy.ts Status                     |
| -------------------------------------- | -------- | ------------------------------------ |
| `app.kubernetes.io/name`               | High     | INFO -- uses simple `{ app }` labels |
| `app.kubernetes.io/managed-by: pulumi` | High     | INFO -- not set                      |
| `app.kubernetes.io/version`            | Medium   | Not set                              |

Naming: lowercase-hyphen, include component, under 63 chars, consistent prefix. deploy.ts uses `<tier>-<kind>` pattern.

---
## [9][SEVERITY_CLASSIFICATION]
>**Dictum:** *Severity drives triage priority.*

<br>

| Severity  | Checks                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `[ERROR]` | TS errors, preview failures, running as root, privileged, host namespace, missing requests, missing probes, secrets in config |
| `[WARN]`  | Missing security context, no limits, no PDB, no NetworkPolicy, `:latest` image, no anti-affinity, no ServiceAccount           |
| `[INFO]`  | Missing startup probe, topology spread, HPA tuning, Gateway API migration, ValidatingAdmissionPolicy                          |

**Validation priority ordering:**

| Priority | Check                                | Severity |
| -------- | ------------------------------------ | -------- |
| 1        | TypeScript compilation errors        | Critical |
| 2        | Missing `metadata.namespace`         | Critical |
| 3        | Secrets in ConfigMap or env          | Critical |
| 4        | Privileged / host namespace access   | Critical |
| 5        | Missing security context             | High     |
| 6        | `:latest` / untagged images          | High     |
| 7        | Missing health probes                | High     |
| 8        | Missing resource requests            | High     |
| 9        | No PDB (replicas >= 2)               | High     |
| 10       | No NetworkPolicy                     | Medium   |
| 11       | No topology spread / anti-affinity   | Low      |
| 12       | Using Ingress instead of Gateway API | Low      |
