# Complete technical guide to n8n workflow files

**n8n workflow files are JSON documents with no official schema**, but a well-defined structure documented through TypeScript interfaces and community research. This guide covers every field, configuration option, and pattern needed to create workflow files programmatically—from basic structure to advanced patterns introduced through n8n 2.0 in December 2025.

The workflow JSON format centers on three required fields: `name`, `nodes` (array of node objects), and `connections` (object defining data flow). Everything else—settings, metadata, pinned data, tags—is optional. Node configurations use a type-version system where `typeVersion` must match the n8n instance's node implementation, and credentials reference stored secrets by ID without embedding actual keys.

## Root-level workflow structure

Every n8n workflow JSON file follows this foundational schema:

```json
{
  "id": "aOQANirVMuWrH0ZD",
  "name": "My Workflow",
  "nodes": [],
  "connections": {},
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "error-workflow-id",
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner",
    "timezone": "America/New_York"
  },
  "pinData": {},
  "staticData": null,
  "versionId": "c4448c34-1f75-4479-805e-20d8a69a7e00",
  "meta": {
    "instanceId": "b78ce2d06ac74b90...",
    "templateCredsSetupCompleted": true
  },
  "tags": [],
  "createdAt": "2025-01-15T10:00:00Z",
  "updatedAt": "2025-01-15T12:00:00Z"
}
```

**Required fields** are `nodes`, `connections`, and `name`—a workflow missing any of these will fail import. **Optional fields** include `id` (auto-generated if omitted), `active` (defaults to `false`), `settings`, `staticData`, `pinData`, `versionId`, `meta`, and `tags`.

The `settings` object controls workflow-level behavior:

| Setting | Type | Description |
|---------|------|-------------|
| `executionOrder` | `"v1"` or `"v2"` | Execution engine version |
| `errorWorkflow` | string | ID of workflow to trigger on error |
| `saveManualExecutions` | boolean | Persist manual test runs |
| `saveExecutionProgress` | boolean | Save intermediate execution states |
| `callerPolicy` | string | Sub-workflow permissions: `"any"`, `"workflowsFromSameOwner"`, `"none"` |
| `timeout` | number | Workflow timeout in seconds |
| `timezone` | string | IANA timezone string |

## Node object structure and configuration

Each node in the `nodes` array follows this structure:

```json
{
  "id": "8b0c1e5d-4f2a-4b3c-9d8e-7f6a5b4c3d2e",
  "name": "HTTP Request",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.1,
  "position": [250, 300],
  "parameters": {
    "httpMethod": "GET",
    "url": "https://api.example.com/data",
    "options": { "timeout": 10000 }
  },
  "credentials": {
    "httpBasicAuth": {
      "id": "credential-uuid",
      "name": "My API Credentials"
    }
  },
  "disabled": false,
  "notes": "Fetches status data from external API",
  "notesInFlow": true,
  "onError": "stopWorkflow",
  "retryOnFail": false,
  "maxRetries": 3,
  "waitBetweenRetries": 1000
}
```

**Required node fields**: `id` (unique UUID), `name` (unique within workflow, used in connections), `type` (node identifier), `position` ([x, y] canvas coordinates). The `typeVersion` field is technically optional but critical for compatibility—nodes without it use version 1.

**Node type naming conventions** follow these patterns:
- Built-in nodes: `n8n-nodes-base.{nodeName}` (e.g., `httpRequest`, `slack`, `if`)
- AI/LangChain nodes: `@n8n/n8n-nodes-langchain.{nodeName}` (e.g., `agent`, `openAi`)
- Community nodes: `{package-name}.{nodeName}`

**Error handling options** per node include:
- `onError`: `"stopWorkflow"` (default), `"continueRegularOutput"`, `"continueErrorOutput"`
- `retryOnFail`: boolean enabling automatic retries
- `maxRetries` and `waitBetweenRetries`: control retry behavior

## Connection definitions between nodes

The `connections` object maps source node names to their targets using nested arrays to support multiple outputs:

```json
"connections": {
  "HTTP Request": {
    "main": [
      [
        { "node": "IF Status Error", "type": "main", "index": 0 }
      ]
    ]
  },
  "IF Status Error": {
    "main": [
      [{ "node": "Send Alert", "type": "main", "index": 0 }],
      [{ "node": "Log Success", "type": "main", "index": 0 }]
    ]
  }
}
```

**Connection properties**: `node` (target node name as string), `type` (port type, typically `"main"`), `index` (input port index on target, 0 for first input).

**Multi-output nodes** like IF use array indices for branches—output 0 is the TRUE branch, output 1 is FALSE. The Loop Over Items node similarly uses output 0 for batch processing and output 1 for final completion.

**AI node connections** use special port types for model and tool connections:

```json
"connections": {
  "AI Agent": {
    "ai_languageModel": [[{ "node": "OpenAI Chat Model", "type": "ai_languageModel", "index": 0 }]],
    "ai_outputParser": [[{ "node": "Structured Output Parser", "type": "ai_outputParser", "index": 0 }]]
  }
}
```

## Expression syntax and dynamic parameters

n8n uses Tournament templating with **`{{ }}` brackets** for expressions. Parameters prefixed with `=` are evaluated dynamically:

```json
{
  "parameters": {
    "url": "={{ $json.apiEndpoint }}",
    "text": "={{ `Hello ${$json.firstName}` }}",
    "staticValue": "https://api.example.com"
  }
}
```

**Built-in variables** available in expressions:

| Variable | Description | Example |
|----------|-------------|---------|
| `$json` | Current item's JSON data | `{{ $json.fieldName }}` |
| `$input` | Input data object | `{{ $input.all() }}` |
| `$('NodeName')` | Reference another node | `{{ $('HTTP Request').item.json.data }}` |
| `$workflow` | Workflow metadata | `{{ $workflow.id }}`, `{{ $workflow.name }}` |
| `$execution` | Execution context | `{{ $execution.id }}`, `{{ $execution.mode }}` |
| `$env` | Environment variables | `{{ $env.MY_VAR }}` |
| `$vars` | Custom n8n variables | `{{ $vars.myVariable }}` |
| `$now` | Current timestamp (Luxon) | `{{ $now.toISO() }}` |
| `$itemIndex` | Current item index | `{{ $itemIndex }}` |

**Advanced expression patterns**:
```javascript
// Conditional expression
{{ $json.status === 'error' ? 'Failed' : 'Success' }}

// JMESPath query
{{ $jmespath($json, 'users[*].name') }}

// Date manipulation with Luxon
{{ $now.plus({days: 7}).toFormat('yyyy-MM-dd') }}

// IIFE for complex logic
{{(function() {
  return $json.items.reduce((sum, item) => sum + item.price, 0);
})()}}
```

## Credential references in workflow files

Credentials are referenced by type key, ID, and name—**never containing actual secrets**:

```json
"credentials": {
  "slackOAuth2Api": {
    "id": "1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p",
    "name": "Slack OAuth2 API"
  },
  "gmailOAuth2": {
    "id": "ofvBTX8A0aWfQb2O",
    "name": "Gmail account"
  }
}
```

**Critical import consideration**: Credential IDs are instance-specific and become invalid when importing to a different n8n instance. After import, credentials must be manually reassigned in the target environment. Approximately **40% of workflow imports fail** due to credential or version mismatches.

## Sticky notes and visual annotations

Sticky notes appear in the `nodes` array with type `n8n-nodes-base.stickyNote`:

```json
{
  "id": "c81ee1e0-9610-4cf7-a081-bf0494bcdec5",
  "name": "Sticky Note1",
  "type": "n8n-nodes-base.stickyNote",
  "typeVersion": 1,
  "position": [860, 432],
  "parameters": {
    "content": "## API Integration Notes\n\nThis section handles external API calls.",
    "height": 442,
    "width": 367,
    "color": 6
  }
}
```

The `color` field uses **integers 1-7** mapping to preset colors (not hex values). Content supports **CommonMark markdown**, including YouTube embedding with `@[youtube](<video-id>)` syntax.

## Pinned data for testing workflows

The `pinData` object stores test data that nodes use during manual executions:

```json
"pinData": {
  "HTTP Request": [
    {
      "json": {
        "status": "success",
        "data": { "id": 123, "name": "Test" }
      }
    }
  ]
}
```

**Important limitations**: Pinned data is **ignored during production executions**—it only works for manual testing. Size is limited to approximately **12-16MB** per workflow (controlled by `N8N_PAYLOAD_SIZE_MAX`). Binary data cannot be pinned.

## Advanced node configurations

### Webhook nodes

```json
{
  "name": "Webhook",
  "type": "n8n-nodes-base.webhook",
  "typeVersion": 2,
  "webhookId": "unique-webhook-id",
  "parameters": {
    "path": "my-webhook-path",
    "httpMethod": "POST",
    "authentication": "none",
    "responseMode": "responseNode",
    "options": {
      "allowedOrigins": "*",
      "responseCode": 200,
      "responseContentType": "application/json"
    }
  }
}
```

Response modes: `"onReceived"` (immediate), `"lastNode"` (after completion), `"responseNode"` (explicit Respond to Webhook node).

### Code nodes with JavaScript/Python

```json
{
  "name": "Process Data",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "parameters": {
    "mode": "runOnceForAllItems",
    "language": "javaScript",
    "jsCode": "const items = $input.all();\nreturn items.map(item => ({\n  json: {\n    processed: true,\n    original: item.json\n  }\n}));"
  }
}
```

**Python in n8n 2.0** requires `"language": "pythonNative"` (Pyodide-based `"python"` was removed). Python uses `_items` with bracket notation: `_items[0]["json"]["field"]`.

### Sub-workflow execution

```json
{
  "name": "Execute Sub-workflow",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1,
  "parameters": {
    "source": "database",
    "workflowId": "WORKFLOW_ID_HERE",
    "mode": "runOnceForAllItems"
  }
}
```

Source options: `"database"` (by ID), `"localFile"`, `"parameter"` (embedded JSON), `"url"`.

### Loop Over Items (batching)

```json
{
  "name": "Loop Over Items",
  "type": "n8n-nodes-base.splitInBatches",
  "typeVersion": 3,
  "parameters": {
    "batchSize": 10,
    "options": { "reset": false }
  }
}
```

The node has **two outputs**: output 0 for items in the current batch (loop continues), output 1 for final output when all batches complete. Connect processed items back to input 0 to continue the loop.

### Merge node for complex data flows

```json
{
  "name": "Merge",
  "type": "n8n-nodes-base.merge",
  "typeVersion": 3.1,
  "parameters": {
    "mode": "combine",
    "combineBy": "combineByFields",
    "mergeByFields": {
      "values": [{ "field1": "id", "field2": "userId" }]
    },
    "joinMode": "enrichInput1",
    "options": { "multipleMatches": "first" }
  }
}
```

Modes include `"append"`, `"combine"` (by position or fields), `"sql"` (SQL query joining), and `"chooseBranch"`.

### IF and Switch conditional nodes

```json
{
  "name": "Route by Status",
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.2,
  "parameters": {
    "mode": "rules",
    "rules": {
      "rules": [
        {
          "outputKey": "urgent",
          "conditions": {
            "conditions": [{
              "leftValue": "={{ $json.priority }}",
              "rightValue": "high",
              "operator": { "type": "string", "operation": "equals" }
            }]
          }
        }
      ]
    },
    "options": { "fallbackOutput": "extra" }
  }
}
```

## Version information and compatibility

Multiple version fields track compatibility:

```json
{
  "versionId": "c4448c34-1f75-4479-805e-20d8a69a7e00",
  "meta": { "instanceId": "b78ce2d06ac74b90..." },
  "settings": { "executionOrder": "v1" }
}
```

- `versionId`: UUID that changes with each save
- `meta.instanceId`: Fingerprint of the creating n8n instance
- `settings.executionOrder`: `"v1"` or `"v2"` execution engine
- Node `typeVersion`: Critical for compatibility—newer nodes may have different parameter schemas

## n8n 2.0 breaking changes (December 2025)

The **n8n 2.0 release** (December 2025) introduced significant changes affecting workflow files:

**Security defaults changed**: Task runners now enabled by default (Code nodes run in isolated environments), environment variable access blocked from Code nodes (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`), and ExecuteCommand/LocalFileTrigger nodes disabled by default.

**Python execution changed**: The `"language": "python"` parameter (Pyodide-based) was removed. Use `"language": "pythonNative"` with task runners instead.

**Database support changed**: MySQL/MariaDB support dropped—PostgreSQL required. SQLite uses a new pooling driver (up to 10x faster).

**New publish/save paradigm**: Workflows now distinguish between saved (draft) and published (production) versions. The `settings` object may include `publishedAt` timestamp.

**New nodes added in 2025**:
- MCP nodes (`mcptrigger`, `toolmcp`) for AI agent interoperability
- AI Evaluation nodes for testing AI workflows
- Model Selector node for dynamic model selection
- Guardrails node for AI output safety
- DeepSeek Chat Model node

## Complete workflow example

```json
{
  "name": "API Monitor with Error Handling",
  "nodes": [
    {
      "id": "trigger-001",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [100, 300],
      "parameters": {
        "rule": { "interval": [{ "field": "minutes", "minutesInterval": 5 }] }
      }
    },
    {
      "id": "http-001",
      "name": "Check API Status",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.1,
      "position": [300, 300],
      "parameters": {
        "url": "https://api.example.com/health",
        "options": { "timeout": 10000 }
      }
    },
    {
      "id": "if-001",
      "name": "Status Check",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [500, 300],
      "parameters": {
        "conditions": {
          "conditions": [{
            "leftValue": "={{ $json.status }}",
            "rightValue": "healthy",
            "operator": { "type": "string", "operation": "notEquals" }
          }],
          "combinator": "and"
        }
      }
    },
    {
      "id": "slack-001",
      "name": "Send Alert",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.1,
      "position": [700, 250],
      "parameters": {
        "authentication": "oAuth2",
        "select": "channel",
        "channelId": { "__rl": true, "value": "C1234567890", "mode": "id" },
        "text": "🚨 API Alert: {{ $('Check API Status').item.json.message }}"
      },
      "credentials": {
        "slackOAuth2Api": { "id": "slack-cred-001", "name": "Slack OAuth" }
      }
    },
    {
      "id": "sticky-001",
      "name": "Documentation",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [80, 100],
      "parameters": {
        "content": "## API Monitoring\n\nChecks API health every 5 minutes and alerts on failures.",
        "width": 300,
        "height": 150,
        "color": 3
      }
    }
  ],
  "connections": {
    "Schedule Trigger": {
      "main": [[{ "node": "Check API Status", "type": "main", "index": 0 }]]
    },
    "Check API Status": {
      "main": [[{ "node": "Status Check", "type": "main", "index": 0 }]]
    },
    "Status Check": {
      "main": [
        [{ "node": "Send Alert", "type": "main", "index": 0 }],
        []
      ]
    }
  },
  "settings": {
    "executionOrder": "v1",
    "errorWorkflow": "error-handler-workflow-id",
    "saveManualExecutions": true
  },
  "pinData": {},
  "active": false,
  "meta": {
    "templateCredsSetupCompleted": true
  }
}
```

## Programmatic workflow generation tips

When generating workflows programmatically:

1. **Generate unique UUIDs** for all node `id` fields—duplicates cause silent failures
2. **Ensure unique node names** within the workflow since connections reference by name
3. **Match `typeVersion`** to your target n8n version's node implementations
4. **Position nodes logically**—standard spacing is 200px horizontal, 150px vertical
5. **Validate JSON structure** before import using n8n's TypeScript interfaces as reference
6. **Test in staging first**—credential mismatches and version incompatibilities are common
7. **Use empty objects** for optional fields (`"pinData": {}`, `"settings": {}`) rather than omitting them for cleaner imports

The workflow JSON format has remained largely stable through n8n's evolution, with most changes adding optional fields rather than modifying required structures. The December 2025 n8n 2.0 release represents the largest change, primarily affecting execution behavior and security defaults rather than the JSON schema itself.