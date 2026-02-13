# [H1][PULUMI_K8S_PATTERNS]
>**Dictum:** *Patterns encode deploy.ts conventions for consistent generation.*

<br>

Canonical: `infrastructure/src/deploy.ts` (207 LOC) | Provider: current stable `@pulumi/kubernetes` | K8s 1.32-1.35

---
## [1][NAMING]
>**Dictum:** *Deterministic naming prevents drift and enables discovery.*

<br>

| Rule          | Pattern                                  | deploy.ts Example                                 |
| ------------- | ---------------------------------------- | ------------------------------------------------- |
| Logical name  | `<tier>-<kind>`                          | `compute-deploy`, `observe-alloy-svc`, `data-rds` |
| Metadata name | `_Ops.meta(namespace, component, name?)` | Auto-sets labels + namespace (line 63)            |
| DNS-compliant | Lowercase alphanumeric + hyphens         | Max 63 chars (253 for namespaces)                 |

**deploy.ts resource map:**

| Logical Name        | Kind                  | Tier    | Line |
| ------------------- | --------------------- | ------- | ---- |
| `parametric-ns`     | Namespace             | infra   | 133  |
| `compute-deploy`    | Deployment            | compute | 172  |
| `compute-svc`       | Service (ClusterIP)   | compute | 173  |
| `compute-hpa`       | HPA (autoscaling/v2)  | compute | 174  |
| `compute-ingress`   | Ingress (nginx class) | compute | 175  |
| `compute-config`    | ConfigMap             | compute | 158  |
| `compute-secret`    | Secret                | compute | 159  |
| `observe-alloy`     | DaemonSet             | observe | 149  |
| `observe-alloy-svc` | Service (ClusterIP)   | observe | 150  |
| `observe-alloy-cfg` | ConfigMap             | observe | 147  |
| `prometheus`        | Deployment            | observe | 152  |
| `grafana`           | Deployment            | observe | 153  |

Factory resources (`_k8sObserve`, line 120): `<name>-pvc`, `<name>-cfg`, `<name>-svc` per array item.

---
## [2][LABELS]
>**Dictum:** *Labels enable selection, monitoring, and lifecycle management.*

<br>

deploy.ts uses inline labels `{ app, stack, tier }`:

```typescript
// Compute tier -- selector labels (deploy.ts:17)
const _CONFIG = { k8s: { labels: { app: 'parametric-api' } } } as const;
// Observe tier -- full labels (deploy.ts:123)
{ app: item.name, stack: 'parametric', tier: 'observe' }
// Observe metadata -- via _Ops.meta() (deploy.ts:63)
{ component: <name>, stack: 'parametric', tier: 'observe' }
```

Recommended labels for new workloads (k8s standard):

```typescript
const _labels = (component: string, instance: string) => ({
    'app.kubernetes.io/name': component, 'app.kubernetes.io/instance': instance,
    'app.kubernetes.io/managed-by': 'pulumi', 'app.kubernetes.io/part-of': 'parametric',
}) as const;
const _selectorLabels = (component: string, instance: string) => ({
    'app.kubernetes.io/name': component, 'app.kubernetes.io/instance': instance,
}) as const;
```

---
## [3][MODE_DISPATCH]
>**Dictum:** *Dispatch table keyed by deployment mode prevents cross-concern leaks.*

<br>

```typescript
const _DEPLOY = {
    cloud: (args) => { /* K8s + AWS resources */ },
    selfhosted: (args) => { /* Docker containers -- NO k8s resources */ },
} as const;
const mode = _Ops.mode(env);  // line 64: validates DEPLOYMENT_MODE
return _DEPLOY[mode](args);   // line 201: dispatch
```

| Concern | `cloud` (K8s + AWS)              | `selfhosted` (Docker)                  |
| ------- | -------------------------------- | -------------------------------------- |
| Compute | Deployment + Service (ClusterIP) | `docker.Container` + Traefik labels    |
| Ingress | Ingress (nginx class)            | Traefik reverse proxy                  |
| Scaling | HPA (CPU + memory)               | None                                   |
| Config  | ConfigMap + Secret               | `docker.Container.envs`                |
| Observe | DaemonSet (Alloy) + factory      | Docker containers with `uploads`       |
| Storage | PVC (via `_k8sObserve`)          | `docker.Volume`                        |
| TLS     | Ingress TLS + ssl-redirect       | Let's Encrypt via Traefik certresolver |
| Data    | AWS RDS + ElastiCache + S3       | Docker (postgres, redis, minio)        |

---
## [4][PROVIDERS_AND_FEATURES]
>**Dictum:** *Provider configuration determines target cluster and capabilities.*

<br>

| Pattern        | Code                                                          |
| -------------- | ------------------------------------------------------------- |
| Single cluster | `new k8s.Provider('k8s', { kubeconfig })`                     |
| EKS            | `new k8s.Provider('eks', { kubeconfig: cluster.kubeconfig })` |
| Multi-cluster  | Named providers; pass `{ provider }` to every resource        |

**Current stable features:** Server-Side Apply default (no `last-applied-configuration`), `enableConfigMapMutable`/`enableSecretMutable` stable, Patch resources for every type, K8s schemas to 1.35, `pulumi.com/waitFor` uses RFC 9535 JSONPath, `plainHttp` on Chart resource.

**K8s 1.33-1.35 features:**

| Feature                         | Status  | K8s  | Usage                                                           |
| ------------------------------- | ------- | ---- | --------------------------------------------------------------- |
| Sidecar containers              | GA      | 1.33 | Init containers with `restartPolicy: Always`                    |
| In-place pod resize             | GA      | 1.35 | `spec.containers[].resizePolicy` for CPU/memory without restart |
| ValidatingAdmissionPolicy       | GA      | 1.30 | CEL-based admission (replaces webhooks for simple policies)     |
| Gateway API                     | v1.4 GA | 1.35 | HTTPRoute, GRPCRoute, Gateway (replaces Ingress)                |
| EndpointSlice                   | Stable  | 1.33 | Preferred over Endpoints (deprecated)                           |
| DRA (Dynamic Resource Alloc)    | GA      | 1.35 | Claim structured resources (GPUs, FPGAs) via ResourceClaim      |
| Topology-aware routing          | GA      | 1.35 | `service.kubernetes.io/topology-mode` for zone-aware endpoints  |
| VolumeAttributesClass           | GA      | 1.35 | Modify volume IOPS/throughput without recreating PVC            |
| Fine-grained supplementalGroups | GA      | 1.35 | Per-container `supplementalGroupsPolicy` vs pod-level fsGroup   |

**Stack references:** `new pulumi.StackReference('org/project/stack')` -- format: `<org>/<project>/<stack>`, same backend required.

**Transforms (cross-cutting):**

```typescript
pulumi.runtime.registerStackTransformation((args) => {
    if (args.type.startsWith('kubernetes:')) {
        args.props.metadata = { ...args.props.metadata,
            labels: { ...args.props.metadata?.labels, 'managed-by': 'pulumi' } };
    }
    return { props: args.props, opts: args.opts };
});
```

**CrossGuard policy packs:** `@pulumi/policy` for mandatory security enforcement. Pre-built packs for CIS, PCI DSS v4.0, NIST SP 800-53.
