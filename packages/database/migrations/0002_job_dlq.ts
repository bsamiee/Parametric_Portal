/**
 * Migration: job_dlq — Dead-letter queue for failed jobs.
 *
 * Purpose: Store jobs that exhausted retries or encountered terminal errors.
 * Supports debugging, replay, and observability of job failures.
 *
 * Key features:
 * - UUIDv7 primary key (uuid_extract_timestamp for creation time)
 * - Tenant isolation via app_id with RLS
 * - Error history as JSONB array for debugging
 * - Partial indexes on pending (replayed_at IS NULL) for efficient queries
 * - Purge function for replayed entries older than N days
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // ═══════════════════════════════════════════════════════════════════════════
    // JOB_DLQ: Dead-letter queue for failed jobs
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
		CREATE TABLE job_dlq (
			id UUID PRIMARY KEY DEFAULT uuidv7(),
			original_job_id UUID NOT NULL,
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
			type TEXT NOT NULL,
			payload JSONB NOT NULL,
			error_reason TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			error_history JSONB NOT NULL,
			dlq_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			replayed_at TIMESTAMPTZ,
			request_id UUID,
			user_id UUID,
			CONSTRAINT job_dlq_error_history_array CHECK (jsonb_typeof(error_history) = 'array')
		)
	`;
    yield* sql`COMMENT ON TABLE job_dlq IS 'Dead-lettered jobs — use uuid_extract_timestamp(id) for DLQ time'`;
    yield* sql`COMMENT ON COLUMN job_dlq.error_reason IS 'Failure classification: MaxRetries, Validation, HandlerMissing, RunnerUnavailable'`;
    yield* sql`COMMENT ON COLUMN job_dlq.replayed_at IS 'NULL = pending replay; set when job resubmitted'`;
    // --- Indexes -------------------------------------------------------------
    yield* sql`CREATE INDEX idx_job_dlq_type ON job_dlq(type) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_dlq_at ON job_dlq(dlq_at) WHERE replayed_at IS NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_request ON job_dlq(request_id) WHERE request_id IS NOT NULL`;
    yield* sql`CREATE INDEX idx_job_dlq_app_id_fk ON job_dlq(app_id)`;
    // --- Trigger for updated_at ----------------------------------------------
    yield* sql`CREATE TRIGGER job_dlq_updated_at BEFORE UPDATE ON job_dlq FOR EACH ROW EXECUTE FUNCTION set_updated_at()`;
    // --- Purge function ------------------------------------------------------
    yield* sql`
		CREATE OR REPLACE FUNCTION purge_job_dlq(p_older_than_days INT DEFAULT 30)
		RETURNS INT
		LANGUAGE sql
		AS $$
			WITH purged AS (
				DELETE FROM job_dlq
				WHERE replayed_at IS NOT NULL
				  AND replayed_at < NOW() - (p_older_than_days || ' days')::interval
				RETURNING id
			)
			SELECT COUNT(*)::int FROM purged
		$$
	`;
    yield* sql`COMMENT ON FUNCTION purge_job_dlq IS 'Hard-delete replayed job_dlq entries older than N days'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS: Row-Level Security for tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`ALTER TABLE job_dlq ENABLE ROW LEVEL SECURITY`;
    yield* sql`CREATE POLICY job_dlq_tenant_isolation ON job_dlq USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    yield* sql`ALTER TABLE job_dlq FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY job_dlq_tenant_isolation ON job_dlq IS 'RLS: Isolate job_dlq by app_id matching current_setting(app.current_tenant)'`;
});
