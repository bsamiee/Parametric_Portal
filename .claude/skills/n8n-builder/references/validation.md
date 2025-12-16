# [REF][VALIDATION]
>**Dictum:** *Constraint validation eliminates import-time failures.*

<br>

---
## [0][SCRIPT]

```bash
# Basic validation (warnings for UUID/position issues)
uv run .claude/skills/n8n-builder/scripts/validate-workflow.py workflow.json

# Strict mode (warnings become errors)
uv run .claude/skills/n8n-builder/scripts/validate-workflow.py workflow.json --strict
```

**Output:** JSON with `status`, `errors`, `warnings` arrays.

---
## [1][GENERATION_RULES]

1. Generate UUID per node.id.
2. Assign unique node.name per workflow.
3. Match node.typeVersion to target n8n instance.
4. Space canvas nodes: 200px horizontal, 150px vertical.
5. Assign empty objects to optional fields (`"pinData": {}`).
6. Validate connection references to existing node names.
7. Match AI connection key AND type property.

---
## [2][ERROR_SYMPTOMS]

| [INDEX] | [SYMPTOM]                | [CAUSE]                   | [FIX]                     |
| :-----: | ------------------------ | ------------------------- | ------------------------- |
|   [1]   | Silent workflow failures | Duplicate node IDs        | Generate unique UUIDs     |
|   [2]   | Broken expressions       | Name collision (Set→Set1) | Pre-validate unique names |
|   [3]   | Node parameter errors    | Mismatched typeVersion    | Match target n8n version  |
|   [4]   | AI tools not visible     | `main` type for AI        | Use `ai_tool` type        |
|   [5]   | Agent stateless          | Missing ai_memory         | Add memory connection     |
|   [6]   | Credential error on run  | ID mismatch               | Reassign post-import      |
|   [7]   | Settings reverted        | API bug                   | POST then PUT pattern     |

---
## [3][API_DEPLOYMENT]

```
POST /workflows         → Creates workflow (may ignore settings)
PUT /workflows/{id}     → Updates workflow (settings persist)
```

Execute two-step pattern for reliable settings persistence.

---
## [4][SOURCE_CONTROL]

<br>

Git repository structure for n8n Enterprise Source Control:

```
workflows/    → Workflow JSON files
credentials/  → Credential stubs (no secrets)
tags/         → Tag metadata definitions
```

- Credential files contain type/name mappings only
- Actual secrets stored in database/vault
- `instanceId` should be stripped when sharing

---
## [5][PERFORMANCE]

| [INDEX] | [SETTING]               | [HIGH_THROUGHPUT] | [CRITICAL_PROCESS] |
| :-----: | ----------------------- | :---------------: | :----------------: |
|   [1]   | `saveExecutionProgress` |      `false`      |       `true`       |

`saveExecutionProgress: true` triggers DB I/O after each node—avoid for high-throughput workflows.

---
## [6][CHECKS]

| [INDEX] | [CHECK]                  | [SEVERITY] | [AUTOMATED] |
| :-----: | ------------------------ | :--------: | :---------: |
|   [1]   | `root_required`          |   Error    |     Yes     |
|   [2]   | `root_types`             |   Error    |     Yes     |
|   [3]   | `node_required`          |   Error    |     Yes     |
|   [4]   | `node_id_uuid`           |  Warning   |     Yes     |
|   [5]   | `node_id_unique`         |   Error    |     Yes     |
|   [6]   | `node_name_unique`       |   Error    |     Yes     |
|   [7]   | `node_position`          |  Warning   |     Yes     |
|   [8]   | `node_on_error`          |   Error    |     Yes     |
|   [9]   | `conn_targets_exist`     |   Error    |     Yes     |
|  [10]   | `conn_ai_type_match`     |   Error    |     Yes     |
|  [11]   | `settings_caller_policy` |   Error    |     Yes     |
|  [12]   | `settings_exec_order_ai` |   Error    |     Yes     |

Run `validate-workflow.py --help` for check descriptions.
