---
name: ${style-name}
description: ${style-purpose}
scope: ${global|project|skill|command}
audience: ${target-audience}
---

# [H1][${STYLE_NAME}]
>**Dictum:** *${response-truth}.*

<br>

${one-sentence-purpose}

[DELEGATE] Voice rules → `style-standards/references/voice/`. Formatting rules → `style-standards/references/formatting/`.

---
## [1][VOICE]
>**Dictum:** *Parameterized voice ensures consistent tone across contexts.*

<br>

| [INDEX] | [PARAMETER]     | [LEVEL]           | [EFFECT]                       |
| :-----: | --------------- | ----------------- | ------------------------------ |
|   [1]   | Formality       | ${0-100}%         | ${formality-description}       |
|   [2]   | Technical Depth | ${low\|med\|high} | ${technical-depth-description} |
|   [3]   | Directness      | ${0-100}%         | ${directness-description}      |
|   [4]   | Enthusiasm      | ${0-100}%         | ${enthusiasm-description}      |

<br>

### [1.1][GRAMMAR]

[IMPORTANT]:
- [ALWAYS] **Active Voice:** ${active-voice-requirement}.
- [ALWAYS] **Imperative Actions:** ${imperative-pattern}.
- [ALWAYS] **Tense:** ${tense-requirement}.

[CRITICAL]:
- [NEVER] **Self-Reference:** Prohibit "I", "we", "you" unless ${exception-condition}.
- [NEVER] **Hedging:** Prohibit "might", "could", "probably", "should".
- [NEVER] **Meta-Commentary:** Prohibit "Sourced from", "Confirmed with".

[REFERENCE] Grammar → `style-standards/references/voice/grammar.md`.

<br>

### [1.2][TONE]

**Primary:** ${primary-tone} — ${tone-description}.<br>
**Secondary:** ${secondary-tone} — ${tone-context}.<br>
**Prohibited:** ${prohibited-tone-1}, ${prohibited-tone-2}.

---
## [2][STRUCTURE]
>**Dictum:** *Structured formatting reduces cognitive load.*

<br>

| [INDEX] | [ELEMENT]        | [THRESHOLD]   | [RULE]                           |
| :-----: | ---------------- | ------------- | -------------------------------- |
|   [1]   | Response Length  | ${min}-${max} | ${length-constraint-description} |
|   [2]   | Paragraph Length | ${min}-${max} | ${paragraph-constraint}          |
|   [3]   | Header Usage     | ${threshold}  | ${header-usage-rule}             |
|   [4]   | List Conversion  | ${threshold}  | ${list-threshold-description}    |

[REFERENCE] Structure → `style-standards/references/formatting/structure.md`.

---
## [3][CONSTRAINTS]
>**Dictum:** *Explicit boundaries enforce output quality.*

<br>

| [INDEX] | [CATEGORY]   | [CONSTRAINT]          | [ENFORCEMENT]                     |
| :-----: | ------------ | --------------------- | --------------------------------- |
|   [1]   | Token Budget | ${min}-${max} tokens  | ${budget-enforcement-description} |
|   [2]   | Emojis       | ${allowed\|forbidden} | ${emoji-policy}                   |
|   [3]   | Code Blocks  | ${threshold}          | ${code-block-rule}                |

<br>

### [3.1][PROHIBITED]

[CRITICAL]:
- [NEVER] **${prohibited-pattern-1}:** ${rationale-1}.
- [NEVER] **${prohibited-pattern-2}:** ${rationale-2}.
- [NEVER] **${prohibited-pattern-3}:** ${rationale-3}.

[REFERENCE] Constraints → `style-standards/references/voice/constraints.md`.

---
## [4][VALIDATION]
>**Dictum:** *Pre-flight verification prevents deployment errors.*

<br>

[VERIFY]:
- [ ] Voice: Formality at ${formality}%, active voice, zero hedging.
- [ ] Structure: Response within ${min}-${max} words, headers per threshold.
- [ ] Constraints: No emojis, no meta-commentary, no self-reference.
- [ ] Tone: ${primary-tone} maintained throughout.
