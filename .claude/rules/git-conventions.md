# Git Conventions

## Commit Format

`<type>: <description>` — types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. Lowercase description, no trailing period. Include body only when the change requires rationale beyond the one-line description — cite issue numbers and linked PRs.

## Branch Naming

`<type>/<short-description>` — matches commit types. Lowercase, hyphen-separated.

## PR Workflow

Analyze FULL commit history from divergence point (`git log [base]...HEAD`), not just latest commit. Summary covers all changes with test plan.

## Breaking Changes

`<type>!: <description>` suffix for breaking changes. `BREAKING CHANGE:` footer in body for detailed migration notes. Breaking changes in libraries require major version bump in catalog.

## Merge Strategy

Squash merge as default for linear, bisect-friendly history. Single atomic commit per PR on main — each must be independently compilable. Branch deleted after merge.
