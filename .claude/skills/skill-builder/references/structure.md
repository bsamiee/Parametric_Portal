# [H1][STRUCTURE]
>**Dictum:** *Type determines breadth—folder existence defines capability scope.*

<br>

**Sections:** [Type Impact](#1type_impact) | [Folder Purpose](#2folder_purpose) | [Naming](#3naming) | [Validation File](#4validation_file)

[IMPORTANT] Structure defines folder existence. Depth constrains folder contents.

---
## [1][TYPE_IMPACT]
>**Dictum:** *Type gates folder creation—each level adds capability.*

<br>

| [INDEX] | [TYPE]   | [SKILL.MD] | [REFERENCES/] | [TEMPLATES/] | [SCRIPTS/] |
| :-----: | -------- | :--------: | :-----------: | :----------: | :--------: |
|   [1]   | Simple   |    Yes     |       —       |      —       |     —      |
|   [2]   | Standard |    Yes     |      Yes      |     Yes      |     —      |
|   [3]   | Complex  |    Yes     |      Yes      |     Yes      |    Yes     |

**Simple:** Single file. All content in SKILL.md. No supporting folders. Sections map to workflow steps.<br>
**Standard:** Distributed content. references/ for deep knowledge, templates/ for output scaffolds. Domains map to reference files.<br>
**Complex:** Standard + scripts/ for deterministic automation.

[CRITICAL] Create only folders appropriate to type. Empty folders prohibited.

---
## [2][FOLDER_PURPOSE]
>**Dictum:** *Each folder serves distinct function.*

<br>

| [INDEX] | [FOLDER]      | [PURPOSE]                | [CONTENTS]                          |
| :-----: | ------------- | ------------------------ | ----------------------------------- |
|   [1]   | `/`           | Skill root               | SKILL.md                            |
|   [2]   | `references/` | Domain knowledge         | Tables, examples, deep explanations |
|   [3]   | `templates/`  | Output scaffolds         | `${placeholder}` syntax, structure  |
|   [4]   | `scripts/`    | Deterministic automation | Python/TypeScript executables       |

**references/** — Content too detailed for SKILL.md. On-demand loading via Required/Conditional Tasks. Must include validation.md.<br>
**templates/** — Source of truth for generated artifacts. Follow template exactly.<br>
**scripts/** — Operations requiring exact reproducibility. External tool wrapping, automation.

[CRITICAL] Max 7 files in references/ (Standard/Complex).

---
## [3][NAMING]
>**Dictum:** *Naming conventions enable rapid discovery.*

<br>

| [INDEX] | [CONTEXT]      | [PATTERN]                     | [EXAMPLE]                    |
| :-----: | -------------- | ----------------------------- | ---------------------------- |
|   [1]   | Skill folder   | `{skill-name}/`               | `skill-builder/`             |
|   [2]   | Reference file | `{domain}.md`                 | `frontmatter.md`, `depth.md` |
|   [3]   | Subfolder      | `{domain}/`                   | `taxonomy/`, `voice/`        |
|   [4]   | Subfolder file | `{topic}.md`                  | `lexicon.md`, `grammar.md`   |
|   [5]   | Template file  | `{type}.{output}.template.md` | `simple.skill.template.md`   |
|   [6]   | Script file    | `{verb}-{noun}.{ext}`         | `validate-prompt.py`         |

[IMPORTANT]:
- [ALWAYS] Kebab-case for all files and folders.
- [ALWAYS] Domain-specific names reflecting content purpose.
- [ALWAYS] Skill folder name matches frontmatter `name` field exactly.

[CRITICAL]:
- [NEVER] Generic names: `utils.md`, `helpers.md`, `misc.md`, `common.md`.
- [NEVER] Numeric prefixes: `01-intro.md`, `02-setup.md`.

---
## [4][VALIDATION_FILE]
>**Dictum:** *validation.md centralizes operational checklists.*

<br>

Standard/Complex types require validation.md in references/.

**Purpose:**
- Consolidates operational verification checklists from all domains.
- SKILL.md VALIDATION contains high-level gates (3-5 items).
- validation.md contains detailed checklists, error symptoms, commands.

**Requirements:**
- Located at `references/validation.md`.
- Sections map to domain concerns (frontmatter, structure, depth, scripting).
- Includes error symptoms table for diagnosis.
- Operational commands for verification (`wc -l`, `rg`, etc.).

**Simple type exception:** Validation remains in SKILL.md VALIDATION (no references/ folder).

See [validation.md](./validation.md) for content guidelines.
