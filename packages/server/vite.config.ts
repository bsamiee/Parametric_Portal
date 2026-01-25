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
                'domain/audit': './src/domain/audit.ts',
                'domain/mfa': './src/domain/mfa.ts',
                'domain/oauth': './src/domain/oauth.ts',
                'domain/search': './src/domain/search.ts',
                'domain/session': './src/domain/session.ts',
                'domain/storage': './src/domain/storage.ts',
                errors: './src/errors.ts',
                // Infrastructure modules
                'infra/jobs': './src/infra/jobs.ts',
                'infra/metrics': './src/infra/metrics.ts',
                'infra/metrics-polling': './src/infra/metrics-polling.ts',
                'infra/rate-limit': './src/infra/rate-limit.ts',
                'infra/storage': './src/infra/storage.ts',
                'infra/telemetry': './src/infra/telemetry.ts',
                // Jobs
                'jobs/purge-assets': './src/jobs/purge-assets.ts',
                middleware: './src/middleware.ts',
                // Security modules
                'security/crypto': './src/security/crypto.ts',
                'security/totp-replay': './src/security/totp-replay.ts',
                // Utility modules
                'utils/circuit': './src/utils/circuit.ts',
                'utils/diff': './src/utils/diff.ts',
                'utils/transfer': './src/utils/transfer.ts',
            },
            external: [
                '@aws-sdk/client-s3',
                '@aws-sdk/s3-request-presigner',
                '@effect-aws/client-s3',
                '@effect/experimental',
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/sql',
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
                'sharp',
                'ts-essentials',
                'yaml',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
