import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as docker from '@pulumi/docker';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { identity, Match } from 'effect';
import { RuntimeEnv } from './runtime-env.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    aws: { backupRetentionDays: 7, bucketVersionRetentionDays: 90, cidr: '10.0.0.0/16', redisClusters: 2 },
    docker: { health: { interval: '10s', retries: 5, timeout: '5s' }, restart: 'unless-stopped' },
    images: { alloy: 'grafana/alloy:latest', grafana: 'grafana/grafana:latest', minio: 'minio/minio:latest', postgres: 'postgres:18.2-alpine', prometheus: 'prom/prometheus:latest', redis: 'redis:7-alpine', traefik: 'traefik:v3' },
    k8s: {
        ingress: { 'kubernetes.io/ingress.class': 'nginx', 'nginx.ingress.kubernetes.io/proxy-body-size': '50m', 'nginx.ingress.kubernetes.io/proxy-read-timeout': '60', 'nginx.ingress.kubernetes.io/ssl-redirect': 'true' },
        labels: { app: 'parametric-api' },
        namespace: 'parametric',
        probes: { live: { failureThreshold: 3, httpGet: { path: '/api/health/liveness', port: 4000 }, periodSeconds: 10 }, ready: { failureThreshold: 3, httpGet: { path: '/api/health/readiness', port: 4000 }, periodSeconds: 5 }, startup: { failureThreshold: 30, httpGet: { path: '/api/health/liveness', port: 4000 }, periodSeconds: 5 } },
    },
    names: { bucket: 'parametric', computeDeployment: 'compute-deploy', network: 'parametric', stack: 'parametric' },
    ports: { alloyGrpc: 4317, alloyHttp: 4318, alloyMetrics: 12345, api: 4000, grafana: 3000, minioApi: 9000, minioConsole: 9001, postgres: 5432, prometheus: 9090, redis: 6379, traefikHttp: 80, traefikHttps: 443 },
    traefik: { volumes: [{ containerPath: '/var/run/docker.sock', hostPath: '/var/run/docker.sock', readOnly: true }, { containerPath: '/letsencrypt', hostPath: '/var/lib/parametric/letsencrypt' }] },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _Ops = {
    alloy: (promUrl: pulumi.Input<string>) => pulumi.interpolate`otelcol.receiver.otlp "default" {
  grpc { endpoint = "0.0.0.0:${_CONFIG.ports.alloyGrpc}" }
  http { endpoint = "0.0.0.0:${_CONFIG.ports.alloyHttp}" }
  output { logs = [otelcol.exporter.debug.default.input] metrics = [otelcol.exporter.prometheus.default.input] traces = [otelcol.exporter.debug.default.input] }
}
otelcol.exporter.debug "default" { verbosity = "basic" }
otelcol.exporter.prometheus "default" { forward_to = [prometheus.remote_write.default.receiver] }
prometheus.remote_write "default" { endpoint { url = "${promUrl}/api/v1/write" } }`,
    apiBaseUrl: (domain: string) => Match.value(domain).pipe(
        Match.when(Match.is(''), () => `http://localhost:${_CONFIG.ports.api}`),
        Match.when((d): d is string => d.startsWith('http://') || d.startsWith('https://'), identity),
        Match.orElse((d) => `https://${d}`)
    ),
    cloud: (env: NodeJS.ProcessEnv) => ({
        api: { cpu: _Ops.text(env, 'CLOUD_API_CPU'), domain: _Ops.text(env, 'CLOUD_API_DOMAIN'), image: _Ops.text(env, 'API_IMAGE'), maxReplicas: _Ops.number(env, 'CLOUD_API_MAX_REPLICAS'), memory: _Ops.text(env, 'CLOUD_API_MEMORY'), minReplicas: _Ops.number(env, 'CLOUD_API_MIN_REPLICAS'), replicas: _Ops.number(env, 'CLOUD_API_REPLICAS') },
        azCount: _Ops.number(env, 'CLOUD_AZ_COUNT'),
        db: { cacheNodeType: _Ops.text(env, 'CLOUD_CACHE_NODE_TYPE'), dbClass: _Ops.text(env, 'CLOUD_DB_CLASS'), dbStorageGi: _Ops.number(env, 'CLOUD_DB_STORAGE_GB') },
        hpa: { cpuTarget: _Ops.number(env, 'CLOUD_HPA_CPU_TARGET'), memoryTarget: _Ops.number(env, 'CLOUD_HPA_MEMORY_TARGET') },
        observe: { grafanaStorageGi: _Ops.number(env, 'CLOUD_GRAFANA_STORAGE_GB'), prometheusStorageGi: _Ops.number(env, 'CLOUD_PROMETHEUS_STORAGE_GB'), retentionDays: _Ops.number(env, 'CLOUD_OBSERVE_RETENTION_DAYS') },
    }),
    compact: (values: Record<string, pulumi.Input<string> | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, pulumi.Input<string>>,
    dockerEnvs: (vars: Record<string, pulumi.Input<string>>) => Object.entries(vars).map(([name, value]) => pulumi.interpolate`${name}=${value}`),
    dockerHealth: (tests: string[]) => ({ ..._CONFIG.docker.health, tests }),
    dockerNets: (networkId: pulumi.Input<string>) => [{ name: pulumi.output(networkId) }],
    dockerPort: (port: number) => ({ external: port, internal: port }),
    dockerVol: (id: string, name: string, path: string) => [{ containerPath: path, volumeName: new docker.Volume(id, { name }).name }],
    fail: (message: string): never => {
        throw new pulumi.RunError(message);
    },
    grafana: (promUrl: pulumi.Input<string>) => pulumi.interpolate`apiVersion: 1\ndatasources:\n  - name: Prometheus\n    type: prometheus\n    access: proxy\n    url: ${promUrl}\n    isDefault: true`,
    httpHealth: (path: string, port: number) => ({ interval: '10s', retries: 3, startPeriod: '30s', tests: ['CMD', 'wget', '--spider', '-q', `http://localhost:${port}${path}`], timeout: '5s' }),
    k8sEnv: [{ name: 'K8S_CONTAINER_NAME', value: 'api' }, { name: 'K8S_DEPLOYMENT_NAME', value: _CONFIG.names.computeDeployment }, { name: 'K8S_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } }, { name: 'K8S_NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } }, { name: 'K8S_POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } }],
    k8sUrl: (ns: pulumi.Input<string>, name: pulumi.Input<string>, port: number) => pulumi.interpolate`http://${name}.${ns}.svc.cluster.local:${port}`,
    meta: (namespace: pulumi.Input<string>, component: string, name?: string) => ({ labels: { component, stack: _CONFIG.names.stack, tier: 'observe' }, namespace, ...(name ? { name } : {}) }),
    mode: (env: NodeJS.ProcessEnv) => {
        const mode = env['DEPLOYMENT_MODE'];
        return mode === 'cloud' || mode === 'selfhosted' ? mode : _Ops.fail('[MISSING_ENV] DEPLOYMENT_MODE must be cloud or selfhosted');
    },
    names: { alloy: 'observe-alloy', api: 'compute-api', grafana: 'observe-grafana', prometheus: 'observe-prometheus' } as const,
    number: (env: NodeJS.ProcessEnv, name: string) => { const value = Number(_Ops.text(env, name)); return Number.isFinite(value) ? value : _Ops.fail(`[INVALID_ENV] ${name} must be numeric`); },
    optionalSecret: (env: NodeJS.ProcessEnv, name: string) => env[name] && env[name] !== '' ? pulumi.secret(env[name]) : undefined,
    prometheus: (alloyHost: string) => `global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: alloy\n    static_configs: [{ targets: ["${alloyHost}:${_CONFIG.ports.alloyMetrics}"] }]\n  - job_name: prometheus\n    static_configs: [{ targets: ["localhost:${_CONFIG.ports.prometheus}"] }]`,
    runtime: (args: {
        apiDomain: string;
        data: {
            bucketName: pulumi.Input<string>;
            cacheHost: pulumi.Input<string>;
            cachePort: pulumi.Input<number>;
            dbHost: pulumi.Input<string>;
            dbPort: pulumi.Input<number>;
            storageEndpoint: pulumi.Input<string>;
            storageRegion: pulumi.Input<string>;
        };
        env: NodeJS.ProcessEnv;
        mode: 'cloud' | 'selfhosted';
        observe: { collectorEndpoint: pulumi.Input<string> };
        namespace?: pulumi.Input<string>;
    }) => RuntimeEnv.collect({
        derived: _Ops.compact({
            API_BASE_URL: _Ops.apiBaseUrl(args.apiDomain),
            CLUSTER_HEALTH_MODE: args.mode === 'cloud' ? 'k8s' : 'ping',
            K8S_LABEL_SELECTOR: args.mode === 'cloud' ? `app=${_CONFIG.k8s.labels.app}` : undefined,
            K8S_NAMESPACE: args.namespace,
            NODE_ENV: args.env['NODE_ENV'] ?? 'development',
            OTEL_EXPORTER_OTLP_ENDPOINT: args.observe.collectorEndpoint,
            OTEL_LOGS_EXPORTER: 'none',
            OTEL_METRICS_EXPORTER: 'otlp',
            OTEL_TRACES_EXPORTER: 'none',
            POSTGRES_HOST: args.data.dbHost,
            POSTGRES_PORT: pulumi.interpolate`${args.data.dbPort}`,
            PROXY_HOPS: args.mode === 'cloud' ? '1' : '0',
            REDIS_HOST: args.data.cacheHost,
            REDIS_PORT: pulumi.interpolate`${args.data.cachePort}`,
            REDIS_TLS: args.mode === 'cloud' ? 'true' : 'false',
            STORAGE_BUCKET: args.data.bucketName,
            STORAGE_ENDPOINT: args.mode === 'selfhosted' ? args.data.storageEndpoint : undefined,
            STORAGE_FORCE_PATH_STYLE: args.mode === 'selfhosted' ? 'true' : undefined,
            STORAGE_REGION: args.data.storageRegion,
            TRUST_PROXY: args.mode === 'cloud' ? 'true' : 'false',
        }),
        env: args.env,
        mode: args.mode,
    }),
    secret: (env: NodeJS.ProcessEnv, name: string) => pulumi.secret(_Ops.text(env, name)),
    securityGroup: (name: string, port: number, vpcId: pulumi.Input<string>) => new aws.ec2.SecurityGroup(name, { egress: [{ cidrBlocks: ['0.0.0.0/0'], fromPort: 0, protocol: '-1', toPort: 0 }], ingress: [{ cidrBlocks: [_CONFIG.aws.cidr], fromPort: port, protocol: 'tcp', toPort: port }], vpcId }),
    selfhosted: (env: NodeJS.ProcessEnv) => ({ acmeEmail: _Ops.text(env, 'ACME_EMAIL'), api: { domain: env['SELFHOSTED_API_DOMAIN'] ?? '', image: _Ops.text(env, 'API_IMAGE') }, observe: { retentionDays: _Ops.number(env, 'SELFHOSTED_OBSERVE_RETENTION_DAYS') } }),
    text: (env: NodeJS.ProcessEnv, name: string) => env[name] && env[name] !== '' ? env[name] : _Ops.fail(`[MISSING_ENV] ${name} is required`),
    traefikCmd: (email: string) => ['--providers.docker=true', '--providers.docker.exposedByDefault=false', '--entrypoints.web.address=:80', '--entrypoints.websecure.address=:443', '--entrypoints.web.http.redirections.entrypoint.to=websecure', '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web', '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json', `--certificatesresolvers.letsencrypt.acme.email=${email}`],
    traefikLabels: (domain: string, port: number) => [{ label: 'traefik.enable', value: 'true' }, { label: 'traefik.http.routers.api.rule', value: domain ? `Host(\`${domain}\`)` : 'PathPrefix(`/`)' }, { label: 'traefik.http.routers.api.entrypoints', value: 'websecure' }, { label: 'traefik.http.routers.api.tls.certresolver', value: 'letsencrypt' }, { label: 'traefik.http.services.api.loadbalancer.server.port', value: `${port}` }],
};
const _k8sObserve = (namespace: pulumi.Input<string>, items: ReadonlyArray<{ cmd: string[]; config: pulumi.Input<string>; configFile: string; configPath: string; dataPath: string; image: string; name: 'grafana' | 'prometheus'; port: number; storageGi: number }>) => items.map((item) => {
    const pvc = new k8s.core.v1.PersistentVolumeClaim(`${item.name}-pvc`, { metadata: _Ops.meta(namespace, item.name), spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: `${item.storageGi}Gi` } } } });
    const cfg = new k8s.core.v1.ConfigMap(`${item.name}-cfg`, { data: { [item.configFile]: item.config }, metadata: _Ops.meta(namespace, item.name) });
    new k8s.apps.v1.Deployment(item.name, { metadata: _Ops.meta(namespace, item.name), spec: { replicas: 1, selector: { matchLabels: { app: item.name } }, template: { metadata: { labels: { app: item.name, stack: _CONFIG.names.stack, tier: 'observe' } }, spec: { containers: [{ args: item.cmd, image: item.image, name: item.name, ports: [{ containerPort: item.port }], volumeMounts: [{ mountPath: item.configPath, name: 'cfg' }, { mountPath: item.dataPath, name: 'data' }] }], volumes: [{ configMap: { name: cfg.metadata.name }, name: 'cfg' }, { name: 'data', persistentVolumeClaim: { claimName: pvc.metadata.name } }] } } } });
    new k8s.core.v1.Service(`${item.name}-svc`, { metadata: _Ops.meta(namespace, item.name, item.name), spec: { ports: [{ port: item.port }], selector: { app: item.name } } });
    return item;
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const _DEPLOY = {
    cloud: (args: { env: NodeJS.ProcessEnv; stack: string }) => {
        const input = _Ops.cloud(args.env);
        const ns = new k8s.core.v1.Namespace('parametric-ns', { metadata: { name: _CONFIG.k8s.namespace } });
        const vpc = new awsx.ec2.Vpc('data-vpc', { cidrBlock: _CONFIG.aws.cidr, enableDnsHostnames: true, enableDnsSupport: true, natGateways: { strategy: 'Single' }, numberOfAvailabilityZones: input.azCount, tags: { Name: 'data-vpc' } });
        const dbSubnet = new aws.rds.SubnetGroup('data-db-subnets', { subnetIds: vpc.privateSubnetIds });
        const cloudPreloadLibraries = args.env['CLOUD_POSTGRES_SHARED_PRELOAD_LIBRARIES'];
        const dbParams = new aws.rds.ParameterGroup('data-db-params', {
            family: 'postgres18',
            parameters: [
                { applyMethod: 'pending-reboot', name: 'app.current_tenant', value: '' },
                { applyMethod: 'pending-reboot', name: 'max_replication_slots', value: '10' },
                { applyMethod: 'pending-reboot', name: 'wal_level', value: 'logical' },
                ...(cloudPreloadLibraries ? [{ applyMethod: 'pending-reboot', name: 'shared_preload_libraries', value: cloudPreloadLibraries }] : []),
            ],
        });
        const rds = new aws.rds.Instance('data-rds', { allocatedStorage: input.db.dbStorageGi, backupRetentionPeriod: _CONFIG.aws.backupRetentionDays, dbName: 'parametric', dbSubnetGroupName: dbSubnet.name, engine: 'postgres', engineVersion: '18.2', finalSnapshotIdentifier: 'data-final', instanceClass: input.db.dbClass, parameterGroupName: dbParams.name, password: _Ops.secret(args.env, 'POSTGRES_PASSWORD'), skipFinalSnapshot: false, storageEncrypted: true, username: 'postgres', vpcSecurityGroupIds: [_Ops.securityGroup('data-db-sg', _CONFIG.ports.postgres, vpc.vpcId).id] });
        const cacheSubnet = new aws.elasticache.SubnetGroup('data-cache-subnets', { subnetIds: vpc.privateSubnetIds });
        const redis = new aws.elasticache.ReplicationGroup('data-redis', { atRestEncryptionEnabled: true, authToken: _Ops.secret(args.env, 'REDIS_PASSWORD'), automaticFailoverEnabled: true, description: 'parametric redis', engine: 'redis', engineVersion: '7.1', nodeType: input.db.cacheNodeType, numCacheClusters: _CONFIG.aws.redisClusters, port: _CONFIG.ports.redis, securityGroupIds: [_Ops.securityGroup('data-cache-sg', _CONFIG.ports.redis, vpc.vpcId).id], subnetGroupName: cacheSubnet.name, transitEncryptionEnabled: true });
        const bucket = new aws.s3.Bucket('data-bucket', { bucket: 'parametric-assets', forceDestroy: false });
        new aws.s3.BucketVersioning('data-bucket-versioning', { bucket: bucket.id, versioningConfiguration: { status: 'Enabled' } });
        new aws.s3.BucketServerSideEncryptionConfiguration('data-bucket-encryption', { bucket: bucket.id, rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } }] });
        new aws.s3.BucketCorsConfiguration('data-bucket-cors', { bucket: bucket.id, corsRules: [{ allowedHeaders: ['*'], allowedMethods: ['GET', 'PUT', 'POST'], allowedOrigins: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 }] });
        new aws.s3.BucketLifecycleConfiguration('data-bucket-lifecycle', { bucket: bucket.id, rules: [{ id: 'expire-old-versions', noncurrentVersionExpiration: { noncurrentDays: _CONFIG.aws.bucketVersionRetentionDays }, status: 'Enabled' }] });
        const data = { bucketName: bucket.id, cacheEndpoint: redis.primaryEndpointAddress, cacheHost: redis.primaryEndpointAddress, cachePort: pulumi.output(_CONFIG.ports.redis), dbEndpoint: rds.endpoint, dbHost: rds.address, dbPort: rds.port, storageEndpoint: pulumi.output(''), storageRegion: aws.getRegionOutput().id };
        const promUrl = _Ops.k8sUrl(ns.metadata.name, 'prometheus', _CONFIG.ports.prometheus);
        const alloyCfg = new k8s.core.v1.ConfigMap('observe-alloy-cfg', { data: { 'config.alloy': _Ops.alloy(promUrl) }, metadata: _Ops.meta(ns.metadata.name, 'alloy') });
        const alloyPod = { containers: [{ args: ['run', '/etc/alloy/config.alloy'], image: _CONFIG.images.alloy, name: 'alloy', ports: [{ containerPort: _CONFIG.ports.alloyGrpc, name: 'grpc' }, { containerPort: _CONFIG.ports.alloyHttp, name: 'http' }, { containerPort: _CONFIG.ports.alloyMetrics, name: 'metrics' }], resources: { limits: { cpu: '200m', memory: '256Mi' }, requests: { cpu: '100m', memory: '128Mi' } }, volumeMounts: [{ mountPath: '/etc/alloy', name: 'cfg' }] }], volumes: [{ configMap: { name: alloyCfg.metadata.name }, name: 'cfg' }] };
        new k8s.apps.v1.DaemonSet('observe-alloy', { metadata: _Ops.meta(ns.metadata.name, 'alloy'), spec: { selector: { matchLabels: { app: 'alloy' } }, template: { metadata: { labels: { app: 'alloy', stack: _CONFIG.names.stack, tier: 'observe' } }, spec: alloyPod } } });
        new k8s.core.v1.Service('observe-alloy-svc', { metadata: _Ops.meta(ns.metadata.name, 'alloy', 'alloy'), spec: { ports: [{ name: 'grpc', port: _CONFIG.ports.alloyGrpc }, { name: 'http', port: _CONFIG.ports.alloyHttp }, { name: 'metrics', port: _CONFIG.ports.alloyMetrics }], selector: { app: 'alloy' } } });
        _k8sObserve(ns.metadata.name, [
            { cmd: ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--web.enable-remote-write-receiver', `--storage.tsdb.retention.time=${input.observe.retentionDays}d`], config: _Ops.prometheus('alloy'), configFile: 'prometheus.yml', configPath: '/etc/prometheus', dataPath: '/prometheus', image: _CONFIG.images.prometheus, name: 'prometheus', port: _CONFIG.ports.prometheus, storageGi: input.observe.prometheusStorageGi },
            { cmd: [], config: _Ops.grafana(promUrl), configFile: 'datasources.yaml', configPath: '/etc/grafana/provisioning/datasources', dataPath: '/var/lib/grafana', image: _CONFIG.images.grafana, name: 'grafana', port: _CONFIG.ports.grafana, storageGi: input.observe.grafanaStorageGi },
        ]);
        const observe = { collectorEndpoint: _Ops.k8sUrl(ns.metadata.name, 'alloy', _CONFIG.ports.alloyHttp), grafanaEndpoint: _Ops.k8sUrl(ns.metadata.name, 'grafana', _CONFIG.ports.grafana), prometheusEndpoint: _Ops.k8sUrl(ns.metadata.name, 'prometheus', _CONFIG.ports.prometheus) };
        const runtime = _Ops.runtime({ apiDomain: input.api.domain, data, env: args.env, mode: 'cloud', namespace: ns.metadata.name, observe });
        const computeMeta = { labels: _CONFIG.k8s.labels, namespace: ns.metadata.name };
        const configMap = new k8s.core.v1.ConfigMap('compute-config', { data: runtime.envVars, metadata: computeMeta });
        const secret = new k8s.core.v1.Secret('compute-secret', { metadata: computeMeta, stringData: runtime.secretVars });
        const apiContainer = {
            env: _Ops.k8sEnv,
            envFrom: [{ configMapRef: { name: configMap.metadata.name } }, { secretRef: { name: secret.metadata.name } }],
            image: input.api.image,
            livenessProbe: _CONFIG.k8s.probes.live,
            name: 'api',
            ports: [{ containerPort: _CONFIG.ports.api, name: 'http' }],
            readinessProbe: _CONFIG.k8s.probes.ready,
            resources: { limits: { cpu: input.api.cpu, memory: input.api.memory }, requests: { cpu: input.api.cpu, memory: input.api.memory } },
            startupProbe: _CONFIG.k8s.probes.startup,
        };
        const podSpec = { containers: [apiContainer], terminationGracePeriodSeconds: 30 };
        const deploy = new k8s.apps.v1.Deployment(_CONFIG.names.computeDeployment, { metadata: computeMeta, spec: { replicas: input.api.replicas, selector: { matchLabels: _CONFIG.k8s.labels }, template: { metadata: { labels: _CONFIG.k8s.labels }, spec: podSpec } } });
        const service = new k8s.core.v1.Service('compute-svc', { metadata: computeMeta, spec: { ports: [{ name: 'http', port: _CONFIG.ports.api, protocol: 'TCP', targetPort: _CONFIG.ports.api }], selector: _CONFIG.k8s.labels, type: 'ClusterIP' } });
        new k8s.autoscaling.v2.HorizontalPodAutoscaler('compute-hpa', { metadata: computeMeta, spec: { maxReplicas: input.api.maxReplicas, metrics: [{ resource: { name: 'cpu', target: { averageUtilization: input.hpa.cpuTarget, type: 'Utilization' } }, type: 'Resource' }, { resource: { name: 'memory', target: { averageUtilization: input.hpa.memoryTarget, type: 'Utilization' } }, type: 'Resource' }], minReplicas: input.api.minReplicas, scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deploy.metadata.name } } });
        new k8s.networking.v1.Ingress('compute-ingress', { metadata: { ...computeMeta, annotations: _CONFIG.k8s.ingress }, spec: { rules: [{ host: input.api.domain, http: { paths: [{ backend: { service: { name: service.metadata.name, port: { number: _CONFIG.ports.api } } }, path: '/', pathType: 'Prefix' }] } }], tls: [{ hosts: [input.api.domain], secretName: 'compute-tls' }] } });
        return { compute: { apiEndpoint: _Ops.k8sUrl(ns.metadata.name, service.metadata.name, _CONFIG.ports.api) }, data, network: { id: pulumi.output(''), privateSubnetIds: pulumi.output(vpc.privateSubnetIds), publicSubnetIds: pulumi.output(vpc.publicSubnetIds), vpcId: pulumi.output(vpc.vpcId) }, observe };
    },
    selfhosted: (args: { env: NodeJS.ProcessEnv; stack: string }) => {
        const input = _Ops.selfhosted(args.env);
        const network = new docker.Network('data-net', { name: _CONFIG.names.network });
        const nets = _Ops.dockerNets(network.id);
        const selfhostedPreloadLibraries = args.env['SELFHOSTED_POSTGRES_SHARED_PRELOAD_LIBRARIES'];
        const postgres = new docker.Container('data-pg', {
            command: ['postgres', '-c', 'max_replication_slots=10', '-c', 'wal_level=logical', ...(selfhostedPreloadLibraries ? ['-c', `shared_preload_libraries=${selfhostedPreloadLibraries}`] : [])],
            envs: [pulumi.interpolate`POSTGRES_PASSWORD=${_Ops.secret(args.env, 'POSTGRES_PASSWORD')}`, 'POSTGRES_DB=parametric', 'POSTGRES_USER=postgres'],
            healthcheck: _Ops.dockerHealth(['CMD-SHELL', 'pg_isready -U postgres']),
            image: _CONFIG.images.postgres,
            name: 'data-postgres',
            networksAdvanced: nets,
            ports: [_Ops.dockerPort(_CONFIG.ports.postgres)],
            restart: _CONFIG.docker.restart,
            volumes: _Ops.dockerVol('data-db-vol', 'data-db-data', '/var/lib/postgresql/data'),
        });
        const redis = new docker.Container('data-redis', { command: pulumi.output(_Ops.optionalSecret(args.env, 'REDIS_PASSWORD')).apply((password) => password ? ['redis-server', '--appendonly', 'yes', '--requirepass', password] : ['redis-server', '--appendonly', 'yes']), healthcheck: _Ops.dockerHealth(['CMD', 'redis-cli', 'ping']), image: _CONFIG.images.redis, name: 'data-redis', networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.redis)], restart: _CONFIG.docker.restart, volumes: _Ops.dockerVol('data-cache-vol', 'data-cache-data', '/data') });
        const minio = new docker.Container('data-minio', { command: ['server', '/data', '--console-address', `:${_CONFIG.ports.minioConsole}`], envs: [pulumi.interpolate`MINIO_ROOT_USER=${_Ops.secret(args.env, 'STORAGE_ACCESS_KEY_ID')}`, pulumi.interpolate`MINIO_ROOT_PASSWORD=${_Ops.secret(args.env, 'STORAGE_SECRET_ACCESS_KEY')}`], healthcheck: _Ops.dockerHealth(['CMD', 'mc', 'ready', 'local']), image: _CONFIG.images.minio, name: 'data-minio', networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.minioApi), _Ops.dockerPort(_CONFIG.ports.minioConsole)], restart: _CONFIG.docker.restart, volumes: _Ops.dockerVol('data-s3-vol', 'data-s3-data', '/data') });
        const data = { bucketName: pulumi.output(_CONFIG.names.bucket), cacheEndpoint: pulumi.interpolate`${redis.name}:${_CONFIG.ports.redis}`, cacheHost: redis.name, cachePort: pulumi.output(_CONFIG.ports.redis), dbEndpoint: pulumi.interpolate`${postgres.name}:${_CONFIG.ports.postgres}`, dbHost: postgres.name, dbPort: pulumi.output(_CONFIG.ports.postgres), storageEndpoint: pulumi.interpolate`http://${minio.name}:${_CONFIG.ports.minioApi}`, storageRegion: pulumi.output('us-east-1') };
        const observe = { collectorEndpoint: pulumi.interpolate`http://${_Ops.names.alloy}:${_CONFIG.ports.alloyHttp}`, grafanaEndpoint: pulumi.output(`http://localhost:${_CONFIG.ports.grafana}`), prometheusEndpoint: pulumi.output(`http://localhost:${_CONFIG.ports.prometheus}`) };
        new docker.Container('observe-alloy', { command: ['run', '/etc/alloy/config.alloy'], image: _CONFIG.images.alloy, name: _Ops.names.alloy, networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.alloyGrpc), _Ops.dockerPort(_CONFIG.ports.alloyHttp), _Ops.dockerPort(_CONFIG.ports.alloyMetrics)], uploads: [{ content: _Ops.alloy(pulumi.interpolate`http://${_Ops.names.prometheus}:${_CONFIG.ports.prometheus}`), file: '/etc/alloy/config.alloy' }] });
        new docker.Container('observe-prometheus', { command: ['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--web.enable-remote-write-receiver', `--storage.tsdb.retention.time=${input.observe.retentionDays}d`], image: _CONFIG.images.prometheus, name: _Ops.names.prometheus, networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.prometheus)], uploads: [{ content: _Ops.prometheus(_Ops.names.alloy), file: '/etc/prometheus/prometheus.yml' }], volumes: _Ops.dockerVol('observe-prom-vol', 'observe-prom-data', '/prometheus') });
        new docker.Container('observe-grafana', { envs: [pulumi.interpolate`GF_SECURITY_ADMIN_PASSWORD=${_Ops.secret(args.env, 'GRAFANA_ADMIN_PASSWORD')}`], image: _CONFIG.images.grafana, name: _Ops.names.grafana, networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.grafana)], uploads: [{ content: _Ops.grafana(pulumi.interpolate`http://${_Ops.names.prometheus}:${_CONFIG.ports.prometheus}`), file: '/etc/grafana/provisioning/datasources/datasources.yaml' }], volumes: _Ops.dockerVol('observe-grafana-vol', 'observe-grafana-data', '/var/lib/grafana') });
        const runtime = _Ops.runtime({ apiDomain: input.api.domain, data, env: args.env, mode: 'selfhosted', observe });
        const api = new docker.Container('compute-api', { envs: [..._Ops.dockerEnvs(runtime.envVars), ..._Ops.dockerEnvs(runtime.secretVars)], healthcheck: _Ops.httpHealth('/api/health/liveness', _CONFIG.ports.api), image: input.api.image, labels: _Ops.traefikLabels(input.api.domain, _CONFIG.ports.api), name: _Ops.names.api, networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.api)], restart: _CONFIG.docker.restart });
        new docker.Container('compute-traefik', { command: _Ops.traefikCmd(input.acmeEmail), image: _CONFIG.images.traefik, name: 'compute-traefik', networksAdvanced: nets, ports: [_Ops.dockerPort(_CONFIG.ports.traefikHttp), _Ops.dockerPort(_CONFIG.ports.traefikHttps)], restart: _CONFIG.docker.restart, volumes: [..._CONFIG.traefik.volumes] });
        return { compute: { apiEndpoint: api.ports.apply((ports) => `http://localhost:${ports?.[0]?.external ?? _CONFIG.ports.api}`) }, data, network: { id: pulumi.output(network.id), privateSubnetIds: pulumi.output([]), publicSubnetIds: pulumi.output([]), vpcId: pulumi.output('') }, observe };
    },
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const deploy = (args: { env: NodeJS.ProcessEnv; stack: string }) => {
    const mode = _Ops.mode(args.env);
    return { ..._DEPLOY[mode](args), mode, stack: args.stack };
};

// --- [EXPORT] ----------------------------------------------------------------

export { deploy };
