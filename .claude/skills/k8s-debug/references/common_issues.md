# [H1][COMMON_ISSUES]
>**Dictum:** *Known issues have diagnostic tables mapping symptom to fix.*

<br>

Namespace: `parametric` | Deployment: `compute-deploy` | Container: `api` port 4000 | K8s 1.32-1.35 | Source: `infrastructure/src/deploy.ts`

---
## [1][POD_ISSUES]
>**Dictum:** *Pod state determines the diagnostic entry point.*

<br>

| [INDEX] | [ISSUE]              | [DIAGNOSTIC]                                                                        | [SYMPTOM]                               | [FIX]                                     |
| :-----: | -------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------- |
|   [1]   | **CrashLoopBackOff** | `kubectl logs <pod> -n parametric -c api --previous`                                | Stack traces, connection errors.        | Fix app code/config.                      |
|         |                      | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.containers[0].resources}'` | Limits too low.                         | Increase memory/CPU (deploy.ts:168).      |
|         |                      | `kubectl describe pod <pod> -n parametric`                                          | "Startup probe failed".                 | Boot > 150s; increase `failureThreshold`. |
|         |                      |                                                                                     | "Liveness probe failed" (post-startup). | App hangs; check `/api/health/liveness`.  |
|   [2]   | **ImagePullBackOff** | `kubectl describe pod <pod> -n parametric`                                          | "manifest unknown".                     | Verify image:tag exists.                  |
|         |                      | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.imagePullSecrets}'`        | Empty/missing.                          | Add docker-registry secret.               |
|   [3]   | **Pending**          | `kubectl describe pod <pod> -n parametric`                                          | "Insufficient cpu/memory".              | Add nodes or free resources.              |
|         |                      | `kubectl get pvc -n parametric`                                                     | STATUS: Pending.                        | Fix PVC binding: check StorageClass.      |
|         |                      | Node taints with no tolerations.                                                    | `NoSchedule` taint blocks pod.          | Add tolerations or remove taint.          |
|   [4]   | **OOMKilled** (137)  | `kubectl top pod <pod> -n parametric --containers`                                  | Memory near limit before crash.         | Fix memory leak or increase limits.       |

---
## [2][SIDECAR_AND_RESIZE]
>**Dictum:** *K8s 1.33-1.35 features introduce new failure modes.*

<br>

### [2.1][SIDECAR_CONTAINERS]

Sidecars: init containers with `restartPolicy: Always`. Start in array order before main; terminate after main stops.

| [INDEX] | [ISSUE]                              | [DIAGNOSTIC]                                                                                 | [FIX]                                                    |
| :-----: | ------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
|   [1]   | **Sidecar not starting**             | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses}'`          | Check image, resources, config.                          |
|   [2]   | **Ordering wrong**                   | `kubectl get pod <pod> -n parametric -o jsonpath='{.spec.initContainers[*].name}'`           | Reorder: dependencies first.                             |
|   [3]   | **Main starts before sidecar ready** | `kubectl describe pod <pod> -n parametric`                                                   | Add startup probe to sidecar.                            |
|   [4]   | **Sidecar not terminating**          | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.initContainerStatuses[*].state}'` | Check graceful shutdown handler.                         |
|   [5]   | **Legacy sidecar in `containers[]`** | Check `containers` array.                                                                    | Move to `initContainers[]` with `restartPolicy: Always`. |

---
### [2.2][IN_PLACE_RESIZE]

| [INDEX] | [ISSUE]                       | [DIAGNOSTIC]                                                         | [FIX]                                                              |
| :-----: | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
|   [1]   | **Resize stuck "InProgress"** | `kubectl get pod <pod> -n parametric -o jsonpath='{.status.resize}'` | Node lacks capacity; check `kubectl top node`.                     |
|   [2]   | **Resize "Infeasible"**       | Same.                                                                | Exceeds node allocatable; scale down or use larger node.           |
|   [3]   | **Resize "Deferred"**         | Same.                                                                | Container restart required for resize (depends on `resizePolicy`). |

---
## [3][SERVICE_AND_NETWORK]
>**Dictum:** *Service connectivity failures require layered diagnosis.*

<br>

| [INDEX] | [ISSUE]                 | [DIAGNOSTIC]                                                                         | [SYMPTOM]                    | [FIX]                                             |
| :-----: | ----------------------- | ------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------- |
|   [1]   | **Service unreachable** | `kubectl get endpoints compute-svc -n parametric`                                    | ENDPOINTS empty.             | Selector mismatch: must be `app: parametric-api`. |
|         |                         | `kubectl get networkpolicies -n parametric`                                          | Policy blocking port 4000.   | Add ingress rule.                                 |
|   [2]   | **DNS failure**         | `kubectl get pods -n kube-system -l k8s-app=kube-dns`                                | CoreDNS not Running.         | Restart CoreDNS deployment.                       |
|         |                         | `kubectl exec <pod> -n parametric -- cat /etc/resolv.conf`                           | Wrong nameserver.            | Check kubelet DNS config.                         |
|   [3]   | **EndpointSlice**       | `kubectl get endpointslices -n parametric -l kubernetes.io/service-name=compute-svc` | Missing endpoints.           | Endpoints deprecated 1.33; check kube-proxy.      |
|   [4]   | **Ingress 502/503**     | `kubectl describe ingress compute-ingress -n parametric`                             | No healthy endpoints.        | Check readiness probes.                           |
|         |                         | `kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50`    | Upstream errors.             | Check Service endpoints + DNS.                    |
|   [5]   | **TLS failure**         | `kubectl get secret compute-tls -n parametric -o jsonpath='{.data}'`                 | Missing `tls.crt`/`tls.key`. | Recreate secret or check cert-manager.            |

---
## [4][GATEWAY_API]
>**Dictum:** *Gateway API v1.4 debugging applies when migrating from Ingress.*

<br>

| [INDEX] | [ISSUE]                     | [DIAGNOSTIC]                                                                  | [FIX]                                      |
| :-----: | --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
|   [1]   | **HTTPRoute not attached**  | `kubectl get httproute <route> -n parametric -o jsonpath='{.status.parents}'` | Check parentRef matches Gateway.           |
|   [2]   | **Gateway not programmed**  | `kubectl describe gateway <gw> -n parametric`                                 | Controller not installed/ready.            |
|   [3]   | **GRPCRoute not routing**   | `kubectl get grpcroute <route> -n parametric -o jsonpath='{.status}'`         | Verify method filter + backend refs.       |
|   [4]   | **Cross-namespace routing** | `kubectl get referencegrant -A`                                               | Create ReferenceGrant in target namespace. |

---
## [5][OPERATIONAL_ISSUES]
>**Dictum:** *Deployment, HPA, storage, and admission failures share patterns.*

<br>

| [INDEX] | [ISSUE]                  | [DIAGNOSTIC]                                                                    | [SYMPTOM]                  | [FIX]                                     |
| :-----: | ------------------------ | ------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
|   [1]   | **Rollout stuck**        | `kubectl rollout status deployment/compute-deploy -n parametric`                | New pods failing.          | Diagnose pod state.                       |
|         |                          | `kubectl get rs -n parametric -l app=parametric-api`                            | New ReplicaSet 0 READY.    | Check pods for CrashLoop/ImagePull.       |
|   [2]   | **HPA not scaling**      | `kubectl describe hpa compute-hpa -n parametric`                                | "FailedGetResourceMetric". | Ensure metrics-server running.            |
|   [3]   | **HPA flapping**         | `kubectl describe hpa compute-hpa -n parametric`                                | Rapid scale events.        | Increase `stabilizationWindowSeconds`.    |
|   [4]   | **PVC Pending**          | `kubectl describe pvc <name> -n parametric`                                     | "no persistent volumes".   | Fix StorageClass or provisioner.          |
|   [5]   | **CEL policy rejection** | `kubectl get events --field-selector reason=ValidatingAdmissionPolicyRejection` | Expression too strict.     | Fix CEL; use `has()` for optional fields. |
|   [6]   | **Observe stack down**   | `kubectl logs -n parametric -l app=alloy --tail=50`                             | "connection refused".      | Check Prometheus service.                 |
|         |                          | `kubectl logs -n parametric -l app=prometheus --tail=50`                        | Storage/scrape errors.     | Verify PVC Bound + config valid.          |

---
## [6][EKS_SPECIFIC]
>**Dictum:** *EKS adds VPC CNI, IRSA, and managed add-on failure modes.*

<br>

| [INDEX] | [ISSUE]                           | [DIAGNOSTIC]                                                          | [FIX]                                                        |
| :-----: | --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
|   [1]   | **Pod stuck `ContainerCreating`** | `kubectl logs -n kube-system -l k8s-app=aws-node --tail=50`           | VPC CNI IP exhaustion: prefix delegation or larger instance. |
|   [2]   | **Pod cannot reach AWS APIs**     | `kubectl describe sa <sa> -n parametric`                              | IRSA: annotate SA with role ARN.                             |
|         |                                   | `kubectl exec <pod> -n parametric -- env \| grep AWS`                 | Check `AWS_WEB_IDENTITY_TOKEN_FILE`.                         |
|   [3]   | **Node not joining**              | `aws eks describe-nodegroup --cluster-name <c> --nodegroup-name <ng>` | Attach EKS node IAM policies.                                |
|   [4]   | **Add-on degraded**               | `aws eks describe-addon --cluster-name <c> --addon-name <name>`       | Update addon version.                                        |
|   [5]   | **CoreDNS CrashLoop**             | `kubectl logs -n kube-system -l k8s-app=kube-dns`                     | Add Fargate profile or patch compute type.                   |

This project uses nginx ingress (NOT ALB) per deploy.ts:16. ALB debugging applies only if ALB controller installed separately.
