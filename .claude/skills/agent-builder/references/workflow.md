# [H1][WORKFLOW_CREATE]
>**Dictum:** *Sequential phases with parallel dispatch ensure research-informed agent creation.*

<br>

[IMPORTANT] Parameters (`Name`, `Type`, `Purpose`) from command. Reference throughout for constraint enforcement.

---
## [1][UNDERSTAND]
>**Dictum:** *Requirements clarity prevents rework.*

<br>

Confirm before proceeding:
- `Name` — Kebab-case, descriptive, role/action-based. Reject: helper, processor, agent.
- `Type` — readonly|write|orchestrator|full. Gates tools + model.
- `Triggers` — What user intent activates? Capture 3+ scenarios.
- `Deliverable` — What concrete output does this agent produce?
- `Constraints` — What boundaries govern behavior?

[VERIFY] Requirements captured:
- [ ] Name follows naming conventions.
- [ ] Type explicitly stated.
- [ ] 3+ trigger scenarios identified.
- [ ] Deliverable articulated.

---
## [2][ACQUIRE]
>**Dictum:** *Context loading precedes research.*

<br>

### [2.1][LOAD_CONSTRAINTS]

Load agent-builder sections per Type:

| [CONDITION]  | [LOAD]                            |
| ------------ | --------------------------------- |
| All          | §FRONTMATTER, §DISCOVERY, §NAMING |
| All          | §TOOLS, §MODELS, §SYSTEM_PROMPT   |
| orchestrator | Emphasis on Task tool patterns    |
| full         | No tool restrictions              |

---
### [2.2][LOAD_STANDARDS]

Invoke `style-summarizer`. Extract:
- Voice constraints (imperative prompt body, third person description).
- Formatting rules (H2 with sigils, constraint markers).

[CRITICAL] Include style constraints in sub-agent prompts.

---
### [2.3][SCAFFOLD]

Compile constraint manifest before research:

```
Name: ${name} | Type: ${type}
Tools: ${tool_list} | Model: ${model}
Triggers: ${trigger_scenarios}
Deliverable: ${output_description}
```

---
## [3][RESEARCH]
>**Dictum:** *Delegated research maximizes coverage via specialized agents.*

<br>

Invoke `deep-research`:

| [PARAM]     | [VALUE]                                                   |
| ----------- | --------------------------------------------------------- |
| Topic       | Agent design for ${type} type: ${purpose}                 |
| Constraints | Manifest §2.3, style §2.2, AgentCount: 6 Round1, 4 Round2 |

[REFERENCE]: [→deep-research](../../deep-research/SKILL.md)

**Post-dispatch:** Receive validated findings. Proceed to §3.2.

---
### [3.1][PLAN_SYNTHESIS]

Invoke `parallel-dispatch` with 3 planning agents.

**Input:** Research findings, constraint manifest, agent-builder SKILL.md + references, template.<br>
**Deliverable:** Frontmatter fields, prompt sections, constraint list.<br>
**Golden-path synthesis:** Combine strongest elements. Resolve conflicts via Type hierarchy.

[VERIFY] Plan synthesis complete:
- [ ] Frontmatter fields defined.
- [ ] Prompt sections outlined.
- [ ] Trigger coverage confirmed.

---
## [4][AUTHOR]
>**Dictum:** *Type-gated creation prevents scope violations.*

<br>

### [4.1][VALIDATE_PLAN]

[VERIFY]: Confirm plan compliance before creation:
- [ ] Tools match Type gate.
- [ ] Model matches Type gate.
- [ ] Description includes "Use when" + 3+ triggers.

---
### [4.2][CREATE_ARTIFACT]

Create `.claude/agents/${name}.md`:

| [STEP] | [COMPONENT]  | [ACTION]                                          |
| :----: | ------------ | ------------------------------------------------- |
|   1    | Frontmatter  | name, description, tools, model, skills           |
|   2    | Role Line    | Imperative, single sentence, concrete deliverable |
|   3    | §INPUT       | Invocation context specification                  |
|   4    | §PROCESS     | Numbered steps with **verb** bold                 |
|   5    | §OUTPUT      | Explicit format specification                     |
|   6    | §CONSTRAINTS | [CRITICAL]/[IMPORTANT] markers                    |

**Type Gates:**

| [TYPE]       | [TOOLS]                       | [MODEL] |
| ------------ | ----------------------------- | :-----: |
| readonly     | Read, Glob, Grep              | sonnet  |
| write        | Read, Edit, Write, Glob, Bash | sonnet  |
| orchestrator | Task, Read, Glob, TodoWrite   |  opus   |
| full         | *(omit field)*                | session |

[CRITICAL]:
- [ALWAYS] Validate artifact against template before completion.
- [ALWAYS] Third person description, imperative prompt body.
- [NEVER] Vague descriptions—"Use when" + triggers required.

---
## [5][VALIDATE]
>**Dictum:** *Parallel review agents ensure comprehensive quality.*

<br>

Invoke `parallel-dispatch` with 3 review agents.

**Input:** Agent file, plan + manifest, agent-builder SKILL.md + references.<br>
**Review scope:** Frontmatter validity, trigger coverage, tool/model alignment, voice compliance.<br>
**Post-dispatch:** Compile findings, reject false positives, apply fixes.

[VERIFY] Quality gate:
- [ ] Filename: kebab-case, `.md` extension.
- [ ] `name`: matches filename (without extension).
- [ ] `description`: third person, active, "Use when" clause, catch-all.
- [ ] `tools`: matches Type gate (or omitted for full).
- [ ] YAML: `---` delimiters, spaces only, `>-` for multi-line.
- [ ] Role line: imperative, single sentence.
- [ ] Sections: H2 with numbered sigils.
- [ ] Constraints: [CRITICAL]/[IMPORTANT] markers present.
- [ ] Output spec: explicit format defined.
