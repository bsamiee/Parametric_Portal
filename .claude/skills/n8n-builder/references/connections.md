# [REF][CONNECTIONS]
>**Dictum:** *Connection types enforce execution semantics and prevent silent workflow failures.*

<br>

---
## [1][STRUCTURE]

```json
"connections": {
  "SourceNode": {
    "main": [
      [{ "node": "TargetNode", "type": "main", "index": 0 }]
    ]
  }
}
```

| [INDEX] | [PROPERTY] | [TYPE] | [DESCRIPTION]                 |
| :-----: | ---------- | ------ | ----------------------------- |
|   [1]   | `node`     | string | Target node name              |
|   [2]   | `type`     | string | Port type                     |
|   [3]   | `index`    | number | Target input port (0-indexed) |

---
## [2][CONNECTION_TYPES]

| [INDEX] | [KEY]              | [SOURCE]             | [TARGET]        | [ROLE]                  |
| :-----: | ------------------ | -------------------- | --------------- | ----------------------- |
|   [1]   | `main`             | Trigger/Logic/Action | Logic/Action    | Sequential flow         |
|   [2]   | `ai_tool`          | Tool node / MCP      | AI Agent        | Callable function       |
|   [3]   | `ai_languageModel` | Model node           | AI Agent        | Cognitive engine        |
|   [4]   | `ai_memory`        | Memory node          | AI Agent        | Context persistence     |
|   [5]   | `ai_outputParser`  | Parser node          | AI Agent        | Structured output       |
|   [6]   | `ai_embedding`     | Embedding node       | Vector Store    | Text vectorization      |
|   [7]   | `ai_vectorStore`   | Vector Store node    | Tool/Retriever  | Document retrieval      |
|   [8]   | `ai_textSplitter`  | Splitter             | Document Loader | RAG pipeline            |
|   [9]   | `ai_retriever`     | Retriever node       | Chain/Agent     | Semantic search         |
|  [10]   | `ai_tool`          | `mcpClient`          | AI Agent        | MCP server tools (2025) |

`mcpClient` exposes external MCP server tools via `ai_tool` connection — agent discovers tools dynamically at runtime.
`ai_embedding` and `ai_vectorStore` form the RAG data pipeline; `ai_retriever` feeds Q&A chains or agents.

---
## [3][MULTI-OUTPUT]
>**Dictum:** *Array indexing maps conditional branches to output ports.*

<br>

Array index = output port:
- IF node: `[0]` = true, `[1]` = false
- Loop: `[0]` = batch, `[1]` = complete
- Switch: `[N]` = Nth rule match

```json
"IF Node": {
  "main": [
    [{ "node": "True Branch", "type": "main", "index": 0 }],
    [{ "node": "False Branch", "type": "main", "index": 0 }]
  ]
}
```

---
## [4][FAN-OUT]
>**Dictum:** *Single source distributes to multiple targets for parallel execution.*

<br>

Multiple targets from single output:

```json
"Trigger": {
  "main": [
    [
      { "node": "Target A", "type": "main", "index": 0 },
      { "node": "Target B", "type": "main", "index": 0 }
    ]
  ]
}
```

---
## [5][AI_CONNECTIONS]
>**Dictum:** *Specialized connection types register AI capabilities and prevent main-type conflicts.*

<br>

```json
"AI Agent": {
  "ai_languageModel": [[{ "node": "OpenAI", "type": "ai_languageModel", "index": 0 }]],
  "ai_tool": [[{ "node": "HTTP Tool", "type": "ai_tool", "index": 0 }]],
  "ai_memory": [[{ "node": "Redis Memory", "type": "ai_memory", "index": 0 }]]
}
```

Match key AND `type` property—mismatches cause silent failures.
