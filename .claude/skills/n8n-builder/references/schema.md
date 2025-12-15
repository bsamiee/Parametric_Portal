# [REF][SCHEMA]
>**Dictum:** *Schema validation prevents runtime failures at import boundary.*

<br>

---
## [1][ROOT_FIELDS]
>**Dictum:** *Root object structure determines import validity.*

<br>

| [INDEX] | [FIELD]       | [TYPE]  | [REQUIRED] | [DEFAULT]      |
| :-----: | ------------- | ------- | :--------: | -------------- |
|   [1]   | `name`        | string  |    Yes     | —              |
|   [2]   | `nodes`       | array   |    Yes     | —              |
|   [3]   | `connections` | object  |    Yes     | —              |
|   [4]   | `id`          | UUID    |     No     | auto-generated |
|   [5]   | `active`      | boolean |     No     | `false`        |
|   [6]   | `settings`    | object  |     No     | `{}`           |
|   [7]   | `staticData`  | object  |     No     | `null`         |
|   [8]   | `pinData`     | object  |     No     | `{}`           |
|   [9]   | `versionId`   | UUID    |     No     | auto-generated |
|  [10]   | `meta`        | object  |     No     | `{}`           |
|  [11]   | `tags`        | array   |     No     | `[]`           |
|  [12]   | `createdAt`   | string  |     No     | ISO timestamp  |
|  [13]   | `updatedAt`   | string  |     No     | ISO timestamp  |

---
## [2][SETTINGS]

<br>

| [INDEX] | [KEY]                   | [TYPE]  | [VALUES]                                      |
| :-----: | ----------------------- | ------- | --------------------------------------------- |
|   [1]   | `executionOrder`        | string  | `"v1"`                                        |
|   [2]   | `errorWorkflow`         | string  | UUID of error handler                         |
|   [3]   | `timeout`               | number  | seconds                                       |
|   [4]   | `timezone`              | string  | IANA (e.g., `"America/New_York"`)             |
|   [5]   | `callerPolicy`          | string  | `"any"`, `"workflowsFromSameOwner"`, `"none"` |
|   [6]   | `saveManualExecutions`  | boolean | persist test runs                             |
|   [7]   | `saveExecutionProgress` | boolean | resume capability                             |

---
## [3][META]

<br>

| [INDEX] | [KEY]                         | [TYPE]  | [PURPOSE]                |
| :-----: | ----------------------------- | ------- | ------------------------ |
|   [1]   | `instanceId`                  | string  | Installation fingerprint |
|   [2]   | `templateCredsSetupCompleted` | boolean | Suppress setup wizard    |

---
## [4][STATIC_DATA]

<br>

Access persistent key-value storage via `$getWorkflowStaticData()`.
- Workflow-level: global scope
- Node-level: `$getWorkflowStaticData('node')`

---
## [5][PIN_DATA]

<br>

```json
"pinData": {
  "NodeName": [{ "json": { "key": "value" } }]
}
```

- Size limit: 12-16MB (`N8N_PAYLOAD_SIZE_MAX`)
- Test-only: ignored in production execution
- Binary data cannot be pinned

---
## [6][WORKFLOW_INPUTS]

<br>

Trigger node input schema for typed sub-workflow interfaces (2025).

```json
"parameters": {
  "workflowInputs": {
    "schema": [
      { "id": "userId", "type": "number", "required": true, "display": true }
    ]
  }
}
```

- Validates caller payload before execution
- Rejects type mismatches immediately
- Defined on trigger node, not workflow root

---
## [7][VERSION_TRACKING]

<br>

| [INDEX] | [FIELD]      | [PURPOSE]                                       |
| :-----: | ------------ | ----------------------------------------------- |
|   [1]   | `versionId`  | Changes per save; enables diff tracking         |
|   [2]   | `instanceId` | Source installation fingerprint; strip on share |

2025 Publish/Save paradigm: saved (draft) vs published (production) versions.
