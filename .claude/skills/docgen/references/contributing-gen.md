# [H1][CONTRIBUTING_GEN]
>**Dictum:** *Contribution guides encode workflow contracts, not aspirational culture.*

<br>

Generation-specific instructions for creating CONTRIBUTING.md files. Covers operational workflow, section requirements, and project-type adaptations.

---
## [1][EXPLORATION_PHASE]
>**Dictum:** *Contribution guides reflect actual workflow, not ideal workflow.*

<br>

Before generating, gather information from:

| [INDEX] | [SOURCE]                                                | [EXTRACTS]                                    |
| :-----: | ------------------------------------------------------- | --------------------------------------------- |
|   [1]   | CI/CD configuration (`.github/workflows/`, hooks)       | Required checks, linting, test gates          |
|   [2]   | Pre-commit hooks (`.husky/`, `.pre-commit-config`)      | Auto-formatting, lint rules, commit standards |
|   [3]   | Branch protection rules (GitHub settings, `CODEOWNERS`) | Review requirements, merge strategy           |
|   [4]   | Test configuration and scripts                          | Test commands, coverage thresholds            |
|   [5]   | Existing PR templates (`.github/PULL_REQUEST_TEMPLATE`) | Expected PR structure                         |

[CRITICAL]:
- [NEVER] Describe workflow steps the CI does not enforce — contributors follow what's enforced, not what's documented.

---
## [2][SECTION_CATALOG]
>**Dictum:** *Each section maps to a contributor action.*

<br>

### [2.1][DEVELOPMENT_SETUP]

Exact commands from clone to running tests:

```markdown
## Development Setup

```sh
git clone <repo-url>
cd <repo>
pnpm install
pnpm test
```
```

Include fork vs. direct clone policy, required environment variables, database setup if applicable.

---
### [2.2][WORKFLOW]

Branch naming, commit conventions, PR process:

```markdown
## Workflow

1. Create branch from `main`: `feat/short-description` or `fix/short-description`.
2. Commit using Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`.
3. Push; open PR against `main`.
4. Address review feedback; all CI checks pass before merge.
```

---
### [2.3][CODE_STANDARDS]

Link to language-specific standards; do not inline them:

```markdown
## Code Standards

- C#: See [csharp-standards](./docs/standards/csharp-standards.md)
- TypeScript: See [ts-standards](./docs/standards/ts-standards.md)
- Python: See [python-standards](./docs/standards/python-standards.md)
```

---
### [2.4][TESTING]

Commands and coverage expectations:

```markdown
## Testing

Run all tests: `pnpm test`
Run with coverage: `pnpm test:coverage`

Coverage threshold: 80% line coverage; PRs below threshold fail CI.
```

---
### [2.5][ISSUE_REPORTING]

Link to issue templates. State what constitutes a valid bug report vs. feature request.

---
## [3][PROJECT_TYPE_ADAPTATIONS]
>**Dictum:** *Contribution friction varies by project type.*

<br>

| [INDEX] | [TYPE]          | [ADDITIONAL_SECTIONS]                                                 |
| :-----: | --------------- | --------------------------------------------------------------------- |
|   [1]   | **Library**     | API design guidelines, backward compatibility policy                  |
|   [2]   | **Service**     | Local infrastructure setup (Docker compose), seed data                |
|   [3]   | **CLI**         | Argument parsing conventions, manual testing procedures               |
|   [4]   | **Monorepo**    | Package-scoped contribution (which package, how to test in isolation) |
|   [5]   | **Open source** | CLA/DCO requirements, code of conduct link, first-timer labels        |

---
## [4][VALIDATION]
>**Dictum:** *Contribution guides are verifiable by executing them.*

<br>

[VERIFY]:
- [ ] Development setup commands produce passing test suite from clean clone.
- [ ] Branch naming convention matches CI enforcement.
- [ ] Commit convention matches changelog generation expectations.
- [ ] PR template matches code review evaluation criteria.
- [ ] No aspirational workflow steps that CI does not enforce.
