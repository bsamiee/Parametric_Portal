# [H1][NAMING]
>**Dictum:** *Consistent naming enables pattern recognition.*

<br>

---
## [1][CODE]
>**Dictum:** *Prefixes encode category.*

<br>

[IMPORTANT] Strict naming taxonomy. Enforce exact prefixes/suffixes.

| [INDEX] | [CATEGORY]       | [PATTERN]             | [EXAMPLE]                                |
| :-----: | ---------------- | --------------------- | ---------------------------------------- |
|   [1]   | Config constant  | `B`                   | `const B = Object.freeze({...})`         |
|   [2]   | Schema           | `*Schema`             | `InputSchema`, `UserSchema`              |
|   [3]   | Factory function | `create*`             | `createConfig`, `createHandler`          |
|   [4]   | Action function  | Verb-noun             | `validate*`, `transform*`, `dispatch*`   |
|   [5]   | Dispatch table   | `*Handlers`           | `modeHandlers`, `labelHandlers`          |
|   [6]   | Effect pipeline  | `*Pipeline`           | `validationPipeline`                     |
|   [7]   | Type parameter   | Single uppercase      | `<T>`, `<M>`, `<const T>`                |
|   [8]   | Branded type     | PascalCase noun       | `UserId`, `IsoDate`, `HexColor`          |
|   [9]   | Error type       | `*Error`              | `ValidationError`, `TransformError`      |
|  [10]   | Boolean          | `is*`, `has*`, `can*` | `isValid`, `hasPermission`, `canExecute` |

[CRITICAL]:
- [NEVER] `utils`, `helpers`, `misc`—too vague.
- [NEVER] `config` as variable—conflicts with `B` pattern.
- [NEVER] Abbreviations: `cfg`, `opts`, `params`.
- [NEVER] Generic suffixes: `Data`, `Info`, `Manager`, `Service`.

[REFERENCE] Summary: [→SKILL.md§2.2[VOICE]](../../SKILL.md#22voice)

---
## [2][FILES]
>**Dictum:** *[PENDING]*

<br>

[PENDING] File naming conventions.
