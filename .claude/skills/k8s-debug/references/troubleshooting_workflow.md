# Kubernetes Troubleshooting Workflows

> All resources in namespace `parametric`. Deployment: `compute-deploy`. Container: `api` on port 4000.
> Probes: startup (150s window), liveness (30s window), readiness (15s window).
> K8s: 1.32-1.35. Sidecar containers GA (1.33). In-place pod resize GA (1.35).

## Triage: Pod State -> Workflow

```
kubectl get pods -n parametric -o wide
|
+-- Pending -----------> Go to: [Pod Pending]
+-- ImagePullBackOff --> Go to: [Pod ImagePullBackOff]
+-- CrashLoopBackOff --> Go to: [Pod CrashLoopBackOff]
+-- Running (broken) --> Go to: [Service Connectivity]
+-- Error / Unknown ---> Go to: [Node Resource Exhaustion]
+-- Init:* ------------> Go to: [Init / Sidecar Containers]
```

## Pod Pending

```
kubectl describe pod <pod> -n parametric -> read Events section
|
+-- "Insufficient cpu/memory"
|   |
|   +-> kubectl top nodes
|   |   -> Output: NAME  CPU(cores)  CPU%  MEMORY(bytes)  MEMORY%
|   |   -> Look for: nodes at >90% utilization
|   |
|   +-> Fix: add nodes or free resources
|       -> Verify: kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.allocatable.cpu}{"\t"}{.status.allocatable.memory}{"\n"}{end}'
|
+-- "didn't match Pod's node affinity/selector"
|   |
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.nodeSelector}'
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.affinity}'
|   +-> Fix: adjust constraint or label matching nodes
|
+-- Taints block scheduling
|   |
|   +-> kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.taints}{"\n"}{end}'
|   |   -> Output: node-1  [{"key":"dedicated","value":"gpu","effect":"NoSchedule"}]
|   +-> Fix: add tolerations to pod spec or remove taint
|       -> kubectl taint nodes <node> <key>:<effect>-
|
+-- "unbound immediate PersistentVolumeClaims"
    |
    +-> kubectl get pvc -n parametric
    |   -> Output: NAME  STATUS  VOLUME  CAPACITY  ACCESS MODES  STORAGECLASS
    |   -> Look for: STATUS = "Pending" (should be "Bound")
    |
    +-> Fix: create matching PV or fix StorageClass provisioner
        -> kubectl get storageclass -> verify default class exists
        -> kubectl describe pvc <name> -n parametric -> read events for provisioner errors
```

## Pod CrashLoopBackOff

```
kubectl logs <pod> -n parametric -c api --previous --tail=100
|
+-- Application error (stack trace, uncaught exception)
|   +-> Fix: patch app code, rebuild image, redeploy
|
+-- "Error: connect ECONNREFUSED" or missing env var
|   |
|   +-> kubectl exec <pod> -n parametric -c api -- env | sort
|   |   -> Verify: POSTGRES_HOST, REDIS_HOST, API_BASE_URL present and correct
|   |
|   +-> kubectl get configmap compute-config -n parametric -o yaml
|   +-> kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
|   +-> Fix: update compute-config/compute-secret in deploy.ts -> pulumi up
|
+-- OOMKilled (exit code 137)
|   |
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[0].lastState}'
|   |   -> Output: {"terminated":{"reason":"OOMKilled","exitCode":137,...}}
|   |
|   +-> kubectl top pod <pod> -n parametric --containers
|   |   -> Look for: MEMORY near or at limit just before crash
|   |
|   +-> Fix: increase memory limits in deploy.ts:168 (input.api.memory)
|       -> Or: use in-place resize (1.35+): kubectl patch pod <pod> -n parametric --subresource resize ...
|
+-- "Startup probe failed" in events
|   |
|   +-> Means: app not ready within 150s (failureThreshold:30 * periodSeconds:5)
|   +-> kubectl logs <pod> -n parametric -c api --tail=200
|   |   -> Look for: slow initialization, dependency wait, migration running
|   |
|   +-> Fix: increase failureThreshold in _CONFIG.k8s.probes.startup (deploy.ts:19)
|
+-- "Liveness probe failed" in events (AFTER startup succeeded)
    |
    +-> Means: /api/health/liveness returned non-200 or timed out
    +-> Check: is the app hanging? memory/CPU pressure?
    +-> kubectl top pod <pod> -n parametric --containers
    +-> Fix: tune liveness periodSeconds/failureThreshold or fix app

After fix -> update infrastructure/src/deploy.ts -> pulumi up
-> kubectl wait --for=condition=ready pod -l app=parametric-api -n parametric --timeout=120s
```

## Pod ImagePullBackOff

```
kubectl describe pod <pod> -n parametric -> read Events for exact error
|
+-- "manifest unknown" or "not found"
|   |
|   +-> Image tag does not exist in registry
|   +-> Verify: kubectl get deploy compute-deploy -n parametric -o jsonpath='{.spec.template.spec.containers[0].image}'
|   |   -> Output: myregistry.com/api:v1.2.3
|   +-> Fix: correct image tag in deploy.ts or push missing image to registry
|
+-- "unauthorized" or "access denied"
    |
    +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.imagePullSecrets}'
    |   -> Output: [] (empty means no pull secrets configured)
    |
    +-> Fix: kubectl create secret docker-registry <secret> \
            --docker-server=<srv> --docker-username=<u> --docker-password=<p> -n parametric

After fix -> update imagePullSecrets in Pulumi -> pulumi up
-> kubectl wait --for=condition=ready pod -l app=parametric-api -n parametric --timeout=120s
```

## Init / Sidecar Containers (K8s 1.33+)

```
kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses}'
|
+-- Regular init container stuck
|   |
|   +-> kubectl logs <pod> -n parametric -c <init-container-name>
|   +-> Common: init container waiting for dependency (DB migration, config fetch)
|   +-> Fix: check init container command/args and dependency availability
|
+-- Sidecar container (restartPolicy: Always) not starting
|   |
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[?(@.restartPolicy=="Always")]}'
|   |   -> Lists all sidecar containers with their specs
|   |
|   +-> Check ordering: sidecars start in array order
|   |   -> If sidecar B depends on sidecar A, A must come first in initContainers[]
|   |
|   +-> kubectl describe pod <pod> -n parametric -> check events for sidecar errors
|   +-> Fix: verify sidecar image, resources, ports, startup probe
|
+-- Sidecar not terminating after main containers exit
    |
    +-> kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses[*].state}'
    +-> Sidecars receive SIGTERM after all main containers exit
    +-> Fix: ensure sidecar handles SIGTERM gracefully
    +-> terminationGracePeriodSeconds applies to the entire pod (currently 30s)
```

## Service Connectivity

```
kubectl get endpoints compute-svc -n parametric
|
+-- ENDPOINTS empty (no IPs)
|   |
|   +-> Selector mismatch: Service selector must match pod labels
|   +-> Verify: kubectl get svc compute-svc -n parametric -o jsonpath='{.spec.selector}'
|   |   -> Expected: {"app":"parametric-api"} (deploy.ts:17)
|   +-> Fix: align labels in Deployment template
|
+-- ENDPOINTS has IPs -> test connectivity from debug pod:
    |
    +-> kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- \
        curl -sv compute-svc.parametric.svc.cluster.local:4000/api/health/liveness
    |
    +-- DNS resolution fails -> go to [DNS Issues]
    +-- "Connection refused" -> verify targetPort matches container port (4000)
    +-- Timeout -> kubectl get networkpolicies -n parametric -> check for blocking rules
    +-- HTTP error -> check application logs: kubectl logs <pod> -n parametric -c api --tail=50
```

## Ingress / TLS

```
kubectl describe ingress compute-ingress -n parametric
|
+-- 502/503
|   |
|   +-> kubectl get endpoints compute-svc -n parametric
|   |   -> Empty means no healthy backends
|   +-> Check pod readiness: /api/health/readiness returning 200?
|   +-> kubectl get pods -n ingress-nginx -> controller running?
|
+-- TLS handshake error
|   |
|   +-> kubectl get secret compute-tls -n parametric -o jsonpath='{.data}'
|   +-- Secret missing -> recreate cert or check cert-manager
|   +-- Cert expired -> kubectl get secret compute-tls -n parametric -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -dates
|   +-- SAN mismatch -> regenerate cert matching ingress host
|
+-- Controller errors
    |
    +-> kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50
    +-> Look for: "upstream connect error", "no resolver defined", "SSL_do_handshake"
```

## Gateway API Debugging (v1.2+ / v1.4 GA)

Gateway API is the modern replacement for Ingress. Use when migrating from nginx Ingress.

```
kubectl get gateways,httproutes,grpcroutes -n parametric
|
+-- Gateway not Accepted/Programmed
|   |
|   +-> kubectl describe gateway <gw> -n parametric
|   |   -> Check conditions: Accepted, Programmed
|   +-> kubectl get gatewayclass <class>
|   |   -> Verify controller is installed and gatewayclass accepted
|   +-> Fix: install gateway controller (e.g., envoy-gateway, nginx-gateway-fabric)
|
+-- HTTPRoute not attached to Gateway
|   |
|   +-> kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents}'
|   |   -> Look for: Accepted: False, ResolvedRefs: False
|   +-> Fix: ensure parentRef matches gateway name, namespace, sectionName (listener)
|
+-- GRPCRoute not routing
|   |
|   +-> kubectl get grpcroute <route> -n parametric -o jsonpath='{.status}'
|   +-> Verify: service/method names in match rules, backend service refs
|
+-- Cross-namespace routing blocked
    |
    +-> kubectl get referencegrant -A
    +-> Fix: create ReferenceGrant in target namespace allowing source namespace
```

## DNS Issues

```
kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local
|
+-- NXDOMAIN or timeout
|   |
|   +-> kubectl get pods -n kube-system -l k8s-app=kube-dns
|   +-- CoreDNS pods not Running
|   |   +-> kubectl rollout restart deployment/coredns -n kube-system
|   +-- CoreDNS running but failing
|       +-> kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
|       +-> Look for: SERVFAIL, loop detection, plugin errors
|       +-> kubectl get cm coredns -n kube-system -o yaml -> check config
|
+-- Pod DNS config wrong
    |
    +-> kubectl exec <pod> -n parametric -- cat /etc/resolv.conf
    |   -> Expected: nameserver <cluster-dns-ip>
    |   -> Expected: search parametric.svc.cluster.local svc.cluster.local cluster.local
    +-> Fix: check kubelet --cluster-dns and --cluster-domain flags
```

## HPA / Autoscaling

```
kubectl get hpa compute-hpa -n parametric
|
+-> kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.currentMetrics}'
|
+-- <unknown> values -> metrics-server not reporting
|   |
|   +-> kubectl get pods -n kube-system -l k8s-app=metrics-server
|   +-> metrics-server not running or failing -> check its logs
|   +-> Fix: install/restart metrics-server
|
+-- Stuck at minReplicas
|   |
|   +-> kubectl get hpa compute-hpa -n parametric -o jsonpath='{.status.conditions}'
|   +-> Look for: "FailedGetResourceMetric" or "FailedComputeMetricsReplicas"
|   +-> Common cause: resource requests not set -> HPA cannot compute utilization %
|   +-> Fix: set cpu/memory requests in deploy.ts:168
|
+-- Flapping (rapid scale up/down)
|   |
|   +-> kubectl describe hpa compute-hpa -n parametric
|   +-> Look for: alternating ScaledUp/ScaledDown events
|   +-> Fix: increase behavior.scaleDown.stabilizationWindowSeconds (default 300s)
|   +-> Fix: add scaleDown.policies to limit velocity (e.g., max 1 pod per 60s)
|
+-- Custom metrics not found
|   |
|   +-> kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1
|   |   -> 404 = no adapter installed
|   +-> Fix: deploy Prometheus Adapter or equivalent metrics adapter
|
+-- Not scaling under load
    |
    +-> Verify CPU/memory requests set in deploy.ts:168
    +-> HPA formula: desiredReplicas = ceil(currentMetricValue / targetMetricValue * currentReplicas)
    +-> No requests = utilization undefined = HPA cannot scale
```

## Stuck Deployment

```
kubectl rollout status deployment/compute-deploy -n parametric
-> "Waiting for deployment ... 0 of N updated replicas are available"
|
+-> kubectl get rs -n parametric -l app=parametric-api -> identify new ReplicaSet
|   -> Output: NAME                        DESIRED  CURRENT  READY
|   -> Look for: new RS with READY=0 but DESIRED>0
|
+-> kubectl get pods -l app=parametric-api -n parametric -> check new pod status
    |
    +-- Pods in CrashLoop/ImagePull/Pending -> follow pod workflows above
    +-- Pause rollout: kubectl rollout pause deployment/compute-deploy -n parametric
    +-- Rollback: kubectl rollout undo deployment/compute-deploy -n parametric
    +-- Rollback to specific revision: kubectl rollout undo deployment/compute-deploy -n parametric --to-revision=N
    +-- View history: kubectl rollout history deployment/compute-deploy -n parametric
```

## ConfigMap / Secret Verification

```
kubectl get configmap compute-config -n parametric -o yaml -> verify expected keys
kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
kubectl exec <pod> -n parametric -c api -- env | sort -> verify injected env vars
|
+-- Missing var
|   |
|   +-> configMapRef/secretRef not matching -> check Pulumi output
|   +-> kubectl get deploy compute-deploy -n parametric -o jsonpath='{.spec.template.spec.containers[0].envFrom}'
|   +-> Fix: update references in deploy.ts
|
+-- Stale value (pods not restarted after ConfigMap/Secret update)
|   |
|   +-> kubectl rollout restart deployment/compute-deploy -n parametric
|   +-> ConfigMap/Secret changes do NOT auto-restart pods (envFrom is read at pod start)
|
+-- Wrong value
    |
    +-> Update infrastructure/src/deploy.ts -> pulumi up
    +-> Verify: kubectl exec <pod> -n parametric -c api -- env | grep <KEY>
```

## In-Place Pod Resize (K8s 1.35+ GA)

```
# Resize without pod restart:
kubectl patch pod <pod> -n parametric --subresource resize --type merge -p \
  '{"spec":{"containers":[{"name":"api","resources":{"requests":{"cpu":"500m","memory":"512Mi"},"limits":{"cpu":"1000m","memory":"1Gi"}}}]}}'
|
+-> kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'
|
+-- "" (empty) -> resize complete
+-- "InProgress" -> resize in progress, wait
+-- "Deferred" -> container needs restart for resize (depends on resizePolicy)
|   +-> Check: kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers[0].resizePolicy}'
|   +-> If RestartContainer: pod will restart affected container
|   +-> If NotRequired: resize happens live (CPU only; memory decrease may require restart)
+-- "Infeasible" -> node cannot accommodate new resource request
    +-> Check: kubectl top node <node-name>
    +-> Fix: scale down other pods or move to larger node

# Verify allocated resources after resize:
kubectl get pod <pod> -n parametric -o jsonpath='{.status.containerStatuses[?(@.name=="api")].allocatedResources}'
```

## Observability Stack

```
kubectl get pods -n parametric -l tier=observe
|
+-- Alloy pods not running
|   |
|   +-> kubectl describe pod -n parametric -l app=alloy
|   +-> kubectl get cm observe-alloy-cfg -n parametric -o yaml
|   +-> Look for: River syntax errors in config.alloy
|
+-- Prometheus not running
|   |
|   +-> kubectl logs -n parametric -l app=prometheus --tail=50
|   +-> Check PVC: kubectl get pvc -n parametric -l component=prometheus
|   +-> Check config: kubectl get cm -n parametric -l component=prometheus -o yaml
|
+-- Grafana not running
|   |
|   +-> kubectl logs -n parametric -l app=grafana --tail=50
|   +-> Verify datasource: kubectl exec <grafana-pod> -n parametric -- cat /etc/grafana/provisioning/datasources/datasources.yaml
|
+-- Metrics not flowing (Alloy -> Prometheus)
    |
    +-> kubectl port-forward svc/prometheus 9090:9090 -n parametric
    +-> Visit http://localhost:9090/targets -> check Alloy target status
    +-> If DOWN: verify Alloy service discovery and metrics port (12345)
```

## Node Resource Exhaustion

```
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'
|
+-- Node NotReady
|   |
|   +-> kubectl describe node <name> -> check Conditions section
|   +-> Look for: MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable
|   +-> Fix per condition:
|       +-- MemoryPressure: evict non-critical pods, add nodes
|       +-- DiskPressure: clean /var/lib/docker or containerd storage, prune images
|       +-- PIDPressure: identify pod with excessive processes: kubectl top pods --sort-by=cpu
|       +-- NetworkUnavailable: check CNI plugin (aws-node on EKS)
|
+-- Node Ready but resource-constrained
    |
    +-> kubectl top node <name>
    |   -> Output: NAME  CPU(cores)  CPU%  MEMORY(bytes)  MEMORY%
    +-> kubectl get node <name> -o jsonpath='{.status.allocatable}'
    +-> Fix: evict non-critical pods, add nodes, clean disk, or scale node group
```

## EKS-Specific Issues

```
VPC CNI (aws-node):
kubectl get pods -n kube-system -l k8s-app=aws-node
-> kubectl logs -n kube-system -l k8s-app=aws-node --tail=50
   |
   +-- "ipamd: no available IP addresses"
   |   +-> IP exhaustion: scale node group or enable prefix delegation
   |   +-> Check: kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}'
   |
   +-- "failed to setup ENI"
       +-> ENI limit reached: use larger instance type
       +-> Check: aws ec2 describe-instance-types --instance-types <type> --query 'InstanceTypes[0].NetworkInfo'

IRSA (IAM Roles for Service Accounts):
kubectl describe sa <sa> -n parametric -> check eks.amazonaws.com/role-arn annotation
-> kubectl exec <pod> -n parametric -- ls /var/run/secrets/eks.amazonaws.com/serviceaccount/
   |
   +-- Token file missing -> ServiceAccount not annotated with IAM role ARN
   +-- Permission denied at runtime -> IAM trust policy OIDC provider mismatch

EKS Add-ons:
aws eks describe-addon --cluster-name <cluster> --addon-name vpc-cni
aws eks describe-addon --cluster-name <cluster> --addon-name coredns
aws eks describe-addon --cluster-name <cluster> --addon-name kube-proxy
-> Status "DEGRADED" -> aws eks update-addon with --addon-version set to latest compatible
```

## ValidatingAdmissionPolicy Debugging (GA 1.30+)

```
kubectl get validatingadmissionpolicies
kubectl get validatingadmissionpolicybindings
|
+-- Resource creation rejected by policy
|   |
|   +-> kubectl describe validatingadmissionpolicy <policy-name>
|   |   -> Read spec.validations[].expression (CEL)
|   |   -> Read spec.validations[].message (human-readable)
|   |
|   +-> Test fix: kubectl apply --dry-run=server -f manifest.yaml
|   +-> Common CEL patterns:
|       -> has(object.spec.securityContext) -- check field existence
|       -> object.spec.containers.all(c, c.resources.limits.?memory.hasValue()) -- all containers have memory limit
|       -> object.metadata.labels.exists(k, k == 'app') -- label exists
|
+-- Policy not enforcing (resource created despite violation)
|   |
|   +-> kubectl get validatingadmissionpolicybinding <binding>
|   +-> Check: validationActions includes "Deny" (not just "Warn" or "Audit")
|   +-> Check: paramRef and matchResources select the intended resources
|
+-- CEL expression evaluation error
    |
    +-> kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection -n parametric
    +-> Common errors:
        -> "no such key" -> use has() macro for optional fields
        -> "type mismatch" -> cast with int(), string(), etc.
        -> nil pointer -> use ?. optional chaining: object.spec.?field.orValue(default)
```
