---
name: parallel-dispatch
type: simple
depth: base
context: fork
user-invocable: false
description: >-
  Orchestrates concurrent workstreams via Task tool for non-trivial requests.
  Decomposes complex tasks into 3-10 parallel agents with independent scopes
  and synthesizes results. Use when requests involve: (1) multiple investigative
  paths or validation layers, (2) research, analysis, or debugging exceeding
  trivial scope, (3) implementation planning requiring facet exploration, or
  (4) any moderate+ complexity task benefiting from parallel execution.
---

# [H1][PARALLEL-DISPATCH]
>**Dictum:** *Decomposition into concurrent workstreams multiplies throughput on non-trivial tasks.*

<br>

Orchestrate parallel agents via Task tool.

**Workflow:**
1. §DECISION — Gate: trivial? decomposable? independent?
2. §DECOMPOSITION — Extract facets, map to agents
3. §AGENT_PROMPT — Structure scope, objective, output, context
4. §DISPATCH — Launch ALL agents in ONE message
5. §SYNTHESIS — Integrate convergent, flag divergent

**Exclude:** Trivial requests, sequential dependencies, overlapping writes, <3 streams.

[CRITICAL] Dispatch ALL agents in ONE message. Multiple messages execute sequentially—defeats parallelism.

---
## [1][DECISION]
>**Dictum:** *Binary gates prevent wasted computation on mismatched patterns.*

<br>

```text
Request received
    ↓
Trivial? (single lookup, direct action)
    ├─ YES → Execute directly
    └─ NO → Decomposable into independent facets?
              ├─ NO → Execute sequentially
              └─ YES → Verify independence → Dispatch parallel
```

[VERIFY] Independence confirmed:
- [ ] Workstreams share no mutable state
- [ ] No stream depends on another's output
- [ ] Results synthesize without conflict

[CRITICAL] Gate failure → sequential execution required.

---
## [2][DECOMPOSITION]
>**Dictum:** *Facet isolation enables contention-free parallel execution.*

<br>

Extract facets via criteria:
- *Independent questions* — Resolve distinct aspects of request
- *Parallel paths* — Accelerate via concurrency
- *Validation layers* — Strengthen confidence through cross-verification
- *Multiple perspectives* — Apply sources independently

**Agent Count:**
- Moderate tasks: 3-5 agents
- Complex tasks: 6-10 agents

[IMPORTANT]:
- [ALWAYS] Map extracted facets to agent assignments.
- [NEVER] Decompose by arbitrary boundaries.
- [NEVER] Create overlapping investigation scope.
- [NEVER] Dispatch single-agent workloads as parallel.

---
## [3][AGENT_PROMPT]
>**Dictum:** *Precise scope prevents overlap and enables conflict-free synthesis.*

<br>

Structure each agent prompt:

```
Scope: [Specific facet—included and excluded elements]
Objective: [Concrete deliverable for this agent]
Output: [Structured format for synthesis]
Context: [Relevant background—agents execute statelessly]
```

[IMPORTANT]:
- [ALWAYS] Define scope boundaries explicitly—agents receive explicit limits only.
- [ALWAYS] Specify output structure for synthesis.
- [ALWAYS] Include sufficient context—no cross-agent communication.
- [NEVER] Reference other agents or outputs.
- [NEVER] Assume shared context between agents.

---
## [4][DISPATCH]
>**Dictum:** *Single-message dispatch prevents sequential bottleneck.*

<br>

[CRITICAL] Dispatch ALL agents in ONE message block:

```text
Task("Agent A: [scope, objective, output format]", subagent_type="Explore")
Task("Agent B: [scope, objective, output format]", subagent_type="Explore")
Task("Agent C: [scope, objective, output format]", subagent_type="general-purpose")
Task("Agent D: [scope, objective, output format]", run_in_background=true)
```

[IMPORTANT]:
- [ALWAYS] Include complete context per agent—stateless execution.
- [ALWAYS] Specify `subagent_type` for optimal agent selection.
- [ALWAYS] Use `run_in_background=true` for long-running tasks.
- [NEVER] Chain agent outputs—parallel means independent.

---
## [5][SYNTHESIS]
>**Dictum:** *Integration confirms orthogonality and prevents partial results.*

<br>

Synthesize post-dispatch:
- *Convergent findings* → High confidence; integrate directly.
- *Divergent findings* → Flag uncertainty; present alternatives or request resolution.

[CRITICAL] Conflict detected → Decomposition violated orthogonality. Retry sequentially.

[IMPORTANT]:
- [ALWAYS] Verify all agents returned before synthesis.
- [ALWAYS] Flag divergent findings explicitly.

---
## [6][VALIDATION]
>**Dictum:** *Gates prevent incomplete execution.*

<br>

[VERIFY] Completion:
- [ ] Decision: Independence gates passed (no shared state, no dependencies).
- [ ] Decomposition: 3-10 facets mapped to agents.
- [ ] Prompts: Scope, objective, output, context defined per agent.
- [ ] Dispatch: ALL agents sent in ONE message block.
- [ ] Synthesis: Convergent integrated, divergent flagged.
