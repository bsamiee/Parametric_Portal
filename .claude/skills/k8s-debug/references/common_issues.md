# Common Kubernetes Issues

> All resources in namespace `parametric`. Deployment: `compute-deploy`. Service: `compute-svc`. Container: `api` on port 4000.
> Source of truth: `infrastructure/src/deploy.ts`
> K8s: 1.32-1.35. Sidecar containers GA (1.33). In-place pod resize GA (1.35). ValidatingAdmissionPolicy GA (1.30+).

## Pod Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **CrashLoopBackOff** | `kubectl logs <pod> -n parametric -c api --previous` | Stack traces, connection errors, missing module errors | Fix app code/config |
| | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers[0].resources}'` | Limits too low relative to actual usage | Increase memory/CPU limits in deploy.ts:168 |
| | `kubectl describe pod <pod> -n parametric` | "Startup probe failed" in events | Boot exceeds 150s (30 failures x 5s period); increase `_CONFIG.k8s.probes.startup.failureThreshold` |
| | `kubectl describe pod <pod> -n parametric` | "Liveness probe failed" in events (after startup succeeded) | App hangs post-startup; check `/api/health/liveness` endpoint |
| | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers[0].volumeMounts}'` | Missing expected mounts | Add volume and volumeMount to pod spec |
| **ImagePullBackOff** | `kubectl describe pod <pod> -n parametric` | "manifest unknown" or "repository does not exist" | Verify image:tag exists in registry |
| | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.imagePullSecrets}'` | Empty array or missing field | Add docker-registry secret |
| **Pending** | `kubectl describe pod <pod> -n parametric` | "Insufficient cpu" or "Insufficient memory" in events | Add nodes or free resources |
| | `kubectl top nodes` | All nodes at capacity (CPU%/MEM% near 100%) | Scale node group |
| | `kubectl get pvc -n parametric` | STATUS: Pending (not Bound) | Fix PVC binding: check StorageClass and provisioner |
| | Node taints with no matching tolerations | `NoSchedule` taint blocks pod | Add tolerations to pod spec or remove taint |
| **OOMKilled** (exit 137) | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[0].lastState}'` | `terminated.reason: OOMKilled` | Increase memory limits |
| | `kubectl top pod <pod> -n parametric --containers` | MEMORY near limit just before crash | Fix memory leak or increase limits |

## Sidecar Container Issues (K8s 1.33+ GA)

Sidecars are init containers with `restartPolicy: Always`. They start in array order before main containers and terminate after main containers stop.

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Sidecar not starting** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses}'` | Sidecar status shows `waiting` with reason | Check sidecar image, resources, and config |
| **Sidecar ordering wrong** | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[*].name}'` | Dependent sidecar listed before its dependency | Reorder `initContainers` array: dependencies first |
| **Main container starts before sidecar ready** | `kubectl describe pod <pod> -n parametric` | Main container crashes because sidecar service unavailable | Add startup probe to sidecar; K8s waits for sidecar startup probe before starting next init/main container |
| **Sidecar not terminating** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses[*].state}'` | Sidecar still running after main container stopped | Sidecar receives SIGTERM after all main containers exit; check graceful shutdown handler |
| **Legacy sidecar pattern migration** | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers}'` | Sidecar in `containers[]` instead of `initContainers[]` | Move to `initContainers[]` with `restartPolicy: Always` for native lifecycle management |

## In-Place Pod Resize Issues (K8s 1.35+ GA)

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Resize stuck "InProgress"** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'` | Status stays `InProgress` | Node may lack capacity; check `kubectl top node <node>` |
| **Resize "Infeasible"** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'` | Status shows `Infeasible` | Requested resources exceed node allocatable; scale down or move pod to larger node |
| **Resize "Deferred"** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'` | Status shows `Deferred` | Container must restart for the resize to take effect (depends on `resizePolicy`) |
| **Memory limit decrease rejected** | `kubectl describe pod <pod> -n parametric` | Admission error on resize patch | Memory limit decreases are allowed in 1.35 GA but may require cgroup support; verify kernel cgroup v2 |

## Service / Network Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Service unreachable** | `kubectl get endpoints compute-svc -n parametric` | ENDPOINTS column empty | Selector mismatch: must be `app: parametric-api` (deploy.ts:17) |
| | `kubectl get pods -n parametric --show-labels` | Pod labels missing `app=parametric-api` | Fix labels in Deployment template |
| | `kubectl get networkpolicies -n parametric` | Policy blocking ingress on port 4000 | Add ingress rule for port 4000 |
| | `kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- curl compute-svc.parametric.svc.cluster.local:4000/api/health/liveness` | Non-200 response or timeout | Check pod health and network policy |
| **DNS failure** | `kubectl get pods -n kube-system -l k8s-app=kube-dns` | CoreDNS pods not Running | `kubectl rollout restart deployment/coredns -n kube-system` |
| | `kubectl logs -n kube-system -l k8s-app=kube-dns` | SERVFAIL or plugin errors | Check CoreDNS ConfigMap (`kubectl get cm coredns -n kube-system -o yaml`) |
| | `kubectl exec <pod> -n parametric -- cat /etc/resolv.conf` | Wrong nameserver IP or missing search domains | Check kubelet `--cluster-dns` and `--cluster-domain` |
| **EndpointSlice issues** | `kubectl get endpointslices -n parametric -l kubernetes.io/service-name=compute-svc` | No EndpointSlice or missing endpoints | EndpointSlice is the preferred API (Endpoints deprecated in 1.33); check kube-proxy logs |

## Ingress / TLS Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Ingress 502/503** | `kubectl describe ingress compute-ingress -n parametric` | "Backend" annotation shows no healthy endpoints | Check pod readiness probes (`/api/health/readiness`) |
| | `kubectl get pods -n ingress-nginx` | Ingress controller pods not Running | Restart or redeploy nginx controller |
| | `kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50` | "upstream connect error" or "no resolver defined" | Check Service endpoints and DNS |
| **TLS handshake failure** | `kubectl get secret compute-tls -n parametric -o jsonpath='{.data}'` | Missing `tls.crt` or `tls.key` | Recreate TLS secret or check cert-manager |
| | `kubectl get ingress compute-ingress -n parametric -o jsonpath='{.spec.tls}'` | Hostname mismatch with cert SAN | Update cert to match ingress host |

## Gateway API Issues (v1.2+ / v1.4 GA)

Gateway API is the modern replacement for Ingress. This project currently uses nginx Ingress, but Gateway API debugging applies if migrating.

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **HTTPRoute not attached** | `kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents}'` | `Accepted: False` in conditions | Check parentRef matches Gateway name/namespace/section |
| **Gateway not programmed** | `kubectl describe gateway <gw> -n parametric` | `Programmed: False` in status conditions | GatewayClass controller not installed or not ready |
| **GRPCRoute not routing** | `kubectl get grpcroute <route> -n parametric -o jsonpath='{.status}'` | No matching backend or method filter mismatch | Verify service/method names in match rules and backend refs |
| **BackendTLSPolicy rejected** | `kubectl describe backendtlspolicy <name> -n parametric` | "Invalid" or "PolicyNotAccepted" | Check that target backend service exists and port matches |
| **Cross-namespace routing** | `kubectl get referencegrant -A` | No ReferenceGrant in target namespace | Create ReferenceGrant allowing route's namespace to reference target service |

## Storage Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **PVC Pending** | `kubectl describe pvc <name> -n parametric` | "no persistent volumes available" or "waiting for first consumer" | Create matching PV or fix StorageClass |
| | `kubectl get storageclass` | No default StorageClass (missing `(default)` marker) | Set default: `kubectl patch storageclass <name> -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'` |
| | `kubectl logs -n kube-system <provisioner-pod>` | Provisioner errors | Fix dynamic provisioner config |

## Deployment Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Rollout stuck** | `kubectl rollout status deployment/compute-deploy -n parametric` | "Waiting for deployment" with 0 updated replicas | New pods failing; diagnose pod state |
| | `kubectl get rs -n parametric -l app=parametric-api` | New ReplicaSet has 0 READY but desired > 0 | Check new pods for CrashLoop/ImagePull/Pending |
| | `kubectl rollout undo deployment/compute-deploy -n parametric` | -- | Rollback to last working revision |
| | `kubectl rollout history deployment/compute-deploy -n parametric` | Review which revisions exist | Rollback to specific: `--to-revision=N` |

## HPA / Autoscaling Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **HPA not scaling** | `kubectl describe hpa compute-hpa -n parametric` | "FailedGetResourceMetric" in conditions | Ensure metrics-server running: `kubectl get pods -n kube-system -l k8s-app=metrics-server` |
| | `kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.currentMetrics}'` | `<unknown>` for current value | metrics-server not reporting; check its logs |
| **HPA stuck at min** | `kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.conditions}'` | `AbleToScale: False` | Check for resource requests (HPA uses request-relative %) |
| **HPA flapping** | `kubectl describe hpa compute-hpa -n parametric` | Rapid scale-up/scale-down events | Increase `behavior.scaleDown.stabilizationWindowSeconds` (default 300s) |
| **Custom metrics not working** | `kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1` | 404 or empty response | Deploy metrics adapter (Prometheus Adapter, Datadog, etc.) |

## CEL Admission Policy Issues (ValidatingAdmissionPolicy GA 1.30+)

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Policy rejecting valid resources** | `kubectl describe validatingadmissionpolicy <name>` | CEL expression too strict | Fix expression; test with `kubectl apply --dry-run=server -f manifest.yaml` |
| **Policy not enforcing** | `kubectl get validatingadmissionpolicybindings` | No binding for the policy | Create ValidatingAdmissionPolicyBinding targeting correct resources |
| **CEL expression error** | `kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection` | Type error or nil access in CEL | Use `has()` macro for optional fields; check `object.spec.?field.orValue(default)` |
| **Policy bypass via namespace** | `kubectl get validatingadmissionpolicybinding <name> -o yaml` | `matchResources.namespaceSelector` too narrow | Expand selector or use `matchPolicy: Equivalent` |

## Performance Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **High CPU/Memory** | `kubectl top nodes && kubectl top pods -n parametric --containers` | Pod or node resource exhaustion | Scale horizontally (increase HPA max) or optimize app |
| | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers[0].resources}'` | Requests too low (BestEffort QoS) | Set proper requests/limits in deploy.ts:168 |
| **Node pressure** | `kubectl describe node <node>` | `MemoryPressure: True` or `DiskPressure: True` in conditions | Evict pods, add nodes, clean disk |
| | `kubectl get node <node> -o jsonpath='{.status.allocatable}'` | Allocatable resources near zero | Rebalance workloads or add nodes |

## EKS-Specific Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Pod stuck ContainerCreating** | `kubectl logs -n kube-system -l k8s-app=aws-node --tail=50` | "ipamd: no available IP addresses" | VPC CNI IP exhaustion: scale nodes or enable prefix delegation |
| **Pod cannot reach AWS** | `kubectl describe sa <sa> -n parametric` | Missing `eks.amazonaws.com/role-arn` annotation | IRSA: add IAM role ARN annotation to ServiceAccount |
| | `kubectl exec <pod> -n parametric -- env \| grep AWS` | Missing `AWS_WEB_IDENTITY_TOKEN_FILE` | Check projected token mount at `/var/run/secrets/eks.amazonaws.com/` |
| **Node not joining** | `aws eks describe-nodegroup --cluster-name <c> --nodegroup-name <ng>` | Health issue or CREATE_FAILED | Attach EKS node IAM policies |
| **Add-on degraded** | `aws eks describe-addon --cluster-name <c> --addon-name <name>` | `status: DEGRADED` | Update addon: `aws eks update-addon --addon-version <latest>` |
| **CoreDNS CrashLoop** | `kubectl logs -n kube-system -l k8s-app=kube-dns` | OOMKilled or scheduling failures | Add Fargate profile or patch compute type |
| **ALB not routing** | `kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller` | "failed to build model" | Check subnet tags and IAM policy (note: this project uses nginx ingress, not ALB) |

## Observability Stack Issues

| Issue | Diagnostic | What to Look For | Fix |
|---|---|---|---|
| **Alloy not collecting** | `kubectl logs -n parametric -l app=alloy --tail=50` | "connection refused" to remote_write endpoint | Check Prometheus service: `kubectl get svc -n parametric -l component=prometheus` |
| | `kubectl get ds observe-alloy -n parametric -o jsonpath='{.status}'` | `numberUnavailable > 0` | Check node scheduling and resource limits |
| **Prometheus no data** | `kubectl logs -n parametric -l app=prometheus --tail=50` | "error opening storage" or scrape target errors | Verify PVC is Bound and config is valid |
| | `kubectl port-forward svc/prometheus 9090:9090 -n parametric` then visit `/targets` | Target shows "DOWN" | Fix scrape config in ConfigMap |
| **Grafana no dashboards** | `kubectl logs -n parametric -l app=grafana --tail=50` | Datasource provisioning errors | Verify Prometheus datasource ConfigMap at `/etc/grafana/provisioning/datasources/` |
