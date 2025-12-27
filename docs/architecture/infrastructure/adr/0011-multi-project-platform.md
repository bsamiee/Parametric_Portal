# 0011. Multi-Project Platform Architecture

Date: 2025-12-12
Status: Accepted
Deciders: Bardia Samiee

---
## Context

Infrastructure must support multiple internal teams deploying custom applications with isolated namespaces, custom domains (BYOD), and shared platform services.

---
## Alternatives Considered

| Option                    | Pros                                       | Cons                                                |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Monolith (single project) | Simple, minimal overhead                   | No isolation, scaling issues, single failure domain |
| Namespace-per-team        | Kubernetes-native isolation                | Manual provisioning, no automation                  |
| Multi-cluster             | Complete isolation, blast radius contained | High cost, operational complexity, resource waste   |
| Multi-project platform    | Isolation + shared services, automated     | Requires ArgoCD ApplicationSet, RBAC complexity     |

---
## Decision

Adopt **multi-project platform architecture** with centralized GitOps discovery via ArgoCD ApplicationSet.

**Rationale:**
- Teams copy `infrastructure/projects/_template/` to onboard
- Each project gets isolated namespace with RBAC, quotas, network policies
- Shared platform services (PostgreSQL, MinIO, Redis, Monitoring, Ingress)
- Custom domains per project via cert-manager DNS-01 challenge
- GitOps-driven: add folder → ArgoCD auto-deploys
- Cost-efficient: shared infrastructure vs multi-cluster

---
## Implementation

### Folder Structure

```
infrastructure/
├── argocd/               # ArgoCD Applications (15 files)
│   ├── appproject.yaml  # Platform RBAC
│   ├── apps.yaml        # Projects ApplicationSet
│   └── *.yaml           # Platform service deployments
├── platform/             # Shared platform services (6 folders)
│   ├── base/            # Namespace, RBAC, quotas, network policies, TLS
│   ├── postgres/        # CloudNativePG cluster (shared, DB per project)
│   ├── cert-manager/    # TLS automation (ClusterIssuers)
│   ├── kyverno/         # Policy engine (5 policies)
│   ├── monitoring/      # LGTM stack (Prometheus, Grafana, Loki, Tempo)
│   └── minio/           # Object storage (buckets per project)
└── projects/             # Project instances
    ├── _template/       # Project template with README
    └── parametric-portal/ # First project (API + Icons apps)
```

### ApplicationSet Pattern

**File:** `infrastructure/argocd/apps.yaml`

```yaml
spec:
  generators:
    - git:
        repoURL: https://github.com/bardiasamiee/Parametric_Portal.git
        directories:
          - path: infrastructure/projects/*/overlays/*
            exclude: infrastructure/projects/_template/**
  template:
    metadata:
      name: 'parametric-portal-{{ .path.basename }}'
    spec:
      source:
        path: '{{ .path.path }}'
      destination:
        namespace: 'parametric-portal{{ if eq .path.basename "dev" }}-dev{{ end }}'
```

**Discovery:** ArgoCD watches `projects/*/overlays/*`, auto-creates Applications per project environment.

### Project Onboarding Workflow

1. Team copies template: `cp -r infrastructure/projects/_template infrastructure/projects/my-project`
2. Team customizes `base/PROJECT.yaml`:
   - Domain: `myproject.example.com` (BYOD)
   - DNS provider: Google Cloud DNS or Azure DNS
   - Resource limits: CPU, memory, storage, pods
   - Platform services: database, S3, Redis
3. Team commits: `git add infrastructure/projects/my-project && git commit`
4. ArgoCD discovers new folder, creates Application `project-my-project`
5. Deploys to namespace `my-project` with:
   - Isolated namespace with network policies
   - Resource quota enforcement
   - TLS certificate via cert-manager
   - Database on shared PostgreSQL cluster
   - S3 bucket on shared MinIO
   - Redis database slot on shared Redis
   - PodMonitors for Prometheus scraping

---
## Platform Services (Shared)

| Service          | Namespace         | Purpose               | Projects Access Via              |
| ---------------- | ----------------- | --------------------- | -------------------------------- |
| **PostgreSQL**   | parametric-portal | Shared 3-node cluster | Database name in PROJECT.yaml    |
| **MinIO**        | minio-system      | S3-compatible storage | Bucket name in PROJECT.yaml      |
| **Redis**        | redis-system      | Caching + sessions    | DB number (0-15) in PROJECT.yaml |
| **Traefik**      | kube-system       | Ingress controller    | IngressRoute CRDs                |
| **cert-manager** | cert-manager      | TLS automation        | Certificate CRDs                 |
| **Kyverno**      | kyverno           | Policy enforcement    | Applied to all namespaces        |
| **Monitoring**   | monitoring        | LGTM observability    | PodMonitors auto-created         |
| **Longhorn**     | longhorn-system   | Distributed storage   | StorageClass reference           |

---
## Consequences

[+] **Isolation:** Each project has dedicated namespace with RBAC + quotas
[+] **Automation:** GitOps-driven onboarding (<5min per project)
[+] **Custom Domains:** cert-manager DNS-01 supports BYOD
[+] **Cost-Efficient:** Shared PostgreSQL/Redis/MinIO vs per-project clusters
[+] **Observability:** Automatic metrics/logs/traces per project
[+] **Security:** Kyverno enforces Pod Security Standards across all projects
[+] **Scalability:** Linear scaling (add folder → get isolated project)

[-] **Shared Services:** PostgreSQL/Redis/MinIO single points of failure (mitigated by HA)
[-] **Resource Contention:** Projects share cluster resources (mitigated by quotas)
[-] **Domain Management:** Requires DNS provider credentials (GCP/Azure)
[-] **RBAC Complexity:** AppProject must whitelist all resources

[~] **Database Sharing:** Projects get databases on shared cluster, not dedicated clusters
[~] **Namespace Sprawl:** Many namespaces (1-2 per project), manageable with labels
[~] **ArgoCD Load:** ApplicationSet watches all projects (acceptable for <100 projects)

---
## Validation

```bash
# Verify ApplicationSet discovery
kubectl get applications -n argocd | grep parametric-portal

# Verify project namespace created
kubectl get namespace parametric-portal

# Verify resource quota applied
kubectl get resourcequota -n parametric-portal

# Verify network policies isolate project
kubectl get networkpolicy -n parametric-portal

# Verify TLS certificate issued
kubectl get certificate -n parametric-portal

# Verify platform service access
kubectl exec -it <api-pod> -n parametric-portal -- \
  psql -h parametric-portal-db-rw -U app -d parametric_portal -c "SELECT 1;"
```

### Project Onboarding Test

```bash
# Copy template
cp -r infrastructure/projects/_template infrastructure/projects/test-project

# Customize PROJECT.yaml (use sed or manual edit)
sed -i 's/my-project/test-project/g' infrastructure/projects/test-project/parametric-portal/base/PROJECT.yaml

# Commit
git add infrastructure/projects/test-project
git commit -m "Add test-project to platform"
git push

# Wait for ArgoCD sync (check in UI or CLI)
argocd app sync project-test-project
```

---
## References

- ArgoCD ApplicationSets: https://argo-cd.readthedocs.io/en/stable/user-guide/application-set/
- GitOps Best Practices: https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gitops-best-practices
- Multi-Tenancy in Kubernetes: https://kubernetes.io/docs/concepts/security/multi-tenancy/
- Kustomize Overlays: https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/
