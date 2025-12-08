# Concurrency Issue Fix

## Problem Statement

PR titles were not being normalized from `feat(ci):` to `[FEAT]:` format because the PR Meta job was being cancelled by rapid successive commits.

## Root Cause Analysis

### Issue #1: Aggressive Cancellation
- **Symptom**: PR Meta job shows "cancelled" status
- **Cause**: `cancel-in-progress: true` at workflow level
- **Impact**: When multiple commits are pushed quickly (6 commits in this PR), later workflow runs cancel earlier ones before PR Meta can complete

### Issue #2: Shared Concurrency Group
- **Configuration**: `active-qc-${{ github.event_name }}-${{ github.event.pull_request.number }}`
- **Problem**: All jobs in active-qc workflow share the same concurrency group
- **Impact**: Any new PR event (synchronize, edited, etc.) cancels ALL pending jobs, including critical metadata fixes

### Issue #3: Timing Window
- **Scenario**: 6 commits pushed in rapid succession
- **Timing**: Each commit triggers a new workflow run
- **Result**: Jobs from earlier runs are cancelled before completing their work

## Solution Implemented

### 1. Separate Concurrency Group for PR Meta

```yaml
jobs:
  pr-meta:
    name: PR Meta
    concurrency:
      group: pr-meta-${{ github.event.pull_request.number }}
      cancel-in-progress: false  # Prevent cancellation
```

**Benefits**:
- PR Meta job runs in isolation from other active-qc jobs
- `cancel-in-progress: false` ensures the job completes even if new commits arrive
- Only one PR Meta job runs at a time per PR number

### 2. Job Ordering
Moved `pr-meta` to be the first job in the workflow, ensuring it runs immediately when triggered by `pull_request.opened` or `pull_request.edited` events.

### 3. YAML Expression Fix
Fixed expression syntax to prevent YAML parser errors:
```yaml
# Before (YAML parser error - interprets ! as tag)
if: !steps.slash-dispatch.outputs.command

# After (properly quoted)
if: "!steps.slash-dispatch.outputs.command"
```

## How It Works

### Before (Problematic Flow)
```
Commit 1 → Trigger Run 1 → PR Meta starts
Commit 2 → Trigger Run 2 → Cancel Run 1 (PR Meta killed)
Commit 3 → Trigger Run 3 → Cancel Run 2
...
Commit 6 → Trigger Run 6 → Cancel Run 5
Result: PR title never gets fixed
```

### After (Fixed Flow)
```
Commit 1 → Trigger Run 1 → PR Meta starts (isolated concurrency)
Commit 2 → Trigger Run 2 → Run 1's other jobs cancelled, but PR Meta continues
Commit 3 → Trigger Run 3 → Run 2's other jobs cancelled, but PR Meta continues
...
PR Meta completes → Title normalized to [FEAT]:
```

## Testing Strategy

1. **Single Commit PR**: Verify PR Meta runs and completes
2. **Rapid Multi-Commit PR**: Verify PR Meta completes despite subsequent commits
3. **Concurrent Events**: Verify different event types (opened, edited, synchronize) don't interfere

## Related Files

- `.github/workflows/active-qc.yml` - Concurrency configuration
- `.github/actions/meta-fixer/action.yml` - Title normalization logic
- `.github/scripts/ai-meta.ts` - Pattern matching and fixing

## Pattern Reference

Expected PR title format: `/^\[([A-Z]+)(!?)\]:\s*(.+)$/i`

Examples:
- ✅ `[FEAT]: add new feature`
- ✅ `[FIX!]: breaking bug fix`
- ❌ `feat(ci): wrong format`
- ❌ `feat: missing brackets`

## Monitoring

To verify the fix is working:
1. Check workflow runs for "PR Meta" job
2. Verify job status is "completed" (not "cancelled")
3. Confirm PR title matches `[TYPE]:` format after job completes

## Future Improvements

1. **Debouncing**: Consider using a debounce mechanism for rapid commits
2. **Job Dependencies**: Make other jobs depend on PR Meta completion
3. **Metrics**: Track cancellation rates for different job types
4. **Alerting**: Notify when PR Meta fails to complete
