# Migration Guide: Change Detection Integration

## Overview

This guide documents the migration from handrolled file change detection to the unified change detection architecture using step-security/changed-files.

## Pre-Migration State

### Current Detection Patterns (To Be Replaced)

#### Pattern 1: Shell-based Git Commands
```yaml
# [AVOID] Scattered git commands in workflows
- name: Detect changes
  run: |
      git diff --name-only ${{ github.event.pull_request.base.sha }} > changed_files.txt
      if grep -q "apps/" changed_files.txt; then
        echo "apps_changed=true" >> $GITHUB_OUTPUT
      fi
      if grep -q "packages/" changed_files.txt; then
        echo "packages_changed=true" >> $GITHUB_OUTPUT
      fi
```

**Issues**:
- Scattered logic across multiple workflow files
- No type safety
- if/else chains (violates dispatch table pattern)
- Manual glob matching prone to errors

#### Pattern 2: Multiple tj-actions/changed-files Calls
```yaml
# [AVOID] Compromised action (CVE-2025-30066)
- uses: tj-actions/changed-files@v44
  id: changed-apps
  with:
      files: apps/**

- uses: tj-actions/changed-files@v44
  id: changed-packages
  with:
      files: packages/**
```

**Issues**:
- Security vulnerability (CVE-2025-30066)
- Multiple action invocations (slow)
- Duplicated configuration
- No integration with B constant

#### Pattern 3: GitHub API Direct Calls
```typescript
// [AVOID] Unstructured API calls
const { data } = await github.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: baseSha,
    head: 'HEAD',
});
const changedFiles = data.files?.map((f) => f.filename) ?? [];
```

**Issues**:
- No dispatch table
- Hardcoded pagination
- Manual error handling
- Not integrated with existing `call()` infrastructure

## Migration Path

### Step 1: Add step-security/changed-files Reference

Already completed in `B.changes.action`:

```typescript
const B = Object.freeze({
    changes: {
        action: {
            name: 'step-security/changed-files',
            version: '4.3.0',
            ref: 'f9b3bb1f9126ed32d88ef4aacec02bde4b70daa2',  // Post-CVE fix
        },
        // ... rest of config
    },
} as const);
```

### Step 2: Replace Workflow Detection Logic

#### Before (ci.yml - manual detection):
```yaml
- name: Detect affected
  id: affected
  run: |
      CHANGED_FILES=$(git diff --name-only origin/main...HEAD)
      if echo "$CHANGED_FILES" | grep -q "^apps/"; then
        echo "apps=true" >> $GITHUB_OUTPUT
      fi
      if echo "$CHANGED_FILES" | grep -q "^packages/"; then
        echo "packages=true" >> $GITHUB_OUTPUT
      fi
```

#### After (ci.yml - unified factory):
```yaml
- uses: ./.github/actions/changed-files
  id: changes
  with:
      mode: fast
      globs: apps/**,packages/**
      since_sha: ${{ github.event.pull_request.base.sha || 'origin/main' }}

- name: Display Changes
  run: |
      echo "Affected: ${{ steps.changes.outputs.affected }}"
      echo "Stats: ${{ steps.changes.outputs.stats }}"
```

### Step 3: Remove Scattered API Calls

#### Before (pr-sync.ts - manual comparison):
```typescript
const compare = await github.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: context.payload.pull_request.base.sha,
    head: context.payload.pull_request.head.sha,
});
const files = compare.data.files?.map((f) => f.filename) ?? [];
```

#### After (pr-sync.ts - dispatch table):
```typescript
import { createChangeDetection, createCtx, B } from './schema.ts';

const ctx = createCtx({ context, core, github });
const result = await createChangeDetection(ctx, {
    mode: 'fast',
    globs: [B.changes.globs.packages, B.changes.globs.apps],
    sinceSha: context.payload.pull_request.base.sha,
});
const files = result.files.map((f) => f.path);
```

### Step 4: Consolidate PR Comments

#### Before (multiple comment actions):
```yaml
- name: Comment on apps changes
  if: steps.affected.outputs.apps == 'true'
  uses: actions/github-script@v7
  with:
      script: |
          await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
              body: 'Apps changed!'
          });

- name: Comment on packages changes
  if: steps.affected.outputs.packages == 'true'
  uses: actions/github-script@v7
  with:
      script: |
          await github.rest.issues.createComment({...});
```

#### After (single mutate dispatch):
```typescript
import { mutate, createChangeDetection, md, fn } from './schema.ts';

const changes = await createChangeDetection(ctx, {
    mode: 'comprehensive',
    globs: [B.changes.matchers.monorepo.affected],
});

await mutate(ctx, {
    t: 'comment',
    n: prNumber,
    marker: 'CHANGE-SUMMARY',
    body: fn.body([
        { kind: 'heading', level: 2, text: 'Change Summary' },
        { kind: 'alert', type: 'note', content: `${changes.files.length} files changed across ${changes.affected.length} packages` },
        { kind: 'task', items: changes.affected.map((pkg) => ({ text: pkg, done: false })) },
        { kind: 'code', lang: 'json', content: JSON.stringify(changes.stats, null, 2) },
    ]),
});
```

### Step 5: Integrate with Nx Affected

#### Current (ci.yml - implicit affected):
```yaml
- name: Build
  run: pnpm exec nx affected -t build
```

#### Enhanced (explicit change detection):
```yaml
- uses: ./.github/actions/changed-files
  id: changes
  with:
      mode: fast
      globs: apps/**,packages/**

- name: Build Affected
  run: |
      AFFECTED="${{ steps.changes.outputs.affected }}"
      if [[ -n "$AFFECTED" ]]; then
        echo "Building: $AFFECTED"
        pnpm exec nx affected -t build
      else
        echo "[OK] No affected projects"
      fi
```

**Benefits**:
- Explicit change visibility
- Early exit if no changes
- Clear logs for debugging

## Workflow File Changes

### ci.yml

**Add after checkout**:
```yaml
- uses: ./.github/actions/changed-files
  id: changes
  with:
      mode: fast
      globs: ${{ github.event_name == 'pull_request' && 'apps/**,packages/**' || '**/*' }}
      since_sha: ${{ github.event.pull_request.base.sha || 'HEAD^' }}

- name: Change Summary
  run: |
      echo "## Changed Files" >> $GITHUB_STEP_SUMMARY
      echo "${{ steps.changes.outputs.stats }}" >> $GITHUB_STEP_SUMMARY
      echo "" >> $GITHUB_STEP_SUMMARY
      echo "**Affected Packages**: ${{ steps.changes.outputs.affected }}" >> $GITHUB_STEP_SUMMARY
```

### active-qc.yml (pr-hygiene job)

**Current** (no change detection):
```yaml
pr-hygiene:
    name: PR Review Hygiene
    if: github.event_name == 'pull_request' && github.event.action == 'synchronize'
    runs-on: ubuntu-latest
    steps:
        - uses: actions/checkout@v4
        - uses: ./.github/actions/pr-hygiene
```

**Enhanced** (with change context):
```yaml
pr-hygiene:
    name: PR Review Hygiene
    if: github.event_name == 'pull_request' && github.event.action == 'synchronize'
    runs-on: ubuntu-latest
    steps:
        - uses: actions/checkout@v4

        - uses: ./.github/actions/changed-files
          id: changes
          with:
              mode: comprehensive
              globs: apps/**,packages/**,**/*.{ts,tsx}

        - uses: ./.github/actions/pr-hygiene
          with:
              pr_number: ${{ github.event.pull_request.number }}
              owner_logins: ${{ github.repository_owner }}
              changed_files: ${{ steps.changes.outputs.files }}
```

## Script File Changes

### pr-sync.ts

**Before** (manual API calls):
```typescript
const compare = await github.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: pr.base.sha,
    head: pr.head.sha,
});
const files = compare.data.files ?? [];
```

**After** (unified factory):
```typescript
import { createChangeDetection, createCtx, B } from './schema.ts';

const ctx = createCtx({ context, core, github });
const result = await createChangeDetection(ctx, {
    mode: 'fast',
    globs: [B.changes.globs.packages, B.changes.globs.apps],
    sinceSha: pr.base.sha,
});
const files = result.files;
```

### pr-hygiene.ts

**Enhancement** (use change context):
```typescript
// Add to HygieneSpec type
type HygieneSpec = {
    readonly prNumber: number;
    readonly ownerLogins: ReadonlyArray<string>;
    readonly changedFiles?: ReadonlyArray<string>;  // New field
};

// Use in classify function
const classify = (t: Thread, commits: ReadonlyArray<CommitFile>, spec: HygieneSpec): Action => {
    if (t.isResolved) return 'skip';
    if (t.isOutdated) return 'resolve';

    // [USE] New: Check if thread path in changed files
    const inChangedFiles = spec.changedFiles?.includes(t.path ?? '') ?? true;
    if (!inChangedFiles) return 'skip';  // Skip threads on unchanged files

    const isValuableThread = isValuable(t.comments.nodes.map((c) => c.body).join(' '));
    return isValuableThread ? 'skip' : commits.some((c) => pathMatch(t.path, c.files)) ? 'reply' : 'skip';
};
```

## Testing Strategy

### Unit Tests (Vitest)

```typescript
import { describe, it, expect } from 'vitest';
import { fn, B } from './.github/scripts/schema.ts';

describe('fn.globMatch', () => {
    it('matches packages glob', () => {
        expect(fn.globMatch('packages/ui/src/index.ts', [B.changes.globs.packages])).toBe(true);
    });

    it('excludes node_modules', () => {
        expect(fn.globMatch('packages/ui/node_modules/foo.js', B.changes.paths.exclude)).toBe(true);
    });
});

describe('fn.affectedPackages', () => {
    it('extracts unique package names', () => {
        const files = ['packages/ui/src/index.ts', 'packages/ui/src/button.ts', 'apps/web/index.html'];
        const affected = fn.affectedPackages(files, B.changes.paths.workspace);
        expect(affected).toEqual(['packages/ui', 'apps/web']);
    });
});
```

### Integration Tests (GitHub Actions)

```yaml
# .github/workflows/test-change-detection.yml
name: Test Change Detection

on:
    workflow_dispatch:
    pull_request:
        paths: ['.github/scripts/schema.ts']

jobs:
    test-modes:
        runs-on: ubuntu-latest
        strategy:
            matrix:
                mode: [fast, comprehensive, matrix]
        steps:
            - uses: actions/checkout@v4
              with:
                  fetch-depth: 0

            - uses: ./.github/actions/changed-files
              id: changes
              with:
                  mode: ${{ matrix.mode }}
                  globs: apps/**,packages/**

            - name: Validate Outputs
              run: |
                  echo "Mode: ${{ matrix.mode }}"
                  echo "Files: ${{ steps.changes.outputs.files }}"
                  echo "Affected: ${{ steps.changes.outputs.affected }}"
                  echo "Stats: ${{ steps.changes.outputs.stats }}"
                  test -n "${{ steps.changes.outputs.files }}"
```

## Rollback Plan

If issues arise:

1. **Revert schema.ts changes**:
   ```bash
   git revert <commit-sha>
   git push
   ```

2. **Re-enable old detection** (temporary):
   ```yaml
   # Fallback to git commands
   - name: Detect changes (fallback)
     run: git diff --name-only ${{ github.event.pull_request.base.sha }} | tee changed.txt
   ```

3. **Monitor for issues**:
   - Check CI logs for API rate limits
   - Verify change detection accuracy
   - Monitor performance impact

## Success Criteria

- [x] B.changes constant defined with all config
- [x] Discriminated union schema for 3 modes
- [x] Dispatch tables (no if/else)
- [x] Pure utility functions (globMatch, affectedPackages)
- [x] Polymorphic entry point (createChangeDetection)
- [ ] CI workflows updated to use new action
- [ ] pr-sync.ts migrated to createChangeDetection
- [ ] pr-hygiene.ts enhanced with change context
- [ ] Unit tests for fn utilities
- [ ] Integration test workflow
- [ ] Documentation complete
- [ ] Security scan passed (no vulnerabilities)

## Timeline

- **Phase 1** (Complete): Architecture design, B constant, dispatch tables
- **Phase 2** (Next): Create `.github/actions/changed-files/action.yml`
- **Phase 3**: Update ci.yml and active-qc.yml workflows
- **Phase 4**: Migrate pr-sync.ts and pr-hygiene.ts scripts
- **Phase 5**: Add tests and validate
- **Phase 6**: Monitor and iterate

## References

- **Architecture**: [CHANGE_DETECTION.md](./CHANGE_DETECTION.md)
- **Schema**: [schema.ts](./schema.ts) (B.changes constant)
- **Pattern Source**: vite.config.ts (master pattern)
- **Security**: OpenSSF Scorecard 10/10 (step-security/changed-files)
- **CVE**: CVE-2025-30066 (tj-actions/changed-files compromise)
