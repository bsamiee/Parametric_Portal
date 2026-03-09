---
description: Structural specification for Changelogs and Release Notes
---

# [H1][CHANGELOG-STANDARDS]
>**Dictum:** *Changelogs record user-visible changes; commit logs record developer-visible changes.*

<br>

[CRITICAL] Changelog is not commit log. Changelogs communicate what changed from consumer perspective—new capabilities, behavior changes, removals, fixes.

---
## [1][FORMAT]
>**Dictum:** *Keep a Changelog is the canonical format.*

<br>

Based on [Keep a Changelog](https://keepachangelog.com/) with Semantic Versioning. Group entries by release version, categories within each release. Nx generates changelogs from conventional commits on main — `feat` maps to Added, `fix` to Fixed, `perf` to Changed. Other types (`refactor`, `docs`, `chore`, `ci`, `test`, `build`, `style`) are excluded from changelog output.

| [INDEX] | [ELEMENT]            | [FORMAT]                                                               |
| :-----: | -------------------- | ---------------------------------------------------------------------- |
|   [1]   | **Title**            | `# Changelog` — fixed, no project name.                                |
|   [2]   | **Version heading**  | `## [X.Y.Z] - YYYY-MM-DD` — semver + ISO 8601 date.                    |
|   [3]   | **Unreleased**       | `## [Unreleased]` — accumulates entries before next release.           |
|   [4]   | **Categories**       | H3 headings: Added, Changed, Deprecated, Removed, Fixed, Security.     |
|   [5]   | **Entries**          | Bullet points. User-facing language. One change per bullet.            |
|   [6]   | **Comparison links** | Footer: `[X.Y.Z]: https://github.com/org/repo/compare/vA.B.C...vX.Y.Z` |

---
## [2][CATEGORIES]
>**Dictum:** *Six categories cover the full change taxonomy.*

<br>

| [INDEX] | [CATEGORY]     | [WHEN_USED]                                    |
| :-----: | -------------- | ---------------------------------------------- |
|   [1]   | **Added**      | New features, new endpoints, new capabilities. |
|   [2]   | **Changed**    | Behavior changes to existing functionality.    |
|   [3]   | **Deprecated** | Features marked for future removal.            |
|   [4]   | **Removed**    | Features deleted in this release.              |
|   [5]   | **Fixed**      | Bug fixes to existing functionality.           |
|   [6]   | **Security**   | Vulnerability patches, security improvements.  |

[IMPORTANT]:
1. [ALWAYS] **Omit empty categories:** Only include categories with entries.
2. [ALWAYS] **Fixed order:** Categories appear in the order listed above.

[CRITICAL]:
- [NEVER] Invent new categories—six above are exhaustive.
- [NEVER] Use past tense in bullet entries—entries use imperative mood: "Add X" not "Added X." *(Section headers like "Added", "Fixed" retain past participle per Keep a Changelog convention.)*

---
## [3][ENTRY_DISCIPLINE]
>**Dictum:** *Entries describe impact, not implementation.*

<br>

### [3.1][WRITING_RULES]

Each entry is one bullet point, one sentence, imperative mood. State user-visible impact, not code change.

[IMPORTANT]:
1. [ALWAYS] **Consumer language:** "Add pagination to search results" not "Implement cursor-based pagination in SearchService."
2. [ALWAYS] **Scope clarity:** Include the affected component or area: "Add pagination to **search results**."

[CRITICAL]:
- [NEVER] Reference commit hashes, PRs, internal implementation in changelog entries.
- [NEVER] Combine multiple changes in one bullet—one change per entry.

---
### [3.2][BREAKING_CHANGES]

Breaking changes receive special treatment within their category:

[IMPORTANT]:
1. [ALWAYS] **BREAKING prefix:** Start entry with `**BREAKING:**` in bold.
2. [ALWAYS] **Migration path:** Include migration instruction inline or link to migration guide.

---
## [4][VERSIONING]
>**Dictum:** *Semantic Versioning encodes change severity.*

<br>

| [INDEX] | [BUMP]    | [TRIGGER]                                               |
| :-----: | --------- | ------------------------------------------------------- |
|   [1]   | **Major** | Breaking changes to public API or behavior.             |
|   [2]   | **Minor** | New features, non-breaking additions.                   |
|   [3]   | **Patch** | Bug fixes, security patches, documentation corrections. |

[CRITICAL]:
- [NEVER] Release major version without at least one `**BREAKING:**` entry in changelog.
- [NEVER] Backdate version entries—date is release date, not development date.

---
## [5][VALIDATION]
>**Dictum:** *Gates prevent incomplete release documentation.*

<br>

[VERIFY]:
- [ ] Title is `# Changelog` with no project name.
- [ ] `[Unreleased]` section exists at the top.
- [ ] Version headings follow `## [X.Y.Z] - YYYY-MM-DD` format.
- [ ] All entries use imperative mood.
- [ ] Empty categories are omitted.
- [ ] Breaking changes prefixed with `**BREAKING:**` and include migration path.
- [ ] Comparison links in footer for all versions.
- [ ] Entries describe user-visible impact, not implementation details.
