# [REF][INTEGRATIONS]
>**Dictum:** *Parameter-driven integration enables workflow composition.*

<br>

---
## [1][TRIGGERS]
>**Dictum:** *Triggers initiate workflow execution.*

<br>

| [INDEX] | [TYPE]            | [TYPE_VERSION] | [KEY_PARAMETERS]                          |
| :-----: | ----------------- | :------------: | ----------------------------------------- |
|   [1]   | `webhook`         |       2        | path, httpMethod, responseMode, webhookId |
|   [2]   | `scheduleTrigger` |      1.2       | rule.interval                             |
|   [3]   | `githubTrigger`   |       —        | repository, events                        |
|   [4]   | `emailReadImap`   |       —        | mailbox, credentials                      |
|   [5]   | `manualTrigger`   |       1        | —                                         |

responseMode: `"onReceived"`, `"lastNode"`, `"responseNode"`.

---
## [2][LOGIC]
>**Dictum:** *Logic nodes control flow and transformation.*

<br>

| [INDEX] | [TYPE]           | [TYPE_VERSION] | [KEY_PARAMETERS]                  |
| :-----: | ---------------- | :------------: | --------------------------------- |
|   [1]   | `code`           |       2        | mode, language, jsCode            |
|   [2]   | `if`             |       2        | conditions.conditions, combinator |
|   [3]   | `switch`         |      3.2       | mode, rules.rules, fallbackOutput |
|   [4]   | `merge`          |      3.1       | mode, combineBy, mergeByFields    |
|   [5]   | `splitInBatches` |       3        | batchSize                         |
|   [6]   | `set`            |      3.4       | mode, assignments, options        |
|   [7]   | `wait`           |       1        | resume, amount, unit              |

Code language: `"javaScript"`, `"pythonNative"`.
Code mode: `"runOnceForAllItems"`, `"runOnceForEachItem"`.
Merge mode: `"append"`, `"combine"`, `"sql"`, `"chooseBranch"`.

---
## [3][HTTP]
>**Dictum:** *HTTP nodes enable external API communication.*

<br>

| [INDEX] | [TYPE]        | [TYPE_VERSION] | [KEY_PARAMETERS]                         |
| :-----: | ------------- | :------------: | ---------------------------------------- |
|   [1]   | `httpRequest` |      4.1       | url, httpMethod, headers, authentication |

---
## [4][DEVOPS]
>**Dictum:** *DevOps nodes integrate infrastructure operations.*

<br>

| [INDEX] | [TYPE]            | [KEY_PARAMETERS]                 |
| :-----: | ----------------- | -------------------------------- |
|   [1]   | `ssh`             | host, command, operation         |
|   [2]   | `github`          | resource, operation, owner, repo |
|   [3]   | `executeWorkflow` | source, workflowId, mode         |

SSH outputs: `{exitCode, stdOut, stdErr}`.

---
## [5][AI/LANGCHAIN]
>**Dictum:** *AI nodes leverage language models for reasoning.*

<br>

| [INDEX] | [TYPE]                   | [KEY_PARAMETERS]                    |
| :-----: | ------------------------ | ----------------------------------- |
|   [1]   | `agent`                  | options.systemMessage, text         |
|   [2]   | `openAi`                 | model, credentials                  |
|   [3]   | `outputParserStructured` | jsonSchema (static, no expressions) |

Tool as sub-workflow: `executeWorkflow` with `ai_tool` connection requires `description` parameter.

---
## [6][MESSAGING]
>**Dictum:** *Messaging nodes deliver notifications.*

<br>

| [INDEX] | [TYPE]      | [TYPE_VERSION] | [KEY_PARAMETERS]        |
| :-----: | ----------- | :------------: | ----------------------- |
|   [1]   | `slack`     |      2.1       | select, channelId, text |
|   [2]   | `emailSend` |       —        | toEmail, subject, text  |

---
## [7][DATABASE]
>**Dictum:** *Database nodes enable persistent data operations.*

<br>

| [INDEX] | [TYPE]      | [KEY_PARAMETERS]                         |
| :-----: | ----------- | ---------------------------------------- |
|   [1]   | `postgres`  | operation, query, schema, table          |
|   [2]   | `mySql`     | operation, query, table                  |
|   [3]   | `mongoDb`   | operation, collection, query, options    |

---
## [8][STORAGE]
>**Dictum:** *Storage nodes manage file operations across services.*

<br>

| [INDEX] | [TYPE]        | [KEY_PARAMETERS]                    |
| :-----: | ------------- | ----------------------------------- |
|   [1]   | `s3`          | operation, bucketName, fileKey      |
|   [2]   | `googleDrive` | operation, fileId, folderId         |
|   [3]   | `ftp`         | operation, path, protocol           |

---
## [9][ERROR_HANDLING]
>**Dictum:** *Error nodes enable controlled failure propagation.*

<br>

| [INDEX] | [TYPE]         | [KEY_PARAMETERS]               |
| :-----: | -------------- | ------------------------------ |
|   [1]   | `stopAndError` | errorType, message             |
|   [2]   | `errorTrigger` | —                              |

stopAndError outputs to error workflow; errorTrigger catches errors from other workflows.

---
## [10][2025_NODES]
>**Dictum:** *2025 nodes enable AI interoperability and safety.*

<br>

| [INDEX] | [TYPE]           | [KEY_PARAMETERS]                 |
| :-----: | ---------------- | -------------------------------- |
|   [1]   | `mcpTrigger`     | —                                |
|   [2]   | `toolMcp`        | —                                |
|   [3]   | `aiEvaluation`   | evaluationType, criteria         |
|   [4]   | `modelSelector`  | models, selectionStrategy        |
|   [5]   | `guardrails`     | rules, action                    |
|   [6]   | `deepseek`       | model, credentials               |

MCP nodes enable AI agent interoperability via Model Context Protocol.

---
## [11][MEMORY]
>**Dictum:** *Memory nodes persist conversation context across interactions.*

<br>

| [INDEX] | [TYPE]                 | [KEY_PARAMETERS]                            |
| :-----: | ---------------------- | ------------------------------------------- |
|   [1]   | `memoryBufferWindow`   | sessionKey, contextWindowLength             |
|   [2]   | `memoryRedisChat`      | sessionKey, sessionTimeToLive, contextWindowLength |
|   [3]   | `memoryPostgresChat`   | sessionKey, tableName, contextWindowLength  |
|   [4]   | `memoryMotorhead`      | sessionId, credentials                      |
|   [5]   | `memoryXata`           | sessionId, tableName, credentials           |
|   [6]   | `memoryZep`            | sessionId, credentials                      |
|   [7]   | `memoryManager`        | mode, sessionIdFieldName                    |

Connection type: `ai_memory`. Only agents support memory; chains do not.

---
## [12][CHAINS]
>**Dictum:** *Chains sequence LLM calls without agent reasoning overhead.*

<br>

| [INDEX] | [TYPE]                 | [KEY_PARAMETERS]                            |
| :-----: | ---------------------- | ------------------------------------------- |
|   [1]   | `chainLlm`             | prompt, requireSpecificOutputFormat         |
|   [2]   | `chainRetrievalQa`     | query                                       |
|   [3]   | `chainSummarization`   | dataToSummarize, summarizationMethod        |
|   [4]   | `sentimentAnalysis`    | text                                        |
|   [5]   | `textClassifier`       | text, categories                            |

Summarization methods: `"mapReduce"`, `"refine"`, `"stuff"`.
Chains cannot use memory; use Agent for conversational workflows.
