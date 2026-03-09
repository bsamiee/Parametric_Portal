# Security

Row-level security, privilege architecture, authentication, audit, and pgaudit for PostgreSQL 18.2+. Security is enforced at the database level --- application-layer authorization is redundant defense, not primary enforcement.


## Row-Level Security (RLS)

RLS policies enforce tenant isolation and access control at the query planner level --- invisible to application queries.

### Patterns

Tenant isolation policy (enable + force in same statement block):

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- without FORCE, table owners bypass RLS

CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
```

Admin bypass: `CREATE POLICY admin_access ON orders FOR ALL TO app_admin USING (true) WITH CHECK (true);`

Per-operation policies enforce least-privilege per DML verb:
- `FOR SELECT USING (...)` --- read visibility filter
- `FOR INSERT WITH CHECK (...)` --- write admission gate
- `FOR UPDATE USING (...) WITH CHECK (...)` --- both old and new row must satisfy
- `FOR DELETE USING (...)` --- deletion visibility filter

Combining permissive + restrictive for layered access:

```sql
-- Permissive: tenant sees own rows (OR'd with other permissive policies)
CREATE POLICY tenant_read ON orders FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Restrictive: even within tenant, only active rows visible (AND'd with permissive result)
CREATE POLICY active_only ON orders AS RESTRICTIVE FOR SELECT
    USING (status != 'archived');
```

Temporal RLS --- policy with range containment:

```sql
CREATE POLICY valid_period_access ON versioned_entities
    USING (valid_period @> current_timestamp::timestamptz);
```

### Contracts

- `USING` filters visible rows (SELECT, UPDATE, DELETE); `WITH CHECK` validates new/modified rows (INSERT, UPDATE)
- `FORCE ROW LEVEL SECURITY` applies policies even to table owners --- without it, table owners bypass RLS
- **Policy combination semantics**: PERMISSIVE policies (the default) OR together. RESTRICTIVE policies (`AS RESTRICTIVE`) AND together. Final access: at least one PERMISSIVE must pass AND every RESTRICTIVE must pass. When no PERMISSIVE policy exists for an operation, access is denied. Policy type --- not role assignment --- determines combination logic.
- `current_setting('app.current_tenant')` must be set via `SET LOCAL` or `set_config(..., true)` in each transaction --- not session-level
- Performance: RLS predicates are appended to every query --- ensure indexed columns used in policies
- Superusers and roles with BYPASSRLS bypass RLS --- never use superuser for application connections
- Schema isolation vs RLS tradeoff: schema-per-tenant eliminates RLS overhead but complicates shared infrastructure (migrations, connection routing, monitoring). RLS preferred for shared-schema multi-tenancy; schema isolation for strict compliance boundaries.


## Privilege Architecture

### Patterns

Column-level grants for sensitive data:

```sql
REVOKE SELECT ON users FROM app_readonly;
GRANT SELECT (id, name, email, created_at) ON users TO app_readonly;
-- password_hash, mfa_secret, recovery_codes columns are NOT granted
```

Default privileges for automated schema management --- applies to all FUTURE objects created by `deploy_role`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE deploy_role IN SCHEMA app
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_readwrite;

ALTER DEFAULT PRIVILEGES FOR ROLE deploy_role IN SCHEMA app
    GRANT SELECT ON TABLES TO app_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE deploy_role IN SCHEMA app
    GRANT USAGE, SELECT ON SEQUENCES TO app_readwrite;
```

Privilege escalation prevention:

```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
-- Grant only specific functions to specific roles
GRANT EXECUTE ON FUNCTION app.search_entities(text, int) TO app_readonly;

-- Prevent role inheritance escalation
CREATE ROLE app_service NOINHERIT;  -- must SET ROLE explicitly, no ambient privilege
```

### Contracts

- Role hierarchy: `app_readonly` < `app_readwrite` < `app_admin` via `GRANT role TO role`
- `ALTER DEFAULT PRIVILEGES` applies to FUTURE objects only --- existing objects need explicit GRANT
- `PUBLIC` pseudo-role: all roles inherit from PUBLIC --- `REVOKE ... FROM PUBLIC` is the baseline posture
- Column-level SELECT: queries referencing non-granted columns fail at parse time --- not runtime
- `GRANT USAGE ON SCHEMA` required before any object access within schema
- `NOINHERIT` prevents ambient privilege from granted roles --- force explicit `SET ROLE` for escalation audit trail


## Function Security

SECURITY INVOKER vs SECURITY DEFINER for function execution context.

### Patterns

SECURITY INVOKER (always the default for SQL/plpgsql functions in all PG versions):

```sql
CREATE FUNCTION safe_lookup(p_id uuid)
RETURNS jsonb
LANGUAGE SQL
SECURITY INVOKER
STABLE
RETURN (SELECT to_jsonb(t.*) FROM orders t WHERE t.id = p_id);
-- RLS policies apply --- caller's tenant isolation enforced
```

SECURITY DEFINER with search_path lock:

```sql
CREATE FUNCTION admin_audit_log(p_action text, p_detail jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    INSERT INTO audit_log (action, detail, performed_by, performed_at)
    VALUES (p_action, p_detail, current_setting('app.user_id'), clock_timestamp());
END;
$$;
```

### Contracts

- SECURITY INVOKER has always been the default for SQL/plpgsql functions in all PG versions --- this was never changed.
- PG 15 introduced `security_invoker` option for VIEWS via `CREATE VIEW ... WITH (security_invoker = true)`. Prior to PG 15, views always executed as the view owner (definer semantics).
- SECURITY DEFINER without `SET search_path`: attacker creates malicious function in user-writable schema that shadows a system function --- privilege escalation
- SECURITY DEFINER functions bypass RLS --- use sparingly and audit carefully
- Leakproof functions: `LEAKPROOF` attribute declares function cannot leak information through error messages or side channels --- required for some RLS optimizations


## Authentication (PG 18)

### Contracts

- md5 is deprecated in PG 18 --- use `scram-sha-256` exclusively
- OAuth 2.0: `host all all 0.0.0.0/0 oauth` in pg_hba.conf; requires `oauth_validator_library` (singular) in postgresql.conf --- token validation loaded via shared library
- Data checksums enabled by default in PG 18 (`initdb`) --- protects against silent data corruption
- TLS 1.3 cipher control: `ssl_tls13_ciphers = 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256'`
- Connection-level encryption: `sslmode=verify-full` on client side enforces server certificate validation


## pgaudit

Compliance-grade audit logging for SOC 2, HIPAA, and PCI-DSS requirements.

```sql
CREATE EXTENSION pgaudit;
```

### Configuration

Session audit via `ALTER SYSTEM` (persists across restarts):

```sql
ALTER SYSTEM SET pgaudit.log = 'ddl, write';
ALTER SYSTEM SET pgaudit.log_relation = on;       -- log relation name per statement
ALTER SYSTEM SET pgaudit.log_catalog = off;        -- exclude pg_catalog (noisy)
ALTER SYSTEM SET pgaudit.log_parameter = on;       -- include bind parameters
ALTER SYSTEM SET pgaudit.log_statement_once = on;  -- de-duplicate: statement text on first line only
ALTER SYSTEM SET pgaudit.role = 'auditor';          -- object audit role
SELECT pg_reload_conf();
```

### Session vs Object Audit

**Session audit** (`pgaudit.log`): captures all statements matching configured classes regardless of target. Classes: `read`, `write`, `function`, `role`, `ddl`, `misc`, `misc_set`, `all` --- comma-separated. Recommended baseline: `ddl, write` for schema changes and data mutations; add `role` when tracking privilege changes.

**Object audit** (`pgaudit.role`): captures only statements touching objects where the named audit role has grants. More selective --- use for targeted compliance on sensitive tables:

```sql
CREATE ROLE auditor NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, payments, audit_log TO auditor;
-- Only queries touching these three tables generate object audit entries
```

**Dual mode**: run both simultaneously --- session audit for broad DDL/role coverage, object audit for sensitive data tables. Both fire independently for the same statement when conditions match.

### Contracts

- `pgaudit.log_relation = on` logs each relation accessed per statement --- critical for JOINs touching sensitive tables
- Log output goes to PostgreSQL server log --- route to SIEM via syslog or log shipper (Alloy, Promtail, Fluent Bit)
- `pgaudit.log = 'all'` generates significant volume --- scope to `ddl, write` minimum; add `role` for privilege audit
- `misc_set`: logs SET/RESET commands; `misc`: logs DISCARD, FETCH, CHECKPOINT and other utility statements


## Audit Patterns

Application-level audit via MERGE RETURNING --- not triggers.

Audit via MERGE RETURNING OLD/NEW (PG 18):

```sql
WITH write_result AS (
    MERGE INTO entities AS tgt
    USING (SELECT $1::uuid AS id, $2::jsonb AS payload) AS src
    ON tgt.id = src.id
    WHEN MATCHED THEN
        UPDATE SET payload = src.payload, updated_at = clock_timestamp()
    WHEN NOT MATCHED THEN
        INSERT (id, payload) VALUES (src.id, src.payload)
    RETURNING merge_action() AS action,
              to_jsonb(OLD.*) AS before,
              to_jsonb(NEW.*) AS after
)
INSERT INTO audit_log (entity_type, entity_id, action, before_state, after_state, actor_id)
SELECT 'entity',
       (after->>'id')::uuid,
       action,
       before,
       after,
       current_setting('app.user_id')::uuid
FROM write_result;
```

### Contracts

- OLD is NULL for INSERT actions, NEW is NULL for DELETE actions
- MERGE RETURNING + writable CTE: audit insert happens in same transaction --- atomicity guaranteed
- `current_setting('app.user_id')` must be SET per transaction --- not session state
- Audit table should be append-only with RLS preventing modification --- `FOR SELECT` policy only for app roles
