# [H1][STRUCTURE]
>**Dictum:** *Type determines breadth—folder existence defines capability scope.*

<br>

[IMPORTANT] Structure defines folder existence. Depth constrains folder contents.

---
## [1][TYPE_IMPACT]
>**Dictum:** *Type gates folder creation—each level adds capability.*

<br>

| [INDEX] | [TYPE]   | [SKILL.MD] | [INDEX.MD] | [REFERENCES/] | [TEMPLATES/] | [SCRIPTS/] |
| :-----: | -------- | :--------: | :--------: | :-----------: | :----------: | :--------: |
|   [1]   | Simple   |    Yes     |     —      |       —       |      —       |     —      |
|   [2]   | Standard |    Yes     |    Yes     |      Yes      |     Yes      |     —      |
|   [3]   | Complex  |    Yes     |    Yes     |      Yes      |     Yes      |    Yes     |

**Simple:** Single file. All content in SKILL.md. No supporting folders. Sections map to workflow steps.
**Standard:** Distributed content. references/ for deep knowledge, templates/ for output scaffolds. Domains map to reference files.
**Complex:** Standard + scripts/ for deterministic automation.

[CRITICAL] Create only folders appropriate to type. Empty folders prohibited.

---
## [2][FOLDER_PURPOSE]
>**Dictum:** *Each folder serves distinct function.*

<br>

| [INDEX] | [FOLDER]      | [PURPOSE]                | [CONTENTS]                          |
| :-----: | ------------- | ------------------------ | ----------------------------------- |
|   [1]   | `/`           | Skill root               | SKILL.md, index.md                  |
|   [2]   | `references/` | Domain knowledge         | Tables, examples, deep explanations |
|   [3]   | `templates/`  | Output scaffolds         | `${placeholder}` syntax, structure  |
|   [4]   | `scripts/`    | Deterministic automation | Python/TypeScript executables       |

**references/** — Content too detailed for SKILL.md. On-demand loading via Required/Conditional Tasks.
**templates/** — Source of truth for generated artifacts. Follow template exactly.
**scripts/** — Operations requiring exact reproducibility. External tool wrapping, validation.

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
## [4][INDEX_FILE]
>**Dictum:** *index.md provides single navigation source.*

<br>

Standard/Complex types require index.md at skill root.

**Requirements:**<br>
- Located at skill root, not in subfolders.
- Lists ALL reference files with path, domain, and dictum.
- Single navigation source—no per-folder indexes.

**Format:**
```markdown
| [INDEX] | [DOMAIN] | [PATH]                         | [DICTUM]           |
| :-----: | -------- | ------------------------------ | ------------------ |
|   [1]   | Domain   | [→file.md](references/file.md) | Brief description. |
```

[REFERENCE] Nesting rights by depth: [→depth.md§2](./depth.md#2unlocks)

---
## [5][VALIDATION]
>**Dictum:** *Gate checklist enforces structural compliance.*

<br>

[VERIFY] Pre-commit:
- [ ] Type selected: Simple | Standard | Complex.
- [ ] Folders match type (Simple: none; Standard: refs+templates; Complex: +scripts).
- [ ] No empty folders—every folder contains at least one file.
- [ ] Skill folder name matches frontmatter `name` exactly.
- [ ] `references/` ≤7 files total (including nested).
- [ ] `index.md` exists at root (Standard/Complex only).
- [ ] All names kebab-case, domain-specific.

[REFERENCE] Frontmatter name matching: [→frontmatter.md§1.1](./frontmatter.md#11name)
