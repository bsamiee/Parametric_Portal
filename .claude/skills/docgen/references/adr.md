# [H1][ADR]
>**Dictum:** *ADR generation encodes the decision process, not the decision announcement.*

<br>

Generation-specific instructions for creating Architecture Decision Records. Canonical structure defined in `docs/standards/adr-standards.md` — this reference covers operational workflow and content generation.

---
## [1][CREATION_WORKFLOW]
>**Dictum:** *Decisions emerge from forces, not preferences.*

<br>

1. **Identify the decision:** Name the architectural choice as a noun phrase. If the decision cannot be named as a noun phrase, it may not be architectural.
2. **Enumerate forces:** List technical constraints, business requirements, team capabilities, and timeline pressures. Rank by impact.
3. **Generate options:** Minimum 2 options. "Do nothing" is valid when the status quo is functional. Each option gets pros/cons/neutral analysis.
4. **Map drivers to outcome:** The chosen option must reference specific drivers that justify it. If no driver supports the choice, the reasoning is incomplete.
5. **Document consequences:** All three categories (positive, negative, neutral) are mandatory. Omitting negative consequences is the most common ADR failure — address this proactively.

---
## [2][CONTENT_GENERATION]
>**Dictum:** *Each section has a specific information type — no bleeding.*

<br>

### [2.1][CONTEXT]

Write bullet-point facts. Each bullet is independently verifiable. Explicitly label unknowns with `Unknown:` prefix.

**Example context bullets:**
- `Current authentication uses session cookies with 24-hour expiry.` — measurable fact.
- `Mobile clients require stateless authentication — cookies not viable.` — constraint.
- `Team has production experience with JWT via jose library.` — team capability.
- `Unknown: whether token refresh latency impacts UX on slow networks.` — labeled unknown.

[CRITICAL]:
- [NEVER] Write narrative history ("We started by...", "The team discussed...").
- [NEVER] Include opinions or preferences — context states forces, not positions.

### [2.2][DECISION_DRIVERS]

Ranked list. Each driver is a named force with measurable direction.

**Example drivers:**
1. **Stateless mobile support** — mobile clients cannot maintain session state.
2. **Operational simplicity** — team has existing JWT operational runbooks.
3. **Token revocation** — ability to invalidate compromised tokens before expiry.
4. **Migration cost** — existing session-based auth serves 200+ API routes.

[IMPORTANT]:
1. [ALWAYS] **Rank by impact:** Highest-impact driver first.
2. [ALWAYS] **Measurable direction:** Each driver states what it pushes toward or away from.

### [2.3][CONSIDERED_OPTIONS]

Per option: one-paragraph description, then structured pros/cons/neutral. Every pro/con must reference a specific Driver by name.

**Example option structure:**

**Option A: JWT with Refresh Tokens** — Short-lived access tokens (15min) with long-lived refresh tokens (30 days). Pros: Stateless validation, mobile-native, no server-side session storage (addresses Driver 1). Cons: Token revocation requires blocklist check on every request, adding latency (tension with Driver 3). Neutral: Migration effort is incremental.

**Option B: Maintain Session Cookies + Mobile API Keys** — Existing session auth for web; separate API key system for mobile. Pros: Zero migration for web clients (addresses Driver 4). Cons: Two auth systems to maintain, audit, and secure (conflicts with Driver 2). Neutral: API keys are familiar to mobile team.

### [2.4][DECISION_OUTCOME_AND_CONSEQUENCES]

Reference specific drivers by name. Negative consequences require mitigation strategies.

**Example outcome:** Chosen **Option A: JWT with Refresh Tokens**. Justification: Directly addresses **stateless mobile support** (Driver 1) and **operational simplicity** (Driver 2). Token revocation concern (Driver 3) mitigated by Redis-backed blocklist with TTL matching access token expiry.

**Consequence mitigation format:** Each negative consequence follows the pattern: `Risk statement. Mitigation: specific action to reduce impact.`

- Positive: Mobile clients authenticate without server-side session state. Single auth system for all client types.
- Negative: Redis dependency added for token blocklist. Mitigation: Redis is already in the stack for caching; blocklist TTL matches access token expiry, bounding storage.
- Negative: Refresh token theft window is 30 days vs 24-hour session window. Mitigation: Refresh token rotation on each use; compromised token invalidated on first reuse.
- Neutral: Migration period (~3 months) where both session and JWT auth are active.

---
## [3][DECISION_TYPE_GUIDANCE]
>**Dictum:** *Type determines which evaluation criteria are mandatory.*

<br>

Each decision type requires specific evaluation criteria in the Considered Options analysis. Omitting a mandatory criterion for the decision type invalidates the option comparison.

**Technology Selection** — License compatibility (SPDX identifier, copyleft risk), community activity (commit frequency, issue response time, bus factor), migration path (data format changes, API surface delta, rollback feasibility), ecosystem integration (existing toolchain compatibility).<br>
**Architecture Pattern** — Coupling impact (dependency count change, interface surface), testability change (isolation cost, mock complexity), performance delta (latency, throughput, resource consumption), operational complexity (deployment topology, monitoring requirements).<br>
**Process Change** — Team velocity impact (estimated throughput change), onboarding friction (ramp-up time for new contributors), rollback plan (revert to previous process without data loss), compliance alignment (audit trail, approval workflows).<br>
**Security Boundary** — Threat model coverage (STRIDE categories addressed), compliance requirements (SOC2, GDPR, HIPAA applicability), audit trail (logging granularity, retention), blast radius (scope of compromise if boundary fails).<br>
**Infrastructure** — Cost projection (monthly/annual at current and 10x scale), scaling model (horizontal/vertical limits, bottleneck identification), failure modes (single points of failure, degradation behavior), blast radius (impact scope of infrastructure failure).

[IMPORTANT]:
1. [ALWAYS] **Type identification:** Determine decision type before generating options — it constrains the evaluation criteria.
2. [ALWAYS] **Criteria coverage:** Each Considered Option must address every mandatory criterion for its decision type.

---
## [4][NUMBERING_AND_FILING]
>**Dictum:** *ADR location and numbering are deterministic.*

<br>

- Location: `docs/decisions/ADR-NNNN-<kebab-case-title>.md`
- Numbering: sequential four-digit starting at `0001`. Query existing ADRs to determine next number.
- Index: maintain `docs/decisions/README.md` listing all ADRs with title, status, and date.

### [4.1][INDEX_ENTRY_FORMAT]

The ADR index is a markdown table with four columns:

| [INDEX] | [COLUMN]   | [CONTENT]                                  |
| :-----: | ---------- | ------------------------------------------ |
|   [1]   | **ADR**    | Relative link: `[ADR-NNNN](./ADR-NNNN-title.md)` |
|   [2]   | **Title**  | Decision title as noun phrase              |
|   [3]   | **Status** | Current status (Accepted, Proposed, etc.)  |
|   [4]   | **Date**   | ISO 8601 date of last status change        |

---
## [5][SUPERSESSION_MECHANICS]
>**Dictum:** *Supersession preserves history while redirecting authority.*

<br>

When a decision is replaced:
1. Create new ADR with full MADR structure.
2. Add to new ADR Context: `Supersedes [ADR-NNNN](./ADR-NNNN-title.md)`.
3. Update original ADR Status: `Superseded by [ADR-MMMM](./ADR-MMMM-title.md)`.
4. Original ADR content is never modified beyond the Status line.
5. Update index to reflect both status changes.
