---
description: Structural specification for Architecture Decision Records
---

# [H1][ADR-STANDARDS]
>**Dictum:** *Decisions decay without records; records decay without structure.*

<br>

[CRITICAL] ADRs capture the reasoning behind architectural choices. The record survives longer than the author's memory.

---
## [1][FORMAT]
>**Dictum:** *MADR extends Nygard with evaluation rigor.*

<br>

Markdown Any Decision Record (MADR) structure. Seven sections in fixed order.

| [INDEX] | [SECTION]              | [REQUIRED] | [CONTENT]                                                 |
| :-----: | ---------------------- | :--------: | --------------------------------------------------------- |
|   [1]   | **Title**              |    Yes     | `# ADR-NNNN: <Noun Phrase>`. Sequential numbering.        |
|   [2]   | **Status**             |    Yes     | Exactly one: Proposed, Accepted, Deprecated, Superseded.  |
|   [3]   | **Context**            |    Yes     | Facts and forces. No narrative history.                   |
|   [4]   | **Decision Drivers**   |    Yes     | Ranked list of forces influencing the decision.           |
|   [5]   | **Considered Options** |    Yes     | Minimum 2 options. Each with pros, cons, neutral impacts. |
|   [6]   | **Decision Outcome**   |    Yes     | Chosen option with justification linked to drivers.       |
|   [7]   | **Consequences**       |    Yes     | Positive, negative, neutral — all explicit. No omissions. |

### [1.1][NUMBERING]

Sequential four-digit: `ADR-0001`, `ADR-0002`. Gaps permitted (deleted ADRs leave gaps). Numbers never reused.

### [1.2][STATUS_TAXONOMY]

| [INDEX] | [STATUS]       | [MEANING]                                   | [TRANSITION_TO]        |
| :-----: | -------------- | ------------------------------------------- | ---------------------- |
|   [1]   | **Proposed**   | Under review. Not yet binding.              | Accepted, Rejected     |
|   [2]   | **Accepted**   | Binding. Implementation may proceed.        | Deprecated, Superseded |
|   [3]   | **Deprecated** | No longer applicable. Context changed.      | —                      |
|   [4]   | **Superseded** | Replaced by newer ADR. Backlink required.   | —                      |
|   [5]   | **Rejected**   | Reviewed and declined. Reasoning preserved. | —                      |

[IMPORTANT]:
1. [ALWAYS] **Supersession backlink:** `Superseded by [ADR-NNNN](./ADR-NNNN.md)` in Status section.
2. [ALWAYS] **Forward link:** Superseding ADR references predecessor: `Supersedes [ADR-NNNN](./ADR-NNNN.md)`.

---
## [2][DECISION_TYPES]
>**Dictum:** *Type determines evaluation criteria.*

<br>

| [INDEX] | [TYPE]                   | [EVALUATION_CRITERIA]                                           | [RISK_DIMENSIONS]                    |
| :-----: | ------------------------ | --------------------------------------------------------------- | ------------------------------------ |
|   [1]   | **Technology Selection** | Maturity, community, license, integration cost, migration path  | Vendor lock-in, EOL risk, skill gap  |
|   [2]   | **Architecture Pattern** | Coupling reduction, testability, performance impact, complexity | Over-engineering, under-engineering  |
|   [3]   | **Process Change**       | Team velocity impact, onboarding friction, rollback feasibility | Adoption resistance, tooling cost    |
|   [4]   | **Security Boundary**    | Threat model coverage, compliance impact, audit trail           | False sense of security, performance |
|   [5]   | **Infrastructure**       | Operational cost, scaling model, failure modes, observability   | Blast radius, recovery time          |

---
## [3][CONTENT_DISCIPLINE]
>**Dictum:** *Facts over narrative; forces over opinions.*

<br>

### [3.1][CONTEXT]

State current facts. Describe constraints. Identify unknowns explicitly. No chronological narrative — the reader needs the situation, not the story.

[IMPORTANT]:
1. [ALWAYS] **Bullet-point facts:** Each fact is independently verifiable.
2. [ALWAYS] **Explicit unknowns:** `Unknown: <what we don't know and why it matters>`.

[CRITICAL]:
- [NEVER] History narration: "First we tried X, then Y happened..."
- [NEVER] Opinion framing: "We believe...", "It seems..."

### [3.2][DECISION_DRIVERS]

Ranked by impact. Each driver is a force (technical constraint, business requirement, team capability, timeline) that pushes toward or against options.

### [3.3][CONSIDERED_OPTIONS]

Minimum 2 options. "Do nothing" is a valid option when applicable. Per option:
- One-paragraph description of the approach.
- Pros: concrete benefits (measurable where possible).
- Cons: concrete costs (measurable where possible).
- Neutral: trade-offs that are neither clearly positive nor negative.

### [3.4][CONSEQUENCES]

Three categories — all required: `Positive:`, `Negative:`, `Neutral:`.

[IMPORTANT]:
1. [ALWAYS] **Mitigation for negatives:** Each negative consequence includes a mitigation strategy — the specific action, timeline, or architectural guard that reduces impact.
2. [ALWAYS] **Measurable where possible:** Consequences state observable outcomes, not vague concerns.

[CRITICAL]:
- [NEVER] Omit negative consequences — this is the most common ADR failure. Every architectural choice has trade-offs.
- [NEVER] State "no significant downsides" — this signals incomplete analysis, not a superior option.

---
## [4][LIFECYCLE]
>**Dictum:** *Records evolve; decisions do not retroactively change.*

<br>

### [4.1][AMENDMENT_VS_NEW]

| [INDEX] | [CONDITION]                           | [ACTION]                                         |
| :-----: | ------------------------------------- | ------------------------------------------------ |
|   [1]   | Minor clarification, typo fix         | Amend existing ADR. Note amendment date.         |
|   [2]   | Context changed, decision still holds | Amend Context section. Note amendment rationale. |
|   [3]   | Decision no longer appropriate        | New ADR superseding the original.                |
|   [4]   | Decision reversed                     | New ADR. Original marked Superseded.             |

### [4.2][STALENESS_DETECTION]

An ADR is stale when:
- The technology it selects is no longer in the dependency graph.
- The constraint it addresses no longer exists.
- 3+ engineers cannot explain why the decision was made.

Stale ADRs transition to Deprecated with a note explaining why.

---
## [5][VALIDATION]
>**Dictum:** *Gates prevent incomplete decision records.*

<br>

[VERIFY] Completion:
- [ ] Title follows `ADR-NNNN: <Noun Phrase>` format.
- [ ] Status is exactly one of: Proposed, Accepted, Deprecated, Superseded, Rejected.
- [ ] Context contains facts only — no narrative history, no opinion framing.
- [ ] Decision Drivers are ranked by impact.
- [ ] Minimum 2 Considered Options with pros/cons/neutral.
- [ ] Decision Outcome references specific drivers that justify selection.
- [ ] Consequences section has all three categories (Positive, Negative, Neutral).
- [ ] Negative consequences include mitigation strategies.
- [ ] Supersession backlinks are bidirectional.
