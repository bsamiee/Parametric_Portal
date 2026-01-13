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
                api: './src/api.ts',
                audit: './src/audit.ts',
                auth: './src/auth.ts',
                context: './src/context.ts',
                crypto: './src/crypto.ts',
                'http-errors': './src/http-errors.ts',
                metrics: './src/metrics.ts',
                mfa: './src/mfa.ts',
                middleware: './src/middleware.ts',
                'rate-limit': './src/rate-limit.ts',
                telemetry: './src/telemetry.ts',
                transfer: './src/transfer.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/sql',
                '@parametric-portal/types',
                'effect',
                'ioredis',
                'jszip',
                'nanoid',
                'otplib',
                'papaparse',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
