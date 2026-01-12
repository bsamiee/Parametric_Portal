---
description: Commit, push, and open a PR
allowed-tools: Bash(git checkout:*), Bash(git add:*), Bash(git status:*), Bash(git push:*), Bash(git commit:*), Bash(gh pr create:*), Bash(git stash:*), Bash(git branch:*), Edit, Read
---

## Context

- Current branch: !`git branch --show-current`
- Current git status: !`git status`
- Current git diff: !`git diff HEAD --stat`

## Workflow

1. **Branch**: If on `main`, create feature branch (`feat/short-description`) preserving all changes
2. **Stage**: `git add -A` (all changes)
3. **Commit**: Single commit, message format `[TYPE]: description` (FEAT/FIX/REFACTOR/CHORE)
4. **Push**: Push feature branch to origin (`git push -u origin <branch>`)
5. **PR**: Create PR via `gh pr create --base main` using template below

## Lefthook Fixes

Pre-commit `imperatives` hook blocks: `try`, `throw`, `let`, `var`, `for`, `while`, `if`

**Fix surgically** - no new types/constants/helpers:
- `try/catch` → `Effect.try` or `Effect.tryPromise`
- `throw` → `Effect.fail` or `Effect.die`
- `let` → `const` with reassignment via pipe/reduce
- `for/while` → `.map()`, `.filter()`, `.reduce()`, `Effect.forEach`
- `if` → ternary `a ? b : c`, guard `a && b`, `Match.value().pipe()`

## PR Template

```markdown
# [Summary]

<!-- 1-2 sentences: what and why -->

## [Changes]

- <!-- bullet points of key changes -->

---

<!-- PR-MONITOR: START -->
<!-- PR-MONITOR: END -->
```

## Execution

Run all steps in a single message. On lefthook failure, read the failing file, fix imperatives inline, re-commit.
