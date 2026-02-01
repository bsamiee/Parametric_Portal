/**
 * Migration: job_dlq — Dead-letter queue for failed jobs.
 *
 * Purpose: Store jobs that exhausted retries or encountered terminal errors.
 * Supports debugging, replay, and observability of job failures.
 *
 * PG18.1 + EXTENSIONS LEVERAGED:
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ uuidv7()              │ Time-ordered IDs (k-sortable, embeds creation time)   │
 * │ uuid_extract_timestamp│ Extract DLQ time from id (NO separate dlq_at needed)  │
 * │ BRIN on id            │ Ultra-compact for time-range scans on DLQ entries     │
 * │ Partial indexes       │ Only index pending (replayed_at IS NULL) entries      │
 * │ Covering (INCLUDE)    │ Index-only scans for common query patterns            │
 * │ JSONB + GIN           │ Error history search for debugging                    │
 * │ RLS                   │ Tenant isolation via app.current_tenant GUC           │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN DECISIONS:
 * - NO updated_at: DLQ entries are append-mostly; only replayed_at mutates
 * - NO FK to jobs: Original job may be purged before DLQ entry is replayed
 * - user_id FK RESTRICT: Users never hard-deleted (soft-delete only)
 * - Separate table from jobs: Different lifecycle, access patterns, purge semantics
 *
 * SOURCE DISCRIMINANTS:
 * - job: Dead-lettered background job
 * - event: Dead-lettered domain event from EventBus
 *
 * ERROR_REASON DISCRIMINANTS (job sources):
 * - MaxRetries: Job exhausted configured retry attempts
 * - Validation: Payload failed schema validation
 * - HandlerMissing: No registered handler for job type
 * - RunnerUnavailable: Worker pool unavailable or shutting down
 * - Timeout: Job exceeded execution time limit
 * - Panic: Unrecoverable runtime error (defect, not failure)
 *
 * ERROR_REASON DISCRIMINANTS (event sources):
 * - DeliveryFailed: Event could not be delivered to subscriber
 * - DeserializationFailed: Event payload failed schema decoding
 * - DuplicateEvent: Event with same eventId already processed
 * - HandlerMissing: No registered handler for event type
 * - HandlerTimeout: Event handler exceeded time limit
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
			source TEXT NOT NULL DEFAULT 'job',
			original_job_id UUID NOT NULL,
			app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
			user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
			request_id UUID,
			type TEXT NOT NULL,
			payload JSONB NOT NULL,
			error_reason TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			error_history JSONB NOT NULL,
			replayed_at TIMESTAMPTZ,
			CONSTRAINT job_dlq_source_valid CHECK (source IN ('job', 'event')),
			CONSTRAINT job_dlq_error_reason_valid CHECK (error_reason IN (
				'MaxRetries', 'Validation', 'HandlerMissing', 'RunnerUnavailable', 'Timeout', 'Panic',
				'DeliveryFailed', 'DeserializationFailed', 'DuplicateEvent', 'HandlerTimeout'
			)),
			CONSTRAINT job_dlq_error_history_array CHECK (jsonb_typeof(error_history) = 'array'),
			CONSTRAINT job_dlq_attempts_positive CHECK (attempts > 0)
		)
	`;
    yield* sql`COMMENT ON TABLE job_dlq IS 'Unified dead-letter queue for jobs and events — use uuid_extract_timestamp(id) for DLQ creation time; NO updated_at (append-mostly)'`;
    yield* sql`COMMENT ON COLUMN job_dlq.source IS 'Discriminant: job = background job, event = domain event from EventBus'`;
    yield* sql`COMMENT ON COLUMN job_dlq.original_job_id IS 'Reference to original job/event — NO FK constraint (source may be purged before replay)'`;
    yield* sql`COMMENT ON COLUMN job_dlq.error_reason IS 'Failure classification discriminant for typed error handling — valid values depend on source'`;
    yield* sql`COMMENT ON COLUMN job_dlq.error_history IS 'Array of {error: string, timestamp: number} entries from all attempts'`;
    yield* sql`COMMENT ON COLUMN job_dlq.replayed_at IS 'NULL = pending replay; set when job/event resubmitted to queue'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // INDEXES: Optimized for pending queries, time-range scans, debugging
    // ═══════════════════════════════════════════════════════════════════════════
    // BRIN on id: UUIDv7 is time-ordered, efficient for "DLQ entries in last N days"
    yield* sql`CREATE INDEX idx_job_dlq_id_brin ON job_dlq USING BRIN (id)`;
    // Source + error reason: "Show all event DeliveryFailed errors" or "Show all job MaxRetries errors"
    yield* sql`CREATE INDEX idx_job_dlq_source ON job_dlq(source, error_reason) INCLUDE (type, attempts) WHERE replayed_at IS NULL`;
    // Pending entries by type: "Show all pending MaxRetries failures for email-send"
    yield* sql`CREATE INDEX idx_job_dlq_pending_type ON job_dlq(type, error_reason) INCLUDE (app_id, source, attempts) WHERE replayed_at IS NULL`;
    // Pending entries by app: "Show all pending DLQ entries for tenant X"
    yield* sql`CREATE INDEX idx_job_dlq_pending_app ON job_dlq(app_id, id DESC) INCLUDE (type, source, error_reason, attempts) WHERE replayed_at IS NULL`;
    // Original job lookup: "What happened to job X?" (debugging)
    yield* sql`CREATE INDEX idx_job_dlq_original ON job_dlq(original_job_id) INCLUDE (error_reason, attempts, replayed_at)`;
    // Request correlation: "All DLQ entries from HTTP request Y"
    yield* sql`CREATE INDEX idx_job_dlq_request ON job_dlq(request_id) INCLUDE (type, error_reason) WHERE request_id IS NOT NULL`;
    // Error history search: GIN for @> containment queries on error messages
    yield* sql`CREATE INDEX idx_job_dlq_errors ON job_dlq USING GIN (error_history)`;
    // FK enforcement indexes
    yield* sql`CREATE INDEX idx_job_dlq_app_id_fk ON job_dlq(app_id)`;
    yield* sql`CREATE INDEX idx_job_dlq_user_id_fk ON job_dlq(user_id) WHERE user_id IS NOT NULL`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PURGE: Hard-delete replayed entries older than N days
    // ═══════════════════════════════════════════════════════════════════════════
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
    yield* sql`COMMENT ON FUNCTION purge_job_dlq IS 'Hard-delete replayed job_dlq entries older than N days — keeps pending entries indefinitely'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS: Row-Level Security for tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`ALTER TABLE job_dlq ENABLE ROW LEVEL SECURITY`;
    yield* sql`CREATE POLICY job_dlq_tenant_isolation ON job_dlq USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    yield* sql`ALTER TABLE job_dlq FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY job_dlq_tenant_isolation ON job_dlq IS 'RLS: Isolate job_dlq by app_id matching current_setting(app.current_tenant)'`;
});
