# [H1][DEBUG]
>**Dictum:** *Systematic diagnosis eliminates guesswork.*

<br>

Cloud mode (EKS/K8s 1.32+) only. Selfhosted uses Docker containers -- not K8s debugging.

K8s 1.32-1.35 | Stable APIs: sidecar containers GA (1.33), DRA GA (1.33), in-place pod resize GA (1.35), ValidatingAdmissionPolicy GA (1.30+), Gateway API v1.4 (1.35+) | Canonical: `infrastructure/src/deploy.ts` (207 LOC)

[CRITICAL] All `kubectl` state-modifying commands are **temporary**. Update `deploy.ts` + `pulumi up` for permanent resolution.

---
## [1][DECISION_TREE]
>**Dictum:** *Pod status determines the diagnostic path.*

<br>

```
START: kubectl get pods -n parametric -o wide
|
+-- Pending --------> [SCHEDULING]
|   +-- "Insufficient cpu/memory" --> kubectl top nodes --> add nodes or free resources
|   +-- "didn't match node affinity" --> check nodeSelector --> adjust constraint
|   +-- Taints block scheduling --> add tolerations or remove taint
|   +-- "unbound PersistentVolumeClaims" --> kubectl get pvc -n parametric --> fix PVC binding
|
+-- CrashLoopBackOff --> [APPLICATION CRASH]
|   +-- kubectl logs <pod> -n parametric -c api --previous
|   |   +-- Stack trace --> fix app code, redeploy
|   |   +-- "Error: connect ECONNREFUSED" --> verify DB/Redis/deps running
|   |   +-- Missing env var --> check compute-config and compute-secret
|   +-- kubectl describe pod <pod> -n parametric
|       +-- "OOMKilled" (exit 137) --> increase memory limits (deploy.ts:168)
|       +-- "Startup probe failed" --> boot > 150s; increase failureThreshold
|       +-- "Liveness probe failed" --> app hung; check /api/health/liveness
|
+-- ImagePullBackOff --> [IMAGE PULL]
|   +-- "manifest unknown" --> verify image:tag exists in registry
|   +-- "unauthorized" --> create/update imagePullSecrets
|
+-- Running but broken --> [SERVICE/NETWORK]
|   +-- kubectl get endpoints compute-svc -n parametric
|   |   +-- ENDPOINTS empty --> selector mismatch (must be app: parametric-api)
|   |   +-- ENDPOINTS has IPs --> test connectivity from debug pod
|   +-- Ingress 502/503 --> check pod readiness + ingress controller
|   +-- TLS handshake error --> check compute-tls secret + cert expiry
|
+-- Init:* -----------> [SIDECAR CONTAINERS]
|   +-- kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses}'
|   +-- Sidecar (restartPolicy: Always) not starting --> verify image, resources, startup probe
|   +-- Ordering wrong --> dependencies must come first in initContainers array
|   +-- Main starts before sidecar ready --> add startup probe to sidecar
|
+-- Error / Unknown --> [NODE/CLUSTER]
    +-- kubectl describe node <node>
    +-- MemoryPressure/DiskPressure --> evict pods, clean disk, add nodes
    +-- NetworkUnavailable --> check CNI plugin (aws-node on EKS)
```

---
## [2][ESSENTIAL_COMMANDS]
>**Dictum:** *Structured queries replace grep-based debugging.*

<br>

```bash
# --- Pod Lifecycle ---
kubectl get pods -n parametric -o wide
kubectl describe pod <pod> -n parametric
kubectl logs <pod> -n parametric -c api [--previous] [--tail=100]
kubectl exec <pod> -n parametric -c api -it -- /bin/sh
kubectl top pod <pod> -n parametric --containers
kubectl events --for pod/<pod> -n parametric

# --- Structured Queries (jsonpath) ---
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[*].state}'
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[?(@.name=="api")].restartCount}'
kubectl get deploy compute-deploy -n parametric -o jsonpath='{.status.conditions[?(@.type=="Available")].status}'

# --- Service / Network ---
kubectl get svc,endpoints -n parametric
kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- /bin/bash
kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local

# --- Ingress / Gateway API ---
kubectl describe ingress compute-ingress -n parametric
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50
kubectl get gateways,httproutes,grpcroutes -n parametric
kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents[*].conditions}'

# --- HPA ---
kubectl describe hpa compute-hpa -n parametric
kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.currentMetrics}'

# --- Debug Containers (stable 1.25+) ---
kubectl debug <pod> -n parametric -it --image=nicolaka/netshoot --target=api
kubectl debug <pod> -it --copy-to=debug-pod --share-processes --container=api -- /bin/sh
kubectl debug node/<node> -it --image=ubuntu

# --- Sidecar Containers (GA 1.33+) ---
kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[?(@.restartPolicy=="Always")]}'

# --- In-Place Pod Resize (GA 1.35+) ---
kubectl patch pod <pod> -n parametric --subresource resize --type merge -p \
  '{"spec":{"containers":[{"name":"api","resources":{"requests":{"cpu":"500m","memory":"512Mi"},"limits":{"cpu":"1000m","memory":"1Gi"}}}]}}'
# > [IMPORTANT] Temporary. Update deploy.ts resource specs + pulumi up.
kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'

# --- ValidatingAdmissionPolicy (GA 1.30+) ---
kubectl get validatingadmissionpolicies
kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection -n parametric

# --- ConfigMap / Secret Verification ---
kubectl get configmap compute-config -n parametric -o yaml
kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
kubectl exec <pod> -n parametric -c api -- env | sort

# --- Wait / Condition-Based ---
kubectl wait --for=condition=ready pod -l app=parametric-api -n parametric --timeout=120s
kubectl wait --for=condition=available deployment/compute-deploy -n parametric --timeout=300s
```

---
## [3][HPA_TROUBLESHOOTING]
>**Dictum:** *HPA failures trace to metrics availability and request configuration.*

<br>

```
kubectl describe hpa compute-hpa -n parametric
|
+-- <unknown> values --> metrics-server not running
|   +-> kubectl get pods -n kube-system -l k8s-app=metrics-server
|
+-- Stuck at minReplicas
|   +-> "FailedGetResourceMetric" or "FailedComputeMetricsReplicas"
|   +-> Resource requests not set = HPA cannot compute utilization %
|   +-> Fix: set cpu/memory requests in deploy.ts:168
|
+-- Flapping (rapid scale up/down)
|   +-> Increase behavior.scaleDown.stabilizationWindowSeconds (default 300s)
|   +-> Add scaleDown.policies to limit velocity (e.g., max 1 pod per 60s)
|
+-- Custom metrics not found
|   +-> kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 --> 404 = no adapter
|   +-> Fix: deploy Prometheus Adapter
|
+-- Not scaling under load
    +-> HPA formula: ceil(currentMetric / targetMetric * currentReplicas)
    +-> No requests = utilization undefined = HPA cannot scale
```

---
## [4][SERVICE_CONNECTIVITY]
>**Dictum:** *Service connectivity diagnosis layers selectors, DNS, and network policies.*

<br>

```
kubectl get endpoints compute-svc -n parametric
|
+-- ENDPOINTS empty
|   +-> Selector mismatch: must be app: parametric-api (deploy.ts:17)
|   +-> kubectl get svc compute-svc -n parametric -o jsonpath='{.spec.selector}'
|
+-- ENDPOINTS has IPs --> test from debug pod:
    +-> kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- \
        curl -sv compute-svc.parametric.svc.cluster.local:4000/api/health/liveness
    +-- DNS fails --> [DNS Issues below]
    +-- "Connection refused" --> verify targetPort matches 4000
    +-- Timeout --> kubectl get networkpolicies -n parametric
    +-- HTTP error --> kubectl logs <pod> -n parametric -c api --tail=50
```

**DNS Issues:**
```
kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local
|
+-- NXDOMAIN or timeout
|   +-> kubectl get pods -n kube-system -l k8s-app=kube-dns
|   +-> Not Running: investigate CoreDNS logs
|   +-> Running: kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
|       +-> Look for: SERVFAIL, loop detection, plugin errors
|
+-- Pod DNS config wrong
    +-> kubectl exec <pod> -- cat /etc/resolv.conf
    +-> Expected: nameserver <cluster-dns-ip>, search parametric.svc.cluster.local
    +-> Fix: check kubelet --cluster-dns and --cluster-domain flags
```

---
## [5][INGRESS_AND_GATEWAY_API]
>**Dictum:** *Ingress/Gateway debugging traces backends, TLS, and controller state.*

<br>

**Ingress (nginx):**
```
kubectl describe ingress compute-ingress -n parametric
|
+-- 502/503 --> kubectl get endpoints compute-svc -n parametric (empty = no backends)
+-- TLS error --> kubectl get secret compute-tls -n parametric -o jsonpath='{.data}'
|   +-- Missing --> recreate cert or check cert-manager
|   +-- Expired --> base64 -d | openssl x509 -noout -dates
+-- Controller errors --> kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50
```

**Gateway API (v1.4):**
```
kubectl get gateways,httproutes,grpcroutes -n parametric
|
+-- Gateway not Accepted/Programmed --> kubectl describe gateway <gw> -n parametric
+-- HTTPRoute not attached --> check parentRef matches gateway name/namespace
+-- GRPCRoute not routing --> verify method filter + backend refs
+-- Cross-namespace blocked --> kubectl get referencegrant -A --> create ReferenceGrant
```

---
## [6][CLUSTER_OPERATIONS]
>**Dictum:** *Cluster-level issues require node, deployment, and config diagnosis.*

<br>

**Stuck deployment:**
```
kubectl rollout status deployment/compute-deploy -n parametric
+-> kubectl get rs -n parametric -l app=parametric-api --> new RS with READY=0?
+-> kubectl get pods -l app=parametric-api -n parametric --> check pod status
    +-- CrashLoop/ImagePull/Pending --> follow decision tree above
```

**ConfigMap/Secret verification:**
```
kubectl exec <pod> -n parametric -c api -- env | sort
+-- Missing var --> check envFrom refs in deploy.ts
+-- Stale value --> pods not restarted after update (envFrom read at pod start)
+-- Wrong value --> update deploy.ts --> pulumi up
```

**In-place resize status:**
```
kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'
+-- "" (empty) --> resize complete
+-- "InProgress" --> wait; node processing
+-- "Deferred" --> container restart needed (depends on resizePolicy)
+-- "Infeasible" --> node cannot accommodate; kubectl top node
```

**Node resource exhaustion:**
```
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'
+-- NotReady --> kubectl describe node <name> --> check Conditions
    +-- MemoryPressure: evict non-critical pods, add nodes
    +-- DiskPressure: clean containerd storage, prune images
    +-- PIDPressure: kubectl top pods --sort-by=cpu
    +-- NetworkUnavailable: check CNI plugin (aws-node on EKS)
```

**Observability stack:**
```
kubectl get pods -n parametric -l tier=observe
+-- Alloy not running --> check config.alloy syntax (River)
+-- Prometheus not running --> check PVC + scrape config
+-- Metrics not flowing --> port-forward svc/prometheus 9090:9090 --> check /targets
```

---
## [7][VALIDATING_ADMISSION_POLICY]
>**Dictum:** *CEL policy debugging requires expression analysis and dry-run testing.*

<br>

```
kubectl get validatingadmissionpolicies
kubectl get validatingadmissionpolicybindings
|
+-- Resource rejected
|   +-> kubectl describe validatingadmissionpolicy <name>
|   +-> Read spec.validations[].expression (CEL) and .message
|   +-> Test: kubectl apply --dry-run=server -f manifest.yaml
|
+-- Policy not enforcing
|   +-> Check: validationActions includes "Deny" (not just "Warn"/"Audit")
|   +-> Check: paramRef and matchResources select intended resources
|
+-- CEL evaluation error
    +-> "no such key" --> use has() macro
    +-> "type mismatch" --> cast with int(), string()
    +-> nil pointer --> use ?. optional chaining: object.spec.?field.orValue(default)
```

---
## [8][EKS_DEBUGGING]
>**Dictum:** *EKS-specific issues require AWS-level diagnostics.*

<br>

| Symptom                       | Diagnostic                                                            | Fix                                                         |
| ----------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pod stuck `ContainerCreating` | `kubectl logs -n kube-system -l k8s-app=aws-node --tail=50`           | VPC CNI IP exhaustion: prefix delegation or larger instance |
| Pod cannot reach AWS APIs     | `kubectl describe sa <sa> -n parametric`                              | IRSA: annotate SA with `eks.amazonaws.com/role-arn`         |
| Node cannot join cluster      | `aws eks describe-nodegroup --cluster-name <c> --nodegroup-name <ng>` | Attach EKS node IAM policies                                |
| Add-on unhealthy              | `aws eks describe-addon --cluster-name <c> --addon-name <name>`       | `aws eks update-addon --addon-version <latest>`             |
| CoreDNS CrashLoop on EKS      | `kubectl logs -n kube-system -l k8s-app=kube-dns`                     | Add Fargate profile or patch compute type                   |

This project uses nginx ingress (NOT ALB) per deploy.ts:16. ALB debugging applies only if ALB controller installed separately.

**VPC CNI deep diagnosis:**
```
kubectl get pods -n kube-system -l k8s-app=aws-node
kubectl logs -n kube-system -l k8s-app=aws-node --tail=50
+-- "ipamd: no available IP addresses" --> scale nodes or enable prefix delegation
+-- "failed to setup ENI" --> ENI limit; use larger instance type
```

**IRSA deep diagnosis:**
```
kubectl describe sa <sa> -n parametric --> check eks.amazonaws.com/role-arn
kubectl exec <pod> -n parametric -- ls /var/run/secrets/eks.amazonaws.com/serviceaccount/
+-- Token missing --> SA not annotated with IAM role ARN
+-- Permission denied --> IAM trust policy OIDC mismatch
```

---
## [9][ESCALATION_CHECKLIST]
>**Dictum:** *Systematic escalation prevents missed root causes.*

<br>

- [ ] Pod events + current/previous logs
- [ ] Startup (150s) vs liveness (30s) probe failure distinguished
- [ ] Node resources: `kubectl top nodes`
- [ ] Image tag exists in registry
- [ ] Service selector matches labels (`app: parametric-api`) + DNS resolves
- [ ] NetworkPolicies not blocking + ConfigMap/Secret/env vars present
- [ ] HPA status + Ingress/TLS healthy
- [ ] Sidecar containers (1.33+) + in-place resize status (1.35+)
- [ ] (EKS) VPC CNI health + IRSA annotation

---
## [10][EMERGENCY_COMMANDS]
>**Dictum:** *Emergency commands bypass IaC -- always follow with deploy.ts update + pulumi up.*

<br>

| Command                                                              | Risk   | Permanent Fix                                                  |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `kubectl rollout restart deployment/compute-deploy -n parametric`    | Low    | Update deploy.ts image/config                                  |
| `kubectl rollout undo deployment/compute-deploy -n parametric`       | Medium | Fix root cause in deploy.ts                                    |
| `kubectl delete pod <pod> -n parametric --force --grace-period=0`    | Medium | Investigate deployment config                                  |
| `kubectl scale deployment/compute-deploy -n parametric --replicas=N` | Medium | Update HPA/replica specs in Pulumi                             |
| `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data`    | High   | Coordinate with Pulumi node config; run `pulumi refresh` after |
| `kubectl taint nodes <node> <key>:<effect>-`                         | High   | Update deploy.ts toleration/taint config                       |
