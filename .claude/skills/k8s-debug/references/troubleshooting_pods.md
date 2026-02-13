# [H1][TROUBLESHOOTING_PODS]
>**Dictum:** *Pod-level workflows diagnose lifecycle, networking, and sidecar issues.*

<br>

Namespace: `parametric` | Deployment: `compute-deploy` | Container: `api` port 4000 | Probes: startup 150s, liveness 30s, readiness 15s | K8s 1.32-1.35 | Sidecars GA (1.33) | In-place resize GA (1.35)

---
## [1][TRIAGE]
>**Dictum:** *Pod state determines diagnostic workflow entry point.*

<br>

```
kubectl get pods -n parametric -o wide
|
+-- Pending -----------> [Pod Pending]
+-- ImagePullBackOff --> [Pod ImagePullBackOff]
+-- CrashLoopBackOff --> [Pod CrashLoopBackOff]
+-- Running (broken) --> [Service Connectivity]
+-- Error / Unknown ---> troubleshooting_cluster.md [Node Resource Exhaustion]
+-- Init:* ------------> [Init / Sidecar Containers]
```

---
## [2][POD_PENDING]
>**Dictum:** *Scheduling failures trace to resources, affinity, taints, or PVC.*

<br>

```
kubectl describe pod <pod> -n parametric -> read Events
|
+-- "Insufficient cpu/memory"
|   +-> kubectl top nodes -> look for >90% utilization
|   +-> Fix: add nodes or free resources
|
+-- "didn't match Pod's node affinity/selector"
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.nodeSelector}'
|   +-> Fix: adjust constraint or label matching nodes
|
+-- Taints block scheduling
|   +-> kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.taints}{"\n"}{end}'
|   +-> Fix: add tolerations to pod spec or remove taint
|       -> kubectl taint nodes <node> <key>:<effect>-
```
> [CRITICAL] `kubectl taint` bypasses Pulumi state. Update `deploy.ts` toleration/taint config + `pulumi up`.

```
+-- "unbound immediate PersistentVolumeClaims"
    +-> kubectl get pvc -n parametric -> look for STATUS = "Pending"
    +-> Fix: create matching PV or fix StorageClass provisioner
        -> kubectl describe pvc <name> -n parametric -> read events
```

---
## [3][POD_CRASHLOOP]
>**Dictum:** *Crash analysis separates app errors, OOM, and probe failures.*

<br>

```
kubectl logs <pod> -n parametric -c api --previous --tail=100
|
+-- Application error (stack trace)
|   +-> Fix: patch app code, rebuild image, redeploy
|
+-- "Error: connect ECONNREFUSED" or missing env var
|   +-> kubectl exec <pod> -n parametric -c api -- env | sort
|   +-> kubectl get configmap compute-config -n parametric -o yaml
|   +-> kubectl get secret compute-secret -n parametric -o jsonpath='{.data}' | jq 'keys'
|   +-> Fix: update compute-config/compute-secret in deploy.ts -> pulumi up
|
+-- OOMKilled (exit code 137)
|   +-> kubectl top pod <pod> -n parametric --containers -> memory near limit?
|   +-> Fix: increase memory limits in deploy.ts:168
|       -> Or: kubectl patch pod <pod> -n parametric --subresource resize ...
```
> [IMPORTANT] `kubectl patch pod --subresource resize` is temporary. Update `deploy.ts` resource specs via `pulumi up`.

```
+-- "Startup probe failed" in events
|   +-> Means: app not ready within 150s (30 * 5s)
|   +-> kubectl logs <pod> -n parametric -c api --tail=200
|   +-> Fix: increase failureThreshold in _CONFIG.k8s.probes.startup (deploy.ts:19)
|
+-- "Liveness probe failed" (AFTER startup succeeded)
    +-> /api/health/liveness returned non-200 or timed out
    +-> kubectl top pod <pod> -n parametric --containers
    +-> Fix: tune liveness periodSeconds/failureThreshold or fix app

After fix -> update deploy.ts -> pulumi up
-> kubectl wait --for=condition=ready pod -l app=parametric-api -n parametric --timeout=120s
```

---
## [4][POD_IMAGEPULL]
>**Dictum:** *Image pull failures resolve to tag, auth, or secret issues.*

<br>

```
kubectl describe pod <pod> -n parametric -> read Events
|
+-- "manifest unknown" or "not found"
|   +-> kubectl get deploy compute-deploy -n parametric -o jsonpath='{.spec.template.spec.containers[0].image}'
|   +-> Fix: correct image tag in deploy.ts or push missing image
|
+-- "unauthorized" or "access denied"
    +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.imagePullSecrets}'
    +-> Fix: kubectl create secret docker-registry <secret> \
            --docker-server=<srv> --docker-username=<u> --docker-password=<p> -n parametric
```
> [IMPORTANT] `kubectl create secret` is temporary. Define imagePullSecrets in Pulumi via `pulumi up`.

```
After fix -> update imagePullSecrets in Pulumi -> pulumi up
```

---
## [5][INIT_SIDECAR_CONTAINERS]
>**Dictum:** *Sidecar debugging validates ordering, readiness, and termination.*

<br>

```
kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses}'
|
+-- Regular init container stuck
|   +-> kubectl logs <pod> -n parametric -c <init-container-name>
|   +-> Common: waiting for dependency (DB migration, config fetch)
|   +-> Fix: check init container command/args and dependency availability
|
+-- Sidecar (restartPolicy: Always) not starting
|   +-> kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[?(@.restartPolicy=="Always")]}'
|   +-> Sidecars start in array order; if B depends on A, A must come first
|   +-> kubectl describe pod <pod> -n parametric -> check events
|   +-> Fix: verify sidecar image, resources, ports, startup probe
|
+-- Sidecar not terminating after main containers exit
    +-> Sidecars receive SIGTERM after all main containers exit
    +-> Fix: ensure sidecar handles SIGTERM; terminationGracePeriodSeconds=30
```

---
## [6][SERVICE_CONNECTIVITY]
>**Dictum:** *Service connectivity diagnosis layers selectors, DNS, and network policies.*

<br>

```
kubectl get endpoints compute-svc -n parametric
|
+-- ENDPOINTS empty (no IPs)
|   +-> Selector mismatch: must be app: parametric-api (deploy.ts:17)
|   +-> Verify: kubectl get svc compute-svc -n parametric -o jsonpath='{.spec.selector}'
|   +-> Fix: align labels in Deployment template
|
+-- ENDPOINTS has IPs -> test from debug pod:
    +-> kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- \
        curl -sv compute-svc.parametric.svc.cluster.local:4000/api/health/liveness
    +-- DNS fails -> [DNS Issues]
    +-- "Connection refused" -> verify targetPort matches 4000
    +-- Timeout -> kubectl get networkpolicies -n parametric
    +-- HTTP error -> kubectl logs <pod> -n parametric -c api --tail=50
```

---
## [7][INGRESS_TLS]
>**Dictum:** *Ingress debugging traces backends, TLS, and controller state.*

<br>

```
kubectl describe ingress compute-ingress -n parametric
|
+-- 502/503
|   +-> kubectl get endpoints compute-svc -n parametric -> empty = no backends
|   +-> Check readiness: /api/health/readiness returning 200?
|   +-> kubectl get pods -n ingress-nginx -> controller running?
|
+-- TLS handshake error
|   +-> kubectl get secret compute-tls -n parametric -o jsonpath='{.data}'
|   +-- Missing -> recreate cert or check cert-manager
|   +-- Expired -> base64 -d | openssl x509 -noout -dates
|   +-- SAN mismatch -> regenerate cert matching ingress host
|
+-- Controller errors
    +-> kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50
```

---
## [8][GATEWAY_API]
>**Dictum:** *Gateway API debugging verifies routes, conditions, and cross-namespace grants.*

<br>

```
kubectl get gateways,httproutes,grpcroutes -n parametric
|
+-- Gateway not Accepted/Programmed
|   +-> kubectl describe gateway <gw> -n parametric -> check conditions
|   +-> kubectl get gatewayclass <class> -> verify controller installed
|
+-- HTTPRoute not attached
|   +-> kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents}'
|   +-> Fix: ensure parentRef matches gateway name/namespace/sectionName
|
+-- GRPCRoute not routing
|   +-> Verify method filter + backend refs
|
+-- Cross-namespace routing blocked
    +-> kubectl get referencegrant -A -> create ReferenceGrant in target namespace
```

---
## [9][DNS_ISSUES]
>**Dictum:** *DNS failure diagnosis validates CoreDNS health and pod resolv.conf.*

<br>

```
kubectl exec <pod> -n parametric -- nslookup compute-svc.parametric.svc.cluster.local
|
+-- NXDOMAIN or timeout
|   +-> kubectl get pods -n kube-system -l k8s-app=kube-dns
|   +-- Not Running -> kubectl rollout restart deployment/coredns -n kube-system
```
> [IMPORTANT] `kubectl rollout restart` is temporary. Investigate CoreDNS config root cause.

```
|   +-- Running but failing
|       +-> kubectl logs -n kube-system -l k8s-app=kube-dns --tail=50
|       +-> Look for: SERVFAIL, loop detection, plugin errors
|
+-- Pod DNS config wrong
    +-> kubectl exec <pod> -n parametric -- cat /etc/resolv.conf
    +-> Expected: nameserver <cluster-dns-ip>, search parametric.svc.cluster.local
    +-> Fix: check kubelet --cluster-dns and --cluster-domain flags
```
