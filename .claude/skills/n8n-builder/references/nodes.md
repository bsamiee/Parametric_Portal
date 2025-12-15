# [REF][NODES]
>**Dictum:** *Structured identity enables validation, execution, and cross-instance serialization.*

<br>

---
## [1][REQUIRED_FIELDS]
>**Dictum:** *Required fields establish node identity uniqueness.*

<br>

| [INDEX] | [FIELD]    | [TYPE] | [CONSTRAINT]           |
| ------- | ---------- | ------ | ---------------------- |
| 1       | `id`       | UUID   | Unique, primary key    |
| 2       | `name`     | string | Unique within workflow |
| 3       | `type`     | string | Node identifier        |
| 4       | `position` | [x, y] | Canvas coordinates     |

---
## [2][OPTIONAL_FIELDS]
>**Dictum:** *Optional fields configure execution behavior and error handling.*

<br>

| [INDEX] | [FIELD]              | [TYPE]  | [DEFAULT]            |
| ------- | -------------------- | ------- | -------------------- |
| 1       | `typeVersion`        | number  | `1`                  |
| 2       | `parameters`         | object  | Node-specific        |
| 3       | `credentials`        | object  | `{type: {id, name}}` |
| 4       | `disabled`           | boolean | `false`              |
| 5       | `onError`            | string  | `"stopWorkflow"`     |
| 6       | `retryOnFail`        | boolean | `false`              |
| 7       | `maxRetries`         | number  | —                    |
| 8       | `waitBetweenRetries` | number  | ms                   |
| 9       | `notes`              | string  | —                    |
| 10      | `notesInFlow`        | boolean | `false`              |
| 11      | `continueOnFail`     | boolean | `false`              |

onError values: `"stopWorkflow"`, `"continueRegularOutput"`, `"continueErrorOutput"`.

---
## [3][TYPE_NAMING]
>**Dictum:** *Type naming encodes package source and node identity.*

<br>

| [INDEX] | [PATTERN]                         | [EXAMPLE]                   |
| ------- | --------------------------------- | --------------------------- |
| 1       | `n8n-nodes-base.{name}`           | `httpRequest`, `if`, `code` |
| 2       | `@n8n/n8n-nodes-langchain.{name}` | `agent`, `openAi`           |
| 3       | `{package}.{name}`                | Community nodes             |

---
## [4][CREDENTIALS]
>**Dictum:** *Credential references decouple secrets from workflow definitions.*

<br>

```json
"credentials": {
  "slackOAuth2Api": {
    "id": "credential-uuid",
    "name": "Slack OAuth"
  }
}
```

- Contains no secrets (reference only)
- References instance-specific IDs, invalidates cross-instance
- Causes ~40% import failure from credential/version mismatch

---
## [5][STICKY_NOTES]
>**Dictum:** *Sticky notes provide visual workflow documentation.*

<br>

Type: `n8n-nodes-base.stickyNote`

| [INDEX] | [PARAMETER] | [TYPE] | [VALUES]            |
| ------- | ----------- | ------ | ------------------- |
| 1       | `content`   | string | CommonMark markdown |
| 2       | `height`    | number | pixels              |
| 3       | `width`     | number | pixels              |
| 4       | `color`     | number | 1-7 (integer)       |

---
## [6][POSITIONING]
>**Dictum:** *Consistent positioning optimizes canvas readability.*

<br>

Use 200px horizontal, 150px vertical spacing between nodes.
