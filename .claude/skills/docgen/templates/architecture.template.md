# [H1][ARCHITECTURE_TEMPLATE]
>**Dictum:** *Architecture scaffolding encodes structural contracts, not implementation details.*

<br>

Produces one ARCHITECTURE.md file at appropriate scope level. Section selection determined by `architecture-gen.md` §3[SCOPE_ROUTING]. `docs/standards/architecture-standards.md` defines content requirements per section.

**Density:** System-level ARCHITECTURE.md targets 100-250 lines. Below 100 signals missing sections; above 250 signals scope creep into implementation detail.<br>
**References:** `architecture-gen.md` (exploration, section generation, scope routing), `architecture-standards.md` (canonical structure, diagram types, invariants), `validation.md` (compliance checklist), `patterns.md` (anti-patterns).<br>
**Workflow:** Fill placeholders, remove guidance comments, verify diagrams render, validate against architecture-standards.md §4.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]        | [EXAMPLE]                                           |
| :-----: | -------------------- | --------------------------------------------------- |
|   [1]   | `${SystemName}`      | `Parametric Portal`                                 |
|   [2]   | `${ProblemDomain}`   | `Configuration management for distributed systems`  |
|   [3]   | `${ExternalActor1}`  | `Web Client`                                        |
|   [4]   | `${ExternalActor2}`  | `Mobile App`                                        |
|   [5]   | `${Component1}`      | `API Gateway`                                       |
|   [6]   | `${Component2}`      | `Identity Service`                                  |
|   [7]   | `${Component3}`      | `Configuration Engine`                              |
|   [8]   | `${Protocol1}`       | `REST/HTTPS`                                        |
|   [9]   | `${Protocol2}`       | `gRPC`                                              |
|  [10]   | `${ADRRef1}`         | `[ADR-0001](./docs/decisions/ADR-0001-jwt-auth.md)` |
|  [11]   | `${AuthMechanism}`   | `JWT with RS256 + refresh token rotation`           |
|  [12]   | `${ErrorStrategy}`   | `Result/Fin railway with typed error channels`      |
|  [13]   | `${LoggingStrategy}` | `Structured logging via Serilog + OpenTelemetry`    |
|  [14]   | `${Invariant1}`      | `All domain operations return Fin<T>, never throw.` |

---
# ${SystemName} — Architecture

## System Overview

<!-- One paragraph: business problem + system purpose. -->
<!-- C4 Context diagram: system as central node; external actors as surrounding nodes. -->

${ProblemDomain}

```mermaid
graph LR
    ${ExternalActor1} -->|${Protocol1}| ${SystemName}
    ${ExternalActor2} -->|${Protocol1}| ${SystemName}
    ${SystemName} -->|${Protocol2}| ExternalService
```

## High-Level Architecture

<!-- Component/container diagram: 3-7 bounded contexts with directional data flow. -->
<!-- Select diagram type per architecture-gen.md §2.2. -->

```mermaid
graph LR
    ${Component1} -->|${Protocol2}| ${Component2}
    ${Component1} -->|${Protocol2}| ${Component3}
```

<!-- Responsibility table: one row per component. -->

| Component         | Responsibility                    |
| ----------------- | --------------------------------- |
| **${Component1}** | <!-- One-line responsibility. --> |
| **${Component2}** | <!-- One-line responsibility. --> |
| **${Component3}** | <!-- One-line responsibility. --> |

## Codemap

<!-- Annotated directory structure. 2-3 levels deep. Entry points emphasized. -->

```
├── src/
│   ├── index.ts              # ⭐ Entry point
│   ├── modules/
│   │   ├── identity/         # Authentication + authorization
│   │   ├── configuration/    # Core configuration engine
│   │   └── gateway/          # HTTP ingress + routing
│   └── shared/               # Cross-cutting utilities
├── docs/
│   └── decisions/            # Architecture Decision Records
└── infrastructure/           # Deployment configuration
```

## Key Design Decisions

<!-- Summarized decisions linking to full ADRs. Current (Accepted) only. -->

- ${ADRRef1} — <!-- One-line summary + primary justification. -->

## Cross-Cutting Concerns

**Authentication:** ${AuthMechanism}<br>
**Error handling:** ${ErrorStrategy}<br>
**Logging:** ${LoggingStrategy}<br>
**Observability:** <!-- Metrics, traces, health checks. -->

## Invariants

1. ${Invariant1}
2. <!-- Additional invariants. Each testable, each with violation consequence. -->

---
**Guidance**

*System vs. Implementation Detail* — ARCHITECTURE.md maps bounded contexts, data flow directions, and system invariants. Class names, file paths, and function signatures belong in code documentation. Codemap shows 2-3 levels of directory nesting — deeper structure belongs in package-level READMEs. Think "map of a country, not an atlas of its states."<br>
*Diagram Type Selection* — Microservices default to `graph LR` showing containers; monoliths default to `graph TD` showing layers. Use sequence diagrams for critical runtime flows (authentication, order lifecycle). Use state diagrams for stateful workflows. Each diagram type answers different architectural questions.<br>
*ADR Summarization* — Key Design Decisions section summarizes and links — never duplicates. One line per decision: what was decided, which driver justified it, link to the full ADR. Deprecated and superseded decisions appear only in the ADR index.

---
**Post-Scaffold Checklist**

- [ ] All `${...}` placeholders replaced with system-specific values
- [ ] System Overview includes C4 Context diagram with external actors
- [ ] High-Level Architecture shows 3-7 bounded contexts
- [ ] All diagram edges carry protocol/interaction labels
- [ ] Codemap reflects actual directory structure — no invented paths
- [ ] Key Design Decisions link to existing ADRs
- [ ] Cross-Cutting Concerns document auth, error handling, logging, observability
- [ ] Invariants are testable and consequence-linked
- [ ] No implementation details (class names, method signatures) in diagrams
