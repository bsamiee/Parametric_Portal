# Validation Checklist

> Validated against K8s 1.32-1.35 APIs and `@pulumi/kubernetes` v4.25+.
> Canonical: `infrastructure/src/deploy.ts` (207 LOC).

## Security

### Pod Security Context

Applies to: Deployment, StatefulSet, DaemonSet, Job, CronJob pod specs.

| Field | Risk | Severity | WHY | HOW |
|-------|------|----------|-----|-----|
| `runAsNonRoot: true` | Container escape | Critical | Root containers can escape to host via kernel exploits (CVE-2024-21626, etc.) | Set in `spec.template.spec.securityContext` |
| `runAsUser: 1000` | Privilege drift | High | Image default UID may be 0; explicit non-root prevents drift | Pair with `runAsNonRoot` |
| `runAsGroup: 3000` | File permission | Medium | Controls GID for shared volume file permissions | Set alongside `runAsUser` |
| `fsGroup: 2000` | Volume access | Medium | Mounted volumes inherit this GID; prevents permission denied on PVC | Required when pods share PVCs (e.g., prometheus-pvc, grafana-pvc) |
| `seccompProfile.type: "RuntimeDefault"` | Syscall surface | High | Restricts syscall surface to ~300 of 400+ available; blocks container breakout paths | Set at pod level to cover all containers including sidecars |

**deploy.ts status:** No pod security context set (deploy.ts:171). Known gap.

### Container Security Context

Applies to: every container (including init containers and K8s 1.33+ sidecar containers with `restartPolicy: Always`).

| Field | Risk | Severity | WHY | HOW |
|-------|------|----------|-----|-----|
| `allowPrivilegeEscalation: false` | Privilege escalation | Critical | Blocks setuid/setgid binaries from gaining root | Set per container in `securityContext` |
| `readOnlyRootFilesystem: true` | Malware persistence | Critical | Prevents malware from writing to container filesystem | Add `emptyDir` volumes for writable paths (`/tmp`, `/var/cache`) |
| `capabilities.drop: ["ALL"]` | Capability abuse | Critical | Removes all 41 Linux capabilities; add back only what is needed | Use `capabilities.add: ["NET_BIND_SERVICE"]` if binding port <1024 |
| `privileged: true` | Full host access | Critical | Full host access; equivalent to root on the node | Remove; use specific capabilities instead |
| `hostNetwork: true` | Network sniffing | Critical | Container shares host network namespace; can sniff all traffic | Remove; use Service/Ingress for external access |
| `hostPID: true` | Process visibility | Critical | Container can see and signal all host processes | Remove; only justified for node-level monitoring agents |
| `hostIPC: true` | Shared memory attack | Critical | Container shares host IPC namespace; shared memory attack surface | Remove; use network for inter-process communication |

### Secrets

| Check | Severity | HOW |
|-------|----------|-----|
| No secrets in ConfigMap `data` | Critical | Move to `k8s.core.v1.Secret` with `stringData` |
| No plain text secrets in `env.value` | Critical | Use `env.valueFrom.secretKeyRef` referencing a Secret |
| No secrets in Pulumi source | Critical | Wrap with `pulumi.secret()` to encrypt in state (deploy.ts:113) |
| Secrets provider configured | Medium | `pulumi stack init --secrets-provider=awskms://...` for production |

**deploy.ts status:** `_Ops.secret()` wraps all sensitive values (line 113). Secrets stored in `k8s.core.v1.Secret` with `stringData` (line 159). PASS.

### RBAC

| Check | Severity | WHY |
|-------|----------|-----|
| ServiceAccount per workload (not `default`) | Medium | `default` SA may accumulate permissions from other bindings |
| Role over ClusterRole | Medium | Namespace-scoped limits blast radius of compromised SA |
| Minimal verb set | Medium | `get`/`list`/`watch` unless mutation is required |
| No wildcard resources or verbs (`*`) | Critical | Grants full cluster access; violates least-privilege |

### Admission Control (K8s 1.30+ GA)

| Check | Severity | WHY |
|-------|----------|-----|
| ValidatingAdmissionPolicy for resource limits | Low | CEL-based policy enforcement without webhook overhead |
| ValidatingAdmissionPolicy for security context | Low | Enforce non-root, drop capabilities at admission time |
| Policy binding scope appropriate | Medium | Overly broad bindings can block legitimate operations |

**deploy.ts status:** No ValidatingAdmissionPolicy defined. Flag as [INFO] for future hardening.

## Reliability

### Image Tags

| Check | Severity | WHY | HOW |
|-------|----------|-----|-----|
| No `:latest` tag | High | Non-deterministic; `imagePullPolicy: Always` re-pulls on every restart; no rollback target | Pin to `image:v1.2.3` or digest `@sha256:...` |
| No untagged images | High | Equivalent to `:latest` | Always specify `image:tag` |
| No partial tags (`:v3`) | Medium | May resolve to different patch versions over time | Pin to full semver `:v3.1.2` |

**deploy.ts status:** API image is env-driven (user controls tag). Observe images use `:latest` (deploy.ts:14: `alloy: 'grafana/alloy:latest'`, `grafana: 'grafana/grafana:latest'`, `prometheus: 'prom/prometheus:latest'`). Flag as [WARN] for production.

### Health Probes

| Probe | Severity | WHY | Guidelines |
|-------|----------|-----|------------|
| Liveness | Critical | Without it, stuck processes never restart | Lightweight check; no external deps; `periodSeconds: 10`, `failureThreshold: 3` |
| Readiness | Critical | Without it, traffic routes to unready pods causing 502/503 | May check dependencies; `periodSeconds: 5`, `failureThreshold: 3` |
| Startup | Low | Without it, slow-starting apps get killed by liveness probe before ready | `failureThreshold * periodSeconds` >= max startup time |

**deploy.ts status:** All three probes configured (line 19). Startup window: 150s (30 x 5s). PASS.

```typescript
// Reference: deploy.ts:19
livenessProbe:  { httpGet: { path: '/api/health/liveness', port: 4000 }, periodSeconds: 10, failureThreshold: 3 },
readinessProbe: { httpGet: { path: '/api/health/readiness', port: 4000 }, periodSeconds: 5,  failureThreshold: 3 },
startupProbe:   { httpGet: { path: '/api/health/liveness', port: 4000 }, periodSeconds: 5,  failureThreshold: 30 },
```

### Resources

Check ALL containers in each pod spec (primary, init, sidecars with `restartPolicy: Always`).

| Field | Severity | WHY | Guideline |
|-------|----------|-----|-----------|
| `requests.cpu` | Critical | Scheduler uses requests for placement; without it, pod is `BestEffort` QoS (first evicted) | Set to steady-state usage |
| `requests.memory` | Critical | OOM-kill threshold; missing = evicted first under pressure | Set to working-set size |
| `limits.cpu` | Medium | Without it, one pod can starve neighbors on the node | 2-5x requests for burst headroom |
| `limits.memory` | Critical | Unbounded memory -> OOM kills other pods on the node | Never lower than requests; critical workloads set `limits == requests` for `Guaranteed` QoS |

**deploy.ts status:** API container has requests + limits set equal (deploy.ts:168: `{ limits: { cpu, memory }, requests: { cpu, memory } }`). Guaranteed QoS. Alloy has limits (deploy.ts:148). PASS.

### PodDisruptionBudget

Every Deployment/StatefulSet with `replicas >= 2` needs a PDB.

| Setting | When | WHY |
|---------|------|-----|
| `minAvailable: "50%"` | General purpose | Survives node drain during cluster upgrades |
| `maxUnavailable: 1` | Small replica count (2-3) | Ensures at least N-1 pods remain |
| `minAvailable: 1` | Single-replica workloads | Blocks voluntary disruption entirely |

**deploy.ts status:** No PDB defined. Flag as [WARN] when replicas >= 2.

### Scheduling

| Pattern | Severity | WHY | Key field |
|---------|----------|-----|-----------|
| Pod anti-affinity | Medium | Single-node failure takes all replicas | `topologyKey: "kubernetes.io/hostname"` |
| Topology spread | Low | Uneven zone distribution during failover | `topologyKey: "topology.kubernetes.io/zone"`, `maxSkew: 1` |
| Rolling update strategy | Medium | Default may cause downtime | `maxSurge: 1`, `maxUnavailable: 0` for zero-downtime |

### In-Place Pod Resize (K8s 1.35+ GA)

| Check | Severity | WHY |
|-------|----------|-----|
| `resizePolicy` set per container | Low | Controls whether resize requires container restart |
| Memory decrease within bounds | Low | Memory limit decreases now allowed in 1.35 GA; verify cgroup v2 support |

**Known gap:** Not in current deploy.ts. Optional for future vertical scaling without restarts.

## Networking

| Check | Severity | WHY | HOW |
|-------|----------|-----|-----|
| Default-deny NetworkPolicy | Medium | Without it, any pod can reach any other pod in the namespace | `podSelector: {}`, `policyTypes: ["Ingress", "Egress"]` with empty rules |
| Ingress TLS | Medium | Unencrypted external traffic | `spec.tls` with `hosts` + `secretName` |
| Service type appropriate | Low | LoadBalancer costs money; NodePort exposes ports on every node | ClusterIP for internal (deploy.ts uses this), LoadBalancer for cloud external, NodePort for dev only |
| Gateway API readiness | Low | Ingress is functional but Gateway API is the successor | Consider HTTPRoute/GRPCRoute for new workloads |

**deploy.ts status:** Ingress TLS configured (line 175). ClusterIP used (line 173). No NetworkPolicy. Flag NetworkPolicy as [WARN].

## Storage

| Check | Severity | WHY | HOW |
|-------|----------|-----|-----|
| Access mode matches workload | Medium | RWO on multi-pod StatefulSet causes mount failures | RWO for single-pod (deploy.ts uses this for Prometheus/Grafana), RWX for shared access |
| Storage class specified | Low | Default class may be wrong performance tier | Set `storageClassName` explicitly; use `gp3` on AWS for SSD |
| Backup annotations | Low | Data loss on PV deletion | Enable Velero: `backup.velero.io/backup-volumes: data` |

## Observability

| Check | Severity | WHY | HOW |
|-------|----------|-----|-----|
| Prometheus annotations | Low | Metrics not scraped without them | `prometheus.io/scrape: "true"`, `prometheus.io/port`, `prometheus.io/path` |
| Structured logging | Low | Unstructured logs are unsearchable at scale | Set `LOG_FORMAT=json` env var |
| OTEL endpoint | Low | No distributed traces | Set `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_SERVICE_NAME` |

**deploy.ts status:** OTEL endpoint configured via `_Ops.runtime()` (line 94). Metrics exporter set to `otlp`, logs/traces to `none` (lines 95-97). PASS.

## Naming and Labels

Required labels on all resources:

| Label | Severity | WHY |
|-------|----------|-----|
| `app.kubernetes.io/name` | High | Standard selectors; required for service mesh and monitoring |
| `app.kubernetes.io/instance` | High | Distinguishes multiple releases of same app |
| `app.kubernetes.io/managed-by: pulumi` | High | Identifies management tool; prevents manual-edit conflicts |
| `app.kubernetes.io/version` | Medium | Enables version-aware dashboards and rollback identification |
| `app.kubernetes.io/component` | Medium | Distinguishes frontend/backend/worker within an app |
| `app.kubernetes.io/part-of` | Low | Groups related apps into a logical application |

**deploy.ts status:** Uses simple `{ app: 'parametric-api' }` labels (line 17) and `{ app, stack, tier }` for observe (line 123). Does not use `app.kubernetes.io/*` recommended labels. Flag as [INFO] (functional but non-standard).

Naming rules: lowercase-hyphen, include component, under 63 chars, consistent prefix.

## Cross-Resource Consistency

| Check | Severity | What to Verify |
|-------|----------|----------------|
| Selector alignment | Critical | Service selector == Deployment matchLabels == HPA target labels == PDB selector |
| Port chain | Critical | containerPort == Service targetPort == Ingress/HTTPRoute backend port |
| Namespace uniformity | High | All related resources in same namespace |
| Secret/ConfigMap refs | High | envFrom names match actual resource names |
| PVC claim refs | High | volumeMount claimName matches PVC metadata name |
| Ingress TLS secret | Medium | tls.secretName references existing secret with tls.crt and tls.key |
| HPA scaleTargetRef | Medium | name matches Deployment/StatefulSet metadata name |
| NetworkPolicy selector | Medium | podSelector.matchLabels matches target workload labels |
| Gateway parentRef | Medium | HTTPRoute/GRPCRoute parentRefs.name matches Gateway name |
