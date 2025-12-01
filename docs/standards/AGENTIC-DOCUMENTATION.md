---
description: Universal standards for LLM-optimized documentation, comments, and naming
alwaysApply: true
---

# Agentic Documentation Standards

Universal standards for LLM-optimized documentation, comments, and naming conventions.

---
## [1][APPLICATION]

Universal scope: Apply these standards to ALL documentation types.

| Type | Example | Applicable Sections |
|------|---------|---------------------|
| Agent instruction files | `.agent.md`, `CLAUDE.md` | Keywords, Voice, Boundaries, Structure |
| JSDoc headers | `/** ... */` | Headers, Voice |
| Inline comments | `// ...` | Comments, Voice |
| Markdown documentation | `*.md` in `docs/` | Keywords, Voice, Structure, Syntax |
| Parameter naming | Function signatures | Parameters |

NEVER apply selectively. ALWAYS enforce across all documentation surfaces.

---
## [2][KEYWORDS]

Validated emphasis markers for instruction adherence.

| Marker | Semantic | Usage |
|--------|----------|-------|
| `MUST` | Non-negotiable requirement | `MUST return Option, not null` |
| `NEVER` | Absolute prohibition | `NEVER use any type` |
| `ALWAYS` | Mandatory in all cases | `ALWAYS use const` |
| `IMPORTANT` | Critical attention flag | Section-level emphasis |
| `[AVOID]` | Discouraged pattern | Show bad + reason |
| `[USE]` | Preferred pattern | Show good + benefit |
| `[FORBIDDEN]` | Prohibited list header | Constraint sections |
| `[REQUIRED]` | Mandatory list header | Requirement sections |

**Rules:**
- Capitalize for visual parsing
- Max 3-5 per section to maintain signal strength
- Pair with concrete outcome

**Compliance Hierarchy:**

| Keyword | Compliance | Usage |
|---------|------------|-------|
| `NEVER` | 85-90% | Absolute prohibitions |
| `REQUIRED` | 80-85% | Mandatory parameters, non-negotiable steps |
| `MUST` | 80-85%* | Requirements (*when repeated at decision points) |
| `ALWAYS` | 70-75% | Procedural consistency |

**Positioning:**
- Place NEVER early in instruction sequence
- Repeat MUST at specific decision points (not just preamble)
- Use 3-5 mentions per section maximum; diminishing returns after 5

**Negation Preference:** "NEVER X" outperforms "ALWAYS avoid X" by 15-20%. Prefer negative framing for prohibitions.

---
## [3][VOICE]

Imperative, mechanical, domain-specific.

| Pattern | Example |
|---------|---------|
| Verb-first | Validate input via schema |
| No hedging | Dispatch by mode |
| Symbol reference | Return B.config merged with defaults |
| Mechanical behavior | Transform array to Effect.all |

**[FORBIDDEN]:**
- Self-referential: "This file...", "We do...", "You should..."
- Capability disclaimers: "can handle", "is able to"
- Hedging: "might", "could", "probably", "should"

---
## [4][STRUCTURE]

Optimal section ordering for agent ingestion.

**Instruction Files:**
1. Identity/Role
2. Critical Rules
3. Domain Patterns
4. Exemplars
5. Validation
6. Summary

**Code Files:**
1. Types
2. Schema
3. Constants
4. Pure Functions
5. Dispatch Tables
6. Effect Pipeline
7. Entry Point
8. Export

**Section Markers:**

| Context | Format | Example |
|---------|--------|---------|
| Code files | `// --- Label ---` (80 chars) | `// --- Types ---` |
| Instruction files | `# [LABEL]` | `# [CONSTRAINTS]` |
| Numbered patterns | `## Pattern N: Title` | `## Pattern 1: Validation` |

---
## [5][SYNTAX]

Punctuation and formatting rules.

| Element | Rule | Example |
|---------|------|---------|
| Colon | After label, before definition | `[RULE]: Validate before commit` |
| Period | End complete statements | `Return merged config.` |
| Comma | Separate list items in prose | `validate, transform, dispatch` |
| Dash | Connect compound concepts | `Functional-Monadic` |
| Backticks | Code symbols, paths, commands | `` `B.config` `` |

**Formatting:**
- Tables for comparisons
- Bullets for lists, numbered for sequences
- Code blocks with language tags
- No emoji; use `[X]` markers for status

---
## [6][PARAMETERS]

Strict naming taxonomy. MUST enforce exact prefixes/suffixes.

| Category | Pattern | Example |
|----------|---------|---------|
| Config constant | `B` | `const B = Object.freeze({...})` |
| Schema | `*Schema` | `InputSchema`, `UserSchema` |
| Factory function | `create*` | `createConfig`, `createHandler` |
| Action function | Verb-noun | `validate*`, `transform*`, `dispatch*` |
| Dispatch table | `*Handlers` | `modeHandlers`, `labelHandlers` |
| Effect pipeline | `*Pipeline` | `validationPipeline` |
| Type parameter | Single uppercase | `<T>`, `<M>`, `<const T>` |
| Branded type | PascalCase noun | `UserId`, `IsoDate`, `HexColor` |
| Builder context | `*Context` | `BuilderContext`, `RenderContext` |
| Error type | `*Error` | `ValidationError`, `TransformError` |
| Boolean | `is*`, `has*`, `can*`, `should*` | `isValid`, `hasPermission`, `canExecute` |

**[FORBIDDEN] Names:**
- `utils`, `helpers`, `misc` — too vague
- `config` as variable — conflicts with B pattern
- Abbreviations — `cfg`, `opts`, `params`
- Generic suffixes — `Data`, `Info`, `Manager`, `Service`

---
## [7][COMMENTS]

Comment only when code cannot express intent.

**[USE] Comments For:**
- Non-obvious design decisions
- Edge case handling rationale
- Performance tradeoffs
- External API constraints

**[AVOID] Comments For:**
- Restating code behavior
- Type information in signatures
- Change tracking (use git)
- Self-referential meta-commentary

**Voice:**
```typescript
// Wrap to 0-360 range for OKLCH hue normalization
const normalizedHue = ((h % 360) + 360) % 360;
```

---
## [8][HEADERS]

JSDoc 2-line format for all TypeScript files.

```typescript
/**
 * [Verb] [object] [mechanism]: [details].
 * Uses [B.path, fn.name, call.method] from schema.ts.
 */
```

**Line 1:**
- Start with imperative verb
- State mechanical behavior
- Include domain context

**Line 2:**
- Format: `Uses [paths] from schema.ts.`
- List specific paths, not wildcards
- Order: `B.*` → `fn.*` → `call.*` → `mutate.*`
- Omit if no schema dependencies

**Tag Order (when present):**
`@param` → `@returns` → `@throws` → `@example`

---
## [9][EXEMPLARS]

Concrete examples for pattern recognition.

**[USE] Good Header:**
```typescript
/**
 * Command palette components: render dialog, inline, and palette command interfaces.
 * Uses B, fn, animStyle, stateCls, createBuilderContext from schema.ts.
 */
```

**[AVOID] Bad Header:**
```typescript
/**
 * This file contains command components.
 * It exports various utilities for the command palette.
 */
```

**[USE] Good Section Separator:**
```typescript
// --- Types -------------------------------------------------------------------
// --- Schema ------------------------------------------------------------------
// --- Constants ---------------------------------------------------------------
```

**[AVOID] Bad Section Separator:**
```typescript
// Types
// ------
/* Schema Section */
```

**[USE] Good Naming:**
```typescript
const InputSchema = S.Struct({ name: S.String });
const createValidator = (schema: S.Schema<unknown>) => { ... };
const modeHandlers = { dark: applyDark, light: applyLight };
```

**[AVOID] Bad Naming:**
```typescript
const inputValidator = S.Struct({ name: S.String });
const makeValidator = (schema: S.Schema<unknown>) => { ... };
const handlers = { dark: applyDark, light: applyLight };
```

---
## [10][VALIDATION]

Checklist before committing documentation.

- [ ] Imperative voice throughout
- [ ] No hedging language
- [ ] Keywords used sparingly (max 3-5 per section)
- [ ] Tables for comparisons
- [ ] Concrete exemplars for each rule
- [ ] No self-referential commentary
- [ ] Strict naming taxonomy enforced

---
## [11][BOUNDARIES]

Three-tier boundary system for agent instruction files.

| Tier | Marker | Semantic | Example |
|------|--------|----------|---------|
| ALWAYS | `[ALWAYS]` | Execute without confirmation | Lint before commit |
| ASK | `[ASK]` | Request user approval first | Add dependencies |
| NEVER | `[NEVER]` | Absolute prohibition | Commit secrets |

**Definitions:**
- ALWAYS: Actions agent MUST take autonomously
- ASK: Actions requiring explicit user confirmation
- NEVER: Actions agent MUST refuse under all conditions

**Exemplar:**
```markdown
[ALWAYS]: Run `pnpm typecheck` before commit
[ASK]: Before adding new dependencies
[NEVER]: Commit files matching `.env*`, `*credentials*`
```
