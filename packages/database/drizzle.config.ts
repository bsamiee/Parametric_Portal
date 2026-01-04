/**
 * Drizzle Kit configuration for schema migrations.
 */
import { defineConfig } from 'drizzle-kit';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig({
    dialect: 'postgresql',
    out: './migrations',
    schema: './src/schema.ts',
});
