---
phase: 03-schema-redesign-and-topology
verified: 2026-02-23T14:30:00Z
status: passed
score: 10/10 must-haves verified
re_verification: true
gaps:
  - truth: "packages/types/vite.config.ts does not reference the deleted kargadan-schemas.ts as a build entry"
    status: resolved
    reason: "Fixed in commit 18b5306 — removed stale kargadan build entry from packages/types/vite.config.ts. @parametric-portal/types:build now passes."
---

# Phase 3: Schema Redesign and Topology Verification Report

**Phase Goal:** Monorepo topology is clean — universal concepts live in packages/, app-specific protocol lives in apps/kargadan, and public API surface is minimal
**Verified:** 2026-02-23T14:30:00Z
**Status:** passed
**Re-verification:** Yes — gap resolved in commit 18b5306

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `packages/types/src/kargadan/kargadan-schemas.ts` does not exist | VERIFIED | `test ! -f` confirms deletion; commit e1e338d removed the 227-LOC barrel |
| 2  | `packages/types/package.json` has no `./kargadan` export entry | VERIFIED | File confirmed: only `async`, `app-error`, `files`, `icons`, `svg`, `types`, `ui` entries remain |
| 3  | `apps/kargadan/harness/vite.config.ts` does not reference `@parametric-portal/types` in externals | VERIFIED | `external: []` confirmed at line 13 |
| 4  | `packages/types/vite.config.ts` does not reference the deleted `kargadan-schemas.ts` as a build entry | VERIFIED | Stale entry removed in commit 18b5306; `@parametric-portal/types:build` passes |
| 5  | `protocol/schemas.ts` contains all 12 protocol schema definitions | VERIFIED | grep confirms all 12: TelemetryContext, EnvelopeIdentity, FailureReason, Idempotency, HandshakeEnvelope, CommandEnvelope, ResultEnvelope, EventEnvelope, HeartbeatEnvelope, CommandAck, InboundEnvelope, OutboundEnvelope |
| 6  | `checkpoint.ts` contains all 3 persistence schema definitions | VERIFIED | grep confirms RunEventSchema, RunSnapshotSchema, RetrievalArtifactSchema defined at lines 26-61 |
| 7  | `checkpoint.ts` imports `TelemetryContextSchema` from `../protocol/schemas` as its only cross-file schema dependency | VERIFIED | Line 7: `import { TelemetryContextSchema } from '../protocol/schemas'`; no other schema imports |
| 8  | Zero `Kargadan` namespace references remain in `apps/kargadan/harness/src/` | VERIFIED | grep returns only legitimate class name uses (`KargadanSocketClient`) and doc-comment mentions — no `Kargadan.X` namespace member access anywhere |
| 9  | Zero `@parametric-portal/types/kargadan` imports remain in codebase | VERIFIED | grep returns zero results across entire codebase |
| 10 | `pnpm exec nx run kargadan-harness:typecheck` passes with zero errors | VERIFIED | Nx confirms successful typecheck (cache hit on passing result) |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/kargadan/harness/src/protocol/schemas.ts` | 12 protocol schemas — pure leaf module, zero service dependencies | VERIFIED | 117 LOC; imports only `effect`; exports all 12 schemas explicitly; all literal types inlined into parent S.Struct |
| `apps/kargadan/harness/src/protocol/dispatch.ts` | Protocol dispatch service importing from schemas.ts, re-exporting all schemas | VERIFIED | 186 LOC; imports 11 schemas from `./schemas`; re-exports all 14 names at bottom; uses `typeof XSchema.Type` throughout |
| `apps/kargadan/harness/src/persistence/checkpoint.ts` | Persistence service with 3 private schemas + TelemetryContextSchema cross-import | VERIFIED | 169 LOC; 3 schemas defined (RunEvent, RunSnapshot, RetrievalArtifact); not exported; TelemetryContextSchema imported from `../protocol/schemas` |
| `apps/kargadan/harness/src/socket.ts` | Socket handler importing from schemas.ts | VERIFIED | 173 LOC; imports `InboundEnvelopeSchema`, `OutboundEnvelopeSchema`, `type EventEnvelopeSchema` from `./protocol/schemas`; uses Extract narrowing for _request |
| `apps/kargadan/harness/src/config.ts` | Config using field access pattern from schemas.ts | VERIFIED | 108 LOC; imports `CommandEnvelopeSchema`, `EnvelopeIdentitySchema` from `./protocol/schemas`; uses `.fields.protocolVersion` (line 46) and `.fields.operation` (line 64) |
| `apps/kargadan/harness/src/runtime/agent-loop.ts` | Agent loop using `typeof XSchema.Type` from schemas.ts | VERIFIED | 208 LOC; `import type` from `../protocol/schemas`; all 6 schema types derived via `typeof XSchema.Type`; `satisfies typeof XSchema.Type` at construction sites |
| `packages/types/vite.config.ts` | Should not reference deleted kargadan-schemas.ts | VERIFIED | Stale entry removed in commit 18b5306; `@parametric-portal/types:build` passes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `socket.ts` | `protocol/schemas.ts` | `import { InboundEnvelopeSchema, OutboundEnvelopeSchema }` | WIRED | Line 10: `import { type EventEnvelopeSchema, InboundEnvelopeSchema, OutboundEnvelopeSchema } from './protocol/schemas'`; both schemas used for encode/decode |
| `config.ts` | `protocol/schemas.ts` | `import { CommandEnvelopeSchema, EnvelopeIdentitySchema }` + `.fields` access | WIRED | Line 6; `.fields.protocolVersion` at line 46; `.fields.operation` at line 64 |
| `agent-loop.ts` | `protocol/schemas.ts` | `import type { ... }` for 6 schema types | WIRED | Lines 3-5; `typeof XSchema.Type` used across 9 type annotation sites; `satisfies typeof XSchema.Type` at 3 construction sites |
| `checkpoint.ts` | `protocol/schemas.ts` | `import { TelemetryContextSchema }` | WIRED | Line 7; TelemetryContextSchema used in RunEventSchema.telemetryContext field at line 40 |
| `dispatch.ts` | `protocol/schemas.ts` | `import { CommandAckSchema, CommandEnvelopeSchema, ... }` (11 schemas) | WIRED | Lines 9-12; all 11 schemas actively used in service implementation |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SCHM-01 | 03-01-PLAN | Delete kargadan-schemas.ts and rebuild app-specific schemas in apps/kargadan | SATISFIED | File deleted (commit e1e338d); 15 canonical schemas rebuilt in schemas.ts + checkpoint.ts; REQUIREMENTS.md marked complete |
| SCHM-02 | 03-01-PLAN (deferred) | Universal concepts extracted to packages/ | DEFERRED (locked) | Explicitly deferred per user decision in PLAN frontmatter; REQUIREMENTS.md shows Pending; out-of-scope for this phase |
| SCHM-03 | 03-02-PLAN | apps/kargadan consumes packages/ai for all LLM — no duplicated AI orchestration logic outside app | SATISFIED | Research confirmed no schema changes needed (packages/ai is service-only, no app-side schema imports exist); harness package.json has no AI dependency because the harness itself is not AI-orchestration; REQUIREMENTS.md marked complete |
| SCHM-04 | 03-01-PLAN, 03-02-PLAN | One canonical schema per entity, pick/omit/partial at call site, no struct proliferation | SATISFIED | All 15 schemas are canonical; field access pattern (`CommandEnvelopeSchema.fields.operation`) used instead of standalone literal schemas; no module-level S.Literal schemas exist; REQUIREMENTS.md marked complete |
| SCHM-05 | 03-02-PLAN | Consistent field names between TS harness and C# plugin; mapping at boundary adapters only | SATISFIED | C# `ProtocolEnvelopes.cs` field names (`Identity`, `TelemetryContext`, `Idempotency`, `DeadlineMs`, `ObjectRefs`, `Operation`, `Payload`) match TS schema field names (`identity`, `telemetryContext`, `idempotency`, `deadlineMs`, `objectRefs`, `operation`, `payload`); CamelCase policy handles casing via JSON serializer; REQUIREMENTS.md marked complete |
| SCHM-06 | 03-01-PLAN | Internal logic private; minimal public API surface | SATISFIED | Persistence schemas (RunEvent, RunSnapshot, RetrievalArtifact) not exported from checkpoint.ts; 9 schemas exported from schemas.ts are all consumed by identified consumers; composition internal to services; REQUIREMENTS.md marked complete |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/types/vite.config.ts` | 19 | Stale entry reference to deleted file | Blocker | `@parametric-portal/types:build` fails with rollup entry resolution error; no other apps/packages depend on this build output currently but the packages/ build is broken |

No TODO/FIXME/placeholder comments found in any of the 6 modified source files. No empty implementations. No console.log-only stubs.

### Human Verification Required

None. All critical behaviors are mechanically verifiable via file existence, grep patterns, and typecheck output. The C# boundary field alignment (SCHM-05) was verified structurally against ProtocolEnvelopes.cs field names vs schemas.ts field names — runtime wire format depends on C# JsonSerializerOptions CamelCase policy which is out-of-scope for this verification.

### Gaps Summary

**One gap blocks a clean topology claim.**

The plan correctly removed the `./kargadan` export from `packages/types/package.json` and cleared `@parametric-portal/types` from `apps/kargadan/harness/vite.config.ts`. However, `packages/types/vite.config.ts` — which controls the library build of the types package — was not updated. Line 19 still declares `kargadan: './src/kargadan/kargadan-schemas.ts'` as a build entry point. Since that source file was deleted, running `@parametric-portal/types:build` fails immediately with a rollup entry resolution error.

This was not listed in `03-01-PLAN`'s `files_modified` frontmatter, which explains why it was missed. The plan's success criteria focused on the three cleanup targets (schema file, package.json exports, harness externals) and did not include the types package build config. The fix is a single-line deletion.

The fix is trivial: remove `kargadan: './src/kargadan/kargadan-schemas.ts',` from the `entry` object in `packages/types/vite.config.ts`.

---

_Verified: 2026-02-23T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
