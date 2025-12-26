import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                api: './src/api.ts',
                crypto: './src/crypto.ts',
                errors: './src/errors.ts',
                metrics: './src/metrics.ts',
                middleware: './src/middleware.ts',
                telemetry: './src/telemetry.ts',
            },
            external: [
                'effect',
                '@effect/platform',
                '@effect/sql',
                '@effect/sql-pg',
                '@opentelemetry/api',
                '@opentelemetry/auto-instrumentations-node',
                '@opentelemetry/exporter-trace-otlp-grpc',
                '@opentelemetry/resources',
                '@opentelemetry/sdk-node',
                '@opentelemetry/semantic-conventions',
                '@parametric-portal/database',
                '@parametric-portal/types',
                'prom-client',
            ],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
