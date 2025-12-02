# PR Comment Aggregator

Consolidates multiple workflow outputs into single unified PR comment with marker-based update strategy.

## Architecture

**Pattern**: Schema → Script → Action → Workflow

**Files**:
- `/home/runner/work/Parametric_Portal/Parametric_Portal/.github/scripts/schema.ts` — B.prComment constant (config)
- `/home/runner/work/Parametric_Portal/Parametric_Portal/.github/scripts/pr-comment-aggregator.ts` — Core logic
- `/home/runner/work/Parametric_Portal/Parametric_Portal/.github/actions/pr-comment/action.yml` — Action wrapper
- `/home/runner/work/Parametric_Portal/Parametric_Portal/.github/workflows/ci.yml` — Integration point

## Strategy

**Marker-based identification**: Comment contains `<!-- UNIFIED-CI-REPORT -->` marker (B.prComment.marker)

**Update-or-create**: Finds existing comment by marker → updates in-place OR creates new (no duplicate comments)

**Dispatch table**: sectionRenderers maps section type → markdown renderer (affected, biome, changes, quality)

**Conditional rendering**: Only includes sections with data (empty sections filtered)

## Sections

**changes**: Statistics table (added/modified/deleted counts, total files)
```typescript
{ added: 5, modified: 12, deleted: 2, files: ['app.ts', ...] }
```

**affected**: Nx affected projects list from changed-detection action
```typescript
['apps/web', 'packages/components']
```

**quality**: Quality gates status table (lint/typecheck/build/test → pass/fail/skip)
```typescript
{ lint: 'pass', typecheck: 'pass', build: 'fail', test: 'skip' }
```

**biome**: Alert if biome auto-repair applied and committed
```typescript
{ repaired: true }
```

## Usage (ci.yml)

```yaml
- name: Post Unified PR Comment
  if: github.event_name == 'pull_request' && always()
  uses: ./.github/actions/pr-comment
  with:
      pr_number: ${{ github.event.pull_request.number }}
      sections_data: |
          {
            "changes": { "added": 5, "modified": 12, "deleted": 2, "files": [...] },
            "affected": ["apps/web", "packages/components"],
            "quality": { "lint": "pass", "typecheck": "pass", "build": "fail", "test": "skip" },
            "biome": { "repaired": true }
          }
```

## Replaces

**Before** (scattered comments):
- Individual biome auto-repair comments (.github/workflows/ci.yml line 97-107)
- Separate change detection outputs
- Separate quality gate status comments

**After** (unified comment):
- Single comment with all sections
- Updates in-place on subsequent runs
- No comment clutter on PRs

## NOT Integrated

**pr-hygiene**: Remains standalone workflow (explicit requirement). Lives in `/home/runner/work/Parametric_Portal/Parametric_Portal/.github/workflows/active-qc.yml`.

## Patterns Applied

[USE] B constant for config (B.prComment.marker, B.prComment.sections, B.prComment.templates)
[USE] Dispatch table for section renderers (sectionRenderers: Record<SectionType, (data) => string>)
[USE] Pure utility functions (statsTable, projectList, qualityGateTable, biomeAlert)
[USE] md.* utilities from schema.ts (md.details, md.alert, md.marker)
[USE] Conditional rendering (filter empty sections)
[USE] Marker-based comment finding (md.marker(B.prComment.marker))

[AVOID] Scattered constants (single B.prComment)
[AVOID] if/else chains (dispatch table)
[AVOID] Duplicate comments (update-or-create strategy)
[AVOID] Manual markdown construction (use md.* utilities)

## Example Output

```markdown
<!-- UNIFIED-CI-REPORT -->

## 🤖 CI Report

<details>
<summary>📊 Changes Detected</summary>

| Metric | Count |
|:-------|------:|
| Added | 5 |
| Modified | 12 |
| Deleted | 2 |
| Total Files | 19 |
</details>

<details>
<summary>📦 Affected Projects</summary>

- `apps/web`
- `packages/components`
- `packages/theme`
</details>

### ✓ Quality Gates

| Target | Status |
|:-------|:------:|
| Lint | ✅ |
| Type Check | ✅ |
| Build | ❌ |
| Test | ⏭️ |

> [!NOTE]
> Biome auto-repair applied and committed

_Updated: 2025-12-02T04:27:00.000Z_
```

## Extension Points

**Add section**: 
1. Add to B.prComment.sections array in schema.ts
2. Add renderer to sectionRenderers dispatch table in pr-comment-aggregator.ts
3. Pass data via sections_data JSON in ci.yml

**Customize template**:
1. Update B.prComment.templates in schema.ts
2. Modify buildComment function in pr-comment-aggregator.ts if structural changes needed
