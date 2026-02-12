# Pulumi Kubernetes Patterns

Canonical: `infrastructure/src/deploy.ts` (207 LOC). All patterns extracted from or aligned with that file.
Provider: `@pulumi/kubernetes` v4.25+ (Server-Side Apply default, K8s 1.32-1.35 schemas)

---

## Naming

| Rule | Pattern | deploy.ts Example |
|---|---|---|
| Logical name | `<tier>-<kind>` | `compute-deploy`, `observe-alloy-svc`, `data-rds` |
| Metadata name | `_Ops.meta(namespace, component, name?)` | Auto-sets labels + namespace (line 63) |
| DNS-compliant | Lowercase alphanumeric + hyphens | Max 63 chars (253 for namespaces) |

**deploy.ts resource names (complete map):**

| Logical Name | Kind | Tier | Line |
|---|---|---|---|
| `parametric-ns` | Namespace | infra | 133 |
| `compute-deploy` | Deployment | compute | 172 |
| `compute-svc` | Service (ClusterIP) | compute | 173 |
| `compute-hpa` | HPA (autoscaling/v2) | compute | 174 |
| `compute-ingress` | Ingress (nginx class) | compute | 175 |
| `compute-config` | ConfigMap | compute | 158 |
| `compute-secret` | Secret | compute | 159 |
| `observe-alloy` | DaemonSet | observe | 149 |
| `observe-alloy-svc` | Service (ClusterIP) | observe | 150 |
| `observe-alloy-cfg` | ConfigMap | observe | 147 |
| `prometheus` | Deployment | observe | 152 (via `_k8sObserve`) |
| `prometheus-pvc` | PVC | observe | 121 (via `_k8sObserve`) |
| `prometheus-cfg` | ConfigMap | observe | 122 (via `_k8sObserve`) |
| `prometheus-svc` | Service (ClusterIP) | observe | 124 (via `_k8sObserve`) |
| `grafana` | Deployment | observe | 153 (via `_k8sObserve`) |
| `grafana-pvc` | PVC | observe | 121 (via `_k8sObserve`) |
| `grafana-cfg` | ConfigMap | observe | 122 (via `_k8sObserve`) |
| `grafana-svc` | Service (ClusterIP) | observe | 124 (via `_k8sObserve`) |
| `data-vpc` | VPC | data | 134 |
| `data-rds` | RDS Instance | data | 137 |
| `data-redis` | ElastiCache | data | 139 |
| `data-bucket` | S3 Bucket | data | 140 |

---

## Labels

deploy.ts uses simple inline labels `{ app, stack, tier }`:

```typescript
// Compute tier -- selector labels (deploy.ts:17)
const _CONFIG = { k8s: { labels: { app: 'parametric-api' } } } as const;

// Observe tier -- full labels (deploy.ts:123)
{ app: item.name, stack: 'parametric', tier: 'observe' }

// Observe metadata -- via _Ops.meta() (deploy.ts:63)
{ component: <name>, stack: 'parametric', tier: 'observe' }
```

For new workloads needing k8s recommended labels, expand to:

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

## Mode Dispatch

Dispatch table keyed by `'cloud' | 'selfhosted'` (deploy.ts:130-195):

```typescript
const _DEPLOY = {
    cloud: (args) => { /* K8s + AWS resources */ },
    selfhosted: (args) => { /* Docker containers -- NO k8s resources */ },
} as const;
const mode = _Ops.mode(env);  // line 64: validates DEPLOYMENT_MODE env var
return _DEPLOY[mode](args);   // line 201: dispatch
```

| Concern | `cloud` (K8s + AWS) | `selfhosted` (Docker) |
|---|---|---|
| Compute | Deployment + Service (**ClusterIP**) | `docker.Container` + Traefik labels |
| Ingress | Ingress with **nginx** class | Traefik reverse proxy |
| Scaling | HPA (CPU + memory targets) | None |
| Config | ConfigMap + Secret | `docker.Container.envs` |
| Observe | DaemonSet (Alloy) + `_k8sObserve` factory | `docker.Container` with `uploads` |
| Storage | PVC (via `_k8sObserve`) | `docker.Volume` |
| TLS | Ingress annotation `ssl-redirect: 'true'` + `tls` spec | Let's Encrypt via Traefik certresolver |
| Data | AWS RDS + ElastiCache + S3 | Docker containers (postgres, redis, minio) |

**CRITICAL:** Cloud uses **ClusterIP + nginx ingress** (NOT LoadBalancer + ALB). Selfhosted uses `@pulumi/docker` exclusively (NOT Kubernetes).

---

## Providers

| Pattern | Code |
|---|---|
| Single cluster | `new k8s.Provider('k8s', { kubeconfig })` |
| EKS | `new k8s.Provider('eks', { kubeconfig: cluster.kubeconfig })` |
| Multi-cluster | `const providers = { primary: new k8s.Provider('primary', { kubeconfig: a }), secondary: new k8s.Provider('secondary', { kubeconfig: b }) } as const;` |

Target specific cluster: `new k8s.apps.v1.Deployment(name, spec, { provider: providers.primary })`.

**v4.25+ features:**
- Server-Side Apply by default (no `kubectl.k8s.io/last-applied-configuration` annotation)
- `enableConfigMapMutable` and `enableSecretMutable` stable
- Patch resources available for every resource type
- K8s schemas updated to 1.35 (sidecar containers GA, in-place pod resize GA, Gateway API v1.4)
- `pulumi.com/waitFor` annotation uses RFC 9535-compliant JSONPath parser
- `plainHttp` option on Chart resource for HTTP-only Helm registries

---

## Stack References

```typescript
const networkStack = new pulumi.StackReference('myorg/network/prod');
const vpcId = networkStack.getOutput('vpcId') as pulumi.Output<string>;
// v4.25+: use getOutputDetails for plain values (no apply needed)
const vpcIdDetails = networkStack.getOutputDetails('vpcId');
```

Format: `<org>/<project>/<stack>`. Both stacks must share the same backend.

---

## Security Contexts (Recommended for New Workloads)

NOT in current deploy.ts. Apply to all new resources:

```typescript
const _SECURITY = {
    pod: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
    container: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: true, runAsUser: 1000, capabilities: { drop: ['ALL'] } },
} as const;
```

| Pod Security Standard | Use Case |
|---|---|
| Restricted | Security-sensitive (preferred for all new workloads) |
| Baseline | General workloads needing broader capabilities |
| Privileged | System-level only (avoid; use specific capabilities instead) |

---

## K8s 1.33-1.35 Features for New Resources

| Feature | Status | K8s Version | Usage |
|---|---|---|---|
| Sidecar containers | GA | 1.33 | Init containers with `restartPolicy: Always` |
| In-place pod resize | GA | 1.35 | `spec.containers[].resizePolicy` for CPU/memory without restart |
| ValidatingAdmissionPolicy | GA | 1.30 | CEL-based admission control (replaces webhooks for simple policies) |
| Gateway API | v1.4 GA | 1.35 | HTTPRoute, GRPCRoute, Gateway, GatewayClass (replaces Ingress) |
| EndpointSlice | Stable | 1.33 | Preferred over Endpoints (Endpoints deprecated) |
| Pod readiness gates | Stable | 1.32+ | `spec.readinessGates` for custom conditions |
| User namespaces | Default-on | 1.33 | Enhanced container isolation |
| cgroup v2 only | Default | 1.35 | Legacy cgroup v1 retired |
| Numeric taint comparisons | Beta | 1.35 | `Gt`/`Lt` operators in tolerations |
| KYAML | Beta | 1.35 | Safer YAML subset for kubectl |

---

## Transforms (Cross-Cutting Concerns)

```typescript
// Apply labels/security to all resources in a stack via provider-level transforms
const provider = new k8s.Provider('k8s', {
    kubeconfig,
    enableServerSideApply: true,
});

// Resource transforms (v4.25+) -- works with packaged component children
pulumi.runtime.registerStackTransformation((args) => {
    if (args.type.startsWith('kubernetes:')) {
        args.props.metadata = {
            ...args.props.metadata,
            labels: { ...args.props.metadata?.labels, 'managed-by': 'pulumi', env: 'prod' },
        };
    }
    return { props: args.props, opts: args.opts };
});
```

---

## CrossGuard Policy Packs

```typescript
// Enforce security standards via Pulumi policy as code
import * as policy from '@pulumi/policy';

const pack = new policy.PolicyPack('k8s-security', {
    policies: [{
        name: 'no-privileged-containers',
        description: 'Containers must not run in privileged mode',
        enforcementLevel: 'mandatory',
        validateResource: policy.validateResourceOfType(k8s.apps.v1.Deployment, (deployment, args, reportViolation) => {
            const containers = deployment.spec?.template?.spec?.containers ?? [];
            containers.forEach((container) => {
                if (container.securityContext?.privileged) {
                    reportViolation(`Container ${container.name} must not be privileged`);
                }
            });
        }),
    }],
});
```

Pre-built compliance packs available for CIS, PCI DSS v4.0, NIST SP 800-53, HITRUST CSF v11.5.
