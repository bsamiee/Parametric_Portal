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
                auth: './src/auth.ts',
                crypto: './src/crypto.ts',
                'http-errors': './src/http-errors.ts',
                metrics: './src/metrics.ts',
                middleware: './src/middleware.ts',
                telemetry: './src/telemetry.ts',
            },
            external: [
                '@effect/opentelemetry',
                '@effect/platform',
                '@effect/sql',
                '@opentelemetry/exporter-trace-otlp-grpc',
                '@opentelemetry/sdk-trace-base',
                '@parametric-portal/database',
                '@parametric-portal/types',
                'effect',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
