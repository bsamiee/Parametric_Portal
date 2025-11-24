# CI/CD and Commit Gate Documentation

This document describes the CI/CD pipeline and commit gate setup for Parametric Portal.

## Overview

Our CI/CD strategy is focused on **quality**, **speed**, and **no waste**:

- **Git Hooks**: Automatic code quality checks before commits
- **CI Pipeline**: Focused quality checks on pull requests and main branch
- **Nx Affected**: Only test/build what changed
- **Biome Integration**: Fast, Rust-powered linting and formatting

## Git Hooks (Commit Gate)

### Setup

Git hooks are managed by **Husky** (v9) with **lint-staged** for running checks only on staged files.

#### Configuration

**`.husky/pre-commit`**:
```bash
pnpm exec lint-staged
```

**`package.json` lint-staged config**:
```json
{
  "lint-staged": {
    "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}": [
      "biome check --write --no-errors-on-unmatched --files-ignore-unknown=true"
    ],
    "*.{md,yml,yaml}": [
      "biome check --write --no-errors-on-unmatched"
    ]
  }
}
```

### What Happens on Commit

1. **Staged files identified**: Only files you're committing are checked
2. **Biome check runs**: Linting, formatting, and organization
3. **Auto-fix applied**: Safe fixes are automatically applied
4. **Updated files staged**: Fixed files are added back to the commit
5. **Commit proceeds**: If all checks pass

### Key Flags

- `--write`: Auto-fix issues when possible
- `--no-errors-on-unmatched`: Don't fail when patterns don't match files
- `--files-ignore-unknown=true`: Ignore files Biome doesn't understand

## CI Pipeline

### Workflow: `.github/workflows/ci.yml`

The CI pipeline runs on:
- **Pull requests** to `main`
- **Pushes** to `main`

### Job: Code Quality (15 min timeout)

#### 1. Setup Phase
- **Checkout**: Full git history for Nx affected
- **Node.js**: v25.2.1 (exact version from project requirements)
- **pnpm**: v10.23.0 with intelligent caching
- **Dependencies**: Frozen lockfile installation
- **Nx Cache**: Restore previous build cache

#### 2. Quality Checks Phase

**Biome CI Check** (no auto-fix):
```bash
pnpm exec biome ci .
```
Validates code style, linting rules, and formatting across entire codebase.

**Type Check** (Nx affected):
```bash
pnpm exec nx affected -t typecheck --base=$BASE --head=$HEAD --parallel=4
```
Only type-checks projects affected by changes.

**Build** (Nx affected):
```bash
pnpm exec nx affected -t build --base=$BASE --head=$HEAD --parallel=4
```
Only builds projects affected by changes.

**Test** (Nx affected):
```bash
pnpm exec nx affected -t test --base=$BASE --head=$HEAD --parallel=4
```
Only tests projects affected by changes, with coverage collection.

#### 3. Artifacts Phase
- **Coverage reports**: Uploaded for review (7-day retention)

### Performance Optimizations

1. **Concurrency Control**: Cancel in-progress runs when new commits arrive
2. **Dual Caching**: Both pnpm store and Nx computation cache
3. **Parallel Execution**: 4 workers for Nx tasks
4. **Affected-Only**: Skip unchanged projects
5. **Smart Base/Head**: Uses PR base/head for PRs, HEAD~1 for main

### Why Nx Affected?

In a monorepo, running all tests/builds on every commit is wasteful:

```
Without Nx Affected:
PR touches package A → Tests A, B, C, D, E (slow, wasteful)

With Nx Affected:
PR touches package A → Tests only A and dependents (fast, focused)
```

## Biome Integration

### Why Biome?

- **Fast**: Rust-powered, 100x faster than ESLint+Prettier
- **All-in-one**: Linting, formatting, import sorting
- **Zero config**: Works out of the box
- **Git aware**: VCS integration built-in

### Configuration: `biome.json`

Our Biome config enforces:
- **No default exports** (except configs)
- **No `any`** type
- **No `console`** (warn level)
- **Complexity ≤10**
- **Exhaustive dependencies/switch**
- **Import type separation**
- **Auto-organize imports**

See `biome.json` for full configuration.

### Commands

**Local development**:
```bash
pnpm check              # Check + fix all files
pnpm exec biome check . # Check all files (no fix)
```

**CI**:
```bash
pnpm exec biome ci .    # Check only, fail on issues (no auto-fix)
```

**Explain rule**:
```bash
pnpm exec biome explain <rule-name>
```

## Nx Integration

### Targets Defined

From `nx.json`:
- **build**: Cached, outputs to `{projectRoot}/dist`
- **test**: Cached, outputs to `{projectRoot}/coverage`
- **typecheck**: Cached, uses TypeScript compiler
- **check**: Cached, runs Biome

### Crystal Plugin

Nx Crystal automatically infers targets from `vite.config.ts` files:
- **build**: Vite build
- **dev**: Dev server
- **preview**: Preview built app
- **serve-static**: Serve static files

### Named Inputs

- **sharedGlobals**: All root configs (nx.json, tsconfig, biome.json, etc.)
- **production**: Source files excluding tests
- **typescript**: TypeScript files + tsconfig

## Maintenance

### Updating Dependencies

1. Update catalog in `pnpm-workspace.yaml`
2. Run `pnpm install`
3. Verify: `pnpm typecheck && pnpm check`
4. Test: `pnpm test`

### Debugging CI Failures

1. **Check Biome**: `pnpm exec biome ci .`
2. **Check types**: `pnpm typecheck`
3. **Run affected**: `pnpm exec nx affected -t <target> --base=HEAD~1`
4. **Clear cache**: `pnpm exec nx reset`

### Adding New Projects

New projects are automatically discovered by Nx Crystal. Ensure:
1. Project has `vite.config.ts` or `project.json`
2. TypeScript config extends `tsconfig.base.json`
3. Package.json uses catalog versions

## Best Practices

### For Developers

1. **Run checks locally** before committing:
   ```bash
   pnpm check && pnpm typecheck
   ```

2. **Trust the hooks**: Let pre-commit fix formatting issues

3. **Watch CI**: Address CI failures immediately

4. **Use Nx affected** locally to test changes:
   ```bash
   pnpm exec nx affected -t build --base=main
   ```

### For Reviewers

1. **Check CI status**: All checks must pass
2. **Review coverage**: Ensure adequate test coverage
3. **Verify Nx graph**: Understand impact of changes:
   ```bash
   pnpm exec nx graph
   ```

## Troubleshooting

### Git Hook Not Running

```bash
# Reinstall hooks
pnpm prepare
```

### Biome Issues

```bash
# Check specific file
pnpm exec biome check path/to/file.ts

# Fix specific file
pnpm exec biome check --write path/to/file.ts

# Explain a rule
pnpm exec biome explain <rule-name>
```

### Nx Cache Issues

```bash
# Clear all caches
pnpm exec nx reset
rm -rf node_modules/.vite
```

### CI Not Running Affected

Ensure:
1. PR has base and head SHAs
2. Checkout step uses `fetch-depth: 0`
3. Base branch is correct

## Resources

- [Biome Documentation](https://biomejs.dev/)
- [Biome Git Hooks Recipe](https://biomejs.dev/recipes/git-hooks/)
- [Nx Documentation](https://nx.dev/)
- [Nx Affected Commands](https://nx.dev/concepts/affected)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged](https://github.com/lint-staged/lint-staged)

## Summary

Our CI/CD setup provides:
- ✅ **Fast feedback**: Local hooks catch issues before commit
- ✅ **Efficient CI**: Only test/build what changed
- ✅ **High quality**: Strict linting, type checking, and formatting
- ✅ **No bloat**: Focused, minimal configuration
- ✅ **Developer-friendly**: Auto-fix where possible
- ✅ **Scalable**: Nx affected scales with monorepo growth

---

**Last Updated**: 2025-11-24
