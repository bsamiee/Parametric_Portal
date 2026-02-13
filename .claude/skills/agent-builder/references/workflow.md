# [H1][WORKFLOW_CREATE]
>**Dictum:** *Sequential phases ensure research-informed agent creation.*

<br>

[IMPORTANT] Parameters (`Name`, `Type`, `Purpose`) from command. Reference throughout for constraint enforcement.

---
## [1][UNDERSTAND]
>**Dictum:** *Clear requirements prevent rework.*

<br>

**Confirm before proceeding:**
- `Name` — Kebab-case, descriptive, and role/action-based. Reject helper, processor, agent.
- `Type` — readonly|write|orchestrator|full. Type gates tools and model.
- `Triggers` — Identify user intent that activates. Capture 3+ scenarios.
- `Deliverable` — Concrete output agent produces.
- `Constraints` — Boundaries governing behavior.

[REFERENCE] Requirements gate: [→validation.md§1](./validation.md#1requirements_gate).

---
## [2][ACQUIRE]
>**Dictum:** *Context loading enables informed research.*

<br>

### [2.1][LOAD_CONSTRAINTS]

**Load agent-builder sections per Type:**

| [INDEX] | [CONDITION]  | [LOAD]                            |
| :-----: | ------------ | --------------------------------- |
|   [1]   | All          | §FRONTMATTER, §DISCOVERY, §NAMING |
|   [2]   | All          | §TOOLS, §MODELS, §SYSTEM_PROMPT   |
|   [3]   | orchestrator | Emphasis on Task tool patterns    |
|   [4]   | full         | No tool restrictions              |

---
### [2.2][LOAD_STANDARDS]

Invoke `skill-summarizer` with skill `style-standards`. Extract voice constraints and formatting rules:
- Voice: imperative prompt body, third person description.
- Formatting: H2 with sigils, constraint markers.

[CRITICAL] Include style constraints in sub-agent prompts.

---
### [2.3][SCAFFOLD]

**Compile constraint manifest before research:**

```
Name: ${name} | Type: ${type}
Tools: ${tool_list} | Model: ${model}
Triggers: ${trigger_scenarios}
Deliverable: ${output_description}
```

---
## [3][RESEARCH]
>**Dictum:** *Specialized agents maximize research coverage.*

<br>

**Invoke `deep-research`:**

| [INDEX] | [PARAM]     | [VALUE]                                                   |
| :-----: | ----------- | --------------------------------------------------------- |
|   [1]   | Topic       | Agent design for ${type} type: ${purpose}                 |
|   [2]   | Constraints | Manifest §2.3, style §2.2, AgentCount: 6 Round1, 4 Round2 |

[REFERENCE]: [→deep-research](../../deep-research/SKILL.md).

**Post-dispatch:** Receive validated findings, then proceed to §3.2.

<br>

### [3.1][PLAN_SYNTHESIS]

Invoke `parallel-dispatch` with 3 planning agents.

**Input:** Research findings, constraint manifest, agent-builder SKILL.md + references, and template.<br>
**Deliverable:** Frontmatter fields, prompt sections, and constraint list.<br>
**Synthesis:** Combine strongest elements, and resolve conflicts via Type hierarchy.

[REFERENCE] Plan gate: [→validation.md§2](./validation.md#2plan_gate).

---
## [4][AUTHOR]
>**Dictum:** *Type gates prevent scope violations.*

<br>

### [4.1][CREATE_ARTIFACT]

**Create `.claude/agents/${name}.md`:**

| [INDEX] | [COMPONENT]  | [ACTION]                                                          |
| :-----: | ------------ | ----------------------------------------------------------------- |
|   [1]   | Frontmatter  | name, description, tools, disallowedTools, model, permissionMode  |
|   [2]   | Frontmatter  | maxTurns, skills, mcpServers, hooks, memory, color (all optional) |
|   [3]   | Role Line    | Imperative, single sentence, concrete deliverable                 |
|   [4]   | §INPUT       | Invocation context specification                                  |
|   [5]   | §PROCESS     | Numbered steps with **verb** bold                                 |
|   [6]   | §OUTPUT      | Explicit format specification                                     |
|   [7]   | §CONSTRAINTS | [CRITICAL]/[IMPORTANT] markers                                    |

**Type gates:**

| [INDEX] | [TYPE]       | [TOOLS]                       | [MODEL] |
| :-----: | ------------ | ----------------------------- | :-----: |
|   [1]   | readonly     | Read, Glob, Grep              | sonnet  |
|   [2]   | write        | Read, Edit, Write, Glob, Bash | sonnet  |
|   [3]   | orchestrator | Task, Read, Glob, TaskCreate  |  opus   |
|   [4]   | full         | *(omit field)*                | session |

[CRITICAL]:
- [ALWAYS] Validate artifact against template before completion.
- [ALWAYS] Third person description, imperative prompt body.
- [NEVER] Vague descriptions—"Use when" + triggers required.

---
## [5][VALIDATE]
>**Dictum:** *Parallel review ensures comprehensive quality.*

<br>

Invoke `parallel-dispatch` with 3 review agents.

**Input:** Agent file, plan + manifest, agent-builder SKILL.md + references.<br>
**Review scope:** Frontmatter validity, trigger coverage, tool/model alignment, and voice compliance.<br>
**Post-dispatch:** Compile findings, reject false positives, and apply fixes.

[REFERENCE] Artifact gate: [→validation.md§5](./validation.md#5artifact_gate).
