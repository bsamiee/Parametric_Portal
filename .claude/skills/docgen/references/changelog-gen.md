# [H1][CHANGELOG_GEN]
>**Dictum:** *Changelog entries are author-to-user contracts, not developer-to-developer shorthand.*

<br>

Generation-specific instructions for changelog entries and release notes. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with Semantic Versioning.

---
## [1][FORMAT]
>**Dictum:** *Six categories capture all observable behavior changes.*

<br>

### [1.1][HEADING_STRUCTURE]

```markdown
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [1.3.0] - 2026-02-22
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

[IMPORTANT]:
1. [ALWAYS] **Unreleased section:** Exists at top. Accumulates entries between releases.
2. [ALWAYS] **Version heading:** `[MAJOR.MINOR.PATCH] - YYYY-MM-DD` format.
3. [ALWAYS] **Category order:** Added → Changed → Deprecated → Removed → Fixed → Security.

[CRITICAL]:
- [NEVER] Empty categories — omit categories with no entries.
- [NEVER] Date-less versions — every release heading includes ISO 8601 date.

---
### [1.2][COMPARISON_LINKS]

```markdown
[Unreleased]: https://github.com/org/repo/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/org/repo/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/org/repo/releases/tag/v1.2.0
```

Place at file bottom. Each version links to its comparison diff.

---
## [2][ENTRY_GENERATION]
>**Dictum:** *Transform developer shorthand into user-observable behavior.*

<br>

### [2.1][TRANSFORMATION_RULES]

| [INDEX] | [COMMIT_MESSAGE]                           | [CHANGELOG_ENTRY]                                                            | [CATEGORY] |
| :-----: | ------------------------------------------ | ---------------------------------------------------------------------------- | :--------: |
|   [1]   | `feat: add bulk import endpoint`           | Bulk import endpoint: upload CSV to create up to 10,000 records per request. |   Added    |
|   [2]   | `fix: resolve null pointer in UserService` | User profile retrieval no longer fails when optional fields are absent.      |   Fixed    |
|   [3]   | `feat!: migrate auth to JWT`               | Authentication migrated from session cookies to JWT. See migration guide.    |  Changed   |
|   [4]   | `chore: update dependencies`               | *(omit — no user-observable behavior change)*                                |     —      |
|   [5]   | `fix: patch XSS in comment renderer`       | Comment rendering sanitizes HTML input to prevent script injection.          |  Security  |

### [2.2][COMMIT_PARSING_STRATEGY]

When generating entries from commit history:

| [INDEX] | [SOURCE]            | [PRIORITY] | [EXTRACTION]                                          |
| :-----: | ------------------- | :--------: | ----------------------------------------------------- |
|   [1]   | **PR title + body** |  Highest   | PR title → entry summary; body → detail if breaking.  |
|   [2]   | **Commit subject**  |    High    | Conventional Commits prefix → category routing.       |
|   [3]   | **Commit body**     |   Medium   | Extended description for context on complex changes.  |
|   [4]   | **File diff scope** |    Low     | Changed files indicate affected module for scope tag. |

**Filtering heuristics:**
- `feat:`, `feat!:` → Include. Route per §3[CATEGORY_ROUTING].
- `fix:` → Include. Route to Fixed or Security based on content.
- `docs:`, `chore:`, `ci:`, `style:`, `refactor:`, `test:`, `build:` → Omit unless user-observable side effect.
- Merge commits → Omit (PR title already captured).

**Grouping:** Cluster related commits into single entries. Three commits fixing the same feature → one changelog entry describing the net behavior change.

### [2.3][WRITING_DISCIPLINE]

[IMPORTANT]:
1. [ALWAYS] **User-facing language:** Describe observable behavior, not implementation detail.
2. [ALWAYS] **Complete sentences:** Each entry is a standalone statement ending with period.
3. [ALWAYS] **Scope indicator:** Include the feature or module name at entry start for scannability.
4. [ALWAYS] **Migration notes:** Breaking changes include `See migration guide` or inline migration steps.

[CRITICAL]:
- [NEVER] Commit message verbatim — commits are developer shorthand; changelog is user contract.
- [NEVER] Internal refactoring — `chore`, `refactor`, `style`, `ci` categories omitted unless user-observable.
- [NEVER] PR/commit references in entry text — link in comparison URL handles traceability.

---
## [3][CATEGORY_ROUTING]
>**Dictum:** *Category selection is deterministic, not subjective.*

<br>

| [INDEX] | [SIGNAL]                                      |   [CATEGORY]   |
| :-----: | --------------------------------------------- | :------------: |
|   [1]   | New capability not previously available       |   **Added**    |
|   [2]   | Existing behavior modified (non-breaking)     |  **Changed**   |
|   [3]   | Feature scheduled for removal in future       | **Deprecated** |
|   [4]   | Previously available capability removed       |  **Removed**   |
|   [5]   | Incorrect behavior corrected                  |   **Fixed**    |
|   [6]   | Vulnerability patched or security improvement |  **Security**  |

**Breaking change detection:** Semver MAJOR bump required when:
- Public API function signature changes
- Required configuration added
- Default behavior changes
- Data format migration required

---
## [4][RELEASE_NOTES]
>**Dictum:** *Release notes are curated changelog summaries for announcement context.*

<br>

Release notes differ from changelog entries:

| [INDEX] | [DIMENSION]     | [CHANGELOG]                   | [RELEASE_NOTES]                       |
| :-----: | --------------- | ----------------------------- | ------------------------------------- |
|   [1]   | **Audience**    | Existing users tracking diffs | Broader audience including evaluators |
|   [2]   | **Granularity** | Per-entry, per-category       | Grouped by theme/narrative            |
|   [3]   | **Tone**        | Factual, terse                | Contextual, value-oriented            |
|   [4]   | **Structure**   | Flat list per category        | Highlights → details → migration      |

### [4.1][RELEASE_NOTE_STRUCTURE]

1. **Headline:** One sentence — the most impactful change.
2. **Highlights:** 3-5 bullet points covering significant additions/changes.
3. **Breaking changes:** Enumerated with migration steps.
4. **Full changelog:** Link to version comparison.

---
## [5][VERSIONING_DISCIPLINE]
>**Dictum:** *Version numbers encode compatibility contracts.*

<br>

| [INDEX] | [BUMP]    | [TRIGGER]                                       |
| :-----: | --------- | ----------------------------------------------- |
|   [1]   | **MAJOR** | Breaking change — public API contract violated. |
|   [2]   | **MINOR** | New capability — backward-compatible addition.  |
|   [3]   | **PATCH** | Bug fix — backward-compatible correction.       |

[IMPORTANT]:
1. [ALWAYS] **Pre-1.0:** MINOR bumps may include breaking changes. Document explicitly.
2. [ALWAYS] **Unreleased accumulation:** Entries accumulate in `[Unreleased]` until version is cut.

[CRITICAL]:
- [NEVER] Bump MAJOR for internal-only breaking changes — semver tracks public API surface.
