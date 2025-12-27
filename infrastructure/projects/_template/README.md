# Project Template

Copy this template to create a new project on the platform.

## Quick Start

```bash
# Create new project
cp -r infrastructure/projects/_template infrastructure/projects/my-project

# Configure project
cd infrastructure/projects/my-project
# Edit base/PROJECT.yaml with your project details
# Update apps/ with your application deployments
# Configure overlays/dev and overlays/prod

# Commit and push - ArgoCD will auto-deploy
git add infrastructure/projects/my-project
git commit -m "Add my-project to platform"
git push
```

## Folder Structure

```
my-project/
├── base/
│   ├── PROJECT.yaml          # Project metadata (domain, resources, services)
│   ├── kustomization.yaml    # Base composition
│   └── certificate.yaml      # TLS certificate for custom domain
├── apps/
│   ├── backend/              # Your backend service
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── ingressroute.yaml
│   │   └── kustomization.yaml
│   └── frontend/             # Your frontend service
│       ├── deployment.yaml
│       ├── service.yaml
│       ├── ingressroute.yaml
│       └── kustomization.yaml
└── overlays/
    ├── dev/                  # Development environment
    │   ├── kustomization.yaml
    │   └── sealed-secrets.yaml
    └── prod/                 # Production environment
        ├── kustomization.yaml
        ├── sealed-secrets.yaml
        └── hpa.yaml
```

## Platform Services Available

- **Ingress**: Traefik with automatic TLS via cert-manager
- **Monitoring**: Prometheus, Grafana, Loki (metrics, dashboards, logs auto-provisioned)
- **PostgreSQL**: Shared CloudNativePG cluster (request database via PROJECT.yaml)
- **Object Storage**: MinIO S3-compatible storage (request bucket via PROJECT.yaml)
- **Redis**: Shared Redis cluster (request database slot via PROJECT.yaml)

## Configuration

### 1. Update PROJECT.yaml

```yaml
apiVersion: platform.parametric-portal.com/v1alpha1
kind: Project
metadata:
  name: my-project
spec:
  displayName: "My Project"
  owner: "team-name"
  domain: "myproject.example.com"  # Your custom domain
  dnsProvider: clouddns  # or azuredns
  resources:
    requests:
      cpu: "2"
      memory: "4Gi"
      storage: "20Gi"
    limits:
      cpu: "4"
      memory: "8Gi"
      pods: "20"
  services:
    database:
      enabled: true
      name: "my_project_db"
    objectStorage:
      enabled: true
      bucketName: "my-project-files"
    redis:
      enabled: true
      database: 0  # 0-15
  monitoring:
    enabled: true
```

### 2. Configure DNS

Add DNS delegation for your custom domain:
```bash
# CNAME record
myproject.example.com  CNAME  lb.platform.example.com
```

### 3. Create Sealed Secrets

```bash
# Example: database credentials
kubectl create secret generic my-app-secrets \
  --namespace=my-project \
  --from-literal=DB_PASSWORD=${DB_PASS} \
  --dry-run=client -o yaml | \
kubeseal --format yaml > overlays/prod/sealed-secrets.yaml
```

## Deployment

Once you push to Git, ArgoCD will automatically:
1. Detect new project folder
2. Create Application `project-my-project`
3. Deploy to namespace `my-project`
4. Request TLS certificate via cert-manager
5. Configure ingress routing
6. Provision platform services (if enabled)

## Support

See main infrastructure documentation:
- `/docs/architecture/infrastructure/operations.md` - Deployment procedures
- `/docs/architecture/infrastructure/security.md` - Security policies
- `/docs/architecture/infrastructure/monitoring.md` - Observability setup
