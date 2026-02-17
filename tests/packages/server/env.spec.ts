/** Env tests: projection classification, parser validation, deploy modes, service layer. */
import { it } from '@effect/vitest';
import { Env } from '@parametric-portal/server/env';
import { ConfigProvider, Effect, FastCheck as fc, Layer, Redacted } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _mode =     fc.constantFrom('cloud' as const, 'selfhosted' as const);
const _provider = fc.constantFrom('resend' as const, 'postmark' as const, 'ses' as const, 'smtp' as const);
const _ALWAYS_SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'] as const;
const _RUNTIME_BASE = {
    ANTHROPIC_API_KEY:     'sk-ant-1',  DATABASE_URL:              'postgres://u:p@h:5432/db',
    DEPLOYMENT_MODE:       'cloud',     DOPPLER_CONFIG:            'dev',             DOPPLER_PROJECT: 'proj',
    DOPPLER_TOKEN:         'dp.st.xxx', GEMINI_API_KEY:            'AIza-1',
    OPENAI_API_KEY:        'sk-1',      RESEND_API_KEY:            're_1',
    STORAGE_ACCESS_KEY_ID: 'AK1',       STORAGE_SECRET_ACCESS_KEY: 'SK1',
} as const;
const _CLOUD_DEPLOY = {
    ACME_EMAIL:             'a@test.com',     API_CPU:               '1',             API_DOMAIN: 'api.test.com',
    API_IMAGE:              'img:1',          API_MAX_REPLICAS:      '3',             API_MEMORY: '512Mi',
    API_MIN_REPLICAS:       '1',              API_REPLICAS:          '2',             AZ_COUNT: '2',
    CACHE_NODE_TYPE:        'cache.t3.micro', DB_CLASS:              'db.t3.medium',
    DB_STORAGE_GB:          '20',             DEPLOYMENT_MODE:       'cloud',         GRAFANA_STORAGE_GB: '10',
    HPA_CPU_TARGET:         '70',             HPA_MEMORY_TARGET:     '80',
    OBSERVE_RETENTION_DAYS: '30',             PROMETHEUS_STORAGE_GB: '50',
} as const;
const _SELFHOSTED_DEPLOY = {
    ACME_EMAIL:      'admin@local.dev', API_IMAGE:              'img:1',
    DEPLOYMENT_MODE: 'selfhosted',      OBSERVE_RETENTION_DAYS: '14',
} as const;
const _PROVIDER_EXTRA = {
    postmark: { EMAIL_PROVIDER: 'postmark', POSTMARK_TOKEN: 'pm_1' },
    resend:   {},
    ses:      { EMAIL_PROVIDER: 'ses' },
    smtp:     { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'mail.test' },
} as const;

// --- [LAYER] -----------------------------------------------------------------

const _TestRuntimeLayer = Env.Service.Default.pipe(Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(_RUNTIME_BASE))))));

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: projection — mode partitions secrets and preserves config', { mode: _mode }, ({ mode }) =>
    Effect.sync(() => {
        const p = Env.runtimeProjection({
            env: { API_BASE_URL: 'https://api.test.com', APP_NAME: 'Portal',
                DEPLOYMENT_MODE: mode, ENCRYPTION_KEYS: 'k1,k2',
                GRAFANA_ADMIN_PASSWORD: 'secret', RESEND_API_KEY: 're_1' },
            mode,
        });
        _ALWAYS_SECRETS.forEach((k) => { expect(p.secretNames).toContain(k); });
        mode === 'selfhosted'
            ? expect(p.secretNames).toContain('GRAFANA_ADMIN_PASSWORD')
            : expect(p.secretNames).not.toContain('GRAFANA_ADMIN_PASSWORD');
        expect(p.configVars).toHaveProperty('API_BASE_URL', 'https://api.test.com');
        expect(p.configVars).toHaveProperty('APP_NAME', 'Portal');
        expect(p.configVars).not.toHaveProperty('RESEND_API_KEY');
        expect(p.configVars).not.toHaveProperty('ENCRYPTION_KEYS');
        expect(p.secretNames.length).toBe(new Set(p.secretNames).size);
    }));
it.effect.prop('P2: provider secret + encryption key classification', { provider: _provider }, ({ provider }) =>
    Effect.sync(() => {
        const expected = { postmark: 'POSTMARK_TOKEN', resend: 'RESEND_API_KEY', ses: undefined, smtp: undefined } as const;
        const secretKey = expected[provider];
        const p = Env.runtimeProjection({
            env: { EMAIL_PROVIDER: provider,
                ...(secretKey ? { [secretKey]: 'v' } : {}),
                ...(provider === 'smtp' ? { SMTP_PASS: 'pw' } : {}),
            },
            mode: 'cloud',
        });
        secretKey
            ? expect(p.secretNames).toContain(secretKey)
            : expect(p.secretNames).not.toContain('RESEND_API_KEY');
        provider === 'smtp'
            ? expect(p.secretNames).toContain('SMTP_PASS')
            : expect(p.secretNames).not.toContain('SMTP_PASS');
    }));
it.effect.prop('P3: runtime parser — provider branching yields correct shape', { provider: _provider }, ({ provider }) =>
    Effect.sync(() => {
        const parsed = Env.runtime({ ..._RUNTIME_BASE, ..._PROVIDER_EXTRA[provider] } as unknown as NodeJS.ProcessEnv);
        expect(parsed.email.provider).toBe(provider);
        expect(Redacted.value(parsed.security.anthropicApiKey)).toBe('sk-ant-1');
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: encryption precedence + empty filtering', () =>
    Effect.sync(() => {
        const both = Env.runtimeProjection({ env: { ENCRYPTION_KEY: 'k1', ENCRYPTION_KEYS: 'k1,k2' }, mode: 'cloud' });
        expect(both.secretNames).toContain('ENCRYPTION_KEYS');
        const keysOnly = Env.runtimeProjection({ env: { ENCRYPTION_KEYS: 'k1,k2' }, mode: 'cloud' });
        expect(keysOnly.secretNames).toContain('ENCRYPTION_KEYS');
        const fallback = Env.runtimeProjection({ env: { ENCRYPTION_KEY: 'k1' }, mode: 'cloud' });
        expect(fallback.secretNames).toContain('ENCRYPTION_KEY');
        const empty = Env.runtimeProjection({ env: { API_BASE_URL: '', APP_NAME: 'Test' }, mode: 'cloud' });
        expect(empty.configVars).not.toHaveProperty('API_BASE_URL');
        expect(empty.configVars).toHaveProperty('APP_NAME', 'Test');
    }));
it.effect('E2: runtime parser rejects invalid and missing input', () =>
    Effect.sync(() => {
        expect(() => Env.runtime({ DATABASE_URL: '' } as unknown as NodeJS.ProcessEnv)).toThrow();
        expect(() => Env.runtime({ ..._RUNTIME_BASE, EMAIL_PROVIDER: 'smtp' } as unknown as NodeJS.ProcessEnv)).toThrow();
        expect(() => Env.runtime({ ..._RUNTIME_BASE, DEPLOYMENT_MODE: 'x' } as unknown as NodeJS.ProcessEnv)).toThrow();
    }));
it.effect('E3: deploy parser — success and rejection per mode', () =>
    Effect.sync(() => {
        const cloud = Env.deploy(_CLOUD_DEPLOY as unknown as NodeJS.ProcessEnv);
        expect(cloud.mode).toBe('cloud');
        expect(cloud.api.cpu).toBe('1');
        expect(cloud.dbClass).toBe('db.t3.medium');
        const sh = Env.deploy(_SELFHOSTED_DEPLOY as unknown as NodeJS.ProcessEnv);
        expect(sh.mode).toBe('selfhosted');
        expect(sh.acmeEmail).toBe('admin@local.dev');
        expect(() => Env.deploy({ API_IMAGE: 'img:1', DEPLOYMENT_MODE: 'cloud' } as unknown as NodeJS.ProcessEnv)).toThrow();
        expect(() => Env.deploy({ API_IMAGE: 'img:1', DEPLOYMENT_MODE: 'selfhosted' } as unknown as NodeJS.ProcessEnv)).toThrow();
    }));
it.effect('E4: database parser + Env.Service layer', () =>
    Effect.gen(function* () {
        const parsed = Env.database({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', POSTGRES_OPTIONS: '{"max":5}' });
        expect(Redacted.value(parsed.connectionUrl)).toBe('postgres://u:p@localhost:5432/db');
        expect(parsed.options).toBe('{"max":5}');
        expect(() => Env.database({} as NodeJS.ProcessEnv)).toThrow();
        const svc = yield* Env.Service.pipe(Effect.provide(_TestRuntimeLayer));
        expect(svc.deployment.mode).toBe('cloud');
        expect(svc.email.provider).toBe('resend');
        expect(Redacted.value(svc.doppler.token)).toBe('dp.st.xxx');
    }));
it.effect('E5: Service layer wraps config errors as EnvInputError', () =>
    Env.Service.pipe(
        Effect.provide(Env.Service.Default.pipe(Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))))),
        Effect.flip,
        Effect.tap((e) => { expect(e._tag).toBe('EnvInputError'); }),
    ));
