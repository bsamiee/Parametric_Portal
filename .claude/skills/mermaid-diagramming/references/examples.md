# [H1][EXAMPLES]
>**Dictum:** *End-to-end examples demonstrate complete diagram workflows.*

<br>

Complete working examples from configuration to rendered output; one example per diagram family.

---
## [1][FLOWCHART]
>**Dictum:** *Node-edge topology with styling and accessibility.*

<br>

### [1.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  flowchart:
    curve: basis
    padding: 16
    nodeSpacing: 50
    rankSpacing: 50
  themeVariables:
    primaryColor: "#4f46e5"
    primaryTextColor: "#ffffff"
    primaryBorderColor: "#3730a3"
    lineColor: "#6366f1"
    secondaryColor: "#f0abfc"
    tertiaryColor: "#fef3c7"
---
flowchart TB
    accTitle: User Authentication Flow
    accDescr: Depicts the login process from user input through validation to dashboard access or error display.

    subgraph Input["User Input"]
        A[Enter Credentials]
    end

    subgraph Validation["Server Validation"]
        B{Valid?}
        C[(Database)]
    end

    subgraph Output["Result"]
        D[Dashboard]
        E[Error Message]
    end

    A --> B
    B -->|Yes| D
    B -->|No| E
    B -.-> C

    classDef inputNode fill:#4f46e5,stroke:#3730a3,color:#fff
    classDef decisionNode fill:#f0abfc,stroke:#c026d3,color:#000
    classDef outputNode fill:#fef3c7,stroke:#f59e0b,color:#000
    classDef dbNode fill:#6ee7b7,stroke:#059669,color:#000

    class A inputNode
    class B decisionNode
    class D,E outputNode
    class C dbNode
```

### [1.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | YAML frontmatter | Theme, look, curve, spacing configuration |
| [2] | accTitle/accDescr | WCAG 2.1 accessibility compliance |
| [3] | subgraph | Logical grouping with labels |
| [4] | classDef | Reusable node styling |
| [5] | Edge variants | Solid (required), dotted (reference) |

---
## [2][SEQUENCE]
>**Dictum:** *Temporal interaction with control flow blocks.*

<br>

### [2.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  sequence:
    mirrorActors: false
    messageAlign: center
    actorMargin: 80
    boxMargin: 10
  themeVariables:
    actorBkg: "#4f46e5"
    actorTextColor: "#ffffff"
    signalColor: "#6366f1"
    noteBkgColor: "#fef3c7"
---
sequenceDiagram
    accTitle: API Request Lifecycle
    accDescr: Shows client request through API gateway to service layer with authentication and response handling.

    participant C as Client
    participant G as API Gateway
    participant A as Auth Service
    participant S as Core Service

    C->>+G: POST /api/resource
    G->>+A: Validate Token

    alt Token Valid
        A-->>-G: 200 OK
        G->>+S: Forward Request
        S-->>-G: 200 Response
        G-->>-C: 200 Response
    else Token Invalid
        A-->>G: 401 Unauthorized
        G-->>C: 401 Unauthorized
    end

    Note over C,S: All requests logged for audit
```

### [2.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | participant aliases | Short references in diagram |
| [2] | Activation (+/-) | Shows active processing |
| [3] | alt/else blocks | Conditional branching |
| [4] | Note over | Cross-participant annotations |
| [5] | Arrow types | Sync (->>), async (-->>), response (-->) |

---
## [3][CLASS]
>**Dictum:** *UML class relationships with generics and visibility.*

<br>

### [3.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  class:
    defaultRenderer: elk
  themeVariables:
    classText: "#1f2937"
---
classDiagram
    accTitle: Repository Pattern
    accDescr: Shows generic repository interface with concrete implementations for User and Order entities.

    class Repository~T~ {
        <<interface>>
        +findById(id: string) T
        +findAll() T[]
        +save(entity: T) T
        +delete(id: string) void
    }

    class UserRepository {
        -db: Database
        +findById(id: string) User
        +findAll() User[]
        +save(entity: User) User
        +delete(id: string) void
        +findByEmail(email: string) User
    }

    class OrderRepository {
        -db: Database
        +findById(id: string) Order
        +findAll() Order[]
        +save(entity: Order) Order
        +delete(id: string) void
        +findByUser(userId: string) Order[]
    }

    class User {
        +string id
        +string email
        +string name
        +Date createdAt
    }

    class Order {
        +string id
        +string userId
        +number total
        +string status
    }

    Repository~T~ <|.. UserRepository : implements
    Repository~T~ <|.. OrderRepository : implements
    UserRepository --> User : manages
    OrderRepository --> Order : manages
    Order --> User : belongs to
```

### [3.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | Generics (~T~) | Type parameters |
| [2] | Stereotypes (<<interface>>) | UML classifiers |
| [3] | Visibility (+/-/#/~) | Public/private/protected/package |
| [4] | Relationship arrows | Implements (..), association (-->) |
| [5] | ELK renderer | Improved layout algorithm |

---
## [4][STATE]
>**Dictum:** *State transitions with composite states and choices.*

<br>

### [4.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  state:
    nodeSpacing: 40
    rankSpacing: 40
---
stateDiagram-v2
    accTitle: Order Lifecycle
    accDescr: Depicts order states from creation through fulfillment with payment and shipping substates.

    [*] --> Created: Customer submits

    state Created {
        [*] --> PendingPayment
        PendingPayment --> PaymentReceived: Payment confirmed
        PaymentReceived --> [*]
    }

    Created --> Processing: Payment complete

    state Processing {
        [*] --> Picking
        Picking --> Packing
        Packing --> ReadyToShip
        ReadyToShip --> [*]
    }

    Processing --> Shipped: Carrier pickup
    Shipped --> Delivered: Delivery confirmed
    Delivered --> [*]

    Created --> Cancelled: Customer cancels
    Processing --> Cancelled: Inventory issue
    Cancelled --> [*]

    note right of Created: 24h payment window
    note right of Shipped: Tracking provided
```

### [4.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | Composite states | Nested state machines |
| [2] | [*] markers | Initial/final states |
| [3] | Transition labels | Event triggers |
| [4] | Notes | State annotations |
| [5] | stateDiagram-v2 | Modern syntax |

---
## [5][ENTITY_RELATIONSHIP]
>**Dictum:** *Data modeling with cardinality notation.*

<br>

### [5.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  er:
    layoutDirection: TB
    entityPadding: 15
---
erDiagram
    accTitle: E-Commerce Data Model
    accDescr: Shows relationships between users, orders, products, and categories with cardinality.

    USER {
        uuid id PK
        string email UK
        string name
        timestamp created_at
    }

    ORDER {
        uuid id PK
        uuid user_id FK
        decimal total
        string status
        timestamp created_at
    }

    ORDER_ITEM {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int quantity
        decimal unit_price
    }

    PRODUCT {
        uuid id PK
        uuid category_id FK
        string name
        decimal price
        int stock
    }

    CATEGORY {
        uuid id PK
        string name
        string slug UK
    }

    USER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "included in"
    CATEGORY ||--o{ PRODUCT : categorizes
```

### [5.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | Attribute types | uuid, string, decimal, timestamp |
| [2] | Key markers | PK (primary), FK (foreign), UK (unique) |
| [3] | Cardinality | `\|\|` (one), `o{` (zero-many), `\|{` (one-many) |
| [4] | Relationship labels | Verb describing association |
| [5] | layoutDirection | TB for vertical, LR for horizontal |

---
## [6][GANTT]
>**Dictum:** *Project timeline with dependencies and milestones.*

<br>

### [6.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  gantt:
    titleTopMargin: 25
    barHeight: 30
    barGap: 6
    topPadding: 50
    sectionFontSize: 14
---
gantt
    accTitle: Sprint 12 Timeline
    accDescr: Two-week sprint showing design, development, and release phases with dependencies.

    dateFormat YYYY-MM-DD
    title Sprint 12 - User Dashboard
    excludes weekends

    section Design
        Wireframes           :des1, 2025-01-06, 2d
        UI Mockups           :des2, after des1, 2d
        Design Review        :milestone, des3, after des2, 0d

    section Development
        API Endpoints        :dev1, after des3, 3d
        Frontend Components  :dev2, after des3, 4d
        Integration          :dev3, after dev1 dev2, 2d
        Code Review          :crit, dev4, after dev3, 1d

    section Testing
        Unit Tests           :test1, after dev2, 2d
        E2E Tests            :test2, after dev3, 2d
        QA Sign-off          :milestone, test3, after test2, 0d

    section Release
        Staging Deploy       :rel1, after dev4 test3, 1d
        Production Deploy    :crit, rel2, after rel1, 1d
```

### [6.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | dateFormat | Input date parsing |
| [2] | excludes | Skip weekends/holidays |
| [3] | after keyword | Task dependencies |
| [4] | milestone | Zero-duration checkpoints |
| [5] | crit modifier | Critical path highlighting |
| [6] | Sections | Logical phase grouping |

---
## [7][C4_ARCHITECTURE]
>**Dictum:** *System architecture with C4 abstraction levels.*

<br>

### [7.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  c4:
    diagramMarginY: 40
---
C4Container
    accTitle: E-Commerce Platform Containers
    accDescr: Shows container-level architecture with web app, API, database, and external integrations.

    title Container Diagram - E-Commerce Platform

    Person(customer, "Customer", "Browses products and places orders")

    System_Boundary(platform, "E-Commerce Platform") {
        Container(web, "Web Application", "React, TypeScript", "SPA for customer interactions")
        Container(api, "API Gateway", "Node.js, Express", "REST API with auth middleware")
        Container(orders, "Order Service", "Node.js, Effect", "Order processing and fulfillment")
        Container(inventory, "Inventory Service", "Node.js, Effect", "Stock management")
        ContainerDb(db, "PostgreSQL", "CloudNativePG", "Orders, users, products")
        ContainerQueue(queue, "Redis", "Pub/Sub", "Event bus for async processing")
    }

    System_Ext(payment, "Payment Provider", "Stripe API")
    System_Ext(shipping, "Shipping Provider", "Shippo API")

    Rel(customer, web, "Uses", "HTTPS")
    Rel(web, api, "Calls", "REST/JSON")
    Rel(api, orders, "Routes to", "gRPC")
    Rel(api, inventory, "Routes to", "gRPC")
    Rel(orders, db, "Reads/Writes", "SQL")
    Rel(inventory, db, "Reads/Writes", "SQL")
    Rel(orders, queue, "Publishes", "Events")
    Rel(inventory, queue, "Subscribes", "Events")
    Rel(orders, payment, "Processes", "HTTPS")
    Rel(orders, shipping, "Creates labels", "HTTPS")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### [7.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | C4Container | Container-level diagram |
| [2] | Person | External actors |
| [3] | System_Boundary | Platform boundary |
| [4] | Container/ContainerDb/ContainerQueue | Typed containers |
| [5] | System_Ext | External dependencies |
| [6] | Rel | Relationships with protocols |
| [7] | UpdateLayoutConfig | Layout tuning |

---
## [8][MINDMAP]
>**Dictum:** *Hierarchical knowledge with icons and shapes.*

<br>

### [8.1][COMPLETE_EXAMPLE]

```mermaid
---
config:
  theme: base
  look: neo
  mindmap:
    padding: 20
    maxNodeWidth: 200
---
mindmap
    accTitle: Frontend Architecture
    accDescr: Shows frontend technology stack organized by concern with frameworks, state, and tooling.

    root((Frontend Stack))
        Framework
            React 19
                Server Components
                Suspense
                Transitions
            TypeScript 6
                Strict Mode
                Type Inference
        State
            Effect
                Services
                Layers
            Zustand
                Stores
                Selectors
        Styling
            Tailwind v4
                @theme
                OKLCH
            LightningCSS
                Native Transforms
        Build
            Vite 7
                HMR
                ESBuild
            Nx 22
                Caching
                Affected
        Testing
            Vitest
                Coverage
                Mocking
            Playwright
                E2E
                Visual
```

### [8.2][KEY_ELEMENTS]

| [INDEX] | [ELEMENT] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | root(()) | Central node with circle shape |
| [2] | Indentation | Hierarchy via whitespace |
| [3] | maxNodeWidth | Prevents text overflow |
| [4] | Leaf nodes | Terminal concepts |
| [5] | No explicit edges | Hierarchy implies connections |

---
## [9][VERIFY]
>**Dictum:** *Example completeness ensures reference utility.*

<br>

[VERIFY] Examples:
- [ ] Each example includes YAML frontmatter with theme and config.
- [ ] Each example includes accTitle and accDescr for accessibility.
- [ ] Each example demonstrates diagram-specific features.
- [ ] Key elements table explains syntax patterns.
- [ ] Examples render without errors in mermaid-cli.
