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
                circuit: './src/circuit.ts',
                context: './src/context.ts',
                crypto: './src/crypto.ts',
                'http-errors': './src/http-errors.ts',
                metrics: './src/metrics.ts',
                mfa: './src/mfa.ts',
                middleware: './src/middleware.ts',
                'rate-limit': './src/rate-limit.ts',
                telemetry: './src/telemetry.ts',
                'totp-replay': './src/totp-replay.ts',
                transfer: './src/transfer.ts',
            },
            external: [
                '@effect/experimental',
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/sql',
                '@parametric-portal/database',
                '@parametric-portal/types',
                'cockatiel',
                'effect',
                'exceljs',
                'ipaddr.js',
                'ioredis',
                'jszip',
                'nanoid',
                'otplib',
                'papaparse',
                'rfc6902',
                'sax',
                'ts-essentials',
                'yaml',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
