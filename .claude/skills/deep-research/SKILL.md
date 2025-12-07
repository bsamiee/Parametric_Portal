---
name: deep-research
type: simple
depth: extended
description: >-
  Orchestrates two-round parallel agent research for comprehensive topic exploration.
  Use when conducting research, exploring complex topics, gathering multi-faceted
  information, or synthesizing findings from parallel investigation streams.
---

# [H1][DEEP-RESEARCH]
>**Dictum:** *Iterative dispatch with inter-round critique maximizes research coverage.*

<br>

Two-round research: breadth (Round 1) → critique → depth (Round 2) → synthesize.

**Input:**<br>
- `Topic`: Domain to research.
- `Constraints`: Context, scaffold, style. Optional `AgentCount` overrides defaults.

[REFERENCE]: [→parallel-dispatch](../parallel-dispatch/SKILL.md) — Dispatch mechanics, agent prompt structure, synthesis.

**Agents:**<br>
- [→research-explorer](../../agents/research-explorer.md) — Discovery (scope parameter).
- [→research-validator](../../agents/research-validator.md) — Verification (claims parameter).
- [→research-critic](../../agents/research-critic.md) — Adversarial (mode parameter).

---
## [1][WORKFLOW]
>**Dictum:** *Two-round execution ensures breadth then depth.*

<br>

```mermaid
%%{ init: { 'flowchart': { 'curve': 'stepBefore' } } }%%
flowchart LR
    T((Topic)) --> O[ORIENT]
    O --> R1[ROUND_1]:::ref
    R1 --> C1[CRITIQUE]
    C1 --> R2[ROUND_2]:::ref
    R2 --> C2[CRITIQUE]
    C2 --> S[SYNTHESIZE]:::state
    classDef input fill:#50fa7b,stroke:#44475a,stroke-width:2px,color:#282a36
    classDef action fill:#8be9fd,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef ref fill:#ffb86c,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef state fill:#bd93f9,stroke:#44475a,stroke-width:1px,color:#282a36
    class T input
    class O,C1,C2 action
```

---
## [2][ORIENT]
>**Dictum:** *Initial queries establish decomposition boundaries.*

<br>

Main agent executes 2-3 MCP queries to map landscape before dispatch.

**Deliverable:** Facet list for agent assignment per `parallel-dispatch` §3.

[IMPORTANT]:
- [ALWAYS] Extract facet boundaries from results.
- [NEVER] Dispatch before orient phase.

---
## [3][ROUND_1]
>**Dictum:** *Breadth via parallel explorer dispatch.*

<br>

Dispatch agents per `parallel-dispatch` §5. Each agent receives unique scope.

| [AGENT]  | [PARAM]                                                          | [DEFAULT] |
| -------- | ---------------------------------------------------------------- | :-------: |
| explorer | scope: core/adjacent/emerging/tooling/academic/practical/[facet] |     8     |
| critic   | mode: anti-pattern/contrarian                                    |     2     |

[IMPORTANT] `Constraints.AgentCount` overrides defaults when provided by invoker.

[CRITICAL] Round 1 = BREADTH. Agents select MCP tools internally per scope.

---
## [4][CRITIQUE]
>**Dictum:** *Critique filters breadth into focused depth targets.*

<br>

### [4.1][FILTER]

| [REMOVE]     | [CRITERIA]                 |
| ------------ | -------------------------- |
| Tangential   | Off-topic, scope drift     |
| Redundant    | Duplicates across agents   |
| Unverifiable | No source attribution      |
| Outdated     | Pre-2024 when newer exists |

### [4.2][MANIFEST]

```
Retained: [count] / [total] (filtered [removed])
Gaps: [missing facets]
Validation: [claims needing verification]
Deep-Dive: [themes for round 2]
High-Confidence: [convergent—skip round 2]
Conflicts: [divergences to resolve]
```

[CRITICAL] Manifest scopes round 2 dispatch.

---
## [5][ROUND_2]
>**Dictum:** *Surgical dispatch addresses first-round gaps.*

<br>

Dispatch agents per manifest priorities (default 4-6, override via `Constraints.AgentCount`):

| [SIGNAL]   | [AGENT]   | [PARAM]            |
| ---------- | --------- | ------------------ |
| Gap        | explorer  | scope: [facet]     |
| Quality    | validator | claims: [list]     |
| Branch     | explorer  | scope: [theme]     |
| Divergence | validator | claims: [conflict] |
| Weakness   | critic    | mode: edge-case    |

Extend agent prompt with Prior field per `parallel-dispatch` §4:

```
Prior: [Round 1 findings—build on, don't repeat]
```

[CRITICAL] Round 2 = DEPTH. Agents select MCP tools internally per type.

---
## [6][SYNTHESIZE]
>**Dictum:** *Structure enables downstream integration.*

<br>

Apply `parallel-dispatch` §6 convergent/divergent handling.

**Output Format:** @.claude/styles/report.md

**Domain Variables:**<br>
- `domain-1`: CORE_FINDINGS
- `domain-2`: VALIDATED
- `domain-3`: EMERGING
- `domain-4`: LIMITATIONS

---
## [7][VALIDATION]
>**Dictum:** *Gates prevent incomplete synthesis.*

<br>

[VERIFY]:
- [ ] Orient executed before dispatch.
- [ ] Round 1 dispatched agents per constraints.
- [ ] First critique produced manifest.
- [ ] Round 2 addressed manifest priorities.
- [ ] Second critique completed.
- [ ] Synthesis follows report.md format.
