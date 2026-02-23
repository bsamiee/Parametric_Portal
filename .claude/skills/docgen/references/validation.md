# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify documentation standards compliance.*

<br>

Per-document-type checklists for auditing documentation artifacts. Use after creating, editing, or reviewing documentation. Items require agent judgment—no automated linter covers these.

---
## [1][README]
>**Dictum:** *Validation ensures README content matches project reality.*

<br>

- [ ] Title is single H1 matching project/package name.
- [ ] Description is one paragraph: what/why/distinction—no feature lists.
- [ ] Install commands are copy-pasteable and verified against current dependencies.
- [ ] Usage example is runnable: importable for libraries, `curl` for services, exact invocation for CLIs.
- [ ] Conditional sections included per project type (API for libraries, Architecture for services).
- [ ] Audience tiers progressively disclosed: evaluator, adopter, contributor.
- [ ] Architecture section shows system context, not implementation details.
- [ ] No class diagrams—component or container diagrams only.
- [ ] License section contains SPDX identifier and link to LICENSE file.
- [ ] No stale content: all referenced commands, paths, and versions match current state.

---
## [2][ADR]
>**Dictum:** *Decision records require structural completeness to preserve reasoning.*

<br>

- [ ] Title follows `ADR-NNNN: <Noun Phrase>`—sequential, four-digit.
- [ ] Status is exactly one of: Proposed, Accepted, Deprecated, Superseded, Rejected.
- [ ] Context contains verifiable facts—no narrative history, no opinion framing.
- [ ] Decision Drivers ranked by impact—each is named force.
- [ ] Minimum 2 Considered Options—each with explicit pros, cons, neutral impacts.
- [ ] "Do nothing" evaluated as option when status quo is viable.
- [ ] Decision Outcome references specific drivers justifying selection.
- [ ] Consequences section has all three categories: Positive, Negative, Neutral.
- [ ] Negative consequences are not omitted or minimized.
- [ ] Supersession backlinks are bidirectional (old → new, new → old).

---
## [3][CHANGELOG]
>**Dictum:** *Changelog entries must trace to verifiable project history.*

<br>

- [ ] Follows Keep Changelog format: Unreleased section at top.
- [ ] Entries grouped by: Added, Changed, Deprecated, Removed, Fixed, Security.
- [ ] Version headings use semantic versioning: `[MAJOR.MINOR.PATCH] - YYYY-MM-DD`.
- [ ] Entries describe user-facing impact—not internal implementation.
- [ ] No commit hashes or PR numbers in entry text (link separately if needed).
- [ ] Breaking changes highlighted under Changed or Removed with migration guidance.
- [ ] Security entries include CVE references when applicable.

---
## [4][CODE_DOCUMENTATION]
>**Dictum:** *Code documentation gates prevent type-restating noise.*

<br>

- [ ] All exported functions have doc comments: summary, params, returns.
- [ ] All exported types have summary with domain concept and invariants.
- [ ] Effect-returning functions document both success and failure channel semantics.
- [ ] Smart constructors document guard conditions, valid ranges, failure modes.
- [ ] Error types document each variant: trigger condition and caller response.
- [ ] Module-level doc comment states purpose in one line.
- [ ] No doc comment restates type signature (TYPE_RESTATING anti-pattern).
- [ ] No `@param` repeats parameter name as description (PARAMETER_NOISE anti-pattern).
- [ ] No inline comment describes WHAT—only WHY.
- [ ] No commented-out code in module.
- [ ] Language-specific format matches canonical standard: XML (C#), Google (Python), TSDoc (TS).

---
## [5][CONTRIBUTING]
>**Dictum:** *Contribution guides must enable autonomous contributor onboarding.*

<br>

- [ ] Development setup commands produce passing test suite from clean clone.
- [ ] Branch naming convention matches CI enforcement.
- [ ] Commit convention matches changelog generation expectations.
- [ ] PR template structure matches code review evaluation criteria.
- [ ] Test commands and coverage thresholds match CI configuration.
- [ ] No aspirational workflow steps that CI does not enforce.

---
## [6][ARCHITECTURE]
>**Dictum:** *Architecture validation ensures structural completeness and diagram accuracy.*

<br>

- [ ] System Overview includes C4 Context diagram with external actors.
- [ ] High-Level Architecture shows 3-7 bounded contexts with directional data flow.
- [ ] All diagram edges carry protocol or interaction labels.
- [ ] Codemap reflects actual directory structure—no invented paths.
- [ ] Codemap limited to 2-3 levels of nesting depth.
- [ ] Key Design Decisions link to existing ADRs with Accepted status.
- [ ] Cross-Cutting Concerns document auth, error handling, logging, observability.
- [ ] No implementation details (class names, method signatures) in diagrams.
- [ ] Invariants are testable and consequence-linked.
- [ ] Diagrams use Mermaid syntax and render without errors.

---
## [8][DETECTION_HEURISTICS]
>**Dictum:** *Searchable patterns enable automated pre-screening.*

<br>

| [INDEX] | [SEARCH_FOR]                                           | [INDICATES]        | [SEVERITY] |
| :-----: | :----------------------------------------------------- | :----------------- | :--------: |
|   [1]   | `README.md` missing in project root                    | Missing README     |    High    |
|   [2]   | `## Install` absent in README                          | TROPHY_README      |    High    |
|   [3]   | `## Usage` absent in README                            | TROPHY_README      |    High    |
|   [4]   | ADR without `## Consequences`                          | WALL_OF_TEXT_ADR   |    High    |
|   [5]   | ADR with single Considered Option                      | Incomplete ADR     |   Medium   |
|   [6]   | `@param \w+ the \w+` pattern in doc comments           | PARAMETER_NOISE    |   Medium   |
|   [7]   | `Returns a` followed by type name in doc comments      | TYPE_RESTATING     |   Medium   |
|   [8]   | `// TODO` without issue link in source files           | Untracked debt     |    Low     |
|   [9]   | Commented-out code blocks (`// ...` spanning 3+ lines) | Code archaeology   |    Low     |
|  [10]   | CHANGELOG with commit hashes in entry text             | COMMIT_CHANGELOG   |   Medium   |

---
## [9][QUICK_REFERENCE]
>**Dictum:** *Quick reference accelerates validation by consolidating checklists.*

<br>

| [INDEX] | [CHECKLIST_AREA]         | [WHAT_IT_VALIDATES]                                            | [REFERENCE]           |
| :-----: | :----------------------- | :------------------------------------------------------------- | :-------------------- |
|   [1]   | **README**               | Structure, audiences, sections, scope routing                  | `readme-gen.md`       |
|   [2]   | **ADR**                  | Format, status, content discipline, lifecycle                  | `adr.md`              |
|   [3]   | **CHANGELOG**            | Keep-a-Changelog format, semantic versioning, user-facing text | `changelog-gen.md`    |
|   [4]   | **CODE_DOCUMENTATION**   | Coverage, format compliance, signal hierarchy                  | `code-docs.md`        |
|   [5]   | **CONTRIBUTING**         | Workflow accuracy, CI alignment, setup reproducibility         | `contributing-gen.md`   |
|   [6]   | **ARCHITECTURE**         | Diagrams, codemap, decisions, cross-cutting concerns           | `architecture-gen.md`   |
|   [7]   | **DETECTION_HEURISTICS** | 10 grep-able patterns with severity classification             | —                       |
