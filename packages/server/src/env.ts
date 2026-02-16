/**
 * Canonical environment contract for runtime and deployment.
 * Single source of env defaults, validation, and projection lists.
 */
import { Config, ConfigProvider, Data, Effect, Match, Option } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class EnvInputError extends Data.TaggedError('EnvInputError')<{ readonly cause: unknown; readonly key?: string; readonly target: 'database' | 'deploy' | 'runtime' }> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _resolve = <A, E>(config: Effect.Effect<A, E, never>, env: NodeJS.ProcessEnv, target: 'database' | 'deploy' | 'runtime') =>
    Effect.runSync(config.pipe(
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map(
            Object.entries(env).flatMap(([key, value]) => typeof value === 'string' && value !== '' ? ([[key, value]] as const) : []),
        ))),
        Effect.mapError((cause) => cause instanceof EnvInputError ? cause : new EnvInputError({ cause, target })),
    ));
const _require = <A>(key: string, value: Option.Option<A>): Effect.Effect<A, EnvInputError> =>
    Option.match(value, {
        onNone: () => Effect.fail(new EnvInputError({ cause: `missing:${key}`, key, target: 'deploy' })),
        onSome: Effect.succeed,
    });

// --- [CONFIG] ----------------------------------------------------------------

const _AppConfig = Config.all({
    apiBaseUrl: Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000')),
    appName: Config.string('APP_NAME').pipe(Config.withDefault('Parametric Portal')),
    corsOrigins: Config.string('CORS_ORIGINS').pipe(Config.withDefault('*')),
    hostname: Config.string('HOSTNAME').pipe(Config.option),
    logLevel: Config.logLevel('LOG_LEVEL').pipe(Config.option),
    nodeEnv: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
    port: Config.integer('PORT').pipe(Config.withDefault(4000)),
});
const _AuthConfig = Config.all({
    maxSessionsPerUser: Config.integer('MAX_SESSIONS_PER_USER').pipe(Config.withDefault(5)),
    sessionCacheCapacity: Config.integer('SESSION_CACHE_CAPACITY').pipe(Config.withDefault(5000)),
    sessionCacheTtlSeconds: Config.integer('SESSION_CACHE_TTL_SECONDS').pipe(Config.withDefault(300)),
    webauthnOrigin: Config.string('WEBAUTHN_ORIGIN').pipe(Config.withDefault('http://localhost:3000')),
    webauthnRpId: Config.string('WEBAUTHN_RP_ID').pipe(Config.withDefault('localhost')),
    webauthnRpName: Config.string('WEBAUTHN_RP_NAME').pipe(Config.withDefault('Parametric Portal')),
});
const _CacheConfig = Config.all({
    prefix: Config.string('CACHE_PREFIX').pipe(Config.withDefault('persist:')),
    rateLimitPrefix: Config.string('RATE_LIMIT_PREFIX').pipe(Config.withDefault('rl:')),
    rateLimitStore: Config.literal('redis', 'memory')('RATE_LIMIT_STORE').pipe(Config.withDefault('redis' as const)),
    redis: Config.all({
        autoPipeline: Config.boolean('REDIS_AUTO_PIPELINE').pipe(Config.withDefault(false)),
        autoResendUnfulfilledCommands: Config.boolean('REDIS_AUTO_RESEND_UNFULFILLED').pipe(Config.withDefault(true)),
        autoResubscribe: Config.boolean('REDIS_AUTO_RESUBSCRIBE').pipe(Config.withDefault(true)),
        blockingTimeout: Config.integer('REDIS_BLOCKING_TIMEOUT').pipe(Config.option),
        commandTimeout: Config.integer('REDIS_COMMAND_TIMEOUT').pipe(Config.option),
        connectionName: Config.string('REDIS_CONNECTION_NAME').pipe(Config.withDefault('parametric-portal')),
        connectTimeout: Config.integer('REDIS_CONNECT_TIMEOUT').pipe(Config.withDefault(5000)),
        db: Config.integer('REDIS_DB').pipe(Config.option),
        disableClientInfo: Config.boolean('REDIS_DISABLE_CLIENT_INFO').pipe(Config.withDefault(false)),
        enableOfflineQueue: Config.boolean('REDIS_ENABLE_OFFLINE_QUEUE').pipe(Config.withDefault(true)),
        enableReadyCheck: Config.boolean('REDIS_READY_CHECK').pipe(Config.withDefault(true)),
        host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
        keepAlive: Config.integer('REDIS_KEEP_ALIVE').pipe(Config.withDefault(0)),
        lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
        maxLoadingRetryTime: Config.integer('REDIS_MAX_LOADING_RETRY_TIME').pipe(Config.withDefault(10000)),
        maxRetriesPerRequest: Config.integer('REDIS_MAX_RETRIES_PER_REQUEST').pipe(Config.withDefault(20)),
        mode: Config.literal('standalone', 'sentinel')('REDIS_MODE').pipe(Config.withDefault('standalone' as const)),
        noDelay: Config.boolean('REDIS_NO_DELAY').pipe(Config.withDefault(true)),
        password: Config.redacted('REDIS_PASSWORD').pipe(Config.option),
        port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
        retryBaseMs: Config.integer('REDIS_RETRY_BASE_MS').pipe(Config.withDefault(50)),
        retryCapMs: Config.integer('REDIS_RETRY_CAP_MS').pipe(Config.withDefault(2000)),
        retryMaxAttempts: Config.integer('REDIS_MAX_RETRIES').pipe(Config.withDefault(3)),
        sentinelCommandTimeout: Config.integer('REDIS_SENTINEL_COMMAND_TIMEOUT').pipe(Config.option),
        sentinelFailoverDetector: Config.boolean('REDIS_SENTINEL_FAILOVER_DETECTOR').pipe(Config.withDefault(false)),
        sentinelName: Config.string('REDIS_SENTINEL_NAME').pipe(Config.withDefault('mymaster')),
        sentinelNodes: Config.string('REDIS_SENTINEL_NODES').pipe(Config.withDefault('')),
        sentinelPassword: Config.redacted('REDIS_SENTINEL_PASSWORD').pipe(Config.option),
        sentinelRole: Config.literal('master', 'slave')('REDIS_SENTINEL_ROLE').pipe(Config.withDefault('master' as const)),
        sentinelTls: Config.boolean('REDIS_SENTINEL_TLS').pipe(Config.withDefault(false)),
        sentinelUsername: Config.redacted('REDIS_SENTINEL_USERNAME').pipe(Config.option),
        socketTimeout: Config.integer('REDIS_SOCKET_TIMEOUT').pipe(Config.withDefault(15000)),
        tlsCa: Config.redacted('REDIS_TLS_CA').pipe(Config.option),
        tlsCert: Config.redacted('REDIS_TLS_CERT').pipe(Config.option),
        tlsEnabled: Config.boolean('REDIS_TLS').pipe(Config.withDefault(false)),
        tlsKey: Config.redacted('REDIS_TLS_KEY').pipe(Config.option),
        tlsRejectUnauthorized: Config.boolean('REDIS_TLS_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
        tlsServername: Config.string('REDIS_TLS_SERVERNAME').pipe(Config.option),
        username: Config.string('REDIS_USERNAME').pipe(Config.option),
    }),
});
const _ClusterConfig = Config.all({
    healthMode: Config.literal('auto', 'k8s', 'ping')('CLUSTER_HEALTH_MODE').pipe(Config.withDefault('auto' as const)),
    k8sLabelSelector: Config.string('K8S_LABEL_SELECTOR').pipe(Config.withDefault('app=parametric-portal')),
    k8sNamespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('default')),
});
const _DatabaseConfig = Config.all({
    appName: Config.string('POSTGRES_APP_NAME').pipe(Config.withDefault('parametric-portal')),
    connectionTtlMs: Config.integer('POSTGRES_CONNECTION_TTL_MS').pipe(Config.withDefault(900_000)),
    connectionUrl: Config.redacted('DATABASE_URL'),
    connectTimeoutMs: Config.integer('POSTGRES_CONNECT_TIMEOUT_MS').pipe(Config.withDefault(5_000)),
    idleTimeoutMs: Config.integer('POSTGRES_IDLE_TIMEOUT_MS').pipe(Config.withDefault(30_000)),
    options: Config.string('POSTGRES_OPTIONS').pipe(Config.withDefault('')),
    poolMax: Config.integer('POSTGRES_POOL_MAX').pipe(Config.withDefault(10)),
    poolMin: Config.integer('POSTGRES_POOL_MIN').pipe(Config.withDefault(2)),
    ssl: Config.all({
        caPath: Config.string('POSTGRES_SSL_CA').pipe(Config.option),
        certPath: Config.string('POSTGRES_SSL_CERT').pipe(Config.option),
        enabled: Config.boolean('POSTGRES_SSL').pipe(Config.withDefault(false)),
        keyPath: Config.string('POSTGRES_SSL_KEY').pipe(Config.option),
        minVersion: Config.string('POSTGRES_SSL_MIN_VERSION').pipe(Config.withDefault('TLSv1.2')),
        rejectUnauthorized: Config.boolean('POSTGRES_SSL_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
        servername: Config.string('POSTGRES_SSL_SERVERNAME').pipe(Config.option),
    }),
    timeouts: Config.all({
        idleInTransactionMs: Config.integer('POSTGRES_IDLE_IN_TXN_TIMEOUT_MS').pipe(Config.withDefault(60_000)),
        lockMs: Config.integer('POSTGRES_LOCK_TIMEOUT_MS').pipe(Config.withDefault(10_000)),
        statementMs: Config.integer('POSTGRES_STATEMENT_TIMEOUT_MS').pipe(Config.withDefault(30_000)),
        transactionMs: Config.integer('POSTGRES_TRANSACTION_TIMEOUT_MS').pipe(Config.withDefault(120_000)),
    }),
    trigramThresholds: Config.all({
        similarity: Config.number('POSTGRES_TRGM_SIMILARITY_THRESHOLD').pipe(Config.withDefault(0.3)),
        strictWordSimilarity: Config.number('POSTGRES_TRGM_STRICT_WORD_SIMILARITY_THRESHOLD').pipe(Config.withDefault(0.5)),
        wordSimilarity: Config.number('POSTGRES_TRGM_WORD_SIMILARITY_THRESHOLD').pipe(Config.withDefault(0.6)),
    }),
});
const _DeploymentConfig = Config.all({
    mode: Config.literal('cloud', 'selfhosted')('DEPLOYMENT_MODE'),
    proxyHops: Config.integer('PROXY_HOPS').pipe(Config.withDefault(0)),
    trustProxy: Config.boolean('TRUST_PROXY').pipe(Config.withDefault(false)),
});
const _DopplerConfig = Config.all({
    config: Config.string('DOPPLER_CONFIG'),
    project: Config.string('DOPPLER_PROJECT'),
    refreshMs: Config.integer('DOPPLER_REFRESH_MS').pipe(Config.withDefault(300_000)),
    token: Config.redacted('DOPPLER_TOKEN'),
});
const _JobsConfig = Config.all({
    dlqCheckIntervalMs: Config.integer('JOB_DLQ_CHECK_INTERVAL_MS').pipe(Config.withDefault(300_000)),
    dlqMaxRetries: Config.integer('JOB_DLQ_MAX_RETRIES').pipe(Config.withDefault(3)),
});
const _purgeJob = (cronKey: string, cron: string, daysKey: string, days: number) => Config.all({
    cron: Config.string(cronKey).pipe(Config.withDefault(cron)),
    days: Config.integer(daysKey).pipe(Config.withDefault(days)),
});
const _PurgeConfig = Config.all({
    jobs: Config.all({
        purgeApiKeys: _purgeJob('PURGE_API_KEYS_CRON', '0 3 * * 0', 'PURGE_API_KEYS_DAYS', 365),
        purgeAssets: _purgeJob('PURGE_ASSETS_CRON', '0 */6 * * *', 'PURGE_ASSETS_DAYS', 30),
        purgeEventJournal: _purgeJob('PURGE_EVENT_JOURNAL_CRON', '0 2 * * *', 'PURGE_EVENT_JOURNAL_DAYS', 30),
        purgeJobDlq: _purgeJob('PURGE_JOB_DLQ_CRON', '0 2 * * *', 'PURGE_JOB_DLQ_DAYS', 30),
        purgeKvStore: _purgeJob('PURGE_KV_STORE_CRON', '0 0 * * 0', 'PURGE_KV_STORE_DAYS', 90),
        purgeMfaSecrets: _purgeJob('PURGE_MFA_SECRETS_CRON', '0 4 * * 0', 'PURGE_MFA_SECRETS_DAYS', 90),
        purgeOauthAccounts: _purgeJob('PURGE_OAUTH_ACCOUNTS_CRON', '0 5 * * 0', 'PURGE_OAUTH_ACCOUNTS_DAYS', 90),
        purgeSessions: _purgeJob('PURGE_SESSIONS_CRON', '0 1 * * *', 'PURGE_SESSIONS_DAYS', 30),
    }),
    s3BatchSize: Config.integer('PURGE_S3_BATCH_SIZE').pipe(Config.withDefault(100)),
    s3Concurrency: Config.integer('PURGE_S3_CONCURRENCY').pipe(Config.withDefault(2)),
});
const _SecurityConfig = Config.all({
    anthropicApiKey: Config.redacted('ANTHROPIC_API_KEY'),
    encryptionKey: Config.redacted('ENCRYPTION_KEY').pipe(Config.option),
    encryptionKeys: Config.redacted('ENCRYPTION_KEYS').pipe(Config.option),
    encryptionKeyVersion: Config.integer('ENCRYPTION_KEY_VERSION').pipe(Config.option),
    geminiApiKey: Config.redacted('GEMINI_API_KEY'),
    oauthApplePrivateKey: Config.redacted('OAUTH_APPLE_PRIVATE_KEY').pipe(Config.option),
    oauthGithubClientSecret: Config.redacted('OAUTH_GITHUB_CLIENT_SECRET').pipe(Config.option),
    oauthGoogleClientSecret: Config.redacted('OAUTH_GOOGLE_CLIENT_SECRET').pipe(Config.option),
    oauthMicrosoftClientSecret: Config.redacted('OAUTH_MICROSOFT_CLIENT_SECRET').pipe(Config.option),
    openAiApiKey: Config.redacted('OPENAI_API_KEY'),
});
const _StorageConfig = Config.all({
    accessKeyId: Config.redacted('STORAGE_ACCESS_KEY_ID'),
    bucket: Config.string('STORAGE_BUCKET').pipe(Config.withDefault('parametric')),
    endpoint: Config.string('STORAGE_ENDPOINT').pipe(Config.option),
    forcePathStyle: Config.boolean('STORAGE_FORCE_PATH_STYLE').pipe(Config.withDefault(false)),
    maxAttempts: Config.integer('STORAGE_MAX_ATTEMPTS').pipe(Config.withDefault(3)),
    region: Config.string('STORAGE_REGION').pipe(Config.withDefault('us-east-1')),
    retryMode: Config.literal('adaptive', 'legacy', 'standard')('STORAGE_RETRY_MODE').pipe(Config.withDefault('standard' as const)),
    secretAccessKey: Config.redacted('STORAGE_SECRET_ACCESS_KEY'),
    sessionToken: Config.redacted('STORAGE_SESSION_TOKEN').pipe(Config.option),
});
const _TelemetryConfig = Config.all({
    baseEndpoint: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.option),
    headers: Config.string('OTEL_EXPORTER_OTLP_HEADERS').pipe(Config.withDefault('')),
    k8sContainerName: Config.string('K8S_CONTAINER_NAME').pipe(Config.withDefault('')),
    k8sDeploymentName: Config.string('K8S_DEPLOYMENT_NAME').pipe(Config.withDefault('')),
    k8sNamespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('parametric')),
    k8sNodeName: Config.string('K8S_NODE_NAME').pipe(Config.withDefault('')),
    k8sPodName: Config.string('K8S_POD_NAME').pipe(Config.withDefault('')),
    logsEndpoint: Config.string('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT').pipe(Config.option),
    logsExporter: Config.string('OTEL_LOGS_EXPORTER').pipe(Config.withDefault('otlp')),
    metricsEndpoint: Config.string('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT').pipe(Config.option),
    metricsExporter: Config.literal('none', 'otlp')('OTEL_METRICS_EXPORTER').pipe(Config.withDefault('otlp' as const)),
    protocol: Config.literal('http/protobuf', 'http/json')('OTEL_EXPORTER_OTLP_PROTOCOL').pipe(Config.withDefault('http/protobuf' as const)),
    serviceName: Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault('api')),
    serviceVersion: Config.string('OTEL_SERVICE_VERSION').pipe(Config.withDefault('0.0.0')),
    tracesEndpoint: Config.string('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT').pipe(Config.option),
    tracesExporter: Config.literal('none', 'otlp')('OTEL_TRACES_EXPORTER').pipe(Config.withDefault('otlp' as const)),
});
const _WebhookConfig = Config.all({
    verifyMaxRetries: Config.integer('WEBHOOK_VERIFY_MAX_RETRIES').pipe(Config.withDefault(3)),
    verifyTimeoutMs: Config.integer('WEBHOOK_VERIFY_TIMEOUT_MS').pipe(Config.withDefault(10_000)),
});
const _WebsocketConfig = Config.all({
    broadcastChannel: Config.string('WS_BROADCAST_CHANNEL').pipe(Config.withDefault('ws:broadcast')),
    maxRoomsPerSocket: Config.integer('WS_MAX_ROOMS_PER_SOCKET').pipe(Config.withDefault(10)),
    pingIntervalMs: Config.integer('WS_PING_INTERVAL_MS').pipe(Config.withDefault(30_000)),
    pongTimeoutMs: Config.integer('WS_PONG_TIMEOUT_MS').pipe(Config.withDefault(90_000)),
    reaperIntervalMs: Config.integer('WS_REAPER_INTERVAL_MS').pipe(Config.withDefault(15_000)),
});
const _EmailConfig = Effect.gen(function* () {
    const provider = yield* Config.literal('resend', 'postmark', 'ses', 'smtp')('EMAIL_PROVIDER').pipe(Config.withDefault('resend' as const));
    const from = yield* Config.string('EMAIL_FROM').pipe(Config.withDefault('noreply@parametric.dev'));
    const timeoutMs = yield* Config.integer('EMAIL_TIMEOUT_MS').pipe(Config.withDefault(15_000));
    return yield* Match.value(provider).pipe(
        Match.when('resend', () => Config.all({
            from: Config.succeed(from),
            provider: Config.succeed('resend' as const),
            resend: Config.all({
                apiKey: Config.redacted('RESEND_API_KEY'),
                endpoint: Config.string('RESEND_ENDPOINT').pipe(Config.withDefault('https://api.resend.com/emails')),
            }),
            timeoutMs: Config.succeed(timeoutMs),
        })),
        Match.when('postmark', () => Config.all({
            from: Config.succeed(from),
            postmark: Config.all({
                endpoint: Config.string('POSTMARK_ENDPOINT').pipe(Config.withDefault('https://api.postmarkapp.com/email/withTemplate')),
                token: Config.redacted('POSTMARK_TOKEN'),
            }),
            provider: Config.succeed('postmark' as const),
            timeoutMs: Config.succeed(timeoutMs),
        })),
        Match.when('ses', () => Config.all({
            from: Config.succeed(from),
            provider: Config.succeed('ses' as const),
            ses: Config.all({
                endpoint: Config.string('SES_ENDPOINT').pipe(Config.option),
                region: Config.string('SES_REGION').pipe(Config.withDefault('us-east-1')),
            }),
            timeoutMs: Config.succeed(timeoutMs),
        })),
        Match.when('smtp', () => Config.all({
            from: Config.succeed(from),
            provider: Config.succeed('smtp' as const),
            smtp: Config.all({
                host: Config.string('SMTP_HOST'),
                pass: Config.redacted('SMTP_PASS').pipe(Config.option),
                port: Config.integer('SMTP_PORT').pipe(Config.withDefault(587)),
                requireTls: Config.boolean('SMTP_REQUIRE_TLS').pipe(Config.withDefault(false)),
                secure: Config.boolean('SMTP_SECURE').pipe(Config.withDefault(false)),
                user: Config.string('SMTP_USER').pipe(Config.option),
            }),
            timeoutMs: Config.succeed(timeoutMs),
        })),
        Match.exhaustive,
    );
});
const _RuntimeConfig = Effect.all({
    app: _AppConfig,
    auth: _AuthConfig,
    cache: _CacheConfig,
    cluster: _ClusterConfig,
    database: _DatabaseConfig,
    deployment: _DeploymentConfig,
    doppler: _DopplerConfig,
    email: _EmailConfig,
    jobs: _JobsConfig,
    purge: _PurgeConfig,
    security: _SecurityConfig,
    storage: _StorageConfig,
    telemetry: _TelemetryConfig,
    webhook: _WebhookConfig,
    websocket: _WebsocketConfig,
});
const _DeployRawConfig = Config.all({
    acmeEmail: Config.string('ACME_EMAIL').pipe(Config.option),
    api: Config.all({
        cpu: Config.string('API_CPU').pipe(Config.option),
        domain: Config.string('API_DOMAIN').pipe(Config.option),
        image: Config.string('API_IMAGE'),
        maxReplicas: Config.integer('API_MAX_REPLICAS').pipe(Config.option),
        memory: Config.string('API_MEMORY').pipe(Config.option),
        minReplicas: Config.integer('API_MIN_REPLICAS').pipe(Config.option),
        replicas: Config.integer('API_REPLICAS').pipe(Config.option),
    }),
    azCount: Config.integer('AZ_COUNT').pipe(Config.option),
    cacheNodeType: Config.string('CACHE_NODE_TYPE').pipe(Config.option),
    dbClass: Config.string('DB_CLASS').pipe(Config.option),
    dbStorageGb: Config.integer('DB_STORAGE_GB').pipe(Config.option),
    grafanaStorageGb: Config.integer('GRAFANA_STORAGE_GB').pipe(Config.option),
    hpaCpuTarget: Config.integer('HPA_CPU_TARGET').pipe(Config.option),
    hpaMemoryTarget: Config.integer('HPA_MEMORY_TARGET').pipe(Config.option),
    mode: Config.literal('cloud', 'selfhosted')('DEPLOYMENT_MODE'),
    observeRetentionDays: Config.integer('OBSERVE_RETENTION_DAYS').pipe(Config.option),
    postgresSharedPreloadLibraries: Config.string('POSTGRES_SHARED_PRELOAD_LIBRARIES').pipe(Config.option),
    prometheusStorageGb: Config.integer('PROMETHEUS_STORAGE_GB').pipe(Config.option),
});
const _DeployConfig = _DeployRawConfig.pipe(
    Effect.flatMap((raw) => Match.value(raw.mode).pipe(
        Match.when('cloud', () => Effect.all({
            api: Effect.all({
                cpu: _require('API_CPU', raw.api.cpu),
                domain: _require('API_DOMAIN', raw.api.domain),
                maxReplicas: _require('API_MAX_REPLICAS', raw.api.maxReplicas),
                memory: _require('API_MEMORY', raw.api.memory),
                minReplicas: _require('API_MIN_REPLICAS', raw.api.minReplicas),
                replicas: _require('API_REPLICAS', raw.api.replicas),
            }),
            azCount: _require('AZ_COUNT', raw.azCount),
            cacheNodeType: _require('CACHE_NODE_TYPE', raw.cacheNodeType),
            dbClass: _require('DB_CLASS', raw.dbClass),
            dbStorageGb: _require('DB_STORAGE_GB', raw.dbStorageGb),
            grafanaStorageGb: _require('GRAFANA_STORAGE_GB', raw.grafanaStorageGb),
            hpaCpuTarget: _require('HPA_CPU_TARGET', raw.hpaCpuTarget),
            hpaMemoryTarget: _require('HPA_MEMORY_TARGET', raw.hpaMemoryTarget),
            observeRetentionDays: _require('OBSERVE_RETENTION_DAYS', raw.observeRetentionDays),
            prometheusStorageGb: _require('PROMETHEUS_STORAGE_GB', raw.prometheusStorageGb),
        }).pipe(Effect.map((required) => ({ ...raw, ...required, api: { ...raw.api, ...required.api }, mode: 'cloud' as const })))),
        Match.when('selfhosted', () => Effect.all({
            acmeEmail: _require('ACME_EMAIL', raw.acmeEmail),
            observeRetentionDays: _require('OBSERVE_RETENTION_DAYS', raw.observeRetentionDays),
        }).pipe(Effect.map((required) => ({ ...raw, ...required, mode: 'selfhosted' as const })))),
        Match.exhaustive,
    )),
);
const _Projection = {
    requiredSecrets: {
        cloud: [] as const,
        common: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'RESEND_API_KEY', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'] as const,
        selfhosted: ['GRAFANA_ADMIN_PASSWORD'] as const,
    },
    runtimeConfigKeys: ['API_BASE_URL', 'APP_NAME', 'CORS_ORIGINS', 'DEPLOYMENT_MODE', 'DOPPLER_CONFIG', 'DOPPLER_PROJECT', 'HOSTNAME', 'LOG_LEVEL', 'MAX_SESSIONS_PER_USER', 'NODE_ENV', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_LOGS_EXPORTER', 'OTEL_METRICS_EXPORTER', 'OTEL_TRACES_EXPORTER', 'PORT', 'POSTMARK_ENDPOINT', 'PROXY_HOPS', 'RATE_LIMIT_PREFIX', 'RATE_LIMIT_STORE', 'RESEND_ENDPOINT', 'TRUST_PROXY', 'POSTGRES_OPTIONS'] as const,
    runtimeSecretKeys: ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'ENCRYPTION_KEY', 'ENCRYPTION_KEYS', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OAUTH_APPLE_PRIVATE_KEY', 'OAUTH_GITHUB_CLIENT_SECRET', 'OAUTH_GOOGLE_CLIENT_SECRET', 'OAUTH_MICROSOFT_CLIENT_SECRET', 'POSTGRES_PASSWORD', 'POSTMARK_TOKEN', 'REDIS_PASSWORD', 'REDIS_TLS_CA', 'RESEND_API_KEY', 'SMTP_PASS', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'STORAGE_SESSION_TOKEN', 'DOPPLER_TOKEN'] as const,
} as const;

// --- [SERVICES] --------------------------------------------------------------

class Service extends Effect.Service<Service>()('server/Env', {
    effect: _RuntimeConfig.pipe(Effect.mapError((cause) => new EnvInputError({ cause, target: 'runtime' }))),
}) {}

// --- [OBJECT] ----------------------------------------------------------------

const Env = {
    database: (env: NodeJS.ProcessEnv) => _resolve(_DatabaseConfig, env, 'database'),
    deploy: (env: NodeJS.ProcessEnv) => _resolve(_DeployConfig, env, 'deploy'),
    runtime: (env: NodeJS.ProcessEnv) => _resolve(_RuntimeConfig, env, 'runtime'),
    runtimeProjection: ({ env, mode }: { readonly env: NodeJS.ProcessEnv; readonly mode: 'cloud' | 'selfhosted' }) => {
        const entryMap = new Map(
            Object.entries(env).flatMap(([key, value]) =>
                typeof value === 'string' && value !== '' ? ([[key, value]] as const) : []),
        );
        const secretNames = Array.from(new Set([
            ..._Projection.requiredSecrets.common,
            ..._Projection.requiredSecrets[mode],
            ..._Projection.runtimeSecretKeys.filter((name) => entryMap.has(name)),
        ]));
        const secretNameSet = new Set<string>(secretNames);
        const configVars = Object.fromEntries(_Projection.runtimeConfigKeys.flatMap((name) => {
            const value = entryMap.get(name);
            return typeof value === 'string' && value !== '' && !secretNameSet.has(name) ? ([[name, value]] as const) : [];
        }));
        return { configVars, secretNames } as const;
    },
    Service,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Env };
