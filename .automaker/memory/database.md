---
tags: [database]
summary: database implementation decisions and patterns
relevantTo: [database]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 2
  referenced: 2
  successfulFeatures: 2
---
# database

### Stored encrypted MFA secret in bytea column with AES-GCM encryption via EncryptionKeyService rather than storing plaintext or using database-native encryption (2026-01-12)
- **Context:** MFA secrets are cryptographic material that must never be exposed; system already has EncryptionKeyService available
- **Why:** Application-layer encryption allows key rotation independent of database, reduces attack surface if database is compromised, consistent with existing security patterns in codebase
- **Rejected:** Plaintext storage (security risk), database-native encryption (reduces key management flexibility, vendor lock-in)
- **Trade-offs:** Added encryption/decryption overhead on every MFA operation; enables independent key management strategy
- **Breaking if changed:** Removing encryption layer would expose secrets in database; changing encryption algorithm requires migration strategy for existing secrets

### Made userId unique in mfa_secrets table rather than having one-to-many relationship (2026-01-12)
- **Context:** User can only have one active MFA secret at a time; re-enrollment overwrites previous secret
- **Why:** Unique constraint prevents accidental duplicate MFA configs; upsert pattern handles re-enrollment cleanly; simpler queries (no need to find 'active' or 'most recent')
- **Rejected:** Non-unique (would need status field to track active, more complex upsert), one-to-many history table (unnecessary complexity for this use case)
- **Trade-offs:** Cannot keep audit trail of old secrets; simpler implementation; lose granular history if needed later
- **Breaking if changed:** Adding history tracking requires schema change and migration; removing uniqueness allows duplicate configs

### Composite unique constraint (appId, email) instead of single email uniqueness on users table (2026-01-12)
- **Context:** Multi-tenant system where same email should be allowed across different apps, but unique within an app
- **Why:** Enables proper multi-tenant isolation at the database level - prevents accidental conflicts while allowing email reuse across tenants. Enforces business rule that email is unique per app, not globally
- **Rejected:** Single email unique constraint would prevent legitimate use case of same user registering with same email in different apps
- **Trade-offs:** More complex constraint definition, requires appId to be NOT NULL on users, but provides stronger data integrity and clearer tenant boundaries
- **Breaking if changed:** Removing this constraint breaks multi-tenant isolation - allows duplicate emails within same app. Migration complexity in production if existing data violates constraint

### Added appId as NOT NULL foreign key to existing tables (users, assets, audit_logs) rather than making it nullable (2026-01-12)
- **Context:** Retrofitting multi-tenancy to existing schema where these tables existed before AppId concept
- **Why:** Non-null requirement forces every record to belong to an app, preventing orphaned data and ensuring queries must be app-scoped by default. Fails fast if app context is missing
- **Rejected:** Nullable appId would allow legacy data without explicit app assignment, creating implicit default behavior and harder-to-catch bugs where queries forget to filter by app
- **Trade-offs:** Migration complexity - requires default app or data cleanup before applying constraint in production. Simpler query logic afterwards as app scoping is mandatory
- **Breaking if changed:** Any insert/update to users, assets, audit_logs without appId will fail. Existing production data must be migrated to assign appId values before applying NOT NULL constraint

#### [Gotcha] Migration uses covering indexes on app-scoped tables with explicit column lists rather than simple indexes (2026-01-12)
- **Situation:** Complex indexes were created for apps table queries with appId
- **Root cause:** Covering indexes include all columns needed for app-scoped queries without fetching main table - critical performance for multi-tenant queries that must filter by appId. Reduces table lookups
- **How to avoid:** Larger index size and slower writes/updates, but dramatically faster reads for most app-scoped queries. Worth it for read-heavy multi-tenant systems