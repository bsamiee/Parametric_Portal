---
description: Create phase-based implementation spec from brainstorm + deep codebase investigation
argument-hint: [brainstorm-file]
---

# [H1][PLAN]
>**Dictum:** *Spec sheets compress complexity into actionable phases and work units.*

<br>

@.claude/skills/parallel-dispatch/SKILL.md

---
## [1][PATH]

**Input:** `$1` (brainstorm file path)
**Output:** `dirname($1)/plan.md`

**Example:** `@docs/projects/foo/brainstorm.md` → `docs/projects/foo/plan.md`

---
## [2][INPUTS]

**Brainstorm:** @$1

Extract from brainstorm:
- **Scope** — Build target
- **Selected Approach** — Committed design direction
- **Design Constraints** — Hard boundaries to respect
- **Key Decisions** — Choices already made

---
## [3][INVESTIGATE]
>**Dictum:** *Deep investigation reveals implementation targets.*

<br>

Dispatch 4-5 agents via `parallel-dispatch` for **deep** codebase investigation.

| [INDEX] | [AGENT]          | [SCOPE]                      | [RETURNS]                                  |
| :-----: | ---------------- | ---------------------------- | ------------------------------------------ |
|   [1]   | **Files**        | Target locations for changes | Specific paths, line ranges, existing code |
|   [2]   | **Dependencies** | Package graph                | Affected imports, type chains              |
|   [3]   | **Integration**  | Wiring points                | Exports, consumers, touch points           |
|   [4]   | **Tests**        | Coverage requirements        | Test files, patterns, gaps to fill         |

**Agent Context:** Include selected approach + design constraints from brainstorm.

[CRITICAL]:
- [ALWAYS] Dispatch ALL agents in ONE message block.
- [ALWAYS] Include brainstorm context in agent prompts.
- [ALWAYS] Return file paths, line numbers, concrete targets.
- [NEVER] Re-investigate patterns/constraints—brainstorm did that.

---
## [4][SYNTHESIZE]
>**Dictum:** *Synthesis transforms findings into actionable structure.*

<br>

1. Map selected approach to concrete file targets from investigation.
2. Group into logical phases (setup → core → integration).
3. Extract tasks per phase with specific file:line targets.
4. **Synthesize work units** — group related tasks into agent-completable units.
5. Attach validation checklist per work unit.

---
## [5][OUTPUT]
>**Dictum:** *Structured output enables downstream consumption.*

<br>

Write to `dirname($1)/plan.md` as spec sheet:

```markdown
# [H1][PLAN]: [Title]
>**Dictum:** *[1-sentence context from brainstorm scope]*

<br>

**Approach:** [Selected approach name + 1-line summary]

---
## [1][PHASE_NAME]

### [1.1][TASK_VERB_PHRASE]
| [INDEX] | [KEY]   | [VALUE]                         |
| :-----: | ------- | ------------------------------- |
|   [1]   | Target  | `path/to/file.ts:L##`           |
|   [2]   | Action  | [Specific change]               |
|   [3]   | Pattern | [Convention from investigation] |

### [1.2][TASK_VERB_PHRASE]
| [INDEX] | [KEY]   | [VALUE]               |
| :-----: | ------- | --------------------- |
|   [1]   | Target  | `path/to/file.ts:L##` |
|   [2]   | Action  | [Specific change]     |
|   [3]   | Depends | 1.1                   |

---
## [2][PHASE_NAME]

### [2.1][TASK_VERB_PHRASE]
...

---
## [N][WORK_UNITS]

### [N.1][WU_1]: [Descriptive_Name]
| [INDEX] | [KEY]    | [VALUE]                    |
| :-----: | -------- | -------------------------- |
|   [1]   | Scope    | [File/module area]         |
|   [2]   | Tasks    | 1.1, 1.2                   |
|   [3]   | Priority | [critical/high/medium/low] |
|   [4]   | Depends  | —                          |

[VERIFY]:
- [ ] `nx run-many -t typecheck` — zero errors
- [ ] `nx run-many -t check` — zero violations
- [ ] [Specific verification for this unit]

---
### [N.2][WU_2]: [Descriptive_Name]
| [INDEX] | [KEY]    | [VALUE]            |
| :-----: | -------- | ------------------ |
|   [1]   | Scope    | [File/module area] |
|   [2]   | Tasks    | 2.1, 2.2           |
|   [3]   | Priority | medium             |
|   [4]   | Depends  | WU-1               |

[VERIFY]:
- [ ] `nx run-many -t typecheck` — zero errors
- [ ] `nx run-many -t check` — zero violations
- [ ] `pnpm sonar` — no new issues
- [ ] [Specific verification for this unit]
```

---
## [6][WORK_UNIT_RULES]
>**Dictum:** *Rules ensure agent-completable scope boundaries.*

<br>

**Grouping Criteria:**
- Same target file/module
- Sequential dependency chain
- Logical completion boundary (agent can verify done)

**Priority Assignment:**

| [INDEX] | [PRIORITY] | [WHEN]                              |
| :-----: | ---------- | ----------------------------------- |
|   [1]   | `critical` | Blocks all work, security, breaking |
|   [2]   | `high`     | Core functionality, foundational    |
|   [3]   | `medium`   | Standard work, builds on prior      |
|   [4]   | `low`      | Polish, cleanup, nice-to-have       |

[CRITICAL]:
- [ALWAYS] Work unit = discrete, agent-completable scope.
- [ALWAYS] Include validation checklist per work unit.
- [ALWAYS] Priority based on criticality, not phase order.
- [NEVER] 1:1 task:work unit—group logically.
- [NEVER] Overlapping scope between work units.

---
## [7][CONSTRAINTS]
>**Dictum:** *Constraints enforce quality and consistency.*

<br>

[CRITICAL]:
- [ALWAYS] Write to same directory as input brainstorm file.
- [ALWAYS] Phase → Task → Details hierarchy.
- [ALWAYS] Work Units section after phases.
- [ALWAYS] Table format for task and work unit details.
- [ALWAYS] One target per task—no compound actions.
- [ALWAYS] Include `Depends` key when task requires prior completion.
- [ALWAYS] Reference brainstorm decisions—don't re-decide.
- [ALWAYS] Include file:line targets where possible.
- [NEVER] Prose paragraphs—tables and lists only.
- [NEVER] Rationale without codebase evidence.
- [NEVER] Time estimates, scheduling, or "considerations".
- [NEVER] Re-investigate patterns/constraints—trust brainstorm.
