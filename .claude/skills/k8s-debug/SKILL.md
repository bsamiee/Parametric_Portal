---
name: k8s-debug
description: Comprehensive Kubernetes debugging and troubleshooting toolkit. Use this skill when diagnosing Kubernetes cluster issues, debugging failing pods, investigating network connectivity problems, analyzing resource usage, troubleshooting deployments, or performing cluster health checks.
---

# Kubernetes Debugging Skill

> **Scope**: Cloud mode (EKS/K8s 1.32+) only. Selfhosted mode uses Docker containers -- see the docker-gen/docker-val skills instead.
> **K8s Versions**: Tested on 1.32-1.35. Uses stable APIs: sidecar containers GA (1.33), in-place pod resize GA (1.35), `kubectl events --for` (1.32+), `kubectl debug --copy-to` (1.32+), ValidatingAdmissionPolicy GA (1.30+), Gateway API v1.4 (1.35+).

## Project Resource Map

Source of truth: `infrastructure/src/deploy.ts` (207 LOC)

| Category | Resource | Pulumi Name | K8s Kind | Key Details |
|---|---|---|---|---|
| Namespace | `parametric-ns` | Namespace | `metadata.name: parametric` |
| Compute | `compute-deploy` | Deployment | Container `api`, label `app: parametric-api`, port 4000 |
| Compute | `compute-svc` | Service (ClusterIP) | Port 4000/TCP, selector `app: parametric-api` |
| Compute | `compute-hpa` | HPA (autoscaling/v2) | CPU + memory utilization targets, env-driven min/max |
| Compute | `compute-ingress` | Ingress (nginx class) | TLS via `compute-tls` secret, `ssl-redirect: true`, `proxy-body-size: 50m` |
| Compute | `compute-config` | ConfigMap | Non-secret env vars (API_BASE_URL, POSTGRES_HOST, REDIS_HOST, OTEL_*, etc.) |
| Compute | `compute-secret` | Secret | Secret env vars (POSTGRES_PASSWORD, REDIS_PASSWORD, etc.) |
| Observe | `observe-alloy` | DaemonSet | Grafana Alloy OTLP collector, image `grafana/alloy:latest` |
| Observe | `observe-alloy-svc` | Service (ClusterIP) | gRPC :4317, HTTP :4318, metrics :12345 |
| Observe | `prometheus` | Deployment (via `_k8sObserve`) | Port 9090, PVC for `/prometheus`, scrape interval 15s |
| Observe | `grafana` | Deployment (via `_k8sObserve`) | Port 3000, PVC for `/var/lib/grafana`, Prometheus datasource |

### Probes (from `_CONFIG.k8s.probes` in deploy.ts:19)

| Probe | Path | Port | Period | Failure Threshold | Total Window |
|---|---|---|---|---|---|
| Startup | `/api/health/liveness` | 4000 | 5s | 30 | 150s (5s x 30) |
| Liveness | `/api/health/liveness` | 4000 | 10s | 3 | 30s (10s x 3) |
| Readiness | `/api/health/readiness` | 4000 | 5s | 3 | 15s (5s x 3) |

`terminationGracePeriodSeconds: 30` (deploy.ts:171)

### Downward API Env Vars (from `_Ops.k8sEnv` in deploy.ts:61)

| Env Var | Source |
|---|---|
| `K8S_CONTAINER_NAME` | `"api"` (literal) |
| `K8S_DEPLOYMENT_NAME` | `"compute-deploy"` (literal) |
| `K8S_NAMESPACE` | `metadata.namespace` (fieldRef) |
| `K8S_NODE_NAME` | `spec.nodeName` (fieldRef) |
| `K8S_POD_NAME` | `metadata.name` (fieldRef) |

### Labels and Selectors

| Tier | Label Set | Used By |
|---|---|---|
| Compute | `app: parametric-api` | Deployment selector, Service selector, HPA target |
| Observe | `app: <component>, stack: parametric, tier: observe` | DaemonSet/Deployment selectors, pod identity |
| Metadata | `component: <name>, stack: parametric, tier: observe` | `_Ops.meta()` on all observe resources |

```bash
# Quick status for all project resources
kubectl get deploy,ds,svc,hpa,ingress,configmap,secret -n parametric
kubectl get pods -n parametric -o wide
kubectl top pods -n parametric --containers
```

## Decision Tree

```
START: What is the pod status?
|
+-- Pending --------> [SCHEDULING WORKFLOW]
|   |
|   +-- "Insufficient cpu/memory" --> kubectl top nodes --> add nodes or free resources
|   +-- "didn't match node affinity" --> check nodeSelector --> adjust constraint
|   +-- Taints block scheduling --> check taints --> add tolerations or remove taint
|   +-- "unbound PersistentVolumeClaims" --> kubectl get pvc -n parametric --> fix PVC binding
|
+-- CrashLoopBackOff --> [APPLICATION CRASH WORKFLOW]
|   |
|   +-- kubectl logs <pod> -n parametric -c api --previous
|   |   +-- Stack trace / exception --> fix app code, redeploy
|   |   +-- "Error: connect ECONNREFUSED" --> verify DB/Redis/deps running
|   |   +-- Missing env var --> check compute-config and compute-secret
|   |
|   +-- kubectl describe pod <pod> -n parametric
|       +-- "OOMKilled" (exit 137) --> increase memory limits (deploy.ts:168)
|       +-- "Startup probe failed" --> app boot > 150s; increase failureThreshold
|       +-- "Liveness probe failed" (post-startup) --> app hung; check /api/health/liveness
|
+-- ImagePullBackOff --> [IMAGE PULL WORKFLOW]
|   |
|   +-- "manifest unknown" / "not found" --> verify image:tag exists in registry
|   +-- "unauthorized" / "access denied" --> create/update imagePullSecrets
|
+-- Running but broken --> [SERVICE/NETWORK WORKFLOW]
|   |
|   +-- kubectl get endpoints compute-svc -n parametric
|   |   +-- ENDPOINTS empty --> selector mismatch (must be app: parametric-api)
|   |   +-- ENDPOINTS has IPs --> test connectivity from debug pod
|   |       +-- DNS fails --> [DNS WORKFLOW]
|   |       +-- Connection refused --> targetPort mismatch (must be 4000)
|   |       +-- Timeout --> check NetworkPolicies
|   |
|   +-- Ingress 502/503 --> check pod readiness + ingress controller
|   +-- TLS handshake error --> check compute-tls secret + cert expiry
|
+-- Error / Unknown --> [NODE/CLUSTER WORKFLOW]
    |
    +-- kubectl describe node <node>
    +-- MemoryPressure/DiskPressure/PIDPressure --> evict pods, clean disk, add nodes
    +-- NetworkUnavailable --> check CNI plugin (aws-node on EKS)
```

## Essential Commands

```bash
# --- Pod Lifecycle ---
kubectl get pods -n parametric -o wide
kubectl describe pod <pod> -n parametric
kubectl logs <pod> -n parametric -c api [--previous] [--tail=100]
kubectl exec <pod> -n parametric -c api -it -- /bin/sh
kubectl top pod <pod> -n parametric --containers
kubectl events --for pod/<pod> -n parametric

# --- Structured Queries (jsonpath -- no grep) ---
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[*].state}'
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[?(@.name=="api")].restartCount}'
kubectl get pods -n parametric -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}'
kubectl get deploy compute-deploy -n parametric -o jsonpath='{.status.conditions[?(@.type=="Available")].status}'

# --- Service / Network ---
kubectl get svc,endpoints -n parametric
kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- /bin/bash
kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local

# --- Ingress (nginx -- project default) ---
kubectl describe ingress compute-ingress -n parametric
kubectl get pods -n ingress-nginx
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50

# --- Gateway API (if using Gateway API v1.2+) ---
kubectl get gateways,httproutes,grpcroutes -n parametric
kubectl describe gateway <gateway> -n parametric
kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents[*].conditions}'

# --- HPA ---
kubectl get hpa compute-hpa -n parametric
kubectl describe hpa compute-hpa -n parametric

# --- Observability Stack ---
kubectl get pods -n parametric -l tier=observe
kubectl logs -n parametric -l app=alloy --tail=50
kubectl logs -n parametric -l app=prometheus --tail=50
kubectl logs -n parametric -l app=grafana --tail=50

# --- Cluster ---
kubectl top nodes
kubectl get events -n parametric --sort-by='.lastTimestamp'
kubectl get nodes -o wide

# --- Debug Containers (stable 1.25+) ---
# Attach ephemeral debug container to running pod (no restart)
kubectl debug <pod> -n parametric -it --image=nicolaka/netshoot --target=api
# Copy pod for debugging (shares process namespace)
kubectl debug <pod> -it --copy-to=debug-pod --share-processes --container=api -- /bin/sh
# Debug distroless containers (no shell in original image)
kubectl debug <pod> -n parametric -it --image=busybox --target=api -- /bin/sh
# Debug node-level issues
kubectl debug node/<node> -it --image=ubuntu

# --- Sidecar Containers (GA 1.33+) ---
# Sidecars are init containers with restartPolicy: Always
# Check sidecar definition:
kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[?(@.restartPolicy=="Always")]}'
# Check sidecar status:
kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses[*].name}'
# Sidecar ordering: sidecars start in order BEFORE main containers
# If sidecar depends on another sidecar, order matters in initContainers array

# --- In-Place Pod Resize (GA 1.35+) ---
# Resize CPU/memory without pod restart:
kubectl patch pod <pod> -n parametric --subresource resize --type merge -p \
  '{"spec":{"containers":[{"name":"api","resources":{"requests":{"cpu":"500m","memory":"512Mi"},"limits":{"cpu":"1000m","memory":"1Gi"}}}]}}'
# Check resize status:
kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'
# Expected output: "" (empty = done), "InProgress", "Deferred", "Infeasible"
# Check allocated resources after resize:
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[?(@.name=="api")].allocatedResources}'

# --- ValidatingAdmissionPolicy (GA 1.30+) ---
kubectl get validatingadmissionpolicies
kubectl get validatingadmissionpolicybindings
# Debug policy rejections:
kubectl describe validatingadmissionpolicy <policy-name>
# Check CEL expression evaluation errors:
kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection -n parametric

# --- Dry-Run / Diff ---
kubectl diff -f manifest.yaml
kubectl apply --dry-run=server -f manifest.yaml

# --- Wait / Condition-Based Scripting ---
kubectl wait --for=condition=ready pod -l app=parametric-api -n parametric --timeout=120s
kubectl wait --for=condition=available deployment/compute-deploy -n parametric --timeout=300s
kubectl wait --for=delete pod/<pod> -n parametric --timeout=60s
kubectl wait --for=jsonpath='{.status.phase}'=Running pod/<pod> -n parametric --timeout=60s
# Wait for HPA to have current metrics:
kubectl wait --for=jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}' hpa/compute-hpa -n parametric --timeout=120s

# --- ConfigMap / Secret Verification ---
kubectl get configmap compute-config -n parametric -o yaml
kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
kubectl exec <pod> -n parametric -c api -- env | sort

# --- EKS-Specific ---
aws eks describe-cluster --name <cluster>
aws eks describe-addon --cluster-name <cluster> --addon-name <addon>
kubectl get pods -n kube-system -l k8s-app=aws-node
kubectl logs -n kube-system -l k8s-app=aws-node --tail=50

# --- Emergency ---
kubectl rollout restart deployment/compute-deploy -n parametric
kubectl rollout undo deployment/compute-deploy -n parametric
kubectl delete pod <pod> -n parametric --force --grace-period=0
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl cordon <node>
```

## EKS Debugging

| Symptom | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| Pod stuck `ContainerCreating` | `kubectl logs -n kube-system -l k8s-app=aws-node --tail=50` | "ipamd: no available IP addresses" or "failed to setup ENI" | VPC CNI IP/ENI exhaustion: scale node group, use prefix delegation, or use larger instance type |
| Pod cannot reach AWS APIs | `kubectl describe sa <sa> -n parametric` | Missing `eks.amazonaws.com/role-arn` annotation | IRSA misconfigured: annotate ServiceAccount with correct IAM role ARN |
| Node cannot join cluster | `aws eks describe-nodegroup --cluster-name <c> --nodegroup-name <ng>` | `status: CREATE_FAILED` or health issues | Attach `AmazonEKSWorkerNodePolicy`, `AmazonEKS_CNI_Policy`, `AmazonEC2ContainerRegistryReadOnly` |
| Add-on unhealthy | `aws eks describe-addon --cluster-name <c> --addon-name <name>` | `status: DEGRADED` with version conflict | `aws eks update-addon --cluster-name <c> --addon-name <name> --addon-version <latest>` |
| CloudWatch missing logs | `aws logs describe-log-groups --log-group-name-prefix /aws/eks` | No log groups matching cluster name | Enable Container Insights: `aws eks update-cluster-config --logging` |
| CoreDNS CrashLoop on EKS | `kubectl logs -n kube-system -l k8s-app=kube-dns` | OOMKilled or Fargate scheduling errors | Add CoreDNS Fargate profile or patch compute type annotation |
| ALB not routing | `kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller` | "failed to build model" or subnet errors | Check subnet tags (`kubernetes.io/role/elb`) and IAM policy |

**Note:** This project uses nginx ingress (NOT ALB), per deploy.ts:16. ALB debugging applies only if ALB controller is installed separately.

## Scripts

| Script | Scope | Usage |
|---|---|---|
| `scripts/pod_diagnostics.py` | Single pod deep-dive | `python3 scripts/pod_diagnostics.py <pod> -n parametric [-c api] [-o report.txt]` |
| `scripts/cluster_health.sh` | Cluster-wide overview | `./scripts/cluster_health.sh` (requires: `jq`) |
| `scripts/network_debug.sh` | Pod network connectivity | `./scripts/network_debug.sh parametric <pod>` |

## Escalation Checklist

- [ ] Reviewed pod events via `kubectl events --for pod/<pod> -n parametric`
- [ ] Checked current + previous logs: `kubectl logs <pod> -n parametric -c api [--previous]`
- [ ] Distinguished startup probe failure (150s window) from liveness probe failure (30s window)
- [ ] Verified node resource availability via `kubectl top nodes`
- [ ] Confirmed image accessible: `kubectl get deploy compute-deploy -n parametric -o jsonpath='{.spec.template.spec.containers[0].image}'`
- [ ] Validated service selector matches pod labels (`app: parametric-api`)
- [ ] Tested DNS: `kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local`
- [ ] Checked NetworkPolicies: `kubectl get networkpolicies -n parametric`
- [ ] Confirmed ConfigMap + Secret exist: `kubectl get configmap compute-config secret compute-secret -n parametric`
- [ ] Verified env vars injected: `kubectl exec <pod> -n parametric -c api -- env | sort`
- [ ] Checked HPA status: `kubectl describe hpa compute-hpa -n parametric`
- [ ] Checked Ingress + TLS: `kubectl describe ingress compute-ingress -n parametric`
- [ ] Validated RBAC: `kubectl auth can-i --list --as=system:serviceaccount:parametric:default -n parametric`
- [ ] Checked ResourceQuotas: `kubectl get resourcequotas -n parametric`
- [ ] Verified observability stack: `kubectl get pods -n parametric -l tier=observe`
- [ ] Checked sidecar containers (1.33+): `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[?(@.restartPolicy=="Always")]}'`
- [ ] Checked in-place resize status (1.35+): `kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'`
- [ ] (EKS) Verified VPC CNI health: `kubectl get pods -n kube-system -l k8s-app=aws-node`
- [ ] (EKS) Verified IRSA: `kubectl describe sa -n parametric`
