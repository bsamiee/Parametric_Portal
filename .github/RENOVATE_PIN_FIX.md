# Renovate Dashboard Auto-Pinning Fix

## Problem Statement

The Renovate Dependency Dashboard issue (`[DASHBOARD] Dependency Dashboard`) was configured to include the `pinned` label via `renovate.json:dependencyDashboardLabels`, but the pin would drop every time Renovate refreshed the issue.

## Root Cause Analysis

### Why the Pin Dropped

1. **Renovate's Behavior**: When Renovate creates or updates its Dependency Dashboard, it sets labels directly: `['dashboard', 'pinned', 'dependencies']`

2. **GitHub Event Model**: GitHub only fires `labeled` events when a label is **newly added** to an issue. When an issue is updated with labels that were already present, no `labeled` event is triggered.

3. **Existing Infrastructure**: The repository had a complete pinning system:
   - `.github/scripts/schema.ts`: Defines `issue.pin` GraphQL mutation
   - `.github/scripts/label.ts`: Executes pin/unpin behaviors on label events
   - `.github/workflows/active-qc.yml`: `pin-issue` job triggers on `labeled`/`unlabeled` events for the `pinned` label

4. **The Gap**: When Renovate updated its dashboard issue:
   - Labels were already present → no `labeled` event fired
   - The `pin-issue` job never triggered
   - The issue remained unpinned despite having the `pinned` label

## Solution

### Implementation

Added a dedicated job in `.github/workflows/active-qc.yml`:

```yaml
pin-renovate-dashboard:
    name: Pin Renovate Dashboard
    if: |
        github.event_name == 'issues' &&
        (github.event.action == 'opened' || github.event.action == 'edited') &&
        github.event.issue.title == '[DASHBOARD] Dependency Dashboard' &&
        contains(github.event.issue.labels.*.name, 'pinned')
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
        - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
          with:
              sparse-checkout: |
                  .github
                  package.json
                  pnpm-workspace.yaml
                  pnpm-lock.yaml

        - uses: ./.github/actions/label
          with:
              action: 'labeled'
              label: 'pinned'
              node_id: ${{ github.event.issue.node_id }}
              number: ${{ github.event.issue.number }}
```

### How It Works

1. **Triggers**: On `issues.opened` and `issues.edited` events (catches Renovate updates)
2. **Filters**: Only runs for issues with exact title `[DASHBOARD] Dependency Dashboard` and containing the `pinned` label
3. **Action**: Reuses the existing `.github/actions/label` action, which calls `label.ts` → `schema.ts` → GraphQL `issue.pin` mutation
4. **Idempotency**: The `issue.pin` mutation is marked as `safe: true` in `schema.ts`, making it safe to call repeatedly

### Why This Works

- **Event-Based**: Catches all Renovate updates (not just label changes)
- **Specific**: Only targets Renovate's specific dashboard issue
- **Reuses Infrastructure**: Leverages existing, tested pinning code
- **Safe**: GraphQL mutation handles already-pinned issues gracefully
- **Minimal**: Single job addition, no code changes required

## Verification

To verify the fix is working:

1. Wait for Renovate to refresh its Dependency Dashboard (or manually trigger via checkbox)
2. Check the issue remains pinned in the repository issues page
3. Review workflow runs in Actions tab for `pin-renovate-dashboard` job

## Related Configuration

### renovate.json
```json
{
  "dependencyDashboard": true,
  "dependencyDashboardLabels": ["dashboard", "pinned", "dependencies"],
  "dependencyDashboardTitle": "[DASHBOARD] Dependency Dashboard"
}
```

### schema.ts
```typescript
B.labels.behaviors.pinned = { onAdd: 'pin', onRemove: 'unpin' }
B.labels.gql.pin = `mutation($issueId:ID!){pinIssue(input:{issueId:$issueId}){issue{id}}}`
```

## Future Considerations

### If Renovate Changes Its Title
If Renovate's dashboard title changes, update the condition in `pin-renovate-dashboard`:
```yaml
github.event.issue.title == '[NEW-TITLE]'
```

### If Adding More Auto-Pinned Issues
For other issues that need auto-pinning on update (not just label changes):
1. Add a dedicated job similar to `pin-renovate-dashboard`
2. Use specific title/label filters to identify the issue
3. Reuse the `.github/actions/label` action with `action: 'labeled'` and `label: 'pinned'`

### Performance Note
The `issue.pin` mutation is idempotent and lightweight. Running it on every Renovate update has negligible performance impact.

## References

- Original Issue: [Issue describing the pin dropping problem]
- PR: [This fix's PR number]
- Renovate Docs: https://docs.renovatebot.com/configuration-options/#dependencydashboardlabels
- GitHub GraphQL API: https://docs.github.com/en/graphql/reference/mutations#pinissue
