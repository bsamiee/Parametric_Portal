# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify execution quality.*

<br>

**Sections:** [Phase Gates](#1phase_gates) | [Frontmatter](#2frontmatter) | [Structure](#3structure) | [Depth](#4depth) | [Scripting](#5scripting) | [Error Symptoms](#6error_symptoms) | [Commands](#7operational_commands) | [Evaluation](#8evaluation)

Consolidated checklist for skill-builder workflows. SKILL.md VALIDATION contains high-level gates; this file contains operational verification procedures.

---
## [1][PHASE_GATES]
>**Dictum:** *Workflow phases require sequential verification.*

<br>

| [INDEX] | [PHASE]    | [GATE]                 | [VERIFICATION]                                       |
| :-----: | ---------- | ---------------------- | ---------------------------------------------------- |
|   [1]   | Parameters | Collection complete    | Scope, Type, Depth captured before reference loading |
|   [2]   | References | All required loaded    | frontmatter.md, structure.md, depth.md read          |
|   [3]   | Research   | deep-research complete | Both rounds + critiques finished, findings captured  |
|   [4]   | Style      | skill-summarizer run   | Voice/formatting extracted from style-standards      |
|   [5]   | Execute    | Workflow scope matched | create OR refine path executed per Scope parameter   |
|   [6]   | Artifacts  | All files generated    | SKILL.md + type-appropriate folders created          |

---
## [2][FRONTMATTER]
>**Dictum:** *Discovery metadata gates skill registration.*

<br>

[VERIFY] Frontmatter compliance:
- [ ] Delimiters: `---` on line 1; closing `---` before markdown content.
- [ ] `name`: lowercase+hyphens only; max 64 chars; matches folder name exactly; no XML tags; no reserved words (`anthropic`, `claude`).
- [ ] `description`: non-empty; max 1024 chars; no XML tags; third person/active/present tense.
- [ ] `description`: contains "Use when" clause with specific triggers + file types/extensions.
- [ ] `type`: valid enum (`simple`, `standard`, `complex`); matches folder structure.
- [ ] `depth`: valid enum (`base`, `extended`, `full`); matches LOC and nesting.
- [ ] Syntax: spaces only (no tabs); special characters quoted; `>-` for multi-line descriptions.

---
## [3][STRUCTURE]
>**Dictum:** *Type gates folder existence.*

<br>

[VERIFY] Structural compliance:
- [ ] Type selected and documented in frontmatter.
- [ ] Folders match type:
  - Simple: SKILL.md only (no references/, templates/, scripts/).
  - Standard: SKILL.md + references/ + templates/.
  - Complex: Standard + scripts/.
- [ ] No empty folders—every folder contains at least one file.
- [ ] Skill folder name matches frontmatter `name` exactly.
- [ ] `references/` contains <=7 files total (including nested subfolders).
- [ ] All file and folder names are kebab-case, domain-specific (no `utils.md`, `helpers.md`).

---
## [4][DEPTH]
>**Dictum:** *LOC limits enforce density over deletion.*

<br>

[VERIFY] Depth compliance:
- [ ] Depth selected and documented in frontmatter.
- [ ] SKILL.md within LOC limit: Base <300, Extended <350, Full <400.
- [ ] All reference files within LOC limit: Base <150, Extended <175, Full <200.
- [ ] Subfolder count matches depth: Base = 0, Extended <=1, Full <=3.
- [ ] Guidance/Best-Practices item count scales with depth (Base: 1-2, Extended: 2-4, Full: comprehensive).

[VERIFY] LOC optimization applied (in order):
1. [ ] Consolidate — repeated information exists in ONE location only.
2. [ ] Restructure — organization reduces redundant tables/headers/boilerplate.
3. [ ] Densify — lines rewritten for maximum information per token.
4. [ ] Prune — low-impact content removed ONLY after above steps exhausted.

[VERIFY] Content separation enforced:
- [ ] SKILL.md contains WHY (Tasks, Guidance, Best-Practices).
- [ ] References contain HOW (specs, tables, schemas, examples).
- [ ] SKILL.md sections build ON references—no verbatim duplication.

---
## [5][SCRIPTING]
>**Dictum:** *Scripts require additional quality gates.*

<br>

[VERIFY] Script quality (Complex type only):
- [ ] Frozen `B` constant consolidates all tunables.
- [ ] Dispatch table routes all mode variants.
- [ ] JSON output for agent parsing.
- [ ] `--help` flag supported for discoverability.
- [ ] Zero hardcoded paths—all via arguments or environment.
- [ ] External dependencies documented in script header comment.
- [ ] Script executes without errors.

---
## [6][ERROR_SYMPTOMS]
>**Dictum:** *Symptom diagnosis accelerates fix identification.*

<br>

| [INDEX] | [SYMPTOM]                      | [CAUSE]                        | [FIX]                                              |
| :-----: | ------------------------------ | ------------------------------ | -------------------------------------------------- |
|   [1]   | Skill not discovered           | Frontmatter delimiter missing  | Ensure `---` on line 1, closing `---` before body  |
|   [2]   | Registration fails             | Name contains reserved word    | Remove `anthropic`, `claude` from name field       |
|   [3]   | Skill invoked incorrectly      | Description lacks triggers     | Add "Use when" clause with specific scenarios      |
|   [4]   | LOC limit exceeded             | Brute-force trimming attempted | Apply consolidate — restructure — densify — prune  |
|   [5]   | SKILL.md duplicates references | Content separation violated    | Move HOW to references, keep WHY in SKILL.md       |
|   [6]   | Folders missing for type       | Structure mismatch             | Create required folders per type table             |
|   [7]   | Validation scattered           | Per-file validation sections   | Consolidate to validation.md, remove from refs     |
|   [8]   | Script fails silently          | Missing --help or JSON output  | Add argparse/parseArgs with help flag, JSON output |

---
## [7][OPERATIONAL_COMMANDS]
>**Dictum:** *Verification requires observable outcomes.*

<br>

```bash
# LOC verification
wc -l SKILL.md                    # Must be < limit for depth
wc -l references/*.md             # Each must be < limit for depth

# Structure verification
eza -la                            # Verify folder existence matches type
fd -t f . references/ | wc -l     # Must be <=7

# Frontmatter verification
head -1 SKILL.md                  # Must be exactly "---"
rg "^name:" SKILL.md               # Must match folder name
rg "Use when" SKILL.md             # Must exist in description

# Name matching
basename "$(pwd)"                 # Folder name
rg "^name:" SKILL.md | choose 1  # Frontmatter name
# These must match exactly
```

---
## [8][EVALUATION]
>**Dictum:** *Testing validates skill behavior across invocation paths.*

<br>

**Manual Activation Test:**
- [ ] Invoke skill with 3 different phrasings matching "Use when" triggers — verify it activates.
- [ ] Invoke with ambiguous phrasing near skill boundary — verify correct routing (or non-activation).
- [ ] Invoke via `/skill-name` directly — verify full SKILL.md loads and Tasks execute.

**Output Verification:**
- [ ] Generated artifact structure matches selected template (simple/standard/complex).
- [ ] Frontmatter schema fields present with valid values.
- [ ] Content separation enforced — SKILL.md contains WHY, references contain HOW.
- [ ] LOC within depth limits for all generated files.

**Model Variance:**
- Behavior varies across Haiku/Sonnet/Opus. Haiku may require more explicit triggers in description.
- Test with the model specified in frontmatter `model` field (or default model if `inherit`).
