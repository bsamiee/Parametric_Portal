# Infrastructure Architecture

Zero-YAML infrastructure-as-code using Pulumi + Doppler.

> **Note:** CDKTF was deprecated December 10, 2025. Pulumi is the recommended path forward. It's
> free with self-hosted state (S3/GCS/R2) and provides native programmatic infrastructure without
> transpilation to Terraform JSON.

## Toolchain

| Concern   | Tool              | Cost      | Why                                         |
| --------- | ----------------- | --------- | ------------------------------------------- |
| IaC       | Pulumi (OSS)      | $0        | Native TS execution, no HCL/JSON layer      |
| Secrets   | Doppler           | Free tier | Centralized, versioned, SDK integration     |
| State     | S3/GCS/R2         | ~$0/mo    | `pulumi login s3://bucket` — no vendor lock |
| Providers | 150+ cloud + K8s  | $0        | AWS, GCP, Azure, Cloudflare, K8s native     |

## Flow

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           DEPLOYMENT FLOW                                 │
├───────────────────────────────────────────────────────────────────────────┤
│  git push main                                                            │
│       ↓                                                                   │
│  .github/workflows/deploy.yml                                             │
│       ↓                                                                   │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐             │
│  │    Doppler     │──▶│  pulumi up     │──▶│  Cloud APIs    │             │
│  │  (inject env)  │   │  (native TS)   │   │  (provision)   │             │
│  └────────────────┘   └────────────────┘   └────────────────┘             │
│                              │                                            │
│                              ▼                                            │
│                       S3 state bucket                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

## Deployment Modes

### Cloud (K8s) vs Self-Hosted (Docker Compose)

| Aspect            | Docker Compose (Single Node) | Kubernetes (Cluster)         |
| ----------------- | ---------------------------- | ---------------------------- |
| Overhead          | ~50MB                        | ~2GB minimum                 |
| Nodes             | 1 host                       | 3+ nodes for HA              |
| Auto-scaling      | Manual                       | HPA (automatic)              |
| Self-healing      | Container restart only       | Pod rescheduling             |
| Load balancing    | Traefik/Nginx                | Built-in Services + Ingress  |
| Learning curve    | 1-2 days                     | 2-4 weeks                    |
| Monthly cost      | $50-200 VPS                  | $300-1000+ managed K8s       |

**When to use Docker Compose:**
- Single VPS / bare metal / Proxmox
- <50 concurrent users
- Budget-constrained
- No dedicated DevOps

**When to use Kubernetes:**
- Horizontal scaling required
- High availability across zones
- Enterprise SLA (99.9%+)
- Dedicated platform team

### Self-Hosted Service Equivalents

| Cloud Service    | Self-Hosted Alternative | Container Image                          |
| ---------------- | ----------------------- | ---------------------------------------- |
| RDS PostgreSQL   | PostgreSQL 18.2         | `postgres:18.2-alpine`                   |
| ElastiCache      | Redis                   | `redis:7-alpine`                         |
| S3               | MinIO                   | `minio/minio:latest`                     |
| CloudWatch       | Prometheus + Grafana    | `prom/prometheus`, `grafana/grafana`     |
| X-Ray / Datadog  | Grafana Alloy (OTLP)    | `grafana/alloy:latest`                   |
| Secrets Manager  | Doppler / Vault         | `hashicorp/vault` (optional)             |

## Minimal Structure (Zero Stack YAML)

```text
infrastructure/
├── ARCHITECTURE.md      # This file
├── Pulumi.yaml          # Project config (4 lines, required)
├── package.json         # @pulumi/* dependencies
├── tsconfig.json        # TS config
└── src/
    ├── platform.ts      # Entry point: config, env/secret assembly, deploy orchestration
    ├── data.ts           # CloudDataTier (VPC + RDS + ElastiCache + S3) / SelfhostedDataTier (Docker)
    └── compute.ts        # CloudComputeTier (K8s) / SelfhostedComputeTier (Docker + Traefik) / ObserveTier
```

**Pulumi.yaml** (required, minimal):
```yaml
name: parametric
runtime: nodejs
main: src/platform.ts
```

**Stack config files eliminated.** All environment-specific config lives in TypeScript via
`pulumi.getStack()` switching. Secrets come from Doppler environment variables at runtime.

## Multi-Tenant Model

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        SHARED INFRASTRUCTURE                              │
├───────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL 18.2 (1 RDS instance)                                         │
│  ├── RLS via app.current_tenant GUC                                       │
│  └── All tables scoped by app_id FK                                       │
│                                                                           │
│  Kubernetes Cluster (EKS/GKE)                                             │
│  ├── namespace: parametric                                                │
│  ├── api Deployment (N replicas, HPA)                                     │
│  └── Ingress → LoadBalancer                                               │
│                                                                           │
│  S3 Bucket                                                                │
│  └── parametric-assets/{app_id}/{hash}.{ext}                              │
└───────────────────────────────────────────────────────────────────────────┘
```

## Example: Composed ComponentResources (platform.ts)

```typescript
import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG: TypeScript-based stack config (no Pulumi.<stack>.yaml needed)
// ═══════════════════════════════════════════════════════════════════════════
const _STACK_CONFIG = {
    prod:    { replicas: 3, dbClass: 'db.r6g.large', dbStorage: 100 },
    staging: { replicas: 2, dbClass: 'db.r6g.medium', dbStorage: 50 },
    dev:     { replicas: 1, dbClass: 'db.t4g.micro', dbStorage: 20 },
} as const;

const stack = pulumi.getStack() as keyof typeof _STACK_CONFIG;
const cfg = _STACK_CONFIG[stack] ?? _STACK_CONFIG.dev;

// Secrets from Doppler (injected via `doppler run -- pulumi up`)
const secrets = {
    dbPassword: process.env.POSTGRES_PASSWORD!,
    encryptionKey: process.env.ENCRYPTION_KEY!,
};

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE: RDS PostgreSQL 18.2 with all supporting resources
// ═══════════════════════════════════════════════════════════════════════════
class Database extends pulumi.ComponentResource {
    readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: { vpcId: pulumi.Input<string>; subnetIds: pulumi.Input<string>[] }, opts?: pulumi.ComponentResourceOptions) {
        super('parametric:infra:Database', name, {}, opts);

        const subnetGroup = new aws.rds.SubnetGroup(`${name}-subnets`, { subnetIds: args.subnetIds }, { parent: this });
        const sg = new aws.ec2.SecurityGroup(`${name}-sg`, {
            vpcId: args.vpcId,
            ingress: [{ protocol: 'tcp', fromPort: 5432, toPort: 5432, cidrBlocks: ['10.0.0.0/8'] }],
        }, { parent: this });

        const instance = new aws.rds.Instance(`${name}-rds`, {
            engine: 'postgres', engineVersion: '18.2', instanceClass: cfg.dbClass,
            allocatedStorage: cfg.dbStorage, dbName: 'parametric',
            username: 'postgres', password: pulumi.secret(secrets.dbPassword),
            dbSubnetGroupName: subnetGroup.name, vpcSecurityGroupIds: [sg.id],
            backupRetentionPeriod: 7, storageEncrypted: true,
        }, { parent: this });

        this.endpoint = instance.endpoint;
        this.registerOutputs({ endpoint: this.endpoint });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKLOADS: K8s Deployment + Service (replicas from stack config)
// ═══════════════════════════════════════════════════════════════════════════
class ApiWorkload extends pulumi.ComponentResource {
    readonly url: pulumi.Output<string>;

    constructor(name: string, args: { image: string; dbEndpoint: pulumi.Input<string> }, opts?: pulumi.ComponentResourceOptions) {
        super('parametric:infra:ApiWorkload', name, {}, opts);

        const ns = new k8s.core.v1.Namespace(`${name}-ns`, { metadata: { name: 'parametric' } }, { parent: this });
        new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { namespace: ns.metadata.name },
            spec: {
                replicas: cfg.replicas,  // From stack config
                selector: { matchLabels: { app: name } },
                template: {
                    metadata: { labels: { app: name } },
                    spec: { containers: [{ name, image: args.image, ports: [{ containerPort: 4000 }],
                        env: [{ name: 'POSTGRES_HOST', value: args.dbEndpoint }],
                    }] },
                },
            },
        }, { parent: this });

        const svc = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { namespace: ns.metadata.name },
            spec: { type: 'LoadBalancer', ports: [{ port: 443, targetPort: 4000 }], selector: { app: name } },
        }, { parent: this });

        this.url = svc.status.loadBalancer.ingress[0].hostname;
        this.registerOutputs({ url: this.url });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTRY POINT: Compose all infrastructure
// ═══════════════════════════════════════════════════════════════════════════
const vpc = new aws.ec2.Vpc('main', { cidrBlock: '10.0.0.0/16', enableDnsHostnames: true });
const subnets = ['a', 'b', 'c'].map((az, i) =>
    new aws.ec2.Subnet(`private-${az}`, { vpcId: vpc.id, cidrBlock: `10.0.${i}.0/24`, availabilityZone: `us-east-1${az}` })
);

const db = new Database('parametric', { vpcId: vpc.id, subnetIds: subnets.map(s => s.id) });
const api = new ApiWorkload('api', { image: 'ghcr.io/bsamiee/parametric_portal/api:latest', dbEndpoint: db.endpoint });

export const dbEndpoint = db.endpoint;
export const apiUrl = api.url;
```

## Commands

```bash
pulumi login file://~/.pulumi-state  # Local backend (bootstrap default)
pulumi stack init prod               # Create prod stack
doppler run -- pulumi up             # Deploy with Doppler secrets
pulumi preview                       # Preview changes
pulumi destroy                       # Tear down
```

> **Migration:** When moving to remote state, switch to `pulumi login s3://parametric-state`
> and update `backend.url` in `Pulumi.yaml`.

## Secrets (via Doppler)

```bash
# doppler.yaml — project: parametric, configs: prod / staging / dev
POSTGRES_PASSWORD     # RDS master password
ENCRYPTION_KEY        # App-layer AES-256-GCM key
OAUTH_GITHUB_SECRET   # GitHub OAuth
OAUTH_GOOGLE_SECRET   # Google OAuth
AWS_ACCESS_KEY_ID     # Pulumi AWS provider
AWS_SECRET_ACCESS_KEY # Pulumi AWS provider
```

`PULUMI_CONFIG_PASSPHRASE` is required — the `file://` backend uses passphrase-based
encryption for stack secrets. Bootstrap stores per-stack passphrases in Doppler and
exports the variable before each `pulumi` command. No Pulumi stack YAML files are needed.

## Capabilities

| Feature                  | Pulumi                                              |
| ------------------------ | --------------------------------------------------- |
| Loops/conditionals       | Native TS `for`, `if`, `map`, `filter`              |
| Cross-stack refs         | `pulumi.StackReference` — native, no remote state   |
| Testing                  | Vitest/Jest with `pulumi.runtime.setMocks()`        |
| Policy as Code           | CrossGuard (OPA-compatible)                         |
| Drift detection          | `pulumi refresh`                                    |
| Import existing          | `pulumi import aws:rds/instance:Instance db i-xxx`  |
| Providers                | AWS, GCP, Azure, K8s, Cloudflare, GitHub, 150+ more |
