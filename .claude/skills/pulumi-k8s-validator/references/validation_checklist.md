# [H1][VALIDATION_CHECKLIST]
>**Dictum:** *Checklists enforce completeness at each validation stage.*

<br>

K8s 1.32-1.35 | current stable `@pulumi/kubernetes` | Canonical: `infrastructure/src/deploy.ts` (207 LOC)

---
## [1][SECURITY]
>**Dictum:** *Security violations are highest-priority findings.*

<br>

### [1.1][POD_SECURITY_CONTEXT]

Applies to: Deployment, StatefulSet, DaemonSet, Job, CronJob pod specs.

| Field                                   | Severity | WHY                                                                 |
| --------------------------------------- | -------- | ------------------------------------------------------------------- |
| `runAsNonRoot: true`                    | Critical | Root containers escape to host via kernel exploits                  |
| `runAsUser: 1000`                       | High     | Image default UID may be 0; explicit non-root prevents drift        |
| `fsGroup: 2000`                         | Medium   | Mounted volumes inherit this GID; prevents permission denied on PVC |
| `seccompProfile.type: "RuntimeDefault"` | High     | Restricts syscall surface; blocks container breakout paths          |

**deploy.ts status:** No pod security context (line 171). Known gap.

### [1.2][CONTAINER_SECURITY_CONTEXT]

Applies to: every container (including init containers and K8s 1.33+ sidecar containers).

| Field                               | Severity | WHY                                                     |
| ----------------------------------- | -------- | ------------------------------------------------------- |
| `allowPrivilegeEscalation: false`   | Critical | Blocks setuid/setgid binaries from gaining root         |
| `readOnlyRootFilesystem: true`      | Critical | Prevents malware persistence; add `emptyDir` for `/tmp` |
| `capabilities.drop: ["ALL"]`        | Critical | Removes all 41 Linux capabilities; add back only needed |
| `privileged: true`                  | Critical | Full host access; remove and use specific capabilities  |
| `hostNetwork/hostPID/hostIPC: true` | Critical | Shares host namespaces; remove unless node-level agent  |

### [1.3][SECRETS_AND_RBAC]

| Check                                       | Severity | deploy.ts Status                                   |
| ------------------------------------------- | -------- | -------------------------------------------------- |
| No secrets in ConfigMap `data`              | Critical | PASS -- uses `Secret` with `stringData` (line 159) |
| No plain text secrets in `env.value`        | Critical | PASS -- uses `secretRef`                           |
| `pulumi.secret()` wraps sensitive values    | Critical | PASS -- `_Ops.secret()` (line 113)                 |
| ServiceAccount per workload (not `default`) | Medium   | Gap -- uses default SA                             |
| No wildcard RBAC resources or verbs         | Critical | N/A -- no RBAC defined                             |

---
## [2][RELIABILITY]
>**Dictum:** *Reliability gaps cause production incidents.*

<br>

### [2.1][IMAGE_TAGS]

| Check                        | Severity | deploy.ts Status                                           |
| ---------------------------- | -------- | ---------------------------------------------------------- |
| No `:latest` tag             | High     | WARN -- observe images use `:latest` (line 14)             |
| No untagged images           | High     | PASS                                                       |
| Pin to full semver or digest | Medium   | PASS for postgres/redis; WARN for alloy/grafana/prometheus |

### [2.2][HEALTH_PROBES]

| Probe     | Severity | Guidelines                                                                | deploy.ts Status    |
| --------- | -------- | ------------------------------------------------------------------------- | ------------------- |
| Liveness  | Critical | Lightweight; no external deps; `periodSeconds: 10`, `failureThreshold: 3` | PASS (line 19)      |
| Readiness | Critical | May check deps; `periodSeconds: 5`, `failureThreshold: 3`                 | PASS (line 19)      |
| Startup   | Low      | `failureThreshold * periodSeconds` >= max startup time                    | PASS -- 150s window |

### [2.3][RESOURCES_AND_DISRUPTION]

| Check                                              | Severity | deploy.ts Status                              |
| -------------------------------------------------- | -------- | --------------------------------------------- |
| `requests.cpu` + `requests.memory` set             | Critical | PASS -- env-driven (line 168)                 |
| `limits.memory` set                                | Critical | PASS -- `limits == requests` = Guaranteed QoS |
| PDB for `replicas >= 2`                            | High     | WARN -- no PDB defined                        |
| Pod anti-affinity                                  | Medium   | WARN -- not configured                        |
| `topologySpreadConstraints`                        | Low      | INFO -- not configured                        |
| Rolling update: `maxSurge: 1`, `maxUnavailable: 0` | Medium   | Uses default strategy                         |

### [2.4][IN_PLACE_RESIZE]

| Check                            | Severity | WHY                                      |
| -------------------------------- | -------- | ---------------------------------------- |
| `resizePolicy` set per container | Low      | Controls whether resize requires restart |
| Memory decrease within bounds    | Low      | Allowed in 1.35 GA; verify cgroup v2     |

### [2.5][K8S_1.35_FEATURES]

| Check                                              | Severity | WHY                                                                |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| DRA ResourceClaim for structured resources         | Low      | GA 1.35; GPUs/FPGAs claimed vs node-level taints                   |
| Topology-aware routing annotation                  | Low      | `service.kubernetes.io/topology-mode` enables zone-aware endpoints |
| VolumeAttributesClass for storage tuning           | Low      | Modify IOPS/throughput without PVC recreation                      |
| Sidecar `restartPolicy: Always` on init containers | Low      | GA 1.33; replaces DaemonSet sidecar pattern                        |

---
## [3][NETWORKING]
>**Dictum:** *Network isolation prevents lateral movement.*

<br>

| Check                                             | Severity | deploy.ts Status                               |
| ------------------------------------------------- | -------- | ---------------------------------------------- |
| Default-deny NetworkPolicy                        | Medium   | WARN -- none defined                           |
| Ingress TLS configured                            | Medium   | PASS (line 175)                                |
| Service type appropriate (ClusterIP for internal) | Low      | PASS (line 173)                                |
| Gateway API readiness                             | Low      | INFO -- uses Ingress; Gateway API is successor |

---
## [4][STORAGE_AND_OBSERVABILITY]
>**Dictum:** *Storage and observability gaps compound reliability risk.*

<br>

| Check                            | Severity | deploy.ts Status                       |
| -------------------------------- | -------- | -------------------------------------- |
| PVC access mode matches workload | Medium   | PASS -- RWO for single-pod             |
| Storage class specified          | Low      | Uses default class                     |
| Prometheus annotations           | Low      | Not set on compute pods                |
| OTEL endpoint configured         | Low      | PASS -- via `_Ops.runtime()` (line 94) |

---
## [5][NAMING_AND_LABELS]
>**Dictum:** *Consistent naming enables discovery and monitoring.*

<br>

| Label                                  | Severity | deploy.ts Status                     |
| -------------------------------------- | -------- | ------------------------------------ |
| `app.kubernetes.io/name`               | High     | INFO -- uses simple `{ app }` labels |
| `app.kubernetes.io/managed-by: pulumi` | High     | INFO -- not set                      |
| `app.kubernetes.io/version`            | Medium   | Not set                              |

Naming: lowercase-hyphen, include component, under 63 chars, consistent prefix. deploy.ts uses `<tier>-<kind>` pattern.
