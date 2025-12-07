---
name: skill-builder
type: standard
depth: full
description: Creates and edits Claude Code skills with YAML frontmatter, folder structure, and depth-scaled content. Use when building new skills, updating existing skills, designing SKILL.md metadata, organizing skill folders, validating skill structure, or adding Python and TypeScript scripts for deterministic operations.
---

# [H1][SKILL-BUILDER]
>**Dictum:** *Structured authoring produces discoverable, maintainable skills.*

<br>

Universal skill creation and refinement for monorepo skills.

**Scope:**<br>
- *Create:* New skill from requirements. Invoke deep-research, plan structure, author SKILL.md.
- *Refine:* Existing skill refactoring. Audit structure, research gaps, refactor content.

**Domain Navigation:**<br>
- *[FRONTMATTER]* — Discovery metadata, trigger optimization. Load for name/description authoring, trigger patterns.
- *[STRUCTURE]* — Folder layouts, type gates. Load for type selection, folder organization.
- *[DEPTH]* — LOC limits, nesting rights. Load for LOC enforcement, nesting validation.
- *[TEMPLATES]* — Canonical output scaffolds. Load for scaffold selection, artifact generation.
- *[SCRIPTING]* — Python/TypeScript automation. Load for script standards, validation automation.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

---
## [2][INSTRUCTIONS]
>**Dictum:** *Progressive disclosure optimizes context loading.*

<br>

**Instruction Structure:**<br>
- *Required Task* — Mandatory read before domain work. Numbered, sequential.
- *Conditional Task* — Execute when section matches selected parameters.
- *References* — Supplemental files for deeper context. Load when needed.
- *Guidance* — Core concepts with rationale. Why > what.
- *Best-Practices* — Critical rules, patterns, constraints.

**Task Adherence:**<br>
1. Complete **Universal Tasks** first—applies to all workflows.
2. Complete **Required Tasks** for each domain section.
3. Complete **Conditional Tasks** when section matches selected parameters.

**Universal Tasks:**<br>
1. Read [→index.md](./index.md): Reference file listing for navigation.

---
## [3][DECISION]
>**Dictum:** *Three parameters gate all skill authoring.*

<br>

[IMPORTANT] Collect all parameters before loading domain sections. Parameters are orthogonal—each gates independent concerns.

<br>

```mermaid
%%{ init: { 'flowchart': { 'curve': 'stepBefore' } } }%%
flowchart LR
    I((Input)) --> S{Scope} & T{Type} & D{Depth}
    S -->|create| WC[Create Workflow]
    S -->|refine| WR[Refine Workflow]
    T -->|simple| XS[FRONTMATTER]
    T -.->|standard| XM[+STRUCTURE]:::optional
    T -.->|complex| XC[+SCRIPTING]:::optional
    D -->|base| RM[Base]
    D -.->|extended| RS[Extended]:::optional
    D -.->|full| RC[Full]:::optional
    click WC "./references/workflows/create.md" "Open creation workflow"
    click WR "./references/workflows/refine.md" "Open refinement workflow"
    click RM "./references/depth.md" "Open depth constraints"
    click RS "./references/depth.md" "Open depth constraints"
    click RC "./references/depth.md" "Open depth constraints"
    classDef input fill:#50fa7b,stroke:#44475a,stroke-width:2px,color:#282a36
    classDef choice fill:#ff79c6,stroke:#44475a,stroke-width:2px,color:#282a36
    classDef reference fill:#ffb86c,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef action fill:#8be9fd,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef state fill:#bd93f9,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef optional fill:#6272a440,stroke:#f8f8f2,stroke-width:1px,color:#f8f8f2,stroke-dasharray:5 5
    linkStyle 3,4 stroke:#ff5555,stroke-width:2px
    class I input
    class S,T,D choice
    class WC,WR reference
    class XS action
    class RM state
```

<br>

**Conditional Task:**<br>
1. (Requires: create) Read [→create.md](./references/workflows/create.md): Creation workflow phases.
2. (Requires: refine) Read [→refine.md](./references/workflows/refine.md): Refinement workflow phases.

**Guidance:**<br>
- `Type` — Controls breadth. See §STRUCTURE for folder layout implications.
- `Depth` — Controls comprehensiveness. See §DEPTH for LOC limits and nesting rules.

[VERIFY] User must state:
- [ ] Scope: create | refine.
- [ ] Type: simple | standard | complex.
- [ ] Depth: base | extended | full.

---
## [4][STRUCTURE]
>**Dictum:** *Type determines breadth.*

<br>

```mermaid
%%{ init: { 'flowchart': { 'curve': 'stepAfter' } } }%%
flowchart LR
    subgraph simple ["SIMPLE"]
        direction TB
        S[SKILL.md]
        S ~~~ SR[references/]:::hidden & STP[templates/]:::hidden
        SR ~~~ SN[domain/]:::hidden
    end
    subgraph standard ["STANDARD"]
        direction TB
        ST[SKILL.md]
        ST --> R1[references/] & T1[templates/]
        R1 -.-> N1[domain/]:::optional
    end
    subgraph complex ["COMPLEX"]
        direction TB
        C[SKILL.md]
        C --> R2[references/] & T2[templates/] & SC[scripts/]
        R2 -.-> N2[domain/]:::optional
    end
    simple ~~~ standard ~~~ complex
    classDef input fill:#50fa7b,stroke:#44475a,stroke-width:2px,color:#282a36
    classDef action fill:#8be9fd,stroke:#44475a,stroke-width:1px,color:#282a36
    classDef optional fill:#6272a440,stroke:#f8f8f2,stroke-width:1px,color:#f8f8f2,stroke-dasharray:5 5
    classDef hidden fill:transparent,stroke:transparent,color:transparent
    class S,ST,C input
    class R1,R2,T1,T2,SC action
    class N1,N2 optional
    style simple fill:none,stroke:none
    style standard fill:none,stroke:none
    style complex fill:none,stroke:none
```

<br>

**Required Task:**<br>
1. Read [→structure.md](./references/structure.md): Type impact, folder purpose, naming, organization.

**Guidance:**<br>
- `Breadth` — Type controls coverage width. Simple = focused, Standard = moderate, Complex = comprehensive.
- `Naming` — Folder name matches frontmatter `name` field. Consistency enables discovery.
- `Type Selection` — User specifies type explicitly. Prohibit assumptions and inference.

**Best-Practices:**<br>
- **Directory Purpose** — references/ for domain knowledge, templates/ for output scaffolds, scripts/ for automation.
- **Index Requirement** — Standard/Complex types require index.md at skill root. Lists all reference files.
- **Upgrade Path** — Start with simplest type satisfying requirements. Upgrade during refinement if scope expands.

---
## [5][DEPTH]
>**Dictum:** *Depth determines comprehensiveness.*

<br>

Depth prevents bloat through hard caps. Each level adds fixed increments: +50 LOC to SKILL.md, +25 LOC to other files (cumulative).

**Required Task:**<br>
1. Read [→depth.md](./references/depth.md): Full constraint tables, section gates, validation checklist.

**Guidance:**<br>
- `Mechanism` — Base enforces hard limits. Extended/Full add +50/+25 cumulative (<400/<200).
- `Nesting Gate` — Base = flat only. Extended = 1 subfolder. Full = 1-3 subfolders.
- `Section Gate` — Base: Tasks/References only. Extended: +Guidance, sparse Best-Practices. Full: comprehensive.
- `Baseline Limits` — SKILL.md <300 LOC, reference files <150 LOC at Base depth.

**Best-Practices:**<br>
- **Depth Selection** — Base for focused skills. Extended for moderate coverage. Full for comprehensive.
- **Core Domain** — Identify most essential domain before Extended (becomes subfolder).
- **Hard Caps** — Exceeding limits requires refactoring, not justification. No exceptions.

---
## [6][FRONTMATTER]
>**Dictum:** *Metadata enables discovery before loading.*

<br>

Frontmatter indexing occurs at session start for discovery table construction. Description is the ONLY field parsed for relevance matching—quality determines invocation accuracy.

**Required Task:**<br>
1. Read [→frontmatter.md](./references/frontmatter.md): Schema fields, trigger patterns, validation checklist.

**Guidance:**<br>
- `Discovery` — Discovery uses LLM reasoning only. No embeddings, no keyword matching. Description text determines relevance during forward pass.
- `Token Budget` — Only ~100 tokens loaded at startup. Conciseness maximizes discovery signal per token.
- `Optimization Target` — Description is the sole trigger mechanism. Every word must aid intent matching.
- `Failure Mode` — Poor descriptions prevent discovery. Matching failure blocks invocation.

**Best-Practices:**<br>
- **Length** — 1-2 sentences. Concise triggers outperform verbose explanations.
- **Voice** — [CRITICAL] Third person, active voice, present tense. Prohibited: 'could', 'might', 'probably', 'should'.
- **Signal Density** — Maximize matching surface: file types, operations, "Use when" clauses, catch-all phrases.

---
## [7][SCRIPTING]
>**Dictum:** *Deterministic automation extends LLM capabilities.*

<br>

Complex type enables scripts/ folder. Downstream skills execute automation for external tool orchestration, artifact generation, validation.

**Conditional Task:**<br>
1. (Requires: complex) Read [→scripting.md](./references/scripting.md): Standards, patterns, quality gate.

**Guidance:**<br>
- `Complex Justification` — Script overhead demands explicit need: external tool wrapping, exact reproducibility, schema enforcement.
- `Downstream Value` — Skills with scripts provide CLI tooling, deterministic generation, validation beyond LLM generation.
- `Depth Scaling` — Base/Extended: single script. Full: multiple scripts when distinct concerns justify separation.

**Best-Practices:**<br>
- **Type Selection** — Standard suffices for most skills. Choose complex only when deterministic automation is core to skill purpose.
- **Augmentation** — Scripts support skill workflows. Core logic remains in SKILL.md and references.
- **Pattern Delegation** — Criteria, tooling versions, code patterns, and quality gate defined in scripting.md.

---
## [8][TEMPLATES]
>**Dictum:** *Templates enforce canonical structure.*

<br>

Skill templates define scaffolds for generated artifacts. Agent combines user input with template structure to produce consistent outputs. Standard/Complex types only.

**References:**<br>
- [→simple.skill.template.md](./templates/simple.skill.template.md): Single-file skill scaffold.
- [→standard.skill.template.md](./templates/standard.skill.template.md): Multi-file skill with references/, templates/.
- [→complex.skill.template.md](./templates/complex.skill.template.md): Full skill with scripts/ automation.

**Guidance:**<br>
- `Purpose` — Templates define canonical output structure. Follow template exactly. No improvisation.
- `Composition` — Input data + template skeleton = generated artifact. Templates encode structural decisions.
- `Canonical Form` — Base/Extended depth: single template per output type. Full depth: variations permitted.

**Best-Practices:**<br>
- **Placeholder Syntax** — Use `${variable-name}` for insertion points. Document required vs optional fields.
- **Structure Match** — Template complexity matches depth selection. Base templates are minimal; Full templates are comprehensive.
