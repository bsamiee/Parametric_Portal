# Parametric Portal Infrastructure

## What This Is

A pure-TypeScript infrastructure-as-code layer for a multi-tenant Nx monorepo, built on Pulumi and deeply integrated with the Effect ecosystem. One function call provisions an entire tenant stack — cluster, workloads, database, cache, DNS — driven by a shared config schema that both Pulumi and runtime consume. Targets self-hosted Kubernetes with GitHub Actions CI/CD.

## Core Value

A single polymorphic function call deploys a fully provisioned, production-ready tenant — zero manual wiring, zero YAML, zero indirection.

## Requirements

### Validated

- Existing `packages/server/` with Effect-based services (cache, auth, events, jobs, webhooks, cluster management)
- Existing `packages/database/` with Drizzle ORM, migrations, field system, search
- Existing `packages/ai/` with AI model registry and runtime
- Existing `apps/api/` with Hono routes, middleware, WebSocket support
- Effect service pattern established (Layer composition, tagged services, typed errors)
- Biome linting, Vitest testing, Nx orchestration already in place

### Active

- [ ] Shared tenant config schema consumed by both Pulumi IaC and app runtime
- [ ] Polymorphic resource factory — discriminated union input, `Match.type` dispatch to K8s resources
- [ ] Self-hosted Kubernetes cluster provisioning via Pulumi TypeScript
- [ ] Workload provisioning (Deployments, Services, Ingress, ConfigMaps, Secrets) via Pulumi TypeScript
- [ ] Unified config extraction from server/, database/, ai/ into the shared schema
- [ ] Single function call to provision complete tenant stack (DB, API, cache, DNS)
- [ ] GitHub Actions pipeline — merge triggers `pulumi up`, zero manual steps
- [ ] Multi-tenant isolation at the infrastructure level

### Out of Scope

- YAML manifests of any kind — pure TypeScript IaC only
- Wrapper functions, thin aliases, or indirection layers — direct Pulumi imports
- Structural refactoring of existing packages — config extraction only
- Managed K8s services (EKS/GKE/AKS) — self-hosted cluster target
- Frontend/UI deployment — backend infrastructure only for now

## Context

The monorepo has mature backend packages built incrementally over time. Each package (server, database, ai) has its own configuration story — environment variables, hardcoded defaults, scattered config objects. There is no unified config that ties them together, which means deploying a new tenant requires manually wiring dozens of pieces.

The existing code follows strict FP + Effect patterns: tagged services, Layer composition, typed errors, schema-first types, `Match.type` exhaustive dispatch. The infrastructure layer must match this standard — dense, polymorphic, Effect-native code. No type spam, no schema proliferation, no branded type explosion. Every line earns its place.

Pulumi was chosen because it enables pure TypeScript IaC — no HCL, no YAML, no DSL. Resources are real TypeScript objects composed with the same patterns as the rest of the codebase.

## Constraints

- **IaC Language**: Pulumi TypeScript only — no YAML, no Helm charts, no Terraform
- **Code Standard**: Must match packages/server/ quality — FP, Effect-native, ts-standards compliant
- **Polymorphism**: Variant-driven factories via discriminated unions and `Match.type` — not N separate resource files
- **No Proliferation**: Minimal types, schemas, branded types, constants — dense code, high logic density
- **Config Model**: One Effect schema shared between IaC provisioning and app runtime
- **Cluster**: Self-hosted Kubernetes (not managed cloud K8s)
- **CI/CD**: GitHub Actions triggering Pulumi — merge to main deploys
- **Monorepo**: Must integrate with existing Nx workspace, `pnpm` catalog, project graph

## Key Decisions

| Decision                        | Rationale                                                                  | Outcome    |
| ------------------------------- | -------------------------------------------------------------------------- | ---------- |
| Pulumi over Terraform/Helm      | Pure TypeScript, same ecosystem as codebase, real composition              | -- Pending |
| Shared Effect schema for config | Single source of truth eliminates config fragmentation across packages     | -- Pending |
| Variant-driven resource factory | One polymorphic function replaces N resource files — matches FP philosophy | -- Pending |
| Self-hosted K8s over managed    | Full control, cost efficiency at scale with hundreds of tenants            | -- Pending |
| GitHub Actions for CI/CD        | Already in ecosystem, native Pulumi integration available                  | -- Pending |

---
*Last updated: 2026-02-13 after initialization*
