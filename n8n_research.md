The Architect’s Guide to n8n Workflow Definition: A Comprehensive Technical Analysis of the v2.0 JSON Schema (2025 Edition)
1. The Paradigm Shift in Workflow Orchestration: n8n v2.0 and the 2025 Ecosystem
The trajectory of workflow automation has shifted decisively in 2025, moving from simple linear task execution to complex, state-aware orchestration powered by intelligent agents. For the solutions architect and the automation engineer, the release of n8n v2.0 represents a fundamental replatforming of how workflows are defined, executed, and persisted. This report provides an exhaustive technical analysis of the n8n workflow file structure (JSON) as it exists in late 2025. It is designed not merely as a reference but as a foundational document for programmatic generation, advanced debugging, and the implementation of "vibe coding"—the increasingly prevalent practice of using Large Language Models (LLMs) to generate automation logic.
The architectural changes introduced in 2025 extend beyond the visual canvas. The underlying JSON schema has hardened to support the new "Publish/Save" paradigm, which decouples development drafts from production execution.1 Furthermore, the introduction of native AI Agents powered by LangChain has introduced complex connection typologies—ai_tool, ai_languageModel, and ai_memory—that fundamentally alter the directed graph structure of the workflow file.2 As organizations move toward self-hosted, scalable architectures, understanding these raw file definitions is requisite for implementing CI/CD pipelines, enforcing governance via Git-backed source control, and optimizing execution performance.4
This analysis deconstructs the workflow object into its constituent atoms—metadata, execution settings, node definitions, and connectivity graphs—providing the deep technical context necessary to manipulate these files with precision.
1.1 The Evolution of the Execution Engine
The most critical invisible component of a workflow file in 2025 is the executionOrder setting. In previous iterations, n8n relied on a linear execution model (often referred to as "v0"). The v2.0 engine standardizes on a topological sort algorithm (referenced in the JSON as "v1") which allows for complex looping, improved error handling, and the non-blocking execution required for highly asynchronous AI operations.6
Programmatic generators that fail to explicitly define executionOrder: "v1" in the settings object risk defaulting to legacy behaviors, rendering modern nodes like "Wait" or "AI Agent" unstable or non-functional. The implications of this setting ripple through the entire schema, dictating how data flows between branches and how state is preserved during long-running processes.8
1.2 The "Publish" Lifecycle and File Persistence
In the 2025 ecosystem, the JSON file represents a snapshot of state. The distinction between a "saved" workflow and a "published" workflow is now architectural. When retrieving workflow JSON via the API, architects must discern between the active production version and the draft development version. The introduction of the meta object and versionId plays a pivotal role here, allowing the system to track iterations and ensuring that source control systems can correctly diff changes without treating every save as a new entity.1
2. The Root Object Architecture: Anatomy of a Workflow File
A valid n8n workflow file is a single JSON object containing five mandatory and several optional root-level keys. While the n8n editor is forgiving, the API and execution engine require strict adherence to this schema for programmatic imports.
2.1 The Essential Root Properties
The root object serves as the container for the directed acyclic graph (DAG) that defines the automation.
Property
Data Type
Necessity
Architectural Function
nodes
Array of Objects
Critical
The operational units of the workflow. Defines what happens.
connections
Object
Critical
The edges of the graph. Defines where data flows.
settings
Object
Required
Controls the execution environment (timeouts, error handlers).
meta
Object
Optional
System metadata (instance linkage, template attribution).
name
String
Required
The human-readable identifier.
pinData
Object
Optional
Mock data for test-driven development and debugging.
staticData
Object
Optional
Persistent state storage for trigger nodes (e.g., "last checked ID").
tags
Array of Objects
Optional
Organizational taxonomy for filtering and RBAC.

The validation logic in 2025 is stringent regarding the nodes array; it must not be empty for a workflow to be active. However, a workflow consisting solely of a Trigger node is valid, whereas a workflow with no Trigger cannot be activated in production.9
2.2 Deep Dive: The settings Configuration Object
The settings object is where the operational behavior of the workflow is defined. For enterprise deployments, misconfiguration here is the primary source of instability.
2.2.1 Execution Persistence (saveExecutionProgress)
The saveExecutionProgress key (boolean or string "DEFAULT") controls whether the workflow state is serialized to the database after every node execution.
Mechanism: If true, the execution engine writes the full JSON context of all items to the execution_entity table after each step.
2025 Best Practice: For high-throughput workflows (e.g., webhook processors handling >1000 RPM), this must be set to false. The I/O overhead of serialization can degrade performance by orders of magnitude. It should only be true for long-running, critical business processes where resuming from a specific failure point is mandatory.11
2.2.2 Error Handling Topology (errorWorkflow)
The errorWorkflow key takes a String value representing the ID of another workflow.
Operational Insight: This is not a name but a specific UUID (e.g., "VzqKEW0ShTXA5vPj"). When an unhandled exception occurs, the execution context (including the error message and the item that caused it) is passed to the trigger of the specified error workflow.
Programmatic Risk: When migrating workflows between environments (e.g., Staging to Prod), the ID of the error workflow will likely change. Programmatic export/import scripts must include logic to map these IDs dynamically, or the production workflow will fail silently or point to a non-existent error handler.13
2.2.3 The callerPolicy and Security
The callerPolicy setting (e.g., "workflowsFromSameOwner") is a security feature introduced to restrict which workflows can trigger the current workflow via the "Execute Workflow" node.
API Limitation: A notable constraint in the 2025 API is that the POST /workflows endpoint has historically struggled to persist this setting correctly during imports, often defaulting to restrictive policies. Architects using the Python SDK or direct API calls should verify this setting via a subsequent GET request or database query to ensure the security posture is correctly applied.8
2.3 The meta Object and Instance Binding
The meta object contains the instanceId, a fingerprint of the n8n installation where the workflow was created.
Implication for Templates: When sharing workflows (e.g., via the community repository or internal Git), stripping the instanceId is recommended to prevent "identity confusion" when the workflow is imported into a new environment. However, keeping the templateCredsSetupCompleted boolean can improve the user experience by suppressing setup wizards for pre-configured templates.6
3. Node Definition Architecture: The Functional Atoms
In the 2025 schema, the nodes array contains objects that have become increasingly standardized, yet complex in their parameterization. A single node object encapsulates identity, logic, visualization, and authentication.
3.1 The Immutable Identity: id vs. name
Every node possesses two identifiers:
id (UUID): Introduced to solve the fragility of name-based referencing. In 2025, the id is the primary key for internal graph linking. It allows users to rename nodes in the UI without breaking connections.
name (String): The human-readable label. Despite the existence of id, the name remains syntactically critical because n8n's expression language (e.g., $('Node Name').item) references nodes by name.
Constraint: Node names must be unique within a workflow. The import engine will automatically append increments (e.g., "Set1") if a collision is detected, but this can break expressions in code nodes that rely on specific naming conventions.17
3.2 Type Versioning: The typeVersion Imperative
The type field (e.g., n8n-nodes-base.googleSheets) is paired with a typeVersion (e.g., 4.5).
The 2025 Context: n8n aggressively updates nodes to support new API features. A workflow created in 2023 might use typeVersion: 1, while a 2025 workflow uses typeVersion: 4.
Migration Risk: When generating workflows programmatically, using an outdated typeVersion forces the engine to load legacy code, which may lack support for newer features like AI connections or improved error output. Conversely, blindly upgrading the typeVersion in the JSON without updating the parameters structure will cause the node to fail, as parameter schemas often break between major versions.9
3.3 The parameters Object and Expression Syntax
The parameters object is the polymorphic heart of the node. Its structure is entirely dependent on the node type.
Expression Syntax: The distinction between static values and expressions is denoted by the = prefix.
Static: "value": "generic"
Expression: "value": "={{ $json.data }}"
JSON in Parameters: For nodes that accept complex configurations (like HTTP Requests or AI Tools), parameters may contain nested objects. In 2025, the validation of these nested structures has tightened. For instance, the workflowInputs parameter in Trigger nodes now requires a strict schema definition array.19
3.4 Sticky Notes as Nodes
It is a "niche" but important detail that Sticky Notes in the UI are technically nodes of type n8n-nodes-base.stickyNote. They exist in the nodes array but define no logic and have no connections.
Data Structure: They contain height, width, color, and content.
Utility: For automated documentation generators, parsing these nodes allows for the extraction of developer comments and architectural diagrams directly from the workflow file.21
4. The Connection Graph: Topology and AI Orchestration
The connections object defines the data flow. In v2.0, this schema has evolved from a simple directed graph to a multi-modal hypergraph to support AI agents.
4.1 The Standard Directed Graph (main)
The traditional connection type is main.

JSON


"connections": {
  "SourceNode": {
    "main":
  }
}


Output Indexing: The array structure main: [... ], [... ] represents output ports. Index 0 is the primary output. Index 1, 2, etc., represent secondary outputs (e.g., "False" branch of an IF node, or "Split" branches).
Multiplexing: A single output index can connect to multiple target nodes (fan-out), represented by multiple objects within the inner array.
4.2 The AI Connection Typology
The introduction of @n8n/n8n-nodes-langchain has introduced distinct connection keys that must be strictly observed. Using main for these connections will result in silent failures where agents cannot "see" their tools.
4.2.1 The ai_tool Connection
This connects a Tool node (e.g., n8n-nodes-base.httpRequest or n8n-nodes-base.executeWorkflow) to an AI Agent.
Schema Requirement: The key in the connections object must be ai_tool, and the type property inside the target object must also be ai_tool.
Implication: This signals to the execution engine that the connected node should not be executed linearly but should be registered as a callable function within the Agent's context window.2
4.2.2 The ai_languageModel Connection
Connects a Model node (e.g., OpenAI, Anthropic) to the Agent.
Schema Requirement: Key: ai_languageModel.
Constraint: An Agent typically accepts only one language model connection. The JSON array should contain a single entry.
4.2.3 The ai_memory Connection
Connects persistence layers (e.g., Redis, Window Buffer).
Schema Requirement: Key: ai_memory.
Context: This connection allows the Agent to retrieve chat history. Without this specific connection type, the Agent operates statelessly.24
Connection Key
Source Node Type (Typical)
Target Node Type (Typical)
Architectural Role
main
Trigger, Logic, Action
Logic, Action
Standard sequential data flow.
ai_tool
Tool (HTTP, Calculator)
AI Agent
Registers a capability for the Agent to invoke.
ai_languageModel
Model (OpenAI, HuggingFace)
AI Agent
Provides the cognitive engine.
ai_memory
Memory (Redis, Buffer)
AI Agent
Provides conversational context.
ai_textSplitter
Text Splitter
Document Loader
Pre-processing for RAG pipelines.

5. Advanced Intelligence: The AI Agent Schema (@n8n/n8n-nodes-langchain)
The AI Agent node is the most complex structure in the 2025 ecosystem. It acts as an orchestrator, and its JSON definition requires specific handling of prompts, tools, and output parsers.
5.1 Agent Node Configuration
The agent node (@n8n/n8n-nodes-langchain.agent) differs from standard nodes in its parameters object.
options.systemMessage: This is the "God Prompt" defining the agent's persona.
text: The input query, usually bound via expression to the chat trigger output (e.g., ={{ $json.chatInput }}).
Tools Configuration: Unlike v1 where tools might have been defined inline, v2.0 strictly delegates tool definitions to the connected nodes via the ai_tool connection. However, the description of these tools—crucial for the LLM's reasoning—is defined in the Tool Node's parameters, not the Agent's.25
5.2 Sub-Workflow as a Tool (executeWorkflow)
One of the most powerful "niche" capabilities in 2025 is using a sub-workflow as a tool for an AI agent.
Schema Nuance: When an executeWorkflow node is connected via ai_tool, the parameters object MUST contain a description field. This field is not present when the node is used in a standard flow.
JSON
{
  "parameters": {
    "workflowId": "uuid-string",
    "description": "Searches the CRM for a contact by email and returns their ID."
  },
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1.2
}

If this description is missing or vague, the AI Agent will hallucinate the tool's purpose or fail to invoke it.26
5.3 Structured Output Parsing
For Agents required to output valid JSON (e.g., for downstream API processing), the outputParser connection is used.
2025 Update: The schema for structured output parsers (n8n-nodes-langchain.outputParserStructured) allows for defining schemas via JSON examples. In the workflow file, this is serialized as a JSON string within the jsonSchema parameter.
Constraint: The parser node does not support expressions in the schema definition field. It must be a static JSON schema string. This is a known limitation in 2025 that architects must work around by using conditional logic before the parser.27
6. Data Flow Architecture: Inputs, Pinned Data, and State
Managing data flow in JSON requires understanding how n8n v2.0 handles data injection and state persistence.
6.1 The pinData Object: Enabling "Vibe Coding" and TDD
The pinData object allows developers to freeze the output of specific nodes. This is the mechanism that enables "vibe coding"—where users describe a workflow to an AI, and the AI generates a JSON file with data pre-loaded, allowing the user to inspect the transformation logic without connecting to live APIs.29
Structure:
JSON
"pinData": {
  "Node Name":
}


Binary Data Limitation: While text data pins easily, binary data in pinData is often a reference to a filesystem path or an internal ID. Sharing JSON with pinned binary data across instances usually results in broken references.
Expression Caveat: A critical sophisticated detail is that referencing pinned data in expressions requires different syntax. The standard .item property (context-aware) fails because pinned data lacks execution context. Developers must use .first(), .last(), or .all() to reference pinned nodes.31
6.2 The workflowInputs Object: The New Input Schema
In late 2025, the "Specify Input Schema" feature was migrated from the "Execute Workflow" node to the Trigger Node of the called workflow. This effectively turns the Trigger node into a strictly typed interface.
JSON Schema:
JSON
"parameters": {
  "workflowInputs": {
    "schema": [
      {
        "id": "userId",
        "type": "number",
        "required": true,
        "display": true
      }
    ]
  }
}

This schema validation occurs before execution. If a caller sends data matching the wrong type, the workflow rejects the execution request immediately, saving resources. Programmatic generators must ensure this schema matches the data payload sent by the caller.32
7. Programmatic Generation and Source Control Integration
For enterprise environments, workflows are rarely created manually in isolation. They are generated via SDKs or managed via Git.
7.1 The Python SDK (n8n-sdk-python)
The n8n-sdk-python library provides an object-oriented wrapper around the JSON schema. It abstracts the complexity of the connections array and UUID generation.
Capabilities: It allows for the definition of nodes as Python objects and the establishment of connections via method calls (e.g., workflow.add_connection(source, target)).
Use Case: This is particularly powerful for "meta-automation"—workflows that generate other workflows based on database schemas or API specifications.34
7.2 Git Repository Structure
When integrating with n8n's native Source Control (Enterprise), the JSON files are organized into a strict directory hierarchy.
workflows/: Contains the logic files.
credentials/: Contains stub files.
Security Note: These files do not contain the actual API keys. They contain the credential type and name mapping. This allows the workflow to be imported into a production instance where the actual credentials (with matching names) are stored securely in the database/vault.35
tags/: Metadata definitions for organization.
7.3 The API Import Nuance
A frequent issue in 2025 automation involves the POST /workflows/import endpoint. While it accepts the full JSON schema, it has been observed to occasionally ignore the settings object (e.g., reverting saveExecutionProgress to default) or strip callerPolicy.
Sophisticated Workaround: The most robust pattern for programmatic deployment is a two-step process:
Create the workflow via POST /workflows.
Immediately patch the settings via a PUT /workflows/{id} request or a direct SQL update to the workflow_entity table if self-hosting, to ensure critical production settings are enforced.8