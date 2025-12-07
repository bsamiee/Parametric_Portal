---
name: parallel-dispatch
type: simple
depth: base
description: Orchestrates concurrent workstreams via Task tool for non-trivial requests. Decomposes complex tasks into 3-10 parallel agents with independent scopes and synthesizes results. Use when requests involve: (1) multiple investigative paths or validation layers, (2) research, analysis, or debugging exceeding trivial scope, (3) implementation planning requiring facet exploration, or (4) any moderate+ complexity task benefiting from parallel execution.
---

# [H1][PARALLEL-DISPATCH]
>**Dictum:** *Decomposition into concurrent workstreams multiplies throughput on non-trivial tasks.*

<br>

[CRITICAL] Dispatch ALL agents in ONE message. Multiple messages execute sequentially—defeats parallelism.<br>
[IMPORTANT] Single-subject requests decompose into parallel facets. Default to parallel execution for moderate+ complexity.

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

[CRITICAL] Gate failure → sequential execution required.

[VERIFY] Independence confirmed:
- [ ] Workstreams share no mutable state.
- [ ] No stream depends on another's output.
- [ ] Results synthesize without conflict.

---
## [2][EXCLUSION]
>**Dictum:** *Clear boundaries prevent misactivation.*

<br>

[IMPORTANT] Exclude from parallel dispatch:
- *Trivial requests:* Single lookup, direct file read, simple action.
- *Sequential dependencies:* Output A required for input B.
- *Overlapping resource access:* Concurrent writes conflict.
- *Insufficient streams:* Fewer than 3 independent paths.
- *Incomplete exploration:* Problem structure unknown.

---
## [3][DECOMPOSITION]
>**Dictum:** *Facet isolation enables contention-free parallel execution.*

<br>

[IMPORTANT] Extract facets via guiding criteria:
- *Independent questions:* Contained implicitly in request.
- *Parallel paths:* Accelerate resolution via concurrency.
- *Validation layers:* Strengthen result confidence.
- *Multiple perspectives:* Sources that apply independently.

[IMPORTANT]:
- [ALWAYS] Map extracted facets to agent assignments.
- [ALWAYS] Target 3-5 concurrent agents.
- [NEVER] Decompose by arbitrary boundaries lacking semantic basis.
- [NEVER] Create agents with overlapping investigation scope.
- [NEVER] Dispatch single-agent workloads as parallel.

---
## [4][AGENT_PROMPT]
>**Dictum:** *Precise scope prevents overlap and enables conflict-free synthesis.*

<br>

[IMPORTANT] Each agent prompt contains:

```
Scope: [Specific facet—what IS and IS NOT included]
Objective: [Concrete deliverable this agent produces]
Output: [Structured format enabling synthesis]
Context: [Relevant background—agents are stateless]
```

[IMPORTANT]:
- [ALWAYS] Define scope boundaries explicitly—agents cannot infer limits.
- [ALWAYS] Specify output structure for synthesis.
- [ALWAYS] Include sufficient context—no cross-agent communication.
- [NEVER] Reference other agents or outputs.
- [NEVER] Assume agents share context.

---
## [5][DISPATCH]
>**Dictum:** *Single-message dispatch prevents sequential bottleneck.*

<br>

[CRITICAL] Dispatch ALL agents in ONE message block:

```
Task("Agent A: [scope, objective, output format]")
Task("Agent B: [scope, objective, output format]")
Task("Agent C: [scope, objective, output format]")
Task("Agent D: [scope, objective, output format]")
Task("Agent E: [scope, objective, output format]")
Task("Agent F: [scope, objective, output format]")
Task("Agent G: [scope, objective, output format]")
Task("Agent H: [scope, objective, output format]")
Task("Agent I: [scope, objective, output format]")
Task("Agent J: [scope, objective, output format]")
```

[IMPORTANT]:
- [ALWAYS] Launch 3-5 agents for moderate tasks.
- [ALWAYS] Launch 6-10 agents for complex tasks.
- [ALWAYS] Include complete context per agent—stateless execution.
- [NEVER] Chain agent outputs—parallel means independent.

---
## [6][SYNTHESIS]
>**Dictum:** *Integration confirms orthogonality and prevents partial results.*

<br>

[IMPORTANT] Post-dispatch synthesis:
- *Convergent findings* → High confidence. Integrate directly.
- *Divergent findings* → Flag uncertainty. Present alternatives or request resolution.

[CRITICAL] Conflict detected → Decomposition violated orthogonality. Retry sequentially.

[VERIFY] Before finalizing:
- [ ] All dispatched agents returned results.
- [ ] Synthesis addresses original request fully.
- [ ] Divergent findings resolved or flagged.
