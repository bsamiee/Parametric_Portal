# Replication

Logical replication topology, publication/subscription patterns, and conflict management for PostgreSQL 18.2+.


## Publications

Publications define which tables and operations are replicated.

```sql
-- All tables
CREATE PUBLICATION all_changes FOR ALL TABLES;

-- Selective tables
CREATE PUBLICATION order_events FOR TABLE orders, order_items;

-- Filtered publication (PG 15+)
CREATE PUBLICATION active_orders FOR TABLE orders WHERE (status != 'archived');

-- Column filtering (PG 15+) -- exclude sensitive columns
CREATE PUBLICATION user_sync FOR TABLE users (id, name, email, updated_at);

-- Operation filtering
CREATE PUBLICATION inserts_only FOR TABLE audit_log WITH (publish = 'insert');

-- Schema-level (PG 15+)
CREATE PUBLICATION schema_pub FOR TABLES IN SCHEMA public;
```

Publication contracts:
- `publish` parameter: comma-separated list of `insert`, `update`, `delete`, `truncate` — default all four
- Row filters evaluated on publisher — only matching rows sent to subscriber; reduces network and apply overhead
- Column lists: unlisted columns receive NULL on subscriber — ensure subscriber schema has DEFAULT or nullable for excluded columns
- `publish_via_partition_root = true`: publishes changes from all partitions as if from root table — subscriber sees unified stream regardless of partition structure; required for bidirectional replication of partitioned tables
- `ALTER PUBLICATION ... ADD TABLE ...` / `DROP TABLE ...` for dynamic membership — no publication recreation needed


## Subscriptions

Subscriptions connect to publisher and apply changes.

```sql
-- Basic
CREATE SUBSCRIPTION order_replica
    CONNECTION 'host=publisher dbname=app'
    PUBLICATION order_events;

-- With options
CREATE SUBSCRIPTION order_replica
    CONNECTION 'host=publisher dbname=app port=5432 sslmode=verify-full'
    PUBLICATION order_events
    WITH (
        copy_data = true,
        create_slot = true,
        enabled = true,
        streaming = parallel,
        origin = none,
        two_phase = true
    );

-- Refresh after publication change
ALTER SUBSCRIPTION order_replica REFRESH PUBLICATION;

-- Disable/enable
ALTER SUBSCRIPTION order_replica DISABLE;
ALTER SUBSCRIPTION order_replica ENABLE;
```

Subscription contracts:
- `copy_data = true` (default): initial table snapshot + ongoing replication; `false` for tables already synced
- `streaming = parallel` (PG 16+): large transactions applied by parallel workers — prevents single-transaction blocking
- `origin = none`: prevents circular replication in multi-primary setups — changes already replicated once are not re-replicated
- Subscription creates a replication slot on publisher — slot retains WAL until subscriber confirms; monitor `pg_replication_slots` for lag
- `two_phase = true`: prepared transactions (`PREPARE TRANSACTION`) replicated atomically — requires publisher support


## RLS Bypass in Logical Replication

**SECURITY CRITICAL**: The apply worker executes as the subscription owner (typically superuser), which **bypasses all RLS policies**. Row-level security is not evaluated during logical replication apply.

Impact: if publisher replicates all rows and subscriber relies on RLS for tenant isolation, every tenant's data is visible to the apply worker and written without RLS checks.

Mitigations:
- **Filtered publications**: `CREATE PUBLICATION ... WHERE (tenant_id = $X)` — publish only rows belonging to target tenant, enforced at publisher before data leaves
- **Dedicated replication user**: create a non-superuser subscription owner with minimal privileges (`GRANT INSERT, UPDATE, DELETE ON target_tables TO repl_user`); avoids superuser bypass but still skips RLS unless `FORCE ROW LEVEL SECURITY` is set on the role
- **Separate databases per tenant**: physical isolation eliminates cross-tenant leakage entirely
- **Application-level validation on subscriber**: trigger or constraint on subscriber tables validates tenant_id matches expected value — defense-in-depth
- **Column filtering**: exclude sensitive columns from cross-environment replication publications


## Conflict Tracking (PG 15+)

`pg_stat_subscription_stats` (introduced PG 15) tracks logical replication conflicts per subscription.

```sql
-- Conflict statistics per subscription
SELECT subname,
       confl_insert_exists,
       confl_update_origin_differs,
       confl_update_missing,
       confl_delete_origin_differs,
       confl_delete_missing
FROM pg_stat_subscription_stats
WHERE confl_insert_exists > 0
   OR confl_update_missing > 0
   OR confl_delete_missing > 0;
```

Conflict types:
- `confl_insert_exists`: PK/unique violation on INSERT — row already exists on subscriber
- `confl_update_origin_differs`: concurrent update from different replication origin
- `confl_update_missing`: UPDATE target row does not exist on subscriber
- `confl_delete_origin_differs`: concurrent delete from different replication origin
- `confl_delete_missing`: DELETE target row already absent on subscriber

Conflict contracts:
- Logical replication has NO automatic conflict resolution — conflicts halt the apply worker
- Default behavior is ERROR — apply worker stops; requires manual intervention or `ALTER SUBSCRIPTION ... SET (disable_on_error = true)`
- `disable_on_error = true` disables subscription on error rather than retrying indefinitely — does NOT skip conflicting rows; manual resolution still required
- Prevent conflicts: use unidirectional replication or ensure non-overlapping write partitions
- `origin = none` prevents re-replication but does NOT resolve write-write conflicts on same row
- Monitor `pg_replication_slots.confirmed_flush_lsn` vs `pg_current_wal_lsn()` for replication lag


## Bidirectional Replication

Two publications + two subscriptions with `origin = none` on both sides. Origin tracking prevents infinite loops: changes arriving via replication carry the publisher's origin, and `origin = none` filters them out on re-publish.

```sql
-- Node A
CREATE PUBLICATION pub_a FOR TABLE shared_data
    WITH (publish_via_partition_root = true);
CREATE SUBSCRIPTION sub_from_b
    CONNECTION 'host=node_b dbname=app'
    PUBLICATION pub_b
    WITH (origin = none, copy_data = false);

-- Node B
CREATE PUBLICATION pub_b FOR TABLE shared_data
    WITH (publish_via_partition_root = true);
CREATE SUBSCRIPTION sub_from_a
    CONNECTION 'host=node_a dbname=app'
    PUBLICATION pub_a
    WITH (origin = none, copy_data = false);
```

Conflict resolution strategies:
- **Partition writes by node**: node A owns tenant 1-1000, node B owns 1001-2000 — eliminates write-write conflicts entirely
- **Last-write-wins**: application-level `updated_at` comparison in ON CONFLICT handler on subscriber — requires subscriber-side trigger or BEFORE INSERT/UPDATE function
- **Application-level merge**: subscriber writes to staging table; application logic resolves conflicts before promoting to main table

Pitfalls:
- **Sequence collisions**: both nodes generating from same sequence causes PK collisions — use UUIDv7 PKs or odd/even sequence allocation (`INCREMENT BY 2, START WITH 1` on A, `START WITH 2` on B)
- **Schema changes**: DDL is NOT replicated — apply identical migrations on both nodes before DML changes arrive
- **Initial sync**: use `copy_data = false` on both sides; manually ensure tables are synchronized before enabling subscriptions
- **Partitioned tables**: `publish_via_partition_root = true` required on both sides — otherwise partition-level changes carry partition OID, not root OID, breaking origin filtering


## Replication Slots

```sql
-- Create logical slot
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput');

-- Monitor slots
SELECT slot_name, plugin, slot_type, active,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;

-- Drop inactive slot -- releases retained WAL
SELECT pg_drop_replication_slot('my_slot');
```

Slot contracts:
- Inactive slots retain WAL indefinitely — disk fills up; set `max_slot_wal_keep_size` as safety limit
- `max_replication_slots` limits total slots (default 10) — increase for many subscribers
- Each slot tracks a position independently — multiple subscribers at different lag points are normal
- Slot names are cluster-wide unique — not per-database
- Failover slots (PG 17+): `failover = true` in subscription — slot state replicated to standby for seamless failover


## Change Data Capture Patterns

Using logical replication as CDC for event-driven architectures.

```sql
-- Publication as event source: filtered for domain events
CREATE PUBLICATION domain_events
    FOR TABLE events
    WHERE (event_type IN ('order.created', 'order.shipped', 'payment.received'))
    WITH (publish = 'insert');
```

Patterns:
- **Outbox pattern**: application writes to `outbox` table; logical replication delivers to consumers; subscriber deletes after processing
- **Event consumer**: dedicated database/service subscribes and processes events via standard subscription
- **WAL-level CDC**: use `pgoutput` plugin directly via `pg_logical_slot_get_changes()` for custom consumers without full subscription

```sql
-- Direct WAL consumption for custom CDC consumers
SELECT lsn, xid, data
FROM pg_logical_slot_get_changes('my_slot', NULL, NULL,
    'proto_version', '1',
    'publication_names', 'domain_events');
```

CDC contracts:
- Logical decoding requires `wal_level = logical` — set in postgresql.conf, requires restart
- `pgoutput` is the standard output plugin — used by native logical replication; `wal2json` for JSON-formatted changes
- Transactional consistency: all changes within a transaction delivered as a unit — consumer sees atomic commits
- Large transactions: `streaming = on/parallel` prevents blocking — changes streamed before COMMIT


## Configuration Requirements

| Parameter | Side | Default | Purpose |
|-----------|------|---------|---------|
| `wal_level` | publisher | `replica` | Must be `logical`; requires restart |
| `max_replication_slots` | publisher | 10 | Per subscriber + CDC consumers |
| `max_wal_senders` | publisher | 10 | Concurrent replication connections (streaming + logical) |
| `max_slot_wal_keep_size` | publisher | -1 (unlimited) | Safety limit for inactive slots |
| `max_logical_replication_workers` | subscriber | 4 | Parallel apply workers across all subscriptions |
| `max_sync_workers_per_subscription` | subscriber | 2 | Initial sync parallelism |

Publisher requires `pg_hba.conf` entries allowing replication connections from subscriber hosts.


## Monitoring

```sql
-- Subscription worker status and lag (pg_stat_subscription: PG 15+)
SELECT s.subname, s.subenabled,
       sr.received_lsn, sr.latest_end_lsn,
       pg_wal_lsn_diff(sr.received_lsn, sr.latest_end_lsn) AS apply_lag_bytes
FROM pg_subscription s
JOIN pg_stat_subscription sr ON s.oid = sr.subid;

-- Publisher: slot health
SELECT slot_name, active, restart_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lag
FROM pg_replication_slots
WHERE slot_type = 'logical';

-- Subscriber: worker activity
SELECT pid, relid::regclass, received_lsn, last_msg_send_time,
       last_msg_receipt_time
FROM pg_stat_subscription;

-- Conflict growth rate (alert on any non-zero delta)
SELECT subname,
       confl_insert_exists + confl_update_missing + confl_delete_missing AS total_conflicts
FROM pg_stat_subscription_stats;
```

Monitoring contracts:
- Alert on `lag_bytes` exceeding threshold — sustained lag indicates subscriber cannot keep up
- Alert on `active = false` for any slot — inactive slot accumulates WAL without bound
- `last_msg_send_time` older than `wal_sender_timeout` (default 60s) indicates stalled replication
- Track conflict column growth rate in `pg_stat_subscription_stats` — any non-zero value requires investigation
- `pg_stat_subscription` columns: `pid`, `subid`, `subname`, `relid`, `received_lsn`, `last_msg_send_time`, `last_msg_receipt_time`, `latest_end_lsn`, `latest_end_time`
