# [TEMPLATE][WORKFLOW]
>**Dictum:** *Complete template demonstrates all AI connection types and root structure.*

<br>

```json
{
  "name": "${workflow-name}",
  "nodes": [
    {
      "id": "${trigger-uuid}",
      "name": "Chat Trigger",
      "type": "@n8n/n8n-nodes-langchain.chatTrigger",
      "typeVersion": 1.1,
      "position": [100, 300],
      "webhookId": "${webhook-uuid}",
      "parameters": {
        "mode": "webhook",
        "options": {}
      }
    },
    {
      "id": "${agent-uuid}",
      "name": "AI Agent",
      "type": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 1.7,
      "position": [300, 300],
      "parameters": {
        "options": { "systemMessage": "${system-prompt}" },
        "text": "={{ $json.chatInput }}"
      }
    },
    {
      "id": "${model-uuid}",
      "name": "OpenAI Chat Model",
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [100, 450],
      "parameters": { "model": "gpt-4o" },
      "credentials": { "openAiApi": { "id": "${openai-cred-uuid}", "name": "OpenAI" } }
    },
    {
      "id": "${memory-uuid}",
      "name": "Buffer Memory",
      "type": "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      "typeVersion": 1.3,
      "position": [100, 600],
      "parameters": {
        "sessionKey": "={{ $json.sessionId }}",
        "contextWindowLength": 10
      }
    },
    {
      "id": "${vectorstore-uuid}",
      "name": "Vector Store Tool",
      "type": "@n8n/n8n-nodes-langchain.toolVectorStore",
      "typeVersion": 1,
      "position": [300, 450],
      "parameters": {
        "name": "knowledge_base",
        "description": "Search the knowledge base for relevant information"
      }
    },
    {
      "id": "${embeddings-uuid}",
      "name": "OpenAI Embeddings",
      "type": "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
      "typeVersion": 1.1,
      "position": [500, 450],
      "parameters": { "model": "text-embedding-3-small" },
      "credentials": { "openAiApi": { "id": "${openai-cred-uuid}", "name": "OpenAI" } }
    },
    {
      "id": "${simple-store-uuid}",
      "name": "Simple Vector Store",
      "type": "@n8n/n8n-nodes-langchain.vectorStoreInMemory",
      "typeVersion": 1,
      "position": [500, 600],
      "parameters": {
        "mode": "retrieve",
        "memoryKey": "${memory-key}",
        "topK": 4
      }
    }
  ],
  "connections": {
    "Chat Trigger": {
      "main": [[{ "node": "AI Agent", "type": "main", "index": 0 }]]
    },
    "OpenAI Chat Model": {
      "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
    },
    "Buffer Memory": {
      "ai_memory": [[{ "node": "AI Agent", "type": "ai_memory", "index": 0 }]]
    },
    "Vector Store Tool": {
      "ai_tool": [[{ "node": "AI Agent", "type": "ai_tool", "index": 0 }]]
    },
    "OpenAI Embeddings": {
      "ai_embedding": [[{ "node": "Simple Vector Store", "type": "ai_embedding", "index": 0 }]]
    },
    "Simple Vector Store": {
      "ai_vectorStore": [[{ "node": "Vector Store Tool", "type": "ai_vectorStore", "index": 0 }]]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner"
  },
  "pinData": {},
  "active": false
}
```

---
## [STRUCTURE]

| Component           | Connection Type    | Target              | Purpose                  |
| ------------------- | ------------------ | ------------------- | ------------------------ |
| Chat Trigger        | `main`             | AI Agent            | Workflow entry point     |
| OpenAI Chat Model   | `ai_languageModel` | AI Agent            | Cognitive engine         |
| Buffer Memory       | `ai_memory`        | AI Agent            | Conversation persistence |
| Vector Store Tool   | `ai_tool`          | AI Agent            | RAG capability           |
| OpenAI Embeddings   | `ai_embedding`     | Simple Vector Store | Text vectorization       |
| Simple Vector Store | `ai_vectorStore`   | Vector Store Tool   | Document retrieval       |

---
## [SUBSTITUTION]

| Variable              | Description                 | Example                            |
| --------------------- | --------------------------- | ---------------------------------- |
| `${workflow-name}`    | Workflow display name       | `"Customer Support Agent"`         |
| `${*-uuid}`           | Unique node identifiers     | `crypto.randomUUID()`              |
| `${webhook-uuid}`     | Webhook path identifier     | `crypto.randomUUID()`              |
| `${system-prompt}`    | Agent behavior instructions | `"You are a helpful assistant..."` |
| `${openai-cred-uuid}` | Credential reference        | Instance-specific after import     |
| `${memory-key}`       | Vector store namespace      | `"product_docs"`                   |

---
## [EXTENSION]

**Add HTTP Tool:** Insert node, connect via `ai_tool` to AI Agent.<br>
**Add Postgres Memory:** Replace `memoryBufferWindow` with `memoryPostgresChat`, add `tableName`.<br>
**Add Production Vector Store:** Replace `vectorStoreInMemory` with `vectorStorePGVector` or `vectorStorePinecone`.<br>
**Add Output Parser:** Insert `outputParserStructured` node, connect via `ai_outputParser` to AI Agent.
