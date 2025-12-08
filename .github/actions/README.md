# Composite Actions

Reusable composite actions for the Parametric Portal CI/CD workflows.

## Actions Catalog

### changed-detection
**Purpose**: Detect changed files and affected Nx projects  
**Marketplace Action**: `tj-actions/changed-files@v47`  
**Use Cases**:
- Nx affected command optimization
- Conditional workflow execution
- Matrix job generation

**Usage**:
```yaml
- uses: ./.github/actions/changed-detection
  with:
    mode: fast # or comprehensive, matrix
    files_pattern: '**.ts|**.tsx'
    globs_pattern: 'apps/**,packages/**'
```

**Outputs**:
- `changed_files`: JSON array of file paths
- `affected_projects`: Nx projects impacted
- `stats_json`: Add/modify/delete counts
- `has_changes`: Boolean indicator

---

### slash-dispatch
**Purpose**: Unified slash command dispatcher  
**Marketplace Action**: `peter-evans/slash-command-dispatch@v4.0.1`  
**Use Cases**:
- Issue/PR comment commands
- ChatOps workflows
- Automated triage/review triggers

**Usage**:
```yaml
- uses: ./.github/actions/slash-dispatch
  with:
    token: ${{ secrets.GITHUB_TOKEN }} # For reactions only
    # token: ${{ secrets.PAT }} # Use PAT if dispatching to trigger workflows
    commands: |
      review
      triage
      fix
    permission: write
    reactions: 'true'
```

**Outputs**:
- `command`: Dispatched command name
- `args`: JSON payload of arguments

**Supported Commands** (configurable in `B.slashDispatch.commands`):
- **Gemini**: `/review`, `/triage`, `/architect`, `/implement`, `/invoke`
- **Maintenance**: `/duplicate`

---

### node-env
**Purpose**: Node.js + pnpm + Nx environment setup  
**Marketplace Action**: `pnpm/action-setup@v4.1.0`  
**Use Cases**:
- CI job initialization
- Dependency installation
- Nx distributed execution

**Usage**:
```yaml
- uses: ./.github/actions/node-env
  with:
    nx: 'true'
    nx-cloud-token: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}
    nx-distribute: 'true'
```

---

### git-identity
**Purpose**: Configure Git user for automated commits  
**Use Cases**:
- Auto-fix commits
- Release automation
- PR synchronization

---

### auto-fix
**Purpose**: Apply automated fixes and commit changes  
**Use Cases**:
- Biome auto-repair
- Formatting corrections
- Linting fixes

---

### issue-ops
**Purpose**: Unified issue/PR operations  
**Marketplace Action**: `actions-cool/issues-helper@v3.7.2`  
**Use Cases**:
- Stale management
- Label operations
- Duplicate marking

---

### pr-hygiene
**Purpose**: PR review hygiene automation  
**Use Cases**:
- Stale review dismissal
- Comment cleanup
- State synchronization

---

### label
**Purpose**: Label operations via GitHub GraphQL  
**Use Cases**:
- Issue pinning/unpinning
- Dynamic label management

---

### meta-fixer
**Purpose**: AI-powered metadata correction  
**Use Cases**:
- Title normalization
- Label inference
- Body formatting

---

### normalize-commit
**Purpose**: Conventional commit message normalization  
**Use Cases**:
- Commit history cleanup
- Changelog generation

---

## Configuration

All marketplace action versions and SHAs are centralized in `.github/scripts/schema.ts`:

```typescript
const B = Object.freeze({
  changes: {
    action: {
      name: 'tj-actions/changed-files',
      ref: '24d32ffd492484c1d75e0c0b894501ddb9d30d62',
      version: '47',
    },
  },
  slashDispatch: {
    action: {
      name: 'peter-evans/slash-command-dispatch',
      ref: 'a28ee6cd74d5200f99e247ebc7b365c03ae0ef3c',
      version: '4.0.1',
    },
  },
  // ...
});
```

## Best Practices

1. **Pin to SHA**: Always reference marketplace actions by commit SHA for security
2. **Use Composites**: Prefer composite actions over duplicating workflow steps
3. **Centralize Config**: Define action versions in `schema.ts` B constant
4. **Sparse Checkout**: Use minimal checkout for composite actions
5. **Token Scopes**: Use PAT for dispatch, GITHUB_TOKEN for reactions

## Maintenance

- **Update Frequency**: Review marketplace action updates quarterly
- **Security Audits**: Verify SHAs match tagged releases
- **Breaking Changes**: Test in feature branch before main integration

## References

- [Composite Actions Documentation](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [Workflow Optimization Guide](../WORKFLOW_OPTIMIZATION.md)
- [Schema Configuration](../scripts/schema.ts)
