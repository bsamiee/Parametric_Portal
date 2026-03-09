# Git Conventions

## Dual-Format Convention

Two distinct formats serve different purposes. Both are enforced by `schema.ts` (`B.meta.fmt.title` / `B.meta.fmt.commit`) and validated by `B.pr.pattern` / `B.patterns.commit` respectively.

| Surface         | Format                     | Example                        | Enforced By             |
| --------------- | -------------------------- | ------------------------------ | ----------------------- |
| PR title        | `[TYPE]: description`      | `[FEAT]: add pagination`       | `meta-fixer`, `pr-sync` |
| Commit          | `type: description`        | `feat: add pagination`         | `B.patterns.commit`     |
| Commit (scoped) | `type(scope): description` | `feat(search): add pagination` | `B.patterns.commit`     |
| Branch          | `type/short-description`   | `feat/add-pagination`          | Convention              |

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`, `style`. Lowercase description, no trailing period.

## Breaking Changes

`type!: description` for commits, `[TYPE!]: description` for PR titles. `BREAKING CHANGE:` footer in body for detailed migration notes. Breaking changes in libraries require major version bump in catalog.

## Merge Strategy

Rebase merge for linear, bisect-friendly history. Individual commits preserved on main — each must be independently compilable and follow conventional commit format. Branch deleted after merge.

## Commit Quality

Every commit on a PR branch must pass `B.patterns.commit` validation (`/^(\w+)(!?)(?:\(.+\))?:\s*(.+)$/`). No bare messages (`update`, `cleanup`, `wip`). Clean branch history before merge — rebase and fixup locally.

## Changelog Generation

Nx parses commits on main via `conventionalCommits.parserOpts.headerPattern` which accepts both `[TYPE]:` and `type:` formats. Only `feat`, `fix`, `perf` produce changelog entries. Release auto-commits use `chore(release): {version}` and are excluded from re-triggering via CI guard.

## PR Workflow

Analyze full commit history from divergence point (`git log [base]...HEAD`), not just latest commit. Summary covers all changes with test plan.
