# [H1][ADR_TEMPLATE]
>**Dictum:** *ADR scaffolding enforces decision structure, not decision content.*

<br>

Produces one Architecture Decision Record in MADR format. Status transitions and content discipline defined in `adr.md`. Canonical structure defined in `docs/standards/adr-standards.md`.

**Density:** ADRs target 60-150 lines. Below 60 signals missing consequences or evaluation; above 150 signals scope creep into design documentation.<br>
**References:** `adr.md` (generation workflow, status transitions, evaluation criteria), `adr-standards.md` (format, decision types, lifecycle), `validation.md` §2 (compliance checklist), `patterns.md` [3] (WALL_OF_TEXT_ADR).<br>
**Workflow:** Fill placeholders, remove guidance comments, verify minimum 2 options evaluated, validate against `validation.md` §2.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]        | [EXAMPLE]                                      |
| :-----: | -------------------- | ---------------------------------------------- |
|   [1]   | `${SequenceNumber}`  | `0012`                                         |
|   [2]   | `${DecisionTitle}`   | `JWT-Based Authentication`                     |
|   [3]   | `${Status}`          | `Proposed`                                     |
|   [4]   | `${ContextFact1}`    | `Current session auth adds 200ms per request.` |
|   [5]   | `${ContextFact2}`    | `Mobile clients require stateless tokens.`     |
|   [6]   | `${Driver1Name}`     | `Latency reduction`                            |
|   [7]   | `${Driver1Desc}`     | `Sub-50ms auth verification per request.`      |
|   [8]   | `${Driver2Name}`     | `Stateless scalability`                        |
|   [9]   | `${Driver2Desc}`     | `Horizontal scaling without session affinity.` |
|  [10]   | `${OptionAName}`     | `JWT with RS256`                               |
|  [11]   | `${OptionBName}`     | `Session cookies with Redis`                   |
|  [12]   | `${ChosenOption}`    | `Option A: JWT with RS256`                     |
|  [13]   | `${Justification}`   | `Satisfies Driver 1 and Driver 2.`             |
|  [14]   | `${PositiveOutcome}`| `Auth verification reduced to <5ms.`           |
|  [15]   | `${NegativeOutcome}` | `Token revocation requires blocklist service.` |
|  [16]   | `${NeutralOutcome}`  | `Token payload size increases by ~400 bytes.`  |

---
# ADR-${SequenceNumber}: ${DecisionTitle}

## Status

<!-- Exactly one of: Proposed | Accepted | Deprecated | Superseded by [ADR-MMMM](./ADR-MMMM-title.md) -->

${Status}

## Context

<!-- Bullet-point facts. Each independently verifiable. No narrative history. -->
<!-- Label unknowns explicitly with "Unknown:" prefix. -->

- ${ContextFact1}
- ${ContextFact2}
- <!-- Additional facts as needed. -->

## Decision Drivers

<!-- Ranked by impact. Each driver is a named force with measurable direction. -->

1. **${Driver1Name}** — ${Driver1Desc}
2. **${Driver2Name}** — ${Driver2Desc}

## Considered Options

<!-- Minimum 2 options required. Include "Do nothing" when status quo is viable. -->

### Option A: ${OptionAName}

<!-- One-paragraph description of the approach. -->

- **Pros:** <!-- Advantages mapped to specific drivers. -->
- **Cons:** <!-- Disadvantages mapped to specific drivers. -->
- **Neutral:** <!-- Implications neither advantageous nor disadvantageous. -->

### Option B: ${OptionBName}

<!-- One-paragraph description of the approach. -->

- **Pros:** <!-- Advantages mapped to specific drivers. -->
- **Cons:** <!-- Disadvantages mapped to specific drivers. -->
- **Neutral:** <!-- Implications neither advantageous nor disadvantageous. -->

## Decision Outcome

Chosen: **${ChosenOption}**

Justification: ${Justification}

<!-- Reference specific drivers by name. Map chosen option advantages to each driver. -->

## Consequences

**Positive:**
- ${PositiveOutcome}

**Negative:**
- ${NegativeOutcome}

<!-- Negative consequences MUST include mitigation strategy. -->
<!-- Format: "Risk. Mitigation: specific action to reduce impact." -->

**Neutral:**
- ${NeutralOutcome}

---
**Guidance**

*Context as Facts* — Each context bullet must be independently verifiable: a measurement, a constraint, a business requirement, or an explicitly labeled unknown. Narrative history ("We started by...", "The team discussed...") triggers WALL_OF_TEXT_ADR (patterns.md [3]). Context answers "What is true right now?" not "How did we get here?".<br>
*Driver-Option Mapping* — Every pro and con in Considered Options must reference a specific Decision Driver by name. Unanchored evaluations ("this is simpler") lack traceability. The Decision Outcome justification must demonstrate that the chosen option satisfies the highest-ranked drivers.<br>
*Negative Consequence Honesty* — Omitting or minimizing negative consequences invalidates the decision record. Each negative outcome includes a mitigation strategy: the specific action, timeline, or architectural guard that reduces its impact. "No significant downsides" is almost always a documentation failure, not an engineering truth.

---
**Post-Scaffold Checklist**

- [ ] All `${...}` placeholders replaced with decision-specific values
- [ ] Status is exactly one of: Proposed, Accepted, Deprecated, Superseded
- [ ] Context contains only verifiable facts — no narrative history
- [ ] Decision Drivers ranked by impact with measurable direction
- [ ] Minimum 2 Considered Options evaluated
- [ ] "Do nothing" evaluated when status quo is viable
- [ ] Each pro/con references a specific Driver by name
- [ ] Consequences include all three categories: Positive, Negative, Neutral
- [ ] Negative consequences include mitigation strategies
- [ ] Supersession backlinks are bidirectional (old → new, new → old)
