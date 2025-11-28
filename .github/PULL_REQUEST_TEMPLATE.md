## [Summary]

<!-- Describe what this PR does and why -->

## [Related Issues]

<!-- Link related issues: "Fixes #123" or "Closes #456" -->

## [Changes]

<!-- List key changes in bullet points -->

-

## [Human Review Checklist]

<!-- These require human judgment - CI cannot verify -->

- [ ] Tests cover the new/changed behavior
- [ ] Documentation updated (if user-facing changes)
- [ ] No unnecessary complexity added

---

<details>
<summary>Automated Checks (enforced by CI)</summary>

| Check | Workflow | Status Check |
|-------|----------|--------------|
| Code style & linting | `pnpm check` | `Code Quality` |
| Type safety | `pnpm typecheck` | `Code Quality` |
| Tests pass | `pnpm test` | `Code Quality` |
| PR title format | PR Metadata | `PR Metadata` |
| Effect patterns | Claude review | `requirements-review` |
| B constant pattern | Claude review | `requirements-review` |
| No try/catch | Claude review | `requirements-review` |

**Merge is blocked** until all status checks pass via GitHub Rulesets.

</details>
