---
tags: [gotcha, mistake, edge-case, bug, warning]
summary: Mistakes and edge cases to avoid
relevantTo: [error, bug, fix, issue, problem]
importance: 0.9
relatedFiles: []
usageStats:
  loaded: 15
  referenced: 6
  successfulFeatures: 6
---
# Gotchas

Mistakes and edge cases to avoid. These are lessons learned from past issues.

---



#### [Gotcha] Pre-existing typecheck errors in transfer.ts prevented validation of entire server package, requiring file-level filtering (2026-01-13)
- **Situation:** Running pnpm tsc on full server package showed many errors, making it unclear if audit changes were correct
- **Root cause:** transfer.ts had pre-existing issues unrelated to this feature. Required grep filtering to isolate audit-specific errors.
- **How to avoid:** Easier: Identified that audit code was correct. Harder: Had to manually filter output and trust that errors were truly pre-existing