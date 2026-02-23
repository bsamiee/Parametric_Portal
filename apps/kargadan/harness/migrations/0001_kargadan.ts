/**
 * Kargadan harness tables: sessions, tool calls, checkpoints.
 * Separate from platform migrations -- tracked in `kargadan_migrations` table.
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';
// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(String.raw`
        CREATE TABLE kargadan_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            run_id UUID NOT NULL,
            status TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
            tool_call_count INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            ended_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_kargadan_sessions_status_started
            ON kargadan_sessions (status, started_at DESC);
    `);
    yield* sql.unsafe(String.raw`
        CREATE TABLE kargadan_tool_calls (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID NOT NULL REFERENCES kargadan_sessions(id) ON DELETE CASCADE,
            run_id UUID NOT NULL,
            sequence INTEGER NOT NULL,
            operation TEXT NOT NULL CHECK (length(trim(operation)) > 0),
            params JSONB NOT NULL DEFAULT '{}'::jsonb,
            result JSONB,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'ok'
                CHECK (status IN ('ok', 'error')),
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_kargadan_tool_calls_session_sequence
            ON kargadan_tool_calls (session_id, sequence);
    `);
    yield* sql.unsafe(String.raw`
        CREATE TABLE kargadan_checkpoints (
            session_id UUID PRIMARY KEY REFERENCES kargadan_sessions(id) ON DELETE CASCADE,
            loop_state JSONB NOT NULL DEFAULT '{}'::jsonb,
            chat_json TEXT NOT NULL DEFAULT '',
            state_hash TEXT NOT NULL,
            scene_summary JSONB,
            sequence INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    `);
});
