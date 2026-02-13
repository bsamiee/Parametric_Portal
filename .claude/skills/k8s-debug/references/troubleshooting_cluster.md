# [H1][TROUBLESHOOTING_CLUSTER]
>**Dictum:** *Cluster-level workflows diagnose HPA, deployment, resize, and node issues.*

<br>

Namespace: `parametric` | Deployment: `compute-deploy` | Container: `api` port 4000 | K8s 1.32-1.35 | In-place resize GA (1.35) | DRA GA (1.33) | Fine-grained supplemental groups GA (1.35)

---
## [1][HPA_AUTOSCALING]
>**Dictum:** *HPA troubleshooting traces metrics availability to scaling behavior.*

<br>

```
kubectl get hpa compute-hpa -n parametric
|
+-> kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.currentMetrics}'
|
+-- <unknown> values -> metrics-server not reporting
|   +-> kubectl get pods -n kube-system -l k8s-app=metrics-server
|   +-> Fix: install/restart metrics-server
|
+-- Stuck at minReplicas
|   +-> kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.conditions}'
|   +-> Look for: "FailedGetResourceMetric" or "FailedComputeMetricsReplicas"
|   +-> Common cause: resource requests not set -> HPA cannot compute utilization %
|   +-> Fix: set cpu/memory requests in deploy.ts:168
|
+-- Flapping (rapid scale up/down)
|   +-> kubectl describe hpa compute-hpa -n parametric
|   +-> Fix: increase behavior.scaleDown.stabilizationWindowSeconds (default 300s)
|   +-> Fix: add scaleDown.policies to limit velocity (e.g., max 1 pod per 60s)
|
+-- Custom metrics not found
|   +-> kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 -> 404 = no adapter
|   +-> Fix: deploy Prometheus Adapter or equivalent
|
+-- Not scaling under load
    +-> Verify CPU/memory requests set in deploy.ts:168
    +-> HPA formula: ceil(currentMetric / targetMetric * currentReplicas)
    +-> No requests = utilization undefined = HPA cannot scale
```

---
## [2][STUCK_DEPLOYMENT]
>**Dictum:** *Deployment stalls require pod-level and rollout history analysis.*

<br>

```
kubectl rollout status deployment/compute-deploy -n parametric
|
+-> kubectl get rs -n parametric -l app=parametric-api -> new RS with READY=0?
+-> kubectl get pods -l app=parametric-api -n parametric -> check pod status
    |
    +-- Pods in CrashLoop/ImagePull/Pending -> troubleshooting_pods.md
    +-- Pause: kubectl rollout pause deployment/compute-deploy -n parametric
    +-- Rollback: kubectl rollout undo deployment/compute-deploy -n parametric
```
> [IMPORTANT] `kubectl rollout undo` is temporary. Fix root cause in `deploy.ts` + `pulumi up`.

```
    +-- Rollback to revision: kubectl rollout undo ... --to-revision=N
    +-- History: kubectl rollout history deployment/compute-deploy -n parametric
```

---
## [3][CONFIGMAP_SECRET_VERIFICATION]
>**Dictum:** *Environment verification ensures pod config matches expectations.*

<br>

```
kubectl get configmap compute-config -n parametric -o yaml
kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
kubectl exec <pod> -n parametric -c api -- env | sort
|
+-- Missing var
|   +-> kubectl get deploy compute-deploy -n parametric -o jsonpath='{.spec.template.spec.containers[0].envFrom}'
|   +-> Fix: update references in deploy.ts
|
+-- Stale value (pods not restarted after ConfigMap/Secret update)
|   +-> kubectl rollout restart deployment/compute-deploy -n parametric
```
> [IMPORTANT] `kubectl rollout restart` is temporary. Update `deploy.ts` config via `pulumi up`.

```
|   +-> Note: envFrom is read at pod start; changes do NOT auto-restart pods
|
+-- Wrong value
    +-> Update deploy.ts -> pulumi up
    +-> Verify: kubectl exec <pod> -n parametric -c api -- env | grep <KEY>
```

---
## [4][IN_PLACE_POD_RESIZE]
>**Dictum:** *Resize status indicates capacity, restart requirement, or infeasibility.*

<br>

```
kubectl patch pod <pod> -n parametric --subresource resize --type merge -p \
  '{"spec":{"containers":[{"name":"api","resources":{"requests":{"cpu":"500m","memory":"512Mi"},"limits":{"cpu":"1000m","memory":"1Gi"}}}]}}'
```
> [IMPORTANT] `kubectl patch pod --subresource resize` is temporary. Update `deploy.ts` resource specs via `pulumi up`.

```
+-> kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'
|
+-- "" (empty) -> resize complete
+-- "InProgress" -> wait
+-- "Deferred" -> container restart needed (depends on resizePolicy)
|   +-> RestartContainer: pod restarts affected container
|   +-> NotRequired: live resize (CPU only; memory decrease may require restart)
+-- "Infeasible" -> node cannot accommodate; kubectl top node <node-name>

# Verify after resize:
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[?(@.name=="api")].allocatedResources}'
```

---
## [5][OBSERVABILITY_STACK]
>**Dictum:** *Observability stack diagnosis validates Alloy, Prometheus, and Grafana.*

<br>

```
kubectl get pods -n parametric -l tier=observe
|
+-- Alloy not running
|   +-> kubectl describe pod -n parametric -l app=alloy
|   +-> kubectl get cm observe-alloy-cfg -n parametric -o yaml
|   +-> Look for: River syntax errors in config.alloy
|
+-- Prometheus not running
|   +-> kubectl logs -n parametric -l app=prometheus --tail=50
|   +-> Check PVC: kubectl get pvc -n parametric -l component=prometheus
|
+-- Grafana not running
|   +-> kubectl logs -n parametric -l app=grafana --tail=50
|
+-- Metrics not flowing (Alloy -> Prometheus)
    +-> kubectl port-forward svc/prometheus 9090:9090 -n parametric
    +-> http://localhost:9090/targets -> check Alloy target status
    +-> If DOWN: verify service discovery and metrics port (12345)
```

---
## [6][NODE_RESOURCE_EXHAUSTION]
>**Dictum:** *Node conditions expose memory, disk, PID, and network failures.*

<br>

```
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'
|
+-- Node NotReady
|   +-> kubectl describe node <name> -> check Conditions
|   +-> MemoryPressure: evict non-critical pods, add nodes
|   +-> DiskPressure: clean containerd storage, prune images
|   +-> PIDPressure: kubectl top pods --sort-by=cpu
|   +-> NetworkUnavailable: check CNI plugin (aws-node on EKS)
|
+-- Node Ready but resource-constrained
    +-> kubectl top node <name>
    +-> kubectl get node <name> -o jsonpath='{.status.allocatable}'
    +-> Fix: evict pods, add nodes, clean disk, or scale node group
```

Emergency node operations:

```
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
```
> [CRITICAL] `kubectl drain` bypasses Pulumi state. Coordinate with Pulumi node config. Run `pulumi refresh` after.

```
kubectl delete pod <pod> -n parametric --force --grace-period=0
```
> [IMPORTANT] `kubectl delete pod` is temporary. Investigate root cause in `deploy.ts`.

```
kubectl scale deployment/compute-deploy -n parametric --replicas=N
```
> [IMPORTANT] `kubectl scale` is temporary. Update HPA/deployment specs in Pulumi via `pulumi up`.

---
## [7][EKS_SPECIFIC_ISSUES]
>**Dictum:** *EKS adds VPC CNI, IRSA, and add-on specific diagnostics.*

<br>

```
VPC CNI (aws-node):
kubectl get pods -n kube-system -l k8s-app=aws-node
-> kubectl logs -n kube-system -l k8s-app=aws-node --tail=50
   +-- "ipamd: no available IP addresses" -> scale nodes or enable prefix delegation
   +-- "failed to setup ENI" -> ENI limit; use larger instance type

IRSA (IAM Roles for Service Accounts):
kubectl describe sa <sa> -n parametric -> check eks.amazonaws.com/role-arn
-> kubectl exec <pod> -n parametric -- ls /var/run/secrets/eks.amazonaws.com/serviceaccount/
   +-- Token missing -> SA not annotated with IAM role ARN
   +-- Permission denied -> IAM trust policy OIDC mismatch

EKS Add-ons:
aws eks describe-addon --cluster-name <cluster> --addon-name vpc-cni
aws eks describe-addon --cluster-name <cluster> --addon-name coredns
-> Status "DEGRADED" -> aws eks update-addon --addon-version <latest>
```

---
## [8][VALIDATING_ADMISSION_POLICY]
>**Dictum:** *CEL policy debugging requires expression analysis and dry-run testing.*

<br>

```
kubectl get validatingadmissionpolicies
kubectl get validatingadmissionpolicybindings
|
+-- Resource rejected by policy
|   +-> kubectl describe validatingadmissionpolicy <name>
|   |   -> Read spec.validations[].expression (CEL) and .message
|   +-> Test: kubectl apply --dry-run=server -f manifest.yaml
|   +-> Common CEL: has(object.spec.securityContext), .all(c, ...), .exists(k, ...)
|
+-- Policy not enforcing
|   +-> Check: validationActions includes "Deny" (not just "Warn"/"Audit")
|   +-> Check: paramRef and matchResources select intended resources
|
+-- CEL evaluation error
    +-> kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection -n parametric
    +-> "no such key" -> use has() macro
    +-> "type mismatch" -> cast with int(), string()
    +-> nil pointer -> use ?. optional chaining: object.spec.?field.orValue(default)
```
