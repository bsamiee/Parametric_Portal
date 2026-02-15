# Roadmap: Parametric Portal Infrastructure

## Overview

This roadmap delivers a pure-TypeScript IaC layer that provisions production-ready multi-tenant Kubernetes infrastructure via a single polymorphic function call. Starting with hardening the existing Pulumi codebase and establishing the shared config schema, it progresses through cluster tooling, tenant factory construction, CI/CD automation, and finally connects infrastructure provisioning to the existing TenantLifecycleService. Nine phases derived from 23 v1 requirements across six categories.

## Phases

- [x] **Phase 1: Foundation Hardening** - Fix anti-patterns in existing infrastructure code before building on it
- [ ] **Phase 2: State Backend** - Encrypted state storage so Pulumi operations are safe to run
- [ ] **Phase 3: Shared Config Schema** - Single Effect schema consumed by both IaC and runtime
- [ ] **Phase 4: Cluster Tooling** - Platform-level K8s prerequisites (cert-manager, ingress, storage)
- [ ] **Phase 5: Tenant Factory Core** - Polymorphic ComponentResource with namespace isolation
- [ ] **Phase 6: Tenant Resources** - Per-tenant secrets, ingress with TLS, and database provisioning
- [ ] **Phase 7: Infrastructure Testing** - Pulumi mock-based test suite validating all deployment modes
- [ ] **Phase 8: CI/CD Pipeline** - GitHub Actions for preview-on-PR, deploy-on-merge, policy enforcement
- [ ] **Phase 9: Lifecycle Integration** - Connect infrastructure provisioning to TenantLifecycleService

## Phase Details

### Phase 1: Foundation Hardening
**Goal**: Existing infrastructure code is safe and deterministic -- no silent failures, no version drift, no naming collisions
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-03, FOUND-04
**Success Criteria** (what must be TRUE):
  1. Running `pulumi preview` with a missing required env var throws a catchable error with a descriptive message instead of killing the process
  2. Every container image reference in the infrastructure code resolves to a specific digest or semver tag -- no `:latest` anywhere
  3. All Pulumi resource logical names include the stack name as prefix, preventing collisions across multi-stack deployments
  4. A grep for `process.exit` in the infrastructure source returns zero matches
  5. MinIO is replaced with Garage (dxflrs/garage:v2.2.0) -- selfhosted S3-compatible storage uses an actively maintained project
  6. Redis is upgraded to 8.x (redis:8.6.0-alpine under AGPLv3)
  7. @pulumi/command and @pulumi/random are in the workspace catalog and infrastructure dependencies
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Replace process.exit with RunError, pin images, replace MinIO with Garage, upgrade Redis to 8.x, add @pulumi/command + @pulumi/random
- [x] 01-02-PLAN.md -- Apply stack-prefixed naming to all Pulumi resource logical names

### Phase 2: State Backend
**Goal**: Pulumi state is encrypted at rest and secrets never appear as plaintext in state files
**Depends on**: Phase 1
**Requirements**: FOUND-02
**Success Criteria** (what must be TRUE):
  1. `pulumi stack export | grep -c "plaintext"` returns zero for any secret value
  2. Pulumi stack is configured with S3 backend and `--secrets-provider awskms://` encryption
  3. Running `pulumi up` writes state to the configured S3 bucket (not local filesystem)
**Plans**: 1 plan

Plans:
- [ ] 02-01-PLAN.md -- Bootstrap S3 state bucket + KMS secrets key, configure main project backend URL

### Phase 3: Shared Config Schema
**Goal**: A single Effect schema defines the tenant configuration contract consumed by both Pulumi provisioning and runtime packages, with all cross-package env var gaps closed
**Depends on**: Phase 1
**Requirements**: CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. Pulumi infrastructure code imports and decodes tenant config through the shared schema -- invalid config fails at `pulumi preview` time with a schema validation error
  2. Runtime packages (server, database) import the same schema for their configuration needs -- no duplicate type definitions
  3. The environment variable contract (which vars IaC sets, which vars runtime reads) is explicitly declared in the schema and both sides reference it
  4. Passing an `unknown` config blob through `Schema.decodeUnknownSync` produces a fully typed tenant config or throws a structured parse error
  5. Email env vars (`EMAIL_*`, `RESEND_*`, `POSTMARK_*`, `SES_*`, `SMTP_*`) are included in `runtime-env.ts` passthrough lists and `RESEND_API_KEY` is in required secrets -- closing the email infrastructure gap
  6. Cloud mode sets `POSTGRES_SSL=true` in derived vars -- cloud RDS connections are encrypted
  7. Cloud mode provides `REDIS_TLS_CA` or validates that Node's default CA store covers ElastiCache TLS -- no TLS handshake failures
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md -- Create packages/config package with RuntimeEnvSchema (composed sub-schemas) and TenantConfigSchema
- [ ] 03-02-PLAN.md -- Wire infrastructure to import and validate env vars via Schema.decodeUnknownSync at IaC boundary
- [ ] 03-03-PLAN.md -- Close runtime-env passthrough gaps (email prefixes/secrets, POSTGRES_SSL derived var, REDIS_TLS_CA)

### Phase 4: Cluster Tooling
**Goal**: Self-hosted Kubernetes cluster has all platform-level prerequisites for tenant provisioning -- TLS, ingress routing, persistent storage
**Depends on**: Phase 2, Phase 3
**Requirements**: CLST-01, CLST-02, CLST-03
**Success Criteria** (what must be TRUE):
  1. cert-manager is deployed and a ClusterIssuer resource exists that can issue Let's Encrypt certificates (verifiable via `kubectl get clusterissuer`)
  2. Traefik ingress controller is running and responds to HTTP requests on the cluster's external IP (aligns with selfhosted mode; NGINX Ingress is EOL March 2026)
  3. Longhorn is deployed and a `StorageClass` named `longhorn` is available for PersistentVolumeClaim binding
  4. All three tools are provisioned via Pulumi (not manual kubectl) and appear in `pulumi stack export` output
**Plans**: TBD

Plans:
- [ ] 04-01: Deploy cert-manager with Let's Encrypt ClusterIssuer
- [ ] 04-02: Deploy Traefik ingress controller via Pulumi K8s resources
- [ ] 04-03: Deploy Longhorn distributed block storage

### Phase 5: Tenant Factory Core
**Goal**: A single polymorphic ComponentResource provisions isolated tenant namespaces with resource quotas and network policies via discriminated union dispatch
**Depends on**: Phase 3
**Requirements**: TNNT-01, TNNT-02, TNNT-03, TNNT-04
**Success Criteria** (what must be TRUE):
  1. Calling the tenant factory with a valid config object creates a Kubernetes namespace named after the tenant
  2. The created namespace has a ResourceQuota applied matching the tier-specific limits from the config schema
  3. The created namespace has a NetworkPolicy with deny-all default ingress/egress and explicit allow rules for required traffic
  4. The factory accepts a discriminated union input and dispatches via `Match.type` -- adding a new tenant tier is a single match arm addition
  5. Running `pulumi preview` for a new tenant shows namespace, quota, and network policy creation in the diff output
**Plans**: TBD

Plans:
- [ ] 05-01: Build TenantFactory ComponentResource with Match.type dispatch
- [ ] 05-02: Implement namespace creation with ResourceQuota and LimitRange
- [ ] 05-03: Implement NetworkPolicy with deny-all default and allow rules

### Phase 6: Tenant Resources
**Goal**: Each provisioned tenant has its own secrets, TLS-terminated ingress, DNS record, and database access -- the complete resource set for a running tenant
**Depends on**: Phase 4, Phase 5
**Requirements**: TNNT-05, TNNT-06, TNNT-07
**Success Criteria** (what must be TRUE):
  1. Provisioning a tenant creates a Kubernetes Secret in the tenant namespace containing DB credentials, API keys, and service tokens
  2. Provisioning a tenant creates an Ingress resource routing `{tenant}.domain.com` to the backend service with TLS termination via cert-manager
  3. Provisioning a tenant creates a database role and schema within the shared PostgreSQL instance, scoped to the tenant
  4. The complete tenant stack (namespace + quota + network policy + secrets + ingress + database + DNS) is created by a single `pulumi up` invocation
  5. A DNS record for `{tenant}.domain.com` is created pointing to the cluster ingress IP -- tenants are reachable without manual DNS configuration
**Plans**: TBD

Plans:
- [ ] 06-01: Implement per-tenant Kubernetes Secrets provisioning
- [ ] 06-02: Implement per-tenant Ingress with TLS via cert-manager
- [ ] 06-03: Implement per-tenant database role and schema provisioning
- [ ] 06-04: Implement per-tenant DNS record automation (External DNS or Pulumi DNS provider)

### Phase 7: Infrastructure Testing
**Goal**: Infrastructure code has automated test coverage validating resource creation logic without requiring a live cluster
**Depends on**: Phase 5, Phase 6
**Requirements**: FOUND-05
**Success Criteria** (what must be TRUE):
  1. `pnpm exec nx test infrastructure` runs Pulumi mock-based tests and passes
  2. At least one test per deployment mode validates that the expected resources are created with correct properties
  3. Tests use `runtime.setMocks()` and Vitest -- no live cluster or cloud credentials needed to run them
  4. A test validates that the tenant factory creates the correct resource set for a given tier config
**Plans**: TBD

Plans:
- [ ] 07-01: Set up Pulumi testing infrastructure with Vitest and runtime.setMocks
- [ ] 07-02: Write tests for deployment modes and tenant factory resource output

### Phase 8: CI/CD Pipeline
**Goal**: Infrastructure changes are previewed on PRs and deployed automatically on merge -- zero manual Pulumi CLI invocations in production
**Depends on**: Phase 2, Phase 7
**Requirements**: CICD-01, CICD-02, CICD-03
**Success Criteria** (what must be TRUE):
  1. Opening a PR that modifies `infrastructure/` triggers a GitHub Actions workflow that posts a `pulumi preview` diff as a PR comment
  2. Merging a PR to main triggers a GitHub Actions workflow that runs `pulumi up` and deploys the changes
  3. A CrossGuard policy pack runs during both preview and deploy, failing the pipeline if resources violate naming, label, or quota rules
  4. The CI pipeline uses the same S3 state backend and KMS secrets provider configured in Phase 2
**Plans**: TBD

Plans:
- [ ] 08-01: Build GitHub Actions workflow for pulumi preview on PR
- [ ] 08-02: Build GitHub Actions workflow for pulumi up on merge
- [ ] 08-03: Create CrossGuard policy pack and integrate into pipeline

### Phase 9: Lifecycle Integration
**Goal**: Tenant creation through the existing TenantLifecycleService triggers infrastructure provisioning, and the process is idempotent
**Depends on**: Phase 6, Phase 8
**Requirements**: LIFE-01, LIFE-02
**Success Criteria** (what must be TRUE):
  1. Creating a tenant through TenantLifecycleService triggers infrastructure provisioning for that tenant's K8s resources
  2. Running the provisioning workflow twice for the same tenant produces no errors and no duplicate resources -- second run is a no-op
  3. The integration between TenantLifecycleService and infrastructure provisioning is observable in audit logs
**Plans**: TBD

Plans:
- [ ] 09-01: Connect TenantLifecycleService to infrastructure provisioning
- [ ] 09-02: Validate and enforce idempotent provisioning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
Note: Phases 2 and 3 both depend only on Phase 1 (can execute in parallel if desired). Phase 6 depends on both 4 and 5. Phase 8 depends on both 2 and 7.

| Phase                     | Plans Complete | Status      | Completed  |
| ------------------------- | -------------- | ----------- | ---------- |
| 1. Foundation Hardening   | 2/2            | ✓ Complete  | 2026-02-13 |
| 2. State Backend          | 0/1            | Not started | -          |
| 3. Shared Config Schema   | 0/3            | Not started | -          |
| 4. Cluster Tooling        | 0/3            | Not started | -          |
| 5. Tenant Factory Core    | 0/3            | Not started | -          |
| 6. Tenant Resources       | 0/4            | Not started | -          |
| 7. Infrastructure Testing | 0/2            | Not started | -          |
| 8. CI/CD Pipeline         | 0/3            | Not started | -          |
| 9. Lifecycle Integration  | 0/2            | Not started | -          |
