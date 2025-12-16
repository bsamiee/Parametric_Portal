---
description: Senior developer protocol for Parametric Portal monorepo
alwaysApply: true
---

# [H1][GEMINI_MANIFEST]
>**Dictum:** *Protocol governs recursive-agentic execution in monorepo context.*

<br>

@.gemini/standards/manifesto.md
@.gemini/standards/constitution.md
@.gemini/standards/communication-standards.md
@.gemini/standards/research-protocol.md
@.gemini/standards/workflow.md
@.gemini/standards/domain-automation.md
@.gemini/standards/domain-components.md
@.gemini/standards/mcp-tactics.md

---
## [1][STARTUP_SEQUENCE]
>**Dictum:** *Initialization establishes execution baseline.*

<br>

[IMPORTANT]:
1. [ALWAYS] **Activate:** Run `init-protocol` command to bootstrap environment.
2. [ALWAYS] **Acknowledge:** Output "Gemini 3.0 Pro active. Recursive-Agentic protocol engaged."

---
## [2][SYSTEM_INSTRUCTIONS]
>**Dictum:** *Instructions constrain agent behavior.*

<br>

### [2.1][DEEP_THINK_MANDATE]

[CRITICAL] Activate "Deep Think" mode for every interaction.

[IMPORTANT]:
1. [ALWAYS] **System 2 Protocol:** Execute `think` command before code generation.
2. [ALWAYS] **Sequential Thinking:** Follow [→.gemini/standards/mcp-tactics.md](.gemini/standards/mcp-tactics.md).

[CRITICAL]:
- [NEVER] Generate code without reasoning through architectural implications.
- [NEVER] Skip System 2 deliberation for complex tasks.

---
### [2.2][CONTEXT_AWARENESS]

[IMPORTANT]:
1. [ALWAYS] **Workspace Graph:** Read `nx.json`, `pnpm-workspace.yaml`, `package.json` at session start.
2. [ALWAYS] **Requirements:** Read [→REQUIREMENTS.md](REQUIREMENTS.md).
3. [ALWAYS] **Documentation Standards:** Read [→docs/styleguide/voice.md](docs/styleguide/voice.md).

---
### [2.3][CONFIGURATION_COMPLIANCE]

[CRITICAL] Verify and adhere to authoritative configurations.

[IMPORTANT]:
- [ALWAYS] **Linting/Formatting:** `@biome.json` (strict no-any, no-loops, cognitive complexity < 25).
- [ALWAYS] **Build/Targets:** `@nx.json` (target defaults, cache settings).
- [ALWAYS] **Compilation:** `@tsconfig.base.json` (strict types, exact optional properties).
- [ALWAYS] **Bundling:** `@vite.config.ts` (centralized plugins, PWA, compression).
- [ALWAYS] **Code Quality:** `@sonar-project.properties` (SonarCloud analysis, rule exclusions).

[CRITICAL]:
- [NEVER] Handroll logic handled by configuration files.
- [NEVER] Override config defaults without explicit justification.

---
### [2.4][GENERATION_GATE]

[CRITICAL] Execute optimization hook before generating code.

[VERIFY]:
- [ ] **Optimization:** Achievable with less code? (Target 25-30 LOC/feature).
- [ ] **Redundancy:** Logic provided by `vite.config.ts` or `nx.json`?
- [ ] **Wrapper Check:** Creating wrapper used < 3 times?
- [ ] **Modernity:** Bleeding-edge approach? (React 19, Effect, TS 6.0).

[CRITICAL]:
- [NEVER] Generate code that fails this gate.
- [NEVER] Create wrappers used fewer than 3 times.

---
### [2.5][CODE_AS_ACTION]

[IMPORTANT]:
- [ALWAYS] **Orchestration Scripts:** Write disposable Node.js/Shell scripts for multi-step verification or complex refactoring.
- [ALWAYS] **Verification:** Execute via `verify-script` command.
- [ALWAYS] **Pattern:** Adopt 2025 "Code Execution with MCP" (Anthropic/FoundationAgents).

[CRITICAL]:
- [NEVER] Manually execute repetitive CLI commands.
- [NEVER] Inline multi-step operations without script encapsulation.

---
### [2.6][SWARMING_AND_ROUTING]

[IMPORTANT]:
1. [ALWAYS] **Plan First:** Activate Phase 1 of [→.gemini/standards/workflow.md](.gemini/standards/workflow.md) (via `plan` command).
2. [ALWAYS] **Route:** Dispatch task via "Router Pattern" to correct specialist ([→.github/agents/](.github/agents/)).
3. [ALWAYS] **Synthesize:** Generate execution plan before implementation.

[CRITICAL]:
- [NEVER] Write code immediately without planning phase.
- [NEVER] Bypass specialist routing for domain-specific tasks.

---
### [2.7][DOGMATIC_COMPLIANCE]

[CRITICAL] Enforce [→.gemini/standards/constitution.md](.gemini/standards/constitution.md).

[CRITICAL]:
- [NEVER] Accept plans violating immutable laws.
- [NEVER] Accept code violating immutable laws.

---
### [2.8][SESSION_LIFECYCLE]

| [INDEX] | [PHASE] | [ACTION]                                                  |
| :-----: | :-----: | --------------------------------------------------------- |
|   [1]   |  Start  | `init-protocol`                                           |
|   [2]   | During  | `think` → `plan` → `recode` / `visual-audit` / `test-gen` |

---
## [3][INFRASTRUCTURE]
>**Dictum:** *Infrastructure paths enable agent navigation.*

<br>

| [INDEX] | [RESOURCE] | [PATH]                                      |
| :-----: | :--------: | ------------------------------------------- |
|   [1]   |  Commands  | [→.gemini/commands/](.gemini/commands/)     |
|   [2]   | Extensions | [→.gemini/extensions/](.gemini/extensions/) |
|   [3]   |   Agents   | [→.github/agents/](.github/agents/)         |
