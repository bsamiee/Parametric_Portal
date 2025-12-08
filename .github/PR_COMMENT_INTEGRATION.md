# PR Comment Integration Guide

## Overview

All non-AI workflow outputs are consolidated into a single PR comment using the **PR-MONITOR** marker system with section-based updates.

## Architecture

### Marker System

The PR template includes:
```markdown
<!-- PR-MONITOR: START -->
<!-- Automated reports will be injected here -->
<!-- PR-MONITOR: END -->
```

### Section Mode

Each workflow updates its own section within the PR-MONITOR comment:

```typescript
mutate(ctx, {
  t: 'comment',
  n: prNumber,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'workflow-id',
  body: 'Content'
});
```

**How Section Mode Works**:
1. Finds existing comment by `PR-MONITOR` marker
2. Looks for section markers: `<!-- SECTION-START: workflow-id -->` and `<!-- SECTION-END: workflow-id -->`
3. If section exists: replaces content between markers
4. If section doesn't exist: appends new section to comment
5. If no PR-MONITOR comment exists: creates one

### Implementation (schema.ts)

```typescript
const merge = (
    existing: string | null,
    content: string,
    mode: 'replace' | 'append' | 'prepend' | 'section',
    sectionId?: string,
): string => {
    if (mode === 'section' && sectionId) {
        const start = `<!-- SECTION-START: ${sectionId} -->`;
        const end = `<!-- SECTION-END: ${sectionId} -->`;
        const section = `${start}\n${content}\n${end}`;
        const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
        return pattern.test(prev) ? prev.replace(pattern, section) : `${prev}\n\n${section}`;
    }
    // ... other modes
}
```

## Current Integrations

### 1. Biome Auto-Repair (ci.yml)

**Workflow**: `.github/workflows/ci.yml`  
**Section ID**: `biome-repair`  
**Trigger**: PR events when auto-fix applied

```typescript
await mutate(createCtx({ context, core, github }), {
  t: 'comment',
  n: context.payload.pull_request.number,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'biome-repair',
  body: '[OK] **Biome Auto-Repair Applied**: Style issues fixed and committed.'
});
```

### 2. PR Hygiene (active-qc.yml)

**Workflow**: `.github/workflows/active-qc.yml`  
**Section ID**: `pr-hygiene`  
**Trigger**: PR synchronize events

```typescript
const body = `### 🧹 PR Hygiene
| Resolved | Replied | Deleted |
|:--:|:--:|:--:|
| ${resolved} | ${replied} | ${deleted} |

_${fn.formatTime(new Date())}_`;

await mutate(createMutateCtx(...), {
  t: 'comment',
  n: prNumber,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'pr-hygiene',
  body,
});
```

## Migration Patterns

### From Standalone Comment

**Before** (standalone comment with custom marker):
```typescript
await call(ctx, 'comment.create', prNumber, 
  `${md.marker('MY-MARKER')}\n### My Content\n...`
);
```

**After** (integrated into PR-MONITOR):
```typescript
const { mutate, createCtx } = await import('./schema.ts');
await mutate(createCtx({ context: { repo: { owner, repo } }, core, github }), {
  t: 'comment',
  n: prNumber,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'my-section',
  body: '### My Content\n...',
});
```

### From Direct GitHub API

**Before** (direct API call):
```typescript
await github.rest.issues.createComment({
  owner,
  repo,
  issue_number: prNumber,
  body: 'My content'
});
```

**After** (using mutate):
```typescript
const { mutate, createCtx } = await import('./schema.ts');
await mutate(createCtx({ context: { repo: { owner, repo } }, core, github }), {
  t: 'comment',
  n: prNumber,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'my-workflow',
  body: 'My content',
});
```

## Adding New Integrations

### Step 1: Import Required Functions

```typescript
import { mutate, createCtx } from './schema.ts';
// or
const { mutate, createCtx } = await import('${{ github.workspace }}/.github/scripts/schema.ts');
```

### Step 2: Choose Section ID

Use a unique, descriptive section ID:
- `biome-repair` - Style fixes
- `pr-hygiene` - Review cleanup
- `quality-gates` - CI quality checks
- `security-scan` - Security results
- `coverage` - Test coverage
- `performance` - Performance metrics

### Step 3: Format Content

Use consistent markdown formatting:
```typescript
const body = `### 🔍 Section Title
| Metric | Value |
|--------|-------|
| Foo | ${foo} |
| Bar | ${bar} |

_Updated: ${new Date().toISOString()}_`;
```

### Step 4: Call mutate

```typescript
await mutate(createCtx({ 
  context: { repo: { owner: ctx.owner, repo: ctx.repo } }, 
  core, 
  github 
}), {
  t: 'comment',
  n: prNumber,
  marker: 'PR-MONITOR',
  mode: 'section',
  sectionId: 'your-section-id',
  body,
});
```

## Best Practices

### 1. Section IDs
- Use kebab-case: `my-section-id`
- Be descriptive and unique
- Don't change IDs (orphans old sections)

### 2. Content Format
- Start with emoji + title: `### 🔍 Section Title`
- Use tables for structured data
- Include timestamp at bottom
- Keep it concise (target: 5-10 lines)

### 3. Error Handling
```typescript
try {
  await mutate(ctx, { /* ... */ });
} catch (error) {
  core.warning(`Failed to update PR comment: ${error.message}`);
  // Don't fail workflow on comment errors
}
```

### 4. Conditional Updates
Only update when there's meaningful data:
```typescript
if (hasChanges) {
  await mutate(ctx, { /* ... */ });
}
```

## Troubleshooting

### Section Not Appearing

**Issue**: Section content not showing in PR comment

**Checks**:
1. Verify PR template has `<!-- PR-MONITOR: START -->` markers
2. Check section ID is unique
3. Ensure `mode: 'section'` is set
4. Verify workflow has `pull-requests: write` permission

### Section Not Updating

**Issue**: Section shows old content

**Checks**:
1. Verify section ID matches exactly
2. Check regex pattern in merge function
3. Look for malformed HTML comments

### Multiple Comments Created

**Issue**: Each workflow creates new comment

**Checks**:
1. Ensure using `marker: 'PR-MONITOR'` (not custom marker)
2. Verify `mode: 'section'` (not 'replace' or 'append')
3. Check findComment function is working

## External Bot Comments

**These post separately** (can't integrate):
- **Nx Cloud** - Performance metrics
- **SonarQube Cloud** - Code quality
- **Dependabot** - Dependency updates
- **Copilot/Claude** - AI review responses

These are posted by external services and cannot be consolidated into PR-MONITOR.

## Future Enhancements

### Planned Integrations
- [ ] Quality gates summary from ci.yml
- [ ] Change detection stats
- [ ] Affected projects list
- [ ] Test coverage delta
- [ ] Bundle size changes

### Alternative Approaches Considered

1. **Single Aggregator Job**: Collect all outputs, post once
   - ❌ Requires complex coordination between jobs
   - ❌ Delays until all jobs complete

2. **Job Summary Only**: Use $GITHUB_STEP_SUMMARY
   - ❌ Not visible in PR thread
   - ❌ Requires clicking through to run

3. **Individual Comments**: Each workflow posts separately
   - ❌ Clutters PR thread
   - ❌ Hard to find information

4. **Section Mode** (current): Each workflow updates its section ✅
   - ✅ Immediate feedback as jobs complete
   - ✅ Single consolidated view
   - ✅ Easy to extend

## References

- PR Template: `.github/PULL_REQUEST_TEMPLATE.md`
- Schema Implementation: `.github/scripts/schema.ts` (merge function, line ~700)
- Biome Integration: `.github/workflows/ci.yml` (line 71-86)
- PR Hygiene Integration: `.github/scripts/pr-hygiene.ts` (postSummary function)
- Comment Aggregator (unused): `.github/scripts/pr-comment-aggregator.ts` (future unified approach)
