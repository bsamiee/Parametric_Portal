# [H1][INDEX]
>**Dictum:** *Reference navigation requires centralized discovery.*

<br>

Navigate hook configuration, lifecycle, integration patterns.

| [INDEX] | [DOMAIN]        | [PATH]                                               | [DICTUM]                                                 |
| :-----: | --------------- | ---------------------------------------------------- | -------------------------------------------------------- |
|   [1]   | Schema          | [→schema.md](references/schema.md)                   | Schema compliance ensures valid configuration.           |
|   [2]   | Lifecycle       | [→lifecycle.md](references/lifecycle.md)             | Lifecycle understanding enables correct event selection. |
|   [3]   | Integration     | [→integration.md](references/integration.md)         | Integration knowledge enables precedence control.        |
|   [4]   | Scripting       | [→scripting.md](references/scripting.md)             | Functional pipeline patterns ensure reliable hooks.      |
|   [5]   | Recipes         | [→recipes.md](references/recipes.md)                 | Proven patterns accelerate development.                  |
|   [6]   | Troubleshooting | [→troubleshooting.md](references/troubleshooting.md) | Known issues enable defensive implementation.            |
|   [7]   | Validation      | [→validation.md](references/validation.md)           | Operational criteria verify hook quality.                |

**Summary:**
- *Hook types:* `command` (60s), `prompt` (30s, Stop/SubagentStop only).
- *Block action:* Exit code 2 + stderr (exit 1 also blocks—bug #4809).
- *Context injection:* SessionStart, UserPromptSubmit stdout.
- *Security:* `shell=False`, `realpath()`, no `eval()`.
- *Windows:* Use absolute paths—env vars not expanded.
