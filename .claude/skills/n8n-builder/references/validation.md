# [REF][VALIDATION]
>**Dictum:** *Constraint validation eliminates import-time failures.*

<br>

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
## [6][CHECKLIST]

- [ ] `nodes` array non-empty
- [ ] All `node.id` unique UUIDs
- [ ] All `node.name` unique strings
- [ ] `settings.executionOrder` = `"v1"`
- [ ] `connections` reference existing node names
- [ ] AI connections use correct type keys
- [ ] Credentials reference valid names
