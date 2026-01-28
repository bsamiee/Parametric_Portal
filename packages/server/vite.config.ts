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
                'domain/mfa': './src/domain/mfa.ts',
                'domain/oauth': './src/domain/oauth.ts',
                'domain/search': './src/domain/search.ts',
                'domain/session': './src/domain/session.ts',
                'domain/storage': './src/domain/storage.ts',
                errors: './src/errors.ts',
                'infra/handlers/purge-assets': './src/infra/handlers/purge-assets.ts',
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
                'platform/streaming': './src/platform/streaming.ts',
                'platform/websocket': './src/platform/websocket.ts',
                // Security modules
                'security/crypto': './src/security/crypto.ts',
                'security/totp-replay': './src/security/totp-replay.ts',
                // Utility modules
                'utils/circuit': './src/utils/circuit.ts',
                'utils/diff': './src/utils/diff.ts',
                'utils/resilience': './src/utils/resilience.ts',
                'utils/transfer': './src/utils/transfer.ts',
            },
            external: [
                '@aws-sdk/client-s3',
                '@aws-sdk/s3-request-presigner',
                '@effect-aws/client-s3',
                '@effect/cli',
                '@effect/cluster',
                '@effect/experimental',
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/platform-node',
                '@effect/platform-node-shared',
                '@effect/printer',
                '@effect/printer-ansi',
                '@effect/rpc',
                '@effect/sql',
                '@effect/sql-pg',
                '@effect/workflow',
                '@parametric-portal/database',
                '@parametric-portal/types',
                'arctic',
                'cockatiel',
                'effect',
                'exceljs',
                'ioredis',
                'ipaddr.js',
                'jszip',
                'nanoid',
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
