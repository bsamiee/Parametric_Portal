# [H1][PATTERNS]
>**Dictum:** *Each documentation anti-pattern is a reader tax compounding across every consumer.*

<br>

Documentation anti-pattern codex with concrete bad/good examples. Parallel to csharp-standards/references/patterns.md — same format, documentation domain.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Named patterns enable precise identification and correction.*

<br>

**TROPHY_README**

[ANTI-PATTERN]:
```markdown
## Project Structure
- src/
  - controllers/
    - UserController.ts
    - OrderController.ts
  - services/
    - UserService.ts
...
```
[CORRECT]:
```markdown
## Architecture
Three bounded contexts: Identity (auth + profiles), Commerce (orders + payments),
Notification (email + push). Each context owns its schema, routes, and error types.

Identity → Commerce: order placement requires verified identity token.
Commerce → Notification: order state transitions emit notification events.
```
File trees describe topology without conveying architecture. Architecture sections name bounded contexts, ownership boundaries, and data flow direction. The reader needs to understand WHERE their code goes, not what files exist.

**COMMIT_CHANGELOG**

[ANTI-PATTERN]:
```markdown
## [1.3.0] - 2026-02-20
- fix: resolve null pointer in UserService
- chore: update dependencies
- feat: add endpoint for bulk import
```
[CORRECT]:
```markdown
## [1.3.0] - 2026-02-20
### Added
- Bulk import endpoint: upload CSV to create up to 10,000 records per request.
### Fixed
- User profile retrieval no longer fails when optional fields are absent.
```
Commit messages are developer-to-developer shorthand. Changelog entries are author-to-user contracts — they describe observable behavior changes, not implementation details. Category headers (Added/Fixed) group by impact type.

**WALL_OF_TEXT_ADR**

[ANTI-PATTERN]:
```markdown
## Context
When we first started the project in 2024, we used PostgreSQL because
our team was familiar with it. Over time, as the product grew, we noticed
that our read queries were becoming slower. We had several meetings about
this and eventually decided to look into alternatives...
```
[CORRECT]:
```markdown
## Context
- Read query p99 latency exceeds 200ms at current scale (50K concurrent users).
- Write volume is 10:1 read-to-write ratio — read replicas underutilized.
- Team has operational experience with PostgreSQL; no Redis operational experience.
- Unknown: whether connection pooling optimization would resolve latency without architecture change.
```
Context sections state the situation, not the story. Each bullet is an independently verifiable fact or an explicitly labeled unknown. The reader needs forces acting on the decision, not a chronological narrative.

**PARAMETER_NOISE**

[ANTI-PATTERN]:
```typescript
/**
 * @param userId - The user ID.
 * @param limit - The limit.
 * @param offset - The offset.
 */
```
[CORRECT]:
```typescript
/**
 * @param userId - Validated domain identifier. Must originate from Identity context.
 * @param limit - Maximum results per page. Clamped to [1, 100] by the service layer.
 * @param offset - Zero-based cursor position. Invalid offsets return empty result set.
 */
```
Parameter documentation that restates the name adds zero information. Documentation must state the constraint (valid range), origin (which boundary produced the value), or semantic meaning (what happens at edge cases) that the type signature cannot express.

**STALE_DOCS**

[ANTI-PATTERN]: README Install section references `npm install legacy-package` — package was replaced 3 versions ago.
[CORRECT]: Documentation updates are part of the definition of done for every code change that modifies public behavior.
Staleness is the most expensive documentation failure — it produces negative trust. A developer who follows stale instructions wastes time and loses confidence in all other documentation.

**PSEUDOCODE_EXAMPLE**

[ANTI-PATTERN]:
```python
# Conceptual usage:
result = service.process(data)  # returns some result
if result.ok:
    handle(result.value)
```
[CORRECT]:
```python
result: Result[ProcessedOrder, DomainError] = process_order(
    candidate=raw_input,
    max_amount=Decimal("10000.00"),
)
# result is Success(ProcessedOrder(...)) or Failure(DomainError.InvalidAmount(...))
```
Pseudocode examples teach the wrong API. Examples must use actual function signatures, actual types, and actual error representations. The reader should be able to extract the example into a test file and execute it.

**AUDIENCE_MIXING**

[ANTI-PATTERN]: README that opens with installation instructions, then explains internal architecture, then returns to configuration, then explains deployment.
[CORRECT]: Evaluator content (Description, Badges) → Adopter content (Install, Usage, Config) → Contributor content (Architecture, Contributing). Each tier builds on the prior tier; no tier breaks the reading flow to address a different audience.

**TYPE_RESTATING**

[ANTI-PATTERN]:
```csharp
/// <summary>Returns a Fin of OrderId.</summary>
/// <returns>A Fin containing an OrderId.</returns>
public static Fin<OrderId> Create(long candidate)
```
[CORRECT]:
```csharp
/// <summary>
/// Validates positivity and upper-bound constraints on raw identifier input.
/// </summary>
/// <returns>
/// Succ when constraints hold; Fail with the specific invariant violation.
/// </returns>
public static Fin<OrderId> Create(long candidate)
```
The type signature already says `Fin<OrderId>`. Documentation that restates this adds negative value — it occupies attention budget with zero information. Document the guard conditions, the semantic meaning of success, and the invariant that failure represents.
