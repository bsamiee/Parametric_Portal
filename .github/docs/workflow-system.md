# Workflow Automation System Documentation

**Last Updated**: 2025-11-28
**Purpose**: Reference documentation for tag/label/commit validation infrastructure

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SCHEMA.TS (Central Hub)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  B.types = {                                                                 │
│    breaking: { p: ['!:', 'BREAKING CHANGE'] },                              │
│    build, chore, ci, docs, feat, fix, perf, refactor, style, test          │
│  }                                                                           │
│                                                                              │
│  B.pr.pattern = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/i                      │
│  (matches: type(scope)!: description)                                       │
│                                                                              │
│  B.labels.categories = { action, agent, lifecycle, priority, special }      │
│  B.labels.exempt = ['critical', 'implement', 'pinned', 'security']          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Exports: B, S, call, createCtx, fn, mutate                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│    PR-META.TS       │  │     GATE.TS         │  │  FAILURE-ALERT.TS   │
│  PR Title Validator │  │  Merge Eligibility  │  │   Issue Creator     │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ 1. parse(title)     │  │ classifyGating()    │  │ CI/Security alerts  │
│    → B.pr.pattern   │  │ → major/minor/patch │  │ → Creates issues    │
│ 2. validate(parsed) │  │ checkMutation()     │  │ → Labels: tech-debt │
│    → B.types check  │  │ → 80% threshold     │  │   or security       │
│ 3. labels(type)     │  │ migrate()           │  │                     │
│    → Add to PR      │  │ → Migration issues  │  │                     │
│ FAIL if invalid     │  │                     │  │                     │
│ NO auto-fix         │  │                     │  │                     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

---

## Scripts Reference

### schema.ts (715 lines) - Central Configuration
- **B constant**: Single frozen object with all configuration
- **B.types**: Valid conventional commit types (11 types)
- **B.pr.pattern**: Regex for PR title validation
- **B.labels**: Label categories and exemptions
- **B.alerts**: CI and security alert templates
- **B.gating**: Merge eligibility rules
- **B.dashboard**: Dashboard configuration
- **ops**: GitHub API operation registry
- **mutateHandlers**: Dispatch table for mutations (comment, issue, label, release, review)

### pr-meta.ts (72 lines) - PR Title Validation
- Parses title against `B.pr.pattern`
- Validates type against `B.types` keys
- Applies labels on valid title
- **FAILS** with error on invalid (no auto-fix)

### gate.ts (89 lines) - Merge Eligibility
- Classifies PRs: major/minor/patch/canary
- Checks mutation score (80% threshold)
- Blocks ineligible merges
- Creates migration issues for major updates

### failure-alert.ts (42 lines) - Alert Creator
- Creates issues for CI failures
- Creates issues for security scan failures
- Classifies by job type (perf/test/quality)

### probe.ts (201 lines) - Data Extractor
- Polymorphic handlers: issue, pr, discussion
- Extracts normalized data from GitHub entities
- Posts PR review summaries

### dashboard.ts (327 lines) - Metrics Dashboard
- Collects repository metrics
- Generates markdown dashboard
- Updates pinned issue

### report.ts (121 lines) - Report Generator
- Config-driven reports
- Source → Format → Output pipeline

### env.ts (32 lines) - Environment Config
- Language detection (ts/cs)
- Nx Cloud workspace ID

---

## Workflows Reference

### PR Validation Flow
```
PR opened/edited → active-qc.yml → pr-meta.ts
                                   ├─ Valid: Apply type label
                                   └─ Invalid: FAIL workflow
```

### CI Flow
```
PR/Push → ci.yml → Biome → TypeCheck → Build → Test
                   └─ On failure: failure-alert.ts → Create debt issue
```

### Security Flow
```
PR/Push/Schedule → security.yml
  ├─ Dependency Audit (pnpm audit)
  ├─ Dependency Review (license check)
  ├─ CodeQL Analysis
  ├─ Gitleaks (secrets scan)
  └─ License Compliance
      └─ On failure: failure-alert.ts → Create security issue
```

### Auto-Merge Flow
```
Dependabot PR → auto-merge.yml → gate.ts
  ├─ Patch/Minor: Auto-merge after CI
  ├─ Major: Block + create migration issue
  └─ Security fix: Always auto-merge
```

---

## Valid Commit Types

| Type | Prefixes | Description |
|------|----------|-------------|
| `feat` | `feat:`, `feat(` | New feature |
| `fix` | `fix:`, `fix(` | Bug fix |
| `docs` | `docs:`, `docs(` | Documentation |
| `style` | `style:`, `style(` | Formatting |
| `refactor` | `refactor:`, `refactor(` | Restructuring |
| `test` | `test:`, `test(` | Tests |
| `chore` | `chore:`, `chore(` | Maintenance |
| `perf` | `perf:`, `perf(` | Performance |
| `ci` | `ci:`, `ci(` | CI/CD changes |
| `build` | `build:`, `build(` | Build system |
| `breaking` | `!:`, `BREAKING CHANGE` | Breaking change |

---

## PR Title Format

```
type(scope)!: description
│     │    │   │
│     │    │   └─ Brief description (required)
│     │    └───── Breaking change marker (optional)
│     └────────── Scope (optional)
└──────────────── Type from B.types (required)
```

**Examples:**
- `feat: add user authentication`
- `fix(api): handle null responses`
- `chore!: drop Node 18 support`
- `docs(readme): update installation`

---

## Labels Mapping

Labels are defined in `.github/labels.yml` and synced via `ghaction-github-labeler`.

**Commit Type Labels** (applied by pr-meta.ts):
- `fix`, `feat`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`

**Special Labels**:
- `breaking` - Applied with `!` marker
- `security` - Security issues
- `dependencies` - Dependabot updates
- `dashboard` - Dashboard issue

**Agent Labels**:
- `copilot`, `claude`, `gemini`, `codex`

**Lifecycle Labels**:
- `stale`, `pinned`

---

## Nx Release Integration

Configured in `nx.json`:
```json
"conventionalCommits": {
    "types": {
        "feat": { "changelog": { "title": "Features" }, "semverBump": "minor" },
        "fix": { "changelog": { "title": "Bug Fixes" }, "semverBump": "patch" },
        "perf": { "changelog": { "title": "Performance" }, "semverBump": "patch" },
        "refactor": { "changelog": { "title": "Refactoring" }, "semverBump": "patch" },
        "docs": { "changelog": { "title": "Documentation" }, "semverBump": "none" },
        "build": { "changelog": false },
        "chore": { "changelog": false },
        "ci": { "changelog": false },
        "style": { "changelog": false },
        "test": { "changelog": false }
    }
}
```

---

## Known Limitations

1. **No Auto-Fix**: pr-meta.ts validates but doesn't suggest corrections
2. **Error Messages**: Generic format hints, no specific suggestions
3. **Separate Sources**: labels.yml and B.types are manually synchronized
4. **Validation Only**: Commits are not rewritten, just validated

---

## Troubleshooting

### PR Title Fails Validation
- Check format: `type(scope): description`
- Verify type is in: breaking, build, chore, ci, docs, feat, fix, perf, refactor, style, test
- Ensure colon-space separator (`: `)

### Labels Not Applied
- Check pr-meta.ts ran successfully
- Verify label exists in labels.yml
- Check GITHUB_TOKEN permissions

### Gitleaks Fails
- Does not support `pull_request_target` event
- Add conditional: `if: github.event_name != 'pull_request_target'`

### Dependency Review Fails
- Cannot use both `allow-licenses` AND `deny-licenses`
- Pick one approach (recommend `allow-licenses: MIT`)
