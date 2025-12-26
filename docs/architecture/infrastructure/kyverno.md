# [H1][INFRASTRUCTURE_KYVERNO]
>**Dictum:** *Policy enforcement prevents security drift.*

<br>

Kyverno v3.6.1 enforces Pod Security Standards (Restricted) and best practices via cluster-wide policies.

---
## [1][DEPLOYMENT]

| [INDEX] | [ASPECT]  | [VALUE]                                           |
| :-----: | --------- | ------------------------------------------------- |
|   [1]   | Version   | v3.6.1                                            |
|   [2]   | Deployed  | ArgoCD Application `argocd/kyverno.yaml`          |
|   [3]   | Policies  | ArgoCD Application `argocd/kyverno-policies.yaml` |
|   [4]   | Namespace | kyverno                                           |
|   [5]   | Mode      | Enforce (blocks non-compliant pods)               |

---
## [2][POLICIES]
>**Dictum:** *Five policies implement PSS Restricted + best practices.*

<br>

| [INDEX] | [POLICY]                        | [RULE]                              | [RATIONALE]           |
| :-----: | ------------------------------- | ----------------------------------- | --------------------- |
|   [1]   | `require-run-as-nonroot`        | `runAsNonRoot: true`                | PSS Restricted        |
|   [2]   | `disallow-privilege-escalation` | `allowPrivilegeEscalation: false`   | PSS Restricted        |
|   [3]   | `require-ro-rootfs`             | `readOnlyRootFilesystem: true`      | Best Practice         |
|   [4]   | `require-requests-limits`       | CPU/memory requests + memory limits | Resource fairness     |
|   [5]   | `restrict-image-registries`     | Only `ghcr.io/*` allowed            | Supply chain security |

**Files:** `infrastructure/platform/kyverno/policies/*.yaml`

---
## [3][EXCEPTIONS]
>**Dictum:** *PolicyExceptions exempt privileged system components.*

<br>

### [3.1][SYSTEM_NAMESPACES]

Exempt all policies for operator namespaces:

| [INDEX] | [NAMESPACE]     | [REASON]               |
| :-----: | --------------- | ---------------------- |
|   [1]   | kube-system     | Core K8s components    |
|   [2]   | kube-public     | Cluster bootstrap      |
|   [3]   | kube-node-lease | Node heartbeat         |
|   [4]   | kyverno         | Policy engine itself   |
|   [5]   | argocd          | GitOps operator        |
|   [6]   | cnpg-system     | CloudNativePG operator |

**File:** `infrastructure/platform/kyverno/exceptions/system-namespaces.yaml`

---
### [3.2][CLOUDNATIVEPG]

Exempt PostgreSQL pods from read-only rootfs (database requires writes):

| [INDEX] | [POLICY]            | [EXEMPTED_LABELS]           |
| :-----: | ------------------- | --------------------------- |
|   [1]   | `require-ro-rootfs` | `cnpg.io/podRole: instance` |
|   [2]   | `require-ro-rootfs` | `cnpg.io/jobRole: join`     |

**File:** `infrastructure/platform/kyverno/exceptions/cloudnativepg.yaml`

---
### [3.3][MONITORING]

Exempt monitoring namespace from all policies (LGTM stack requires relaxed constraints):

**File:** `infrastructure/platform/monitoring/kyverno-exception.yaml`

---
## [4][OPERATIONS]
>**Dictum:** *Commands accelerate policy management.*

<br>

### [4.1][VIEW_POLICIES]

```bash
# List all cluster policies
kubectl get clusterpolicies

# Describe specific policy
kubectl describe clusterpolicy require-run-as-nonroot
```

---
### [4.2][VIEW_EXCEPTIONS]

```bash
# List all policy exceptions
kubectl get policyexceptions -A

# View exception details
kubectl describe policyexception system-namespace-exception -n kyverno
```

---
### [4.3][CHECK_VIOLATIONS]

```bash
# View policy reports (background scan results)
kubectl get policyreports -A

# Detailed report for namespace
kubectl describe policyreport -n parametric-portal
```

---
### [4.4][ADD_EXCEPTION]

1. Create `PolicyException` resource in `infrastructure/platform/kyverno/exceptions/`
2. Reference policy names and rule names to exempt
3. Add match conditions (namespace, labels, kinds)
4. Include in `infrastructure/platform/kyverno/kustomization.yaml`
5. Commit and ArgoCD syncs

---
## [5][TROUBLESHOOTING]

| [INDEX] | [SYMPTOM]                | [CHECK]                            | [FIX]                           |
| :-----: | ------------------------ | ---------------------------------- | ------------------------------- |
|   [1]   | Pod blocked by policy    | `kubectl describe pod <pod>`       | Add PolicyException or fix spec |
|   [2]   | Policy not enforcing     | `kubectl get clusterpolicy`        | Check `validationFailureAction` |
|   [3]   | Exception not working    | `kubectl describe policyexception` | Verify match conditions         |
|   [4]   | Background scan failures | `kubectl get policyreports`        | Check policy syntax             |
