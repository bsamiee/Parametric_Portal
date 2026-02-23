# [H1][PATTERNS]
>**Dictum:** *Each documentation anti-pattern is a reader tax compounding across every consumer.*

<br>

Documentation anti-pattern codex with concrete bad/good examples. Parallels csharp-standards/references/patterns.md—same format, documentation domain.

---
## [1][ANTI_PATTERN_CODEX]
>**Dictum:** *Named patterns enable precise identification and correction.*

<br>

**TROPHY_README**

**Anti-pattern:** A section titled "Project Structure" with file tree listing `src/controllers/UserController.ts`, `src/services/UserService.ts`, etc., without explaining architectural relationships or ownership boundaries between modules.

**Correct:** A section titled "Architecture" naming bounded contexts (Identity, Commerce, Notification); describes what each context owns (schema, routes, error types); specifies data flow direction (Identity → Commerce for order placement; Commerce → Notification for state transitions).
File trees describe topology without conveying architecture. Architecture sections name bounded contexts, ownership boundaries, data flow direction. Readers need to understand WHERE their code goes, not what files exist.

**COMMIT_CHANGELOG**

**Anti-pattern:** Changelog with flat commit-style entries like `fix: resolve null pointer in UserService` and `chore: update dependencies`, mixing developer-facing implementation details with user-facing changes.

**Correct:** Changelog organized by impact category headers (`### Added`, `### Fixed`) with entries describing observable behavior changes: "Bulk import endpoint: upload CSV to create up to 10,000 records per request" and "User profile retrieval no longer fails when optional fields are absent."
Commit messages are developer-to-developer shorthand. Changelog entries are author-to-user contracts—they describe observable behavior changes, not implementation details. Category headers (Added/Fixed) group by impact type.

**WALL_OF_TEXT_ADR**

**Anti-pattern:** ADR Context section written as chronological narrative: "When we first started the project in 2024, we used PostgreSQL because our team was familiar with it. Over time, as the product grew, we noticed that our read queries were becoming slower. We had several meetings about this and eventually decided to look into alternatives..."

**Correct:** ADR Context section organized as bulleted list of independent facts: "Read query p99 latency exceeds 200ms at current scale (50K concurrent users)" and "Team has operational experience with PostgreSQL; no Redis operational experience," with explicit labels for unknown constraints like "Unknown: whether connection pooling optimization would resolve latency without architecture change."
Context sections state situation, not story. Each bullet is independently verifiable fact or explicitly labeled unknown. Readers need forces acting on decision, not chronological narrative.

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
Parameter documentation restating names adds zero information. Documentation must state constraint (valid range), origin (which boundary produced the value), or semantic meaning (what happens at edge cases) that type signatures cannot express.

**STALE_DOCS**

[ANTI-PATTERN]: README Install section references `npm install legacy-package` — package was replaced 3 versions ago.
[CORRECT]: Documentation updates are part of definition of done for every code change modifying public behavior.
Staleness is most expensive documentation failure—it produces negative trust. Developers following stale instructions waste time and lose confidence in all other documentation.

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
Pseudocode examples teach wrong API. Examples must use actual function signatures, actual types, actual error representations. Readers should extract examples into test files and execute them.

**AUDIENCE_MIXING**

[ANTI-PATTERN]: README opening with installation instructions, then explaining internal architecture, then returning to configuration, then explaining deployment.
[CORRECT]: Evaluator content (Description, Badges) → Adopter content (Install, Usage, Config) → Contributor content (Architecture, Contributing). Each tier builds on prior tier; no tier breaks reading flow to address different audience.

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
/// Succ when constraints hold; Fail with specific invariant violation.
/// </returns>
public static Fin<OrderId> Create(long candidate)
```
Type signature already says `Fin<OrderId>`. Documentation restating this adds negative value—it occupies attention budget with zero information. Document guard conditions, semantic meaning of success, and invariant that failure represents.
