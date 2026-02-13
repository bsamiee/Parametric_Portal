# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify command quality.*

<br>

Consolidated checklist for command-builder. SKILL.md §VALIDATION contains high-level gates; this file contains operational verification procedures.

---
## [1][REQUIREMENTS_GATE]
>**Dictum:** *Clear requirements prevent rework.*

<br>

[VERIFY] Requirements captured:
- [ ] Name follows verb-first convention (reject: run, do, execute, go).
- [ ] Pattern explicitly stated (file|multi|agent|skill|free).
- [ ] Argument style determined ($ARGUMENTS OR $1-$N/$ARGUMENTS[N]).
- [ ] Tool list scoped to pattern.

---
## [2][PLAN_GATE]
>**Dictum:** *Plan synthesis enables artifact creation.*

<br>

[VERIFY] Plan synthesis complete:
- [ ] Frontmatter fields defined.
- [ ] Section structure outlined.
- [ ] LOC estimate <125.

[VERIFY] Plan compliance:
- [ ] Tools match Pattern gate.
- [ ] LOC estimate <125.
- [ ] No $ARGUMENTS + positional mixing.

---
## [3][ARTIFACT_GATE]
>**Dictum:** *Artifact quality prevents deployment failure.*

<br>

[VERIFY] Frontmatter:
- [ ] Valid YAML syntax (no tabs, `---` delimiters).
- [ ] `description` present, verb-first, <80 chars.
- [ ] `argument-hint` matches variable usage.
- [ ] `allowed-tools` declares all required tools.

[VERIFY] Variables:
- [ ] No `$ARGUMENTS` + positional (`$1-$N`/`$ARGUMENTS[N]`) mixing.
- [ ] All `@path` have `Read` declared.
- [ ] All `!command` have `Bash` declared.
- [ ] Optional parameters use `${N:-default}` syntax.

[VERIFY] Structure:
- [ ] LOC < 125.
- [ ] Name: lowercase, hyphens, verb-first.
- [ ] Filename matches command intent.

---
## [4][ERROR_SYMPTOMS]
>**Dictum:** *Symptom-to-fix mapping accelerates diagnosis.*

<br>

| [SYMPTOM]           | [CAUSE]                   | [FIX]                        |
| ------------------- | ------------------------- | ---------------------------- |
| YAML parse failure  | Tab character             | Replace with spaces          |
| Frontmatter ignored | Missing delimiter         | Add `---` before and after   |
| Field truncated     | Unquoted special char     | Quote the value              |
| Silent failure      | Missing tool declaration  | Add to `allowed-tools`       |
| Empty substitution  | Missing default           | Use `${N:-default}` syntax   |
| Double substitution | Mixed argument patterns   | Choose $ARGUMENTS OR $1-$N   |
| Command not found   | Wrong file location       | Check .claude/commands/ path |
| Permission denied   | Tool not in allowed-tools | Add required tool to list    |

---
## [5][OPERATIONAL_COMMANDS]
>**Dictum:** *Observable outcomes enable verification.*

<br>

```bash
# LOC verification
wc -l .claude/commands/*.md  # Each must be <125

# YAML validation
head -20 .claude/commands/my-command.md  # Check frontmatter

# Tool declaration check
rg '@\$|@\.' .claude/commands/*.md  # Find @path references
rg 'Read' .claude/commands/*.md     # Verify Read declared

# Variable pattern check
rg '\$ARGUMENTS|\$[0-9]' .claude/commands/*.md  # Check for mixing

# Filename convention
eza .claude/commands/ | rg -v '^[a-z-]*\.md$'  # Find violations
```
