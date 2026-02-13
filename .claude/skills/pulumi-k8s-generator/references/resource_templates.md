# [H1][RESOURCE_TEMPLATES]
>**Dictum:** *Templates encode deploy.ts patterns as reusable blueprints.*

<br>

Canonical: `infrastructure/src/deploy.ts` (207 LOC) | Provider: current stable `@pulumi/kubernetes` | K8s 1.32-1.35

---
## [1][CORE_PATTERN]
>**Dictum:** *`_CONFIG` + `_Ops` + dispatch table structures all infrastructure.*

<br>

```typescript
const _CONFIG = {
    images: { api: 'myapp:v1.2.3', postgres: 'postgres:18.1-alpine', redis: 'redis:7-alpine' },
    k8s: { ingress: { 'kubernetes.io/ingress.class': 'nginx', 'nginx.ingress.kubernetes.io/ssl-redirect': 'true' },
        labels: { app: 'myapp' }, namespace: 'myapp',
        probes: { live: { httpGet: { path: '/health', port: 8080 }, periodSeconds: 10, failureThreshold: 3 },
            ready: { httpGet: { path: '/ready', port: 8080 }, periodSeconds: 5, failureThreshold: 3 },
            startup: { httpGet: { path: '/health', port: 8080 }, periodSeconds: 5, failureThreshold: 30 } } },
    names: { deployment: 'compute-deploy', stack: 'myapp' },
    ports: { api: 8080, postgres: 5432, redis: 6379 },
} as const;

const _Ops = {
    compact: (values: Record<string, pulumi.Input<string> | undefined>) =>
        Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<string, pulumi.Input<string>>,
    fail: (message: string): never => { console.error(message); return process.exit(1); },
    k8sUrl: (ns: pulumi.Input<string>, name: pulumi.Input<string>, port: number) =>
        pulumi.interpolate`http://${name}.${ns}.svc.cluster.local:${port}`,
    meta: (namespace: pulumi.Input<string>, component: string, name?: string) => ({
        labels: { component, stack: _CONFIG.names.stack }, namespace, ...(name ? { name } : {}) }),
    secret: (env: NodeJS.ProcessEnv, name: string) => pulumi.secret(_Ops.text(env, name)),
    text: (env: NodeJS.ProcessEnv, name: string) =>
        env[name] && env[name] !== '' ? env[name] : _Ops.fail(`[MISSING_ENV] ${name}`),
};

const _DEPLOY = { cloud: (args) => { /* K8s + AWS */ }, selfhosted: (args) => { /* Docker only */ } } as const;
```

---
## [2][CLOUD_RESOURCES]
>**Dictum:** *ClusterIP + nginx ingress -- never LoadBalancer + ALB.*

<br>

```typescript
// Deployment + Service + HPA + Ingress (deploy.ts:133-175)
const ns = new k8s.core.v1.Namespace('myapp-ns', { metadata: { name: _CONFIG.k8s.namespace } });
const computeMeta = { labels: _CONFIG.k8s.labels, namespace: ns.metadata.name };
const configMap = new k8s.core.v1.ConfigMap('compute-config', { data: runtime.envVars, metadata: computeMeta });
const secret = new k8s.core.v1.Secret('compute-secret', { metadata: computeMeta, stringData: runtime.secretVars });
const apiContainer = {
    env: [{ name: 'K8S_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } }],
    envFrom: [{ configMapRef: { name: configMap.metadata.name } }, { secretRef: { name: secret.metadata.name } }],
    image: input.api.image, livenessProbe: _CONFIG.k8s.probes.live, name: 'api',
    ports: [{ containerPort: _CONFIG.ports.api, name: 'http' }], readinessProbe: _CONFIG.k8s.probes.ready,
    resources: { limits: { cpu: input.api.cpu, memory: input.api.memory }, requests: { cpu: input.api.cpu, memory: input.api.memory } },
    startupProbe: _CONFIG.k8s.probes.startup,
};
const deploy = new k8s.apps.v1.Deployment('compute-deploy', { metadata: computeMeta,
    spec: { replicas: input.api.replicas, selector: { matchLabels: _CONFIG.k8s.labels },
        template: { metadata: { labels: _CONFIG.k8s.labels }, spec: { containers: [apiContainer], terminationGracePeriodSeconds: 30 } } } });
const service = new k8s.core.v1.Service('compute-svc', { metadata: computeMeta,
    spec: { ports: [{ name: 'http', port: _CONFIG.ports.api, protocol: 'TCP', targetPort: _CONFIG.ports.api }], selector: _CONFIG.k8s.labels, type: 'ClusterIP' } });
new k8s.autoscaling.v2.HorizontalPodAutoscaler('compute-hpa', { metadata: computeMeta,
    spec: { maxReplicas: input.api.maxReplicas, metrics: [{ resource: { name: 'cpu', target: { averageUtilization: input.hpa.cpuTarget, type: 'Utilization' } }, type: 'Resource' }],
        minReplicas: input.api.minReplicas, scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deploy.metadata.name } } });
new k8s.networking.v1.Ingress('compute-ingress', { metadata: { ...computeMeta, annotations: _CONFIG.k8s.ingress },
    spec: { rules: [{ host: input.api.domain, http: { paths: [{ backend: { service: { name: service.metadata.name, port: { number: _CONFIG.ports.api } } }, path: '/', pathType: 'Prefix' }] } }],
        tls: [{ hosts: [input.api.domain], secretName: 'compute-tls' }] } });
```

---
## [3][ADVANCED_PATTERNS]
>**Dictum:** *K8s 1.33-1.35 features and production hardening patterns.*

<br>

### [3.1][SECURITY_AND_SCHEDULING]

```typescript
const _SECURITY = {
    pod: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } },
    container: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, runAsNonRoot: true, runAsUser: 1000, capabilities: { drop: ['ALL'] } },
} as const;
const _RESOURCES = {
    micro:  { requests: { cpu: '50m',  memory: '64Mi'  }, limits: { cpu: '100m',  memory: '128Mi' } },
    small:  { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '250m',  memory: '256Mi' } },
    medium: { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '500m',  memory: '512Mi' } },
    large:  { requests: { cpu: '500m', memory: '512Mi' }, limits: { cpu: '1000m', memory: '1Gi'   } },
} as const;
// topologySpreadConstraints + anti-affinity
const podSpec = { containers: [apiContainer],
    topologySpreadConstraints: [{ maxSkew: 1, topologyKey: 'topology.kubernetes.io/zone',
        whenUnsatisfiable: 'DoNotSchedule', labelSelector: { matchLabels: _CONFIG.k8s.labels } }],
    affinity: { podAntiAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100,
        podAffinityTerm: { labelSelector: { matchLabels: _CONFIG.k8s.labels }, topologyKey: 'kubernetes.io/hostname' } }] } },
    terminationGracePeriodSeconds: 30 };
```

### [3.2][NETWORK_AND_DISRUPTION]

```typescript
// PodDisruptionBudget -- required for replicas >= 2
new k8s.policy.v1.PodDisruptionBudget('compute-pdb', { metadata: computeMeta,
    spec: { maxUnavailable: 1, selector: { matchLabels: _CONFIG.k8s.labels } } });
// NetworkPolicy -- default deny + allow ingress controller + allow egress to deps
new k8s.networking.v1.NetworkPolicy('compute-deny-all', { metadata: computeMeta,
    spec: { podSelector: { matchLabels: _CONFIG.k8s.labels }, policyTypes: ['Ingress', 'Egress'] } });
new k8s.networking.v1.NetworkPolicy('compute-allow-ingress', { metadata: computeMeta,
    spec: { podSelector: { matchLabels: _CONFIG.k8s.labels }, policyTypes: ['Ingress'],
        ingress: [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-nginx' } } }],
            ports: [{ port: _CONFIG.ports.api, protocol: 'TCP' }] }] } });
new k8s.networking.v1.NetworkPolicy('compute-allow-egress', { metadata: computeMeta,
    spec: { podSelector: { matchLabels: _CONFIG.k8s.labels }, policyTypes: ['Egress'],
        egress: [{ ports: [{ port: 53, protocol: 'TCP' }, { port: 53, protocol: 'UDP' }] },
            { ports: [{ port: 5432, protocol: 'TCP' }] }, { ports: [{ port: 6379, protocol: 'TCP' }] }] } });
```

### [3.3][SIDECAR_AND_GATEWAY]

```typescript
// Sidecar containers (K8s 1.33+ GA) -- init containers with restartPolicy: Always
const podSpec = { initContainers: [{ name: 'log-collector', image: 'grafana/alloy:v1.5.0', restartPolicy: 'Always',
    resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '100m', memory: '128Mi' } },
    ports: [{ containerPort: 4317, name: 'otlp-grpc' }] }],
    containers: [apiContainer], terminationGracePeriodSeconds: 30 };
// Gateway API v1.4 GA -- modern Ingress replacement (requires controller CRDs)
new k8s.apiextensions.CustomResource('compute-gateway', { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'Gateway',
    metadata: { ...computeMeta, name: 'compute-gateway' },
    spec: { gatewayClassName: 'envoy-gateway', listeners: [
        { name: 'https', port: 443, protocol: 'HTTPS', tls: { mode: 'Terminate', certificateRefs: [{ name: 'compute-tls' }] } },
        { name: 'http', port: 80, protocol: 'HTTP' }] } });
new k8s.apiextensions.CustomResource('compute-httproute', { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'HTTPRoute',
    metadata: computeMeta, spec: { parentRefs: [{ name: 'compute-gateway', namespace: _CONFIG.k8s.namespace }],
        hostnames: [input.api.domain], rules: [{ matches: [{ path: { type: 'PathPrefix', value: '/' } }],
            backendRefs: [{ name: service.metadata.name, port: _CONFIG.ports.api }] }] } });
// ValidatingAdmissionPolicy (CEL-based, GA 1.30+)
new k8s.apiextensions.CustomResource('require-resource-limits', { apiVersion: 'admissionregistration.k8s.io/v1',
    kind: 'ValidatingAdmissionPolicy', metadata: { name: 'require-resource-limits' },
    spec: { failurePolicy: 'Fail', matchConstraints: { resourceRules: [{ apiGroups: ['apps'], apiVersions: ['v1'],
        operations: ['CREATE', 'UPDATE'], resources: ['deployments'] }] },
        validations: [{ expression: 'object.spec.template.spec.containers.all(c, has(c.resources) && has(c.resources.limits))',
            message: 'All containers must have resource limits' }] } });
```

### [3.4][DYNAMIC_RESOURCES_AND_RESIZE]

```typescript
// In-place pod resize (K8s 1.35 GA) -- modify CPU/memory without restart
const apiContainer = { name: 'api', image: input.api.image,
    resources: { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
    resizePolicy: [{ resourceName: 'cpu', restartPolicy: 'NotRequired' },
        { resourceName: 'memory', restartPolicy: 'RestartContainer' }] };
// DRA (Dynamic Resource Allocation) -- structured resource claims (1.35 GA)
new k8s.apiextensions.CustomResource('gpu-claim', { apiVersion: 'resource.k8s.io/v1alpha3', kind: 'ResourceClaim',
    metadata: { ...computeMeta, name: 'gpu-claim' },
    spec: { devices: { requests: [{ name: 'gpu', deviceClassName: 'nvidia-a100' }] } } });
// VolumeAttributesClass (K8s 1.35 GA) -- modify IOPS/throughput without PVC recreation
new k8s.apiextensions.CustomResource('high-perf-storage', { apiVersion: 'storage.k8s.io/v1beta1', kind: 'VolumeAttributesClass',
    metadata: { name: 'high-perf' }, driverName: 'ebs.csi.aws.com', parameters: { iops: '10000', throughput: '500' } });
```

---
## [4][COMPONENT_RESOURCE]
>**Dictum:** *ComponentResource encapsulates reusable multi-resource units.*

<br>

```typescript
class AppComponent extends pulumi.ComponentResource {
    readonly serviceUrl: pulumi.Output<string>;
    constructor(name: string, args: { namespace: pulumi.Input<string>; image: pulumi.Input<string>;
        port: number; replicas: number; resources: k8s.types.input.core.v1.ResourceRequirements;
        labels: Record<string, string>; selectorLabels: Record<string, string> }, opts?: pulumi.ComponentResourceOptions) {
        super('custom:app:AppComponent', name, args, opts);
        const child = { parent: this } as const;
        const deployment = new k8s.apps.v1.Deployment(`${name}-deploy`, { metadata: { namespace: args.namespace, labels: args.labels },
            spec: { replicas: args.replicas, selector: { matchLabels: args.selectorLabels },
                template: { metadata: { labels: args.labels }, spec: { containers: [{ name, image: args.image,
                    ports: [{ containerPort: args.port }], resources: args.resources }] } } } }, child);
        const service = new k8s.core.v1.Service(`${name}-svc`, { metadata: { namespace: args.namespace, labels: args.labels },
            spec: { selector: args.selectorLabels, ports: [{ port: 80, targetPort: args.port, protocol: 'TCP' }], type: 'ClusterIP' } }, child);
        this.serviceUrl = pulumi.interpolate`http://${service.metadata.name}.${args.namespace}.svc.cluster.local`;
        this.registerOutputs({ serviceUrl: this.serviceUrl });
    }
}
// Rules: extend ComponentResource, call super() with URN "custom:<domain>:<Name>", pass { parent: this } to children, call registerOutputs({}).
```
