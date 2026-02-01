/**
 * Migration: event_outbox — Transactional outbox for domain events.
 *
 * Purpose: Store events in same transaction as domain mutations.
 * Events become visible only after commit, preventing phantom events.
 *
 * PG18.1 + EXTENSIONS LEVERAGED:
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ uuidv7()              │ Time-ordered IDs (k-sortable, embeds creation time)   │
 * │ uuid_extract_timestamp│ Extract creation time from id (NO created_at needed)  │
 * │ BRIN on id            │ Ultra-compact for time-range scans                    │
 * │ Partial indexes       │ Only index pending status for polling                 │
 * │ Covering (INCLUDE)    │ Index-only scans for worker polling                   │
 * │ RLS                   │ Tenant isolation via app.current_tenant GUC           │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * DESIGN DECISIONS:
 * - NO updated_at: Outbox entries are append-mostly; only status/published_at mutate
 * - event_id UNIQUE: Deduplication key for exactly-once semantics
 * - FK to apps with RESTRICT: Tenant must exist, cannot be deleted with pending events
 *
 * STATUS DISCRIMINANTS:
 * - pending: Awaiting broadcast by outbox worker
 * - published: Successfully sent to EventBus subscribers
 * - failed: Dead-lettered after exhausting retries
 */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT_OUTBOX: Transactional outbox for domain events
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE TABLE event_outbox (
            id UUID PRIMARY KEY DEFAULT uuidv7(),
            app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            event_id UUID NOT NULL UNIQUE,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            published_at TIMESTAMPTZ,
            CONSTRAINT event_outbox_status_check CHECK (status IN ('pending', 'published', 'failed'))
        )
    `;
    yield* sql`COMMENT ON TABLE event_outbox IS 'Transactional outbox for domain events — use uuid_extract_timestamp(id) for creation time'`;
    yield* sql`COMMENT ON COLUMN event_outbox.event_id IS 'Unique event identifier for deduplication — generated via Snowflake'`;
    yield* sql`COMMENT ON COLUMN event_outbox.event_type IS 'Event type in dot-notation: user.created, order.placed'`;
    yield* sql`COMMENT ON COLUMN event_outbox.status IS 'pending = awaiting broadcast; published = successfully sent; failed = dead-lettered'`;
    yield* sql`COMMENT ON COLUMN event_outbox.published_at IS 'Timestamp when event was successfully broadcast to subscribers'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // INDEXES: Optimized for worker polling, deduplication, debugging
    // ═══════════════════════════════════════════════════════════════════════════
    // BRIN on id: UUIDv7 is time-ordered, efficient for time-range scans
    yield* sql`CREATE INDEX idx_event_outbox_id_brin ON event_outbox USING BRIN (id)`;
    // Pending events for worker polling (most common query)
    yield* sql`CREATE INDEX idx_event_outbox_pending ON event_outbox(status, id) INCLUDE (app_id, event_type) WHERE status = 'pending'`;
    // Event lookup by event_id (deduplication check) — UNIQUE constraint already creates index
    // Failed events by type for debugging
    yield* sql`CREATE INDEX idx_event_outbox_failed ON event_outbox(event_type, id DESC) WHERE status = 'failed'`;
    // FK enforcement
    yield* sql`CREATE INDEX idx_event_outbox_app_id_fk ON event_outbox(app_id)`;
    // ═══════════════════════════════════════════════════════════════════════════
    // PURGE: Hard-delete published events older than N days
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`
        CREATE OR REPLACE FUNCTION purge_event_outbox(p_older_than_days INT DEFAULT 7)
        RETURNS INT
        LANGUAGE sql
        AS $$
            WITH purged AS (
                DELETE FROM event_outbox
                WHERE status = 'published'
                  AND published_at < NOW() - (p_older_than_days || ' days')::interval
                RETURNING id
            )
            SELECT COUNT(*)::int FROM purged
        $$
    `;
    yield* sql`COMMENT ON FUNCTION purge_event_outbox IS 'Hard-delete published events older than N days — keeps pending and failed'`;
    // ═══════════════════════════════════════════════════════════════════════════
    // RLS: Row-Level Security for tenant isolation
    // ═══════════════════════════════════════════════════════════════════════════
    yield* sql`ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY`;
    yield* sql`CREATE POLICY event_outbox_tenant_isolation ON event_outbox USING (app_id = current_setting('app.current_tenant', true)::uuid) WITH CHECK (app_id = current_setting('app.current_tenant', true)::uuid)`;
    yield* sql`ALTER TABLE event_outbox FORCE ROW LEVEL SECURITY`;
    yield* sql`COMMENT ON POLICY event_outbox_tenant_isolation ON event_outbox IS 'RLS: Isolate event_outbox by app_id matching current_setting(app.current_tenant)'`;
});
