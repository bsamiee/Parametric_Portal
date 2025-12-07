# [H1][INDEX]
>**Dictum:** *Single navigation source enables rapid reference discovery.*

<br>

Reference file listing for hooks-builder skill.

| [INDEX] | [DOMAIN]    | [PATH]                                       | [DICTUM]                                              |
| :-----: | ----------- | -------------------------------------------- | ----------------------------------------------------- |
|   [1]   | Schema      | [→schema.md](references/schema.md)           | Configuration structure determines hook registration. |
|   [2]   | Lifecycle   | [→lifecycle.md](references/lifecycle.md)     | Event selection determines automation scope.          |
|   [3]   | Integration | [→integration.md](references/integration.md) | Settings precedence governs hook resolution.          |
|   [4]   | Scripting   | [→scripting.md](references/scripting.md)     | Functional pipelines produce reliable hooks.          |

**Quick Reference:**<br>
- *Hook types:* `command` (60s), `prompt` (30s)
- *Block action:* Exit code 2 + stderr
- *Context injection:* SessionStart, UserPromptSubmit stdout
- *Security:* `shell=False`, `realpath()`, no `eval()`
