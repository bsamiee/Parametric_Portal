import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            declaration: false,
            entry: {
                // Root modules
                api: './src/api.ts',
                context: './src/context.ts',
                // Domain modules
                'domain/auth': './src/domain/auth.ts',
                'domain/features': './src/domain/features.ts',
                'domain/notifications': './src/domain/notifications.ts',
                'domain/storage': './src/domain/storage.ts',
                'domain/transfer': './src/domain/transfer.ts',
                env: './src/env.ts',
                errors: './src/errors.ts',
                'infra/cluster': './src/infra/cluster.ts',
                'infra/email': './src/infra/email.ts',
                'infra/events': './src/infra/events.ts',
                'infra/handlers/purge': './src/infra/handlers/purge.ts',
                'infra/handlers/tenant-lifecycle': './src/infra/handlers/tenant-lifecycle.ts',
                // Infrastructure modules
                'infra/jobs': './src/infra/jobs.ts',
                'infra/storage': './src/infra/storage.ts',
                'infra/webhooks': './src/infra/webhooks.ts',
                middleware: './src/middleware.ts',
                // Observability modules
                'observe/audit': './src/observe/audit.ts',
                'observe/metrics': './src/observe/metrics.ts',
                'observe/polling': './src/observe/polling.ts',
                'observe/telemetry': './src/observe/telemetry.ts',
                // Platform modules
                'platform/cache': './src/platform/cache.ts',
                'platform/doppler': './src/platform/doppler.ts',
                'platform/streaming': './src/platform/streaming.ts',
                'platform/websocket': './src/platform/websocket.ts',
                // Security modules
                'security/crypto': './src/security/crypto.ts',
                'security/policy': './src/security/policy.ts',
                'security/totp-replay': './src/security/totp-replay.ts',
                // Utility modules
                'utils/circuit': './src/utils/circuit.ts',
                'utils/diff': './src/utils/diff.ts',
                'utils/resilience': './src/utils/resilience.ts',
                'utils/transfer': './src/utils/transfer.ts',
            },
            external: [
                '@aws-sdk/client-s3',
                '@aws-sdk/client-sesv2',
                '@aws-sdk/s3-request-presigner',
                '@dopplerhq/node-sdk',
                '@effect-aws/client-s3',
                '@effect/cluster',
                '@effect/experimental',
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/platform-node',
                '@effect/platform-node-shared',
                '@effect/rpc',
                '@effect/sql',
                '@effect/sql-pg',
                '@effect/workflow',
                '@parametric-portal/database',
                '@parametric-portal/types',
                '@simplewebauthn/server',
                'arctic',
                'effect',
                'exceljs',
                'ioredis',
                'ipaddr.js',
                'jszip',
                'nanoid',
                'nodemailer',
                'otplib',
                'papaparse',
                'rfc6902',
                'sax',
                'yaml',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
