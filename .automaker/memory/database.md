---
tags: [database]
summary: database implementation decisions and patterns
relevantTo: [database]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
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