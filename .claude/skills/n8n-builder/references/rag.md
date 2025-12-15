# [REF][RAG]
>**Dictum:** *RAG pipelines require coordinated vector storage, embedding, and retrieval.*

<br>

---
## [1][VECTOR_STORES]
>**Dictum:** *Vector stores enable semantic similarity search over embedded documents.*

<br>

| [INDEX] | [TYPE]                | [KEY_PARAMETERS]                       | [PERSISTENCE] |
| :-----: | --------------------- | -------------------------------------- | :-----------: |
|   [1]   | `vectorStoreInMemory` | memoryKey, clearStore                  |      No       |
|   [2]   | `vectorStorePGVector` | tableName, collectionName, credentials |      Yes      |
|   [3]   | `vectorStorePinecone` | pineconeIndex, namespace, credentials  |      Yes      |
|   [4]   | `vectorStoreQdrant`   | qdrantCollection, credentials          |      Yes      |
|   [5]   | `vectorStoreSupabase` | tableName, queryName, credentials      |      Yes      |
|   [6]   | `vectorStoreZep`      | collectionName, embeddingDimensions    |      Yes      |

Simple Vector Store: development only; data lost on restart, global access across users.

---
## [2][EMBEDDINGS]
>**Dictum:** *Embedding models convert text to vectors for similarity computation.*

<br>

| [INDEX] | [TYPE]                           | [KEY_PARAMETERS]   |
| :-----: | -------------------------------- | ------------------ |
|   [1]   | `embeddingsOpenAi`               | model, credentials |
|   [2]   | `embeddingsCohere`               | model, credentials |
|   [3]   | `embeddingsMistralCloud`         | model, credentials |
|   [4]   | `embeddingsAwsBedrock`           | model, region      |
|   [5]   | `embeddingsGooglePalm`           | model, credentials |
|   [6]   | `embeddingsHuggingFaceInference` | model, credentials |
|   [7]   | `embeddingsOllama`               | model, baseUrl     |

Embedding model must match between insert and query operations.

---
## [3][DOCUMENT_LOADERS]
>**Dictum:** *Document loaders ingest external data as processable documents.*

<br>

| [INDEX] | [TYPE]                      | [KEY_PARAMETERS]              |
| :-----: | --------------------------- | ----------------------------- |
|   [1]   | `documentDefaultDataLoader` | dataType, binaryDataKey       |
|   [2]   | `documentGithubLoader`      | repository, branch, recursive |

Default loader accepts JSON, text, or binary input from workflow.

---
## [4][TEXT_SPLITTERS]
>**Dictum:** *Text splitters chunk documents for embedding granularity.*

<br>

| [INDEX] | [TYPE]                                       | [KEY_PARAMETERS]                    |
| :-----: | -------------------------------------------- | ----------------------------------- |
|   [1]   | `textSplitterCharacterTextSplitter`          | chunkSize, chunkOverlap             |
|   [2]   | `textSplitterRecursiveCharacterTextSplitter` | chunkSize, chunkOverlap, separators |
|   [3]   | `textSplitterTokenSplitter`                  | chunkSize, chunkOverlap             |

Recursive splitter recommended: splits by Markdown, HTML, code blocks, then characters.

---
## [5][RETRIEVERS]
>**Dictum:** *Retrievers fetch documents from vector stores for chain consumption.*

<br>

| [INDEX] | [TYPE]                           | [KEY_PARAMETERS] |
| :-----: | -------------------------------- | ---------------- |
|   [1]   | `retrieverVectorStore`           | topK             |
|   [2]   | `retrieverMultiQuery`            | queryCount       |
|   [3]   | `retrieverContextualCompression` | —                |
|   [4]   | `retrieverWorkflow`              | workflowId       |

Connection: `ai_retriever` type; connects to Q&A Chain or Agent.

