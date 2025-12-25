# [H1][INFRASTRUCTURE_OPERATIONS]
>**Dictum:** *Procedural clarity reduces operational risk.*

<br>

Step-by-step operational procedures for local development, cluster setup, deployment, secrets, scaling, backup, and troubleshooting.

---
## [0][LOCAL]
>**Dictum:** *Local development mirrors production patterns.*

<br>

### [0.1][DATABASE]

```bash
# Start local PostgreSQL
docker run -d --name postgres \
    -e POSTGRES_DB=parametric \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=dev \
    -p 5432:5432 postgres:17

# Run migrations
pnpm exec nx run @parametric-portal/api:migrate
```

---
### [0.2][DEVELOPMENT_SERVERS]

```bash
# Start API server (port 4000)
pnpm exec nx dev @parametric-portal/api

# Start frontend (port 3001)
pnpm exec nx dev @parametric-portal/parametric-icons

# Start all apps concurrently
pnpm exec nx run-many -t dev
```

---
### [0.3][LOCAL_DOCKER]

```bash
# Build API image
pnpm exec nx docker:build @parametric-portal/api

# Build Icons image
pnpm exec nx docker:build @parametric-portal/parametric-icons

# Build all affected images
pnpm exec nx affected -t docker:build
```

---
## [1][SETUP]
>**Dictum:** *One command bootstraps production infrastructure.*

<br>

### [1.1][PREREQUISITES]

| [INDEX] | [REQUIREMENT]    | [PURPOSE]                   |
| :-----: | ---------------- | --------------------------- |
|   [1]   | VPS (2 CPU, 8GB) | Compute resources           |
|   [2]   | Ubuntu 24.04     | OS with systemd             |
|   [3]   | DNS A record     | Domain → VPS IP             |
|   [4]   | `DOMAIN` env var | Domain for TLS certificates |
|   [5]   | `ACME_EMAIL` env | Let's Encrypt contact       |

---
### [1.2][BOOTSTRAP]

```bash
# Set required environment variables
export DOMAIN=your-domain.com
export ACME_EMAIL=admin@your-domain.com

# Run cluster bootstrap
mise run setup-k3s
```

**Bootstrap installs:**
1. K3s v1.32.2+k3s1 (single node, cluster-init)
2. Traefik v3.3.5 (via HelmChartConfig)
3. ArgoCD v7.8.28 (Helm chart)
4. Sealed Secrets v2.17.1 (Helm chart)
5. Namespace with LimitRange

**Outputs:**
- Kubeconfig: `/etc/rancher/k3s/k3s.yaml`
- Sealed Secrets cert: `/opt/sealed-secrets-cert.pem`
- ArgoCD admin password (printed to console)

---
### [1.3][POST_BOOTSTRAP]

```bash
# Apply ArgoCD ApplicationSet
kubectl apply -f infrastructure/argocd/application.yaml

# Create and apply sealed secrets (see §3)
mise run seal-secret api-secrets parametric-portal

# Verify deployment
kubectl get applications -n argocd
```

---
## [2][DEPLOY]
>**Dictum:** *GitOps automation eliminates manual deployment.*

<br>

### [2.1][GITOPS_WORKFLOW]

```
Developer pushes to main
        │
GitHub Actions CI (typecheck, lint, test)
        │
CI success triggers Deploy workflow
        │
┌────────────────────────────────────┐
│ 1. Detect affected apps (nx)       │
│ 2. Build Docker images (Buildx)    │
│ 3. Push to GHCR with sha-XXXXXXX   │
│ 4. Update kustomization.yaml       │
│ 5. Commit: "deploy: update tags"   │
└────────────────────────────────────┘
        │
ArgoCD syncs from git (3 min poll or webhook)
        │
kubectl apply -k infrastructure/overlays/prod/
        │
K3s reconciles cluster state
```

---
### [2.2][MANUAL_SYNC]

Force immediate sync when ArgoCD polling is too slow:

```bash
# Access ArgoCD CLI
argocd login argocd.${DOMAIN} --grpc-web

# Sync specific application
argocd app sync parametric-portal-prod

# Sync with prune (delete removed resources)
argocd app sync parametric-portal-prod --prune
```

---
### [2.3][ROLLBACK]

```bash
# List revision history
argocd app history parametric-portal-prod

# Rollback to specific revision
argocd app rollback parametric-portal-prod <revision>

# Or: update kustomization.yaml with previous image tag
# Then commit and let ArgoCD sync
```

---
## [3][SECRETS]
>**Dictum:** *Environment variables configure deployment behavior.*

<br>

### [3.1][ENVIRONMENT_VARIABLES]

**Database:**

| [INDEX] | [VARIABLE]          | [EXAMPLE]  |
| :-----: | ------------------- | ---------- |
|   [1]   | `POSTGRES_HOST`     | localhost  |
|   [2]   | `POSTGRES_PORT`     | 5432       |
|   [3]   | `POSTGRES_DB`       | parametric |
|   [4]   | `POSTGRES_USER`     | postgres   |
|   [5]   | `POSTGRES_PASSWORD` | (secret)   |
|   [6]   | `POSTGRES_SSL`      | false      |

**API Server:**

| [INDEX] | [VARIABLE]     | [EXAMPLE]             |
| :-----: | -------------- | --------------------- |
|   [1]   | `API_PORT`     | 4000                  |
|   [2]   | `API_BASE_URL` | http://localhost:4000 |
|   [3]   | `NODE_ENV`     | production            |

**Security:**

| [INDEX] | [VARIABLE]          | [FORMAT]           |
| :-----: | ------------------- | ------------------ |
|   [1]   | `ENCRYPTION_KEY`    | Base64 32-byte key |
|   [2]   | `ANTHROPIC_API_KEY` | sk-ant-...         |

**OAuth:**

| [INDEX] | [VARIABLE]                      | [PROVIDER] | [NOTES]                          |
| :-----: | ------------------------------- | ---------- | -------------------------------- |
|   [1]   | `OAUTH_GITHUB_CLIENT_ID`        | GitHub     | Settings → Developer Apps        |
|   [2]   | `OAUTH_GITHUB_CLIENT_SECRET`    | GitHub     | Same location                    |
|   [3]   | `OAUTH_GOOGLE_CLIENT_ID`        | Google     | Cloud Console → Credentials      |
|   [4]   | `OAUTH_GOOGLE_CLIENT_SECRET`    | Google     | Same location                    |
|   [5]   | `OAUTH_MICROSOFT_CLIENT_ID`     | Microsoft  | Azure Portal → App Registrations |
|   [6]   | `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft  | Same location                    |
|   [7]   | `OAUTH_MICROSOFT_TENANT_ID`     | Microsoft  | `common` for multi-tenant        |

**Frontend:**

| [INDEX] | [VARIABLE]     | [EXAMPLE]                         | [NOTES]                 |
| :-----: | -------------- | --------------------------------- | ----------------------- |
|   [1]   | `VITE_API_URL` | http://localhost:4000/api         | Local development       |
|   [2]   | `VITE_API_URL` | https://api.parametric-portal.com | Production (GitHub var) |

[IMPORTANT] Frontend env vars are build-time only. Set `API_URL` GitHub variable for production builds.

**Deployment:**

| [INDEX] | [VARIABLE]   | [PURPOSE]              |
| :-----: | ------------ | ---------------------- |
|   [1]   | `DOMAIN`     | TLS certificate domain |
|   [2]   | `ACME_EMAIL` | Let's Encrypt contact  |

---
### [3.2][SEALED_SECRETS_CREATION]

```bash
# Set all required secrets as environment variables
export POSTGRES_USER="postgres"
export POSTGRES_PASSWORD="your-password"
export ENCRYPTION_KEY="base64-encoded-32-byte-key"
export ANTHROPIC_API_KEY="sk-ant-..."
export OAUTH_GITHUB_CLIENT_ID="..."
export OAUTH_GITHUB_CLIENT_SECRET="..."
# ... set all OAuth vars

# Create sealed secret
mise run seal-secret api-secrets parametric-portal

# Output: infrastructure/overlays/prod/sealed-api-secrets.yaml
# Commit to git and ArgoCD syncs
```

---
## [4][SCALING]
>**Dictum:** *HPA maintains performance under varying load.*

<br>

### [4.1][HPA_CONFIGURATION]

| [INDEX] | [SERVICE] | [MIN] | [MAX] | [CPU_TARGET] | [MEM_TARGET] |
| :-----: | --------- | :---: | :---: | :----------: | :----------: |
|   [1]   | API       |   2   |  10   |     70%      |     80%      |
|   [2]   | Icons     |   2   |   6   |     75%      |      -       |

---
### [4.2][SCALE_BEHAVIOR]

**API Scale Up:**
- 100% increase OR +4 pods per 15s (whichever is greater)
- No stabilization window

**API Scale Down:**
- 25% decrease per 60s
- 300s stabilization window

**Icons Scale Up:**
- +2 pods per 30s
- No stabilization window

**Icons Scale Down:**
- 50% decrease per 60s
- 300s stabilization window

---
### [4.3][MANUAL_SCALING]

```bash
# Check current HPA status
kubectl get hpa -n parametric-portal

# View HPA details
kubectl describe hpa api-hpa -n parametric-portal

# Manual scale (temporarily overrides HPA min)
kubectl scale deployment/api --replicas=5 -n parametric-portal
```

[IMPORTANT] Manual scaling is overridden by HPA on next evaluation. Increase HPA `minReplicas` for permanent change.

---
## [5][BACKUP]
>**Dictum:** *Automated backups enable point-in-time recovery.*

<br>

### [5.1][DATABASE_BACKUP]

```bash
# Run backup
mise run backup-db

# Output: /opt/backups/postgres/parametric_YYYYMMDD_HHMMSS.sql.gz
```

**Configuration:**

| [INDEX] | [VARIABLE]       | [DEFAULT]             |
| :-----: | ---------------- | --------------------- |
|   [1]   | `BACKUP_DIR`     | /opt/backups/postgres |
|   [2]   | `RETENTION_DAYS` | 7                     |
|   [3]   | `CONTAINER_NAME` | postgres              |
|   [4]   | `DB_NAME`        | parametric            |

---
### [5.2][BACKUP_RESTORATION]

```bash
# List available backups
ls -la /opt/backups/postgres/

# Restore specific backup
gunzip -c /opt/backups/postgres/parametric_20250101_120000.sql.gz | \
  docker exec -i postgres psql -U postgres -d parametric
```

---
### [5.3][CLUSTER_BACKUP]

K3s stores cluster state in `/var/lib/rancher/k3s/server/db/`:

```bash
# Backup etcd (embedded)
cp -r /var/lib/rancher/k3s/server/db/ /opt/backups/k3s/

# Backup certificates
cp -r /var/lib/rancher/k3s/server/tls/ /opt/backups/k3s-tls/
```

---
## [6][EXTEND]
>**Dictum:** *Per-app ownership enables independent domain scaling.*

<br>

### [6.1][ADD_NEW_APP]

Multi-domain architecture: each app owns its IngressRoute and Middleware. Adding a new app with a different domain:

1. Create application code in `apps/new-app/`
2. Create Dockerfile: `apps/new-app/Dockerfile`
3. Create infrastructure manifests:
   ```
   infrastructure/apps/new-app/
   ├── deployment.yaml       # Pod spec, env vars, probes
   ├── service.yaml          # ClusterIP service
   ├── ingressroute.yaml     # App's domain + TLS
   ├── middleware.yaml       # App's CSP + security headers
   └── kustomization.yaml    # References all files
   ```
4. Reference in overlay:
   ```yaml
   # infrastructure/overlays/prod/kustomization.yaml
   resources:
     - ../../apps/new-app
   ```
5. Add DNS A record: `new-app.io` → VPS IP
6. Commit and push—ArgoCD auto-deploys

---
### [6.2][FILE_TEMPLATES]

**kustomization.yaml:**

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - ingressroute.yaml
  - middleware.yaml

labels:
  - pairs:
      app.kubernetes.io/name: new-app
      app.kubernetes.io/component: application
    includeSelectors: false
```

**ingressroute.yaml:**

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: new-app-https
  labels:
    app.kubernetes.io/name: new-app
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`new-app.io`)
      kind: Rule
      middlewares:
        - name: new-app-middleware-chain
      services:
        - kind: Service
          name: new-app
          port: 8080
  tls:
    certResolver: letsencrypt
    domains:
      - main: new-app.io
```

**middleware.yaml:**

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: new-app-security-headers
spec:
  headers:
    frameDeny: true
    contentTypeNosniff: true
    browserXssFilter: true
    stsSeconds: 31536000
    stsIncludeSubdomains: true
    contentSecurityPolicy: |
      default-src 'self';
      connect-src 'self' https://api.new-app.io;
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: new-app-middleware-chain
spec:
  chain:
    middlewares:
      - name: new-app-security-headers
      - name: rate-limit-web
      - name: compress
```

[IMPORTANT] Each app defines its own CSP `connect-src` to allow API connections. Shared middleware (`rate-limit-web`, `compress`) is defined in `base/shared-middleware.yaml`.

---
## [7][TROUBLESHOOTING]
>**Dictum:** *Diagnostic commands accelerate incident resolution.*

<br>

### [7.1][COMMON_ISSUES]

| [INDEX] | [SYMPTOM]             | [CHECK]                               | [FIX]                         |
| :-----: | --------------------- | ------------------------------------- | ----------------------------- |
|   [1]   | Pod CrashLoopBackOff  | `kubectl logs <pod>`                  | Fix application error         |
|   [2]   | ImagePullBackOff      | `kubectl describe pod <pod>`          | Check GHCR auth, image exists |
|   [3]   | Pending pods          | `kubectl describe pod <pod>`          | Check resource limits, PDB    |
|   [4]   | 502 Bad Gateway       | `kubectl get endpoints`               | Check service selector match  |
|   [5]   | TLS certificate error | `kubectl logs -n kube-system traefik` | Check ACME resolver config    |
|   [6]   | ArgoCD OutOfSync      | `argocd app diff <app>`               | Check git, sync manually      |

---
### [7.2][DIAGNOSTIC_COMMANDS]

```bash
# Pod status
kubectl get pods -n parametric-portal -o wide

# Pod logs
kubectl logs -f deployment/api -n parametric-portal

# Previous container logs (after crash)
kubectl logs deployment/api -n parametric-portal --previous

# Describe pod (events, scheduling)
kubectl describe pod -l app.kubernetes.io/name=api -n parametric-portal

# Exec into pod
kubectl exec -it deployment/api -n parametric-portal -- sh

# Check endpoints
kubectl get endpoints -n parametric-portal

# Check HPA status
kubectl describe hpa -n parametric-portal

# ArgoCD application status
argocd app get parametric-portal-prod

# ArgoCD sync status
argocd app diff parametric-portal-prod
```

---
### [7.3][TRAEFIK_DEBUGGING]

```bash
# Traefik logs
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik

# IngressRoute status
kubectl get ingressroute -n parametric-portal

# Middleware status
kubectl get middleware -n parametric-portal

# TLS certificates
kubectl get certificates -A
```

---
### [7.4][NETWORK_DEBUGGING]

```bash
# Check NetworkPolicy
kubectl get networkpolicy -n parametric-portal

# Test connectivity from pod
kubectl exec -it deployment/api -n parametric-portal -- \
  wget -qO- http://icons.parametric-portal.svc.cluster.local:8080

# DNS resolution
kubectl exec -it deployment/api -n parametric-portal -- \
  nslookup postgres.parametric-portal.svc.cluster.local
```
