import * as pulumi from '@pulumi/pulumi';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    config: {
        allow: ['API_BASE_URL','APP_NAME','CORS_ORIGINS','HOSTNAME','LOG_LEVEL','MAX_SESSIONS_PER_USER','PORT','PROXY_HOPS','RATE_LIMIT_PREFIX','RATE_LIMIT_STORE','TRUST_PROXY',],
        prefixes: ['CACHE_','CLUSTER_','ENCRYPTION_','JOB_','K8S_','OTEL_','POSTGRES_','PURGE_','REDIS_','SESSION_CACHE_','STORAGE_','WEBAUTHN_','WEBHOOK_','WS_',],
    },
    secrets: {
        allow: ['DATABASE_URL', 'ENCRYPTION_KEY', 'ENCRYPTION_KEYS', 'STORAGE_SESSION_TOKEN'],
        prefixes: ['OAUTH_'],
        required: {
            cloud: [],
            common: [
                'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OAUTH_APPLE_PRIVATE_KEY', 'OAUTH_GITHUB_CLIENT_SECRET', 'OAUTH_GOOGLE_CLIENT_SECRET',
                'OAUTH_MICROSOFT_CLIENT_SECRET', 'OPENAI_API_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY',
            ],
            selfhosted: ['GRAFANA_ADMIN_PASSWORD'],
        },
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _Ops = {
    entries: (env: NodeJS.ProcessEnv) =>
        Object.entries(env)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
    fail: (message: string): never => {
        console.error(message);
        return process.exit(1);
    },
    isAllowed: (name: string, allow: readonly string[], prefixes: readonly string[]) => allow.includes(name) || prefixes.some((prefix) => name.startsWith(prefix)),
    secret: (env: NodeJS.ProcessEnv, name: string) => pulumi.secret(env[name] && env[name] !== '' ? env[name] : _Ops.fail(`[MISSING_ENV] ${name} is required`)),
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const RuntimeEnv = {
    collect: ({ derived, env, mode }: {
        derived: Record<string, pulumi.Input<string>>;
        env: NodeJS.ProcessEnv;
        mode: 'cloud' | 'selfhosted';
    }) => {
        const entries = _Ops.entries(env);
        const names = entries.map(([name]) => name);
        const required = [
            ..._CONFIG.secrets.required.common,
            ..._CONFIG.secrets.required[mode],
            ...(env['ENCRYPTION_KEYS'] && env['ENCRYPTION_KEYS'] !== '' ? ['ENCRYPTION_KEYS'] : ['ENCRYPTION_KEY']),
        ];
        const matchedSecrets = names.filter((name) => _Ops.isAllowed(name, _CONFIG.secrets.allow, _CONFIG.secrets.prefixes));
        const secretNames = Array.from(new Set([...required, ...matchedSecrets]));
        const secretNameSet = new Set(secretNames);
        const secretVars = Object.fromEntries(secretNames.map((name) => [name, _Ops.secret(env, name)]));
        const configVars = Object.fromEntries(entries.filter(([name]) => _Ops.isAllowed(name, _CONFIG.config.allow, _CONFIG.config.prefixes) && !secretNameSet.has(name)));
        return { envVars: { ...configVars, ...derived }, secretVars };
    },
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { RuntimeEnv };
