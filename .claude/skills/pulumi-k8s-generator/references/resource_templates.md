# Pulumi Kubernetes Resource Templates

Canonical: `infrastructure/src/deploy.ts` (207 LOC).
Provider: `@pulumi/kubernetes` v4.25+ | K8s 1.32-1.35

---

## Core Pattern: `_CONFIG` + `_Ops` + Dispatch Table

```typescript
import * as k8s from '@pulumi/kubernetes';
import * as docker from '@pulumi/docker';
import * as pulumi from '@pulumi/pulumi';

// --- [CONSTANTS] -------------------------------------------------------------
const _CONFIG = {
    images: { api: 'myapp:latest', postgres: 'postgres:18.1-alpine', redis: 'redis:7-alpine' },
    k8s: {
        ingress: { 'kubernetes.io/ingress.class': 'nginx', 'nginx.ingress.kubernetes.io/ssl-redirect': 'true' },
        labels: { app: 'myapp' },
        namespace: 'myapp',
        probes: {
            live: { httpGet: { path: '/health', port: 8080 }, periodSeconds: 10, failureThreshold: 3 },
            ready: { httpGet: { path: '/ready', port: 8080 }, periodSeconds: 5, failureThreshold: 3 },
            startup: { httpGet: { path: '/health', port: 8080 }, periodSeconds: 5, failureThreshold: 30 },
        },
    },
    names: { deployment: 'compute-deploy', stack: 'myapp' },
    ports: { api: 8080, postgres: 5432, redis: 6379 },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------
const _Ops = {
    compact: (values: Record<string, pulumi.Input<string> | undefined>) =>
        Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<string, pulumi.Input<string>>,
    dockerEnvs: (vars: Record<string, pulumi.Input<string>>) =>
        Object.entries(vars).map(([name, value]) => pulumi.interpolate`${name}=${value}`),
    dockerPort: (port: number) => ({ external: port, internal: port }),
    fail: (message: string): never => { console.error(message); return process.exit(1); },
    k8sUrl: (ns: pulumi.Input<string>, name: pulumi.Input<string>, port: number) =>
        pulumi.interpolate`http://${name}.${ns}.svc.cluster.local:${port}`,
    meta: (namespace: pulumi.Input<string>, component: string, name?: string) => ({
        labels: { component, stack: _CONFIG.names.stack }, namespace, ...(name ? { name } : {}),
    }),
    mode: (env: NodeJS.ProcessEnv) => {
        const mode = env['DEPLOYMENT_MODE'];
        return mode === 'cloud' || mode === 'selfhosted' ? mode : _Ops.fail('[MISSING_ENV] DEPLOYMENT_MODE');
    },
    secret: (env: NodeJS.ProcessEnv, name: string) => pulumi.secret(_Ops.text(env, name)),
    text: (env: NodeJS.ProcessEnv, name: string) =>
        env[name] && env[name] !== '' ? env[name] : _Ops.fail(`[MISSING_ENV] ${name}`),
};

// --- [DISPATCH_TABLES] -------------------------------------------------------
const _DEPLOY = {
    cloud: (args: { env: NodeJS.ProcessEnv }) => { /* K8s + AWS */ },
    selfhosted: (args: { env: NodeJS.ProcessEnv }) => { /* Docker only */ },
} as const;
```

---

## Cloud Branch: Deployment + Service + HPA + Ingress

All cloud resources use **ClusterIP** services and **nginx** ingress class. From deploy.ts:133-175:

```typescript
// Inside _DEPLOY.cloud:
const ns = new k8s.core.v1.Namespace('myapp-ns', { metadata: { name: _CONFIG.k8s.namespace } });
const computeMeta = { labels: _CONFIG.k8s.labels, namespace: ns.metadata.name };

const configMap = new k8s.core.v1.ConfigMap('compute-config', { data: runtime.envVars, metadata: computeMeta });
const secret = new k8s.core.v1.Secret('compute-secret', { metadata: computeMeta, stringData: runtime.secretVars });

// Container spec (deploy.ts:160-170)
const apiContainer = {
    env: [
        { name: 'K8S_CONTAINER_NAME', value: 'api' },
        { name: 'K8S_DEPLOYMENT_NAME', value: _CONFIG.names.deployment },
        { name: 'K8S_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
        { name: 'K8S_NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } },
        { name: 'K8S_POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
    ],
    envFrom: [{ configMapRef: { name: configMap.metadata.name } }, { secretRef: { name: secret.metadata.name } }],
    image: input.api.image,
    livenessProbe: _CONFIG.k8s.probes.live,
    name: 'api',
    ports: [{ containerPort: _CONFIG.ports.api, name: 'http' }],
    readinessProbe: _CONFIG.k8s.probes.ready,
    resources: { limits: { cpu: input.api.cpu, memory: input.api.memory }, requests: { cpu: input.api.cpu, memory: input.api.memory } },
    startupProbe: _CONFIG.k8s.probes.startup,
};

// Deployment (deploy.ts:172)
const deploy = new k8s.apps.v1.Deployment('compute-deploy', {
    metadata: computeMeta,
    spec: { replicas: input.api.replicas, selector: { matchLabels: _CONFIG.k8s.labels }, template: { metadata: { labels: _CONFIG.k8s.labels }, spec: { containers: [apiContainer], terminationGracePeriodSeconds: 30 } } },
});

// Service -- ClusterIP (deploy.ts:173)
const service = new k8s.core.v1.Service('compute-svc', {
    metadata: computeMeta,
    spec: { ports: [{ name: 'http', port: _CONFIG.ports.api, protocol: 'TCP', targetPort: _CONFIG.ports.api }], selector: _CONFIG.k8s.labels, type: 'ClusterIP' },
});

// HPA -- CPU + memory (deploy.ts:174)
new k8s.autoscaling.v2.HorizontalPodAutoscaler('compute-hpa', {
    metadata: computeMeta,
    spec: { maxReplicas: input.api.maxReplicas, metrics: [{ resource: { name: 'cpu', target: { averageUtilization: input.hpa.cpuTarget, type: 'Utilization' } }, type: 'Resource' }, { resource: { name: 'memory', target: { averageUtilization: input.hpa.memoryTarget, type: 'Utilization' } }, type: 'Resource' }], minReplicas: input.api.minReplicas, scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deploy.metadata.name } },
});

// Ingress -- nginx class with TLS (deploy.ts:175)
new k8s.networking.v1.Ingress('compute-ingress', {
    metadata: { ...computeMeta, annotations: _CONFIG.k8s.ingress },
    spec: { rules: [{ host: input.api.domain, http: { paths: [{ backend: { service: { name: service.metadata.name, port: { number: _CONFIG.ports.api } } }, path: '/', pathType: 'Prefix' }] } }], tls: [{ hosts: [input.api.domain], secretName: 'compute-tls' }] },
});
```

**Ingress annotations (from deploy.ts:16):**
- `kubernetes.io/ingress.class: nginx`
- `nginx.ingress.kubernetes.io/proxy-body-size: 50m`
- `nginx.ingress.kubernetes.io/proxy-read-timeout: 60`
- `nginx.ingress.kubernetes.io/ssl-redirect: true`

---

## Selfhosted Branch: Docker Containers

Selfhosted uses `@pulumi/docker` exclusively -- NO Kubernetes resources (deploy.ts:178-194):

```typescript
// Inside _DEPLOY.selfhosted:
const network = new docker.Network('data-net', { name: 'parametric' });
const nets = [{ name: pulumi.output(network.id) }];

new docker.Container('data-pg', {
    envs: [pulumi.interpolate`POSTGRES_PASSWORD=${_Ops.secret(args.env, 'POSTGRES_PASSWORD')}`, 'POSTGRES_DB=parametric'],
    healthcheck: { interval: '10s', retries: 5, timeout: '5s', tests: ['CMD-SHELL', 'pg_isready -U postgres'] },
    image: _CONFIG.images.postgres, name: 'data-postgres', networksAdvanced: nets,
    ports: [_Ops.dockerPort(_CONFIG.ports.postgres)], restart: 'unless-stopped',
    volumes: [{ containerPath: '/var/lib/postgresql/data', volumeName: new docker.Volume('data-db-vol', { name: 'data-db-data' }).name }],
});

const api = new docker.Container('compute-api', {
    envs: [..._Ops.dockerEnvs(runtime.envVars), ..._Ops.dockerEnvs(runtime.secretVars)],
    healthcheck: { interval: '10s', retries: 3, startPeriod: '30s', tests: ['CMD', 'wget', '--spider', '-q', 'http://localhost:4000/api/health/liveness'], timeout: '5s' },
    image: input.api.image, labels: traefikLabels, name: 'compute-api', networksAdvanced: nets,
    ports: [_Ops.dockerPort(_CONFIG.ports.api)], restart: 'unless-stopped',
});
```

---

## Array-Driven Factory: `_k8sObserve` Pattern

Creates PVC + ConfigMap + Deployment + Service per array item (deploy.ts:120-126):

```typescript
const _k8sObserve = (namespace: pulumi.Input<string>, items: ReadonlyArray<{
    cmd: string[]; config: pulumi.Input<string>; configFile: string;
    configPath: string; dataPath: string; image: string;
    name: 'grafana' | 'prometheus'; port: number; storageGi: number;
}>) => items.map((item) => {
    const pvc = new k8s.core.v1.PersistentVolumeClaim(`${item.name}-pvc`, { metadata: _Ops.meta(namespace, item.name), spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: `${item.storageGi}Gi` } } } });
    const cfg = new k8s.core.v1.ConfigMap(`${item.name}-cfg`, { data: { [item.configFile]: item.config }, metadata: _Ops.meta(namespace, item.name) });
    new k8s.apps.v1.Deployment(item.name, { metadata: _Ops.meta(namespace, item.name), spec: { replicas: 1, selector: { matchLabels: { app: item.name } }, template: { metadata: { labels: { app: item.name, stack: _CONFIG.names.stack, tier: 'observe' } }, spec: { containers: [{ args: item.cmd, image: item.image, name: item.name, ports: [{ containerPort: item.port }], volumeMounts: [{ mountPath: item.configPath, name: 'cfg' }, { mountPath: item.dataPath, name: 'data' }] }], volumes: [{ configMap: { name: cfg.metadata.name }, name: 'cfg' }, { name: 'data', persistentVolumeClaim: { claimName: pvc.metadata.name } }] } } } });
    new k8s.core.v1.Service(`${item.name}-svc`, { metadata: _Ops.meta(namespace, item.name, item.name), spec: { ports: [{ port: item.port }], selector: { app: item.name } } });
    return item;
});
```

Invoked at deploy.ts:151-154 with Prometheus + Grafana items.

---

## ComponentResource Composition

Use when building a reusable library unit (NOT inline stacks):

```typescript
interface AppComponentArgs {
    readonly namespace: pulumi.Input<string>;
    readonly image: pulumi.Input<string>;
    readonly port: number;
    readonly replicas: number;
    readonly resources: k8s.types.input.core.v1.ResourceRequirements;
    readonly labels: Record<string, string>;
    readonly selectorLabels: Record<string, string>;
    readonly probes?: { readonly live: k8s.types.input.core.v1.Probe; readonly ready: k8s.types.input.core.v1.Probe };
}

class AppComponent extends pulumi.ComponentResource {
    readonly serviceUrl: pulumi.Output<string>;
    constructor(name: string, args: AppComponentArgs, opts?: pulumi.ComponentResourceOpts) {
        super('custom:app:AppComponent', name, args, opts);
        const child = { parent: this } as const;
        const deployment = new k8s.apps.v1.Deployment(`${name}-deploy`, {
            metadata: { namespace: args.namespace, labels: args.labels },
            spec: { replicas: args.replicas, selector: { matchLabels: args.selectorLabels }, template: { metadata: { labels: args.labels }, spec: { containers: [{ name, image: args.image, ports: [{ containerPort: args.port }], resources: args.resources, ...(args.probes ? { livenessProbe: args.probes.live, readinessProbe: args.probes.ready } : {}) }] } } },
        }, child);
        const service = new k8s.core.v1.Service(`${name}-svc`, {
            metadata: { namespace: args.namespace, labels: args.labels },
            spec: { selector: args.selectorLabels, ports: [{ port: 80, targetPort: args.port, protocol: 'TCP' }], type: 'ClusterIP' },
        }, child);
        this.serviceUrl = pulumi.interpolate`http://${service.metadata.name}.${args.namespace}.svc.cluster.local`;
        this.registerOutputs({ deploymentName: deployment.metadata.name, serviceName: service.metadata.name, serviceUrl: this.serviceUrl });
    }
}
```

Rules: extend `pulumi.ComponentResource`, call `super()` with URN `"custom:<domain>:<Name>"`, pass `{ parent: this }` to children, call `registerOutputs({})`.

---

## Advanced Patterns

### Secrets

```typescript
// Wrap env var as Pulumi secret (encrypted in state) -- deploy.ts:113
const dbPassword = pulumi.secret(process.env['DB_PASSWORD']!);
// Use in interpolation -- stays encrypted
const connectionString = pulumi.interpolate`postgres://user:${dbPassword}@host:5432/db`;
// In Secret resource -- deploy.ts:159
new k8s.core.v1.Secret('db-secret', { metadata: computeMeta, stringData: { DATABASE_URL: connectionString } });
```

### String Interpolation

```typescript
// pulumi.interpolate preserves Output<T> reactivity -- deploy.ts:62
const endpoint = pulumi.interpolate`http://${service.metadata.name}.${ns}.svc.cluster.local:${port}`;
// NOT string templates -- these resolve immediately and break outputs
// WRONG: `http://${service.metadata.name}:${port}`
```

### Sidecar Containers (K8s 1.33+ GA)

```typescript
// Sidecars are init containers with restartPolicy: Always
// They start in order before main containers and run for pod lifetime
const podSpec = {
    initContainers: [{
        name: 'log-collector',
        image: 'grafana/alloy:v1.5.0',
        restartPolicy: 'Always',  // Makes it a sidecar -- runs alongside main container
        resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '100m', memory: '128Mi' } },
        ports: [{ containerPort: 4317, name: 'otlp-grpc' }],
    }, {
        name: 'service-mesh-proxy',
        image: 'envoyproxy/envoy:v1.32.0',
        restartPolicy: 'Always',
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '200m', memory: '256Mi' } },
        ports: [{ containerPort: 9901, name: 'admin' }],
    }],
    containers: [apiContainer],
    terminationGracePeriodSeconds: 30,
};
```

### Gateway API Resources (v1.4 GA)

```typescript
// Gateway API is the modern replacement for Ingress
// Requires GatewayClass CRDs installed by a gateway controller (envoy-gateway, nginx-gateway-fabric, etc.)

// GatewayClass -- managed by controller, usually pre-installed
new k8s.apiextensions.CustomResource('gateway-class', {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'GatewayClass',
    metadata: { name: 'envoy-gateway' },
    spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
});

// Gateway -- allocates infrastructure (load balancer, etc.)
const gateway = new k8s.apiextensions.CustomResource('compute-gateway', {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { ...computeMeta, name: 'compute-gateway' },
    spec: {
        gatewayClassName: 'envoy-gateway',
        listeners: [
            { name: 'https', port: 443, protocol: 'HTTPS', tls: { mode: 'Terminate', certificateRefs: [{ name: 'compute-tls' }] } },
            { name: 'http', port: 80, protocol: 'HTTP' },
        ],
    },
});

// HTTPRoute -- routes HTTP/HTTPS traffic to backends
new k8s.apiextensions.CustomResource('compute-httproute', {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: computeMeta,
    spec: {
        parentRefs: [{ name: 'compute-gateway', namespace: _CONFIG.k8s.namespace }],
        hostnames: [input.api.domain],
        rules: [{
            matches: [{ path: { type: 'PathPrefix', value: '/' } }],
            backendRefs: [{ name: service.metadata.name, port: _CONFIG.ports.api }],
        }],
    },
});

// GRPCRoute -- routes gRPC traffic
new k8s.apiextensions.CustomResource('grpc-route', {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'GRPCRoute',
    metadata: computeMeta,
    spec: {
        parentRefs: [{ name: 'compute-gateway' }],
        rules: [{
            matches: [{ method: { service: 'myapp.v1.MyService', method: 'GetItem' } }],
            backendRefs: [{ name: 'grpc-svc', port: 50051 }],
        }],
    },
});
```

### NetworkPolicy (Default-Deny + Allow Specific)

```typescript
// Default deny all -- baseline zero-trust
new k8s.networking.v1.NetworkPolicy('compute-deny-all', {
    metadata: computeMeta,
    spec: {
        podSelector: { matchLabels: _CONFIG.k8s.labels },
        policyTypes: ['Ingress', 'Egress'],
        // Empty ingress/egress = deny all
    },
});

// Allow ingress from ingress controller only
new k8s.networking.v1.NetworkPolicy('compute-allow-ingress', {
    metadata: computeMeta,
    spec: {
        podSelector: { matchLabels: _CONFIG.k8s.labels },
        policyTypes: ['Ingress'],
        ingress: [{
            from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-nginx' } } }],
            ports: [{ port: _CONFIG.ports.api, protocol: 'TCP' }],
        }],
    },
});

// Allow egress to database, Redis, DNS
new k8s.networking.v1.NetworkPolicy('compute-allow-egress', {
    metadata: computeMeta,
    spec: {
        podSelector: { matchLabels: _CONFIG.k8s.labels },
        policyTypes: ['Egress'],
        egress: [
            { ports: [{ port: 53, protocol: 'TCP' }, { port: 53, protocol: 'UDP' }] },  // DNS
            { ports: [{ port: 5432, protocol: 'TCP' }] },  // PostgreSQL
            { ports: [{ port: 6379, protocol: 'TCP' }] },  // Redis
            { ports: [{ port: 443, protocol: 'TCP' }] },   // HTTPS (external APIs)
        ],
    },
});
```

### PodDisruptionBudget

```typescript
// Required for any Deployment with replicas >= 2
new k8s.policy.v1.PodDisruptionBudget('compute-pdb', {
    metadata: computeMeta,
    spec: {
        maxUnavailable: 1,  // Or: minAvailable: '50%'
        selector: { matchLabels: _CONFIG.k8s.labels },
    },
});
```

### HPA v2 with Custom Metrics and Scaling Behavior

```typescript
new k8s.autoscaling.v2.HorizontalPodAutoscaler('compute-hpa-advanced', {
    metadata: computeMeta,
    spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deploy.metadata.name },
        minReplicas: input.api.minReplicas,
        maxReplicas: input.api.maxReplicas,
        metrics: [
            { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } },
            { type: 'Resource', resource: { name: 'memory', target: { type: 'Utilization', averageUtilization: 80 } } },
            // Custom metric from Prometheus Adapter
            { type: 'Pods', pods: { metric: { name: 'http_requests_per_second' }, target: { type: 'AverageValue', averageValue: '100' } } },
        ],
        behavior: {
            scaleUp: {
                stabilizationWindowSeconds: 60,
                policies: [{ type: 'Percent', value: 100, periodSeconds: 60 }],
                selectPolicy: 'Max',
            },
            scaleDown: {
                stabilizationWindowSeconds: 300,
                policies: [{ type: 'Pods', value: 1, periodSeconds: 60 }],
                selectPolicy: 'Min',
            },
        },
    },
});
```

### ValidatingAdmissionPolicy (CEL-based, GA 1.30+)

```typescript
// Require resource limits on all containers
new k8s.apiextensions.CustomResource('require-resource-limits', {
    apiVersion: 'admissionregistration.k8s.io/v1',
    kind: 'ValidatingAdmissionPolicy',
    metadata: { name: 'require-resource-limits' },
    spec: {
        failurePolicy: 'Fail',
        matchConstraints: {
            resourceRules: [{ apiGroups: ['apps'], apiVersions: ['v1'], operations: ['CREATE', 'UPDATE'], resources: ['deployments'] }],
        },
        validations: [{
            expression: 'object.spec.template.spec.containers.all(c, has(c.resources) && has(c.resources.limits))',
            message: 'All containers must have resource limits defined',
        }],
    },
});

// Bind the policy
new k8s.apiextensions.CustomResource('require-resource-limits-binding', {
    apiVersion: 'admissionregistration.k8s.io/v1',
    kind: 'ValidatingAdmissionPolicyBinding',
    metadata: { name: 'require-resource-limits-binding' },
    spec: {
        policyName: 'require-resource-limits',
        validationActions: ['Deny'],
        matchResources: { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': _CONFIG.k8s.namespace } } },
    },
});
```

### Topology Spread and Anti-Affinity

```typescript
const podSpec = {
    containers: [apiContainer],
    // Spread across availability zones
    topologySpreadConstraints: [{
        maxSkew: 1,
        topologyKey: 'topology.kubernetes.io/zone',
        whenUnsatisfiable: 'DoNotSchedule',
        labelSelector: { matchLabels: _CONFIG.k8s.labels },
    }],
    // Anti-affinity: avoid same node
    affinity: {
        podAntiAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [{
                weight: 100,
                podAffinityTerm: {
                    labelSelector: { matchLabels: _CONFIG.k8s.labels },
                    topologyKey: 'kubernetes.io/hostname',
                },
            }],
        },
    },
    terminationGracePeriodSeconds: 30,
};
```

---

## Resource-Specific Quick Reference

| Resource | Key Fields | deploy.ts Name | Line |
|---|---|---|---|
| Namespace | `metadata.name` | `parametric-ns` | 133 |
| ConfigMap | `data`, `metadata` | `compute-config` | 158 |
| Secret | `stringData`, `metadata` | `compute-secret` | 159 |
| Deployment | `spec.template.spec.containers`, probes, resources | `compute-deploy` | 172 |
| Service | `spec.ports`, `spec.selector`, `spec.type: 'ClusterIP'` | `compute-svc` | 173 |
| HPA | `spec.scaleTargetRef`, `spec.metrics` (CPU + memory), min/max, `spec.behavior` | `compute-hpa` | 174 |
| Ingress | `spec.rules`, `spec.tls`, annotations (`nginx` class) | `compute-ingress` | 175 |
| PVC | `spec.accessModes`, `spec.resources.requests.storage` | `*-pvc` (via factory) | 121 |
| DaemonSet | `spec.template` (same as Deployment, no replicas) | `observe-alloy` | 149 |
| NetworkPolicy | `spec.podSelector`, `spec.policyTypes`, `spec.ingress/egress` | Not in deploy.ts | -- |
| PDB | `spec.maxUnavailable` or `spec.minAvailable`, `spec.selector` | Not in deploy.ts | -- |
| Gateway | `spec.gatewayClassName`, `spec.listeners` | Not in deploy.ts | -- |
| HTTPRoute | `spec.parentRefs`, `spec.hostnames`, `spec.rules` | Not in deploy.ts | -- |
| GRPCRoute | `spec.parentRefs`, `spec.rules[].matches[].method` | Not in deploy.ts | -- |
| ValidatingAdmissionPolicy | `spec.validations[].expression` (CEL), `spec.matchConstraints` | Not in deploy.ts | -- |

---

## Defaults

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
    xlarge: { requests: { cpu: '1000m', memory: '1Gi'  }, limits: { cpu: '2000m', memory: '2Gi'   } },
} as const;
```
