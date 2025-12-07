# [H1][COMMENTS]
>**Dictum:** *Comments explain why, not what.*

<br>

[IMPORTANT] Comment augmentation yields 40-53% accuracy improvement. Early-program documentation receives 4.6× more comprehension than late-program (60% vs 13% fault detection).

**Accuracy Tradeoff:**<br>
*Incorrect comments:* 78% accuracy loss—worse than missing comments.<br>
*Missing comments:* Minimal impact—models rely on code structure.

[CRITICAL] Front-load architectural decisions and domain semantics where attention peaks.

---
## [1][RULES]
>**Dictum:** *Intent outweighs description.*

<br>

[IMPORTANT]:
1.  [ALWAYS] **Why > What:** Explaining *logic* (Redundant) = Noise. Explaining *intent* (Grounding) = Signal.
    -   *Noise:* `// Increment i`
    -   *Signal:* `// Optimization: Bitshift faster`
2.  [ALWAYS] **Anchor-First:** Start JSDoc with **Action Verb**.
3.  [ALWAYS] **Mechanical Voice:** Domain-specific, no hedging.

[CRITICAL]:
- [NEVER] **Type-Lite:** Duplicate TS types in comments (e.g., `@param {string} name`). Type system is single source of truth.
- [NEVER] **Obvious:** Comment only when code cannot express intent.

```typescript
// Wrap to 0-360 range for OKLCH hue normalization
const normalizedHue = ((h % 360) + 360) % 360;
```

---
## [2][JSDOC]
>**Dictum:** *Structure enables parsing.*

<br>

```typescript
/**
 * [Imperative_Verb] [Outcome].
 * [Grounding]: [Why_this_exists].
 */
```

| [INDEX] | [COMPONENT] | [REQUIREMENT]                    |
| :-----: | ----------- | -------------------------------- |
|   [1]   | Verb        | Start with imperative verb.      |
|   [2]   | Object      | State what is acted upon.        |
|   [3]   | Mechanism   | Include domain context.          |
|   [4]   | Details     | Mechanical behavior, not intent. |

**Tag Order:** `@param` → `@returns` → `@throws` → `@example`
