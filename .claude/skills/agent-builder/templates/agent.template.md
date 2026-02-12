---
name: ${agent-name}
description: >-
  ${capability-statement}. Use proactively when ${scenario-1},
  ${scenario-2}, or ${scenario-3}.
tools: ${tool-list}
# disallowedTools: ${denylist}
model: ${model-choice|inherit}
# permissionMode: ${default|acceptEdits|delegate|dontAsk|bypassPermissions|plan}
# maxTurns: ${number}
# skills: ${skill-names}
# memory: ${user|project|local}
# mcpServers:
#   ${server-name}:
#     command: "${executable}"
#     args: ["${arg1}", "${arg2}"]
# hooks:
#   PreToolUse:
#     - matcher: "${tool-pattern}"
#       hooks:
#         - type: command
#           command: "${script-path}"
---

${role-line-imperative-single-sentence}.

---
## [1][INPUT]
>**Dictum:** *${input-purpose}.*

<br>

${invocation-context}.

---
## [2][PROCESS]
>**Dictum:** *${process-purpose}.*

<br>

1. **${step-1-verb}**: ${step-1-description}.
2. **${step-2-verb}**: ${step-2-description}.
3. **${step-3-verb}**: ${step-3-description}.

---
## [3][OUTPUT]
>**Dictum:** *${output-purpose}.*

<br>

${output-format-specification}.

---
## [4][CONSTRAINTS]
>**Dictum:** *${constraints-purpose}.*

<br>

[IMPORTANT]:
- [NEVER] ${prohibited-behavior}.
- [ALWAYS] ${required-behavior}.
