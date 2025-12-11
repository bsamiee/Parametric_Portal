---
name: sonarcloud-tools
type: complex
depth: base
description: >-
  Executes SonarCloud API queries via unified Python CLI. Use when checking
  quality gate status, searching issues (bugs, vulnerabilities, code smells),
  retrieving metrics (coverage, complexity), or viewing analysis history.
---

# [H1][SONARCLOUD-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute SonarCloud queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]        | [API_ENDPOINT]                     | [ARGS]                                            |
| ------------ | ---------------------------------- | ------------------------------------------------- |
| quality-gate | `/api/qualitygates/project_status` | `--project` `--branch` `--pull-request`           |
| issues       | `/api/issues/search`               | `--project` `--severities` `--types` `--statuses` |
| measures     | `/api/measures/component`          | `--project` `--metrics`                           |
| analyses     | `/api/project_analyses/search`     | `--project` `--page` `--page-size`                |
| projects     | `/api/projects/search`             | `--organization` `--page` `--page-size`           |
| hotspots     | `/api/hotspots/search`             | `--project` `--status` `--page` `--page-size`     |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Quality gate status (pass/fail)
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py quality-gate
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py quality-gate --branch main
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py quality-gate --pull-request 42

# Search issues
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py issues
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py issues --severities BLOCKER,CRITICAL
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py issues --types BUG,VULNERABILITY
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py issues --statuses OPEN --page-size 50

# Get metrics
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py measures
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py measures --metrics coverage,bugs,vulnerabilities

# Analysis history
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py analyses
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py analyses --page-size 20

# List projects
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py projects

# Security hotspots
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py hotspots
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py hotspots --status TO_REVIEW
```

[IMPORTANT] API token auto-injected via 1Password at shell startup. Manual export not required.

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Response Fields:**
- `quality-gate` — `{project, status, passed: bool, conditions: object[]}`
- `issues` — `{project, total, issues: object[], summary: {by_severity, by_type}}`
- `measures` — `{project, name, metrics: {metric: value}}`
- `analyses` — `{project, total, analyses: object[]}`
- `projects` — `{organization, total, projects: object[]}`
- `hotspots` — `{project, total, hotspots: object[]}`

---
## [4][ARGUMENTS]
>**Dictum:** *Complete argument reference.*

<br>

### [4.1][GLOBAL]
| [ARG]            | [TYPE] | [DEFAULT]                   | [DESCRIPTION]              |
| ---------------- | ------ | --------------------------- | -------------------------- |
| `--project`      | string | `bsamiee_Parametric_Portal` | SonarCloud project key     |
| `--organization` | string | `bsamiee`                   | SonarCloud organization    |
| `--page`         | int    | `1`                         | Page number (1-indexed)    |
| `--page-size`    | int    | `100`                       | Results per page (max 500) |

### [4.2][QUALITY-GATE]
| [ARG]            | [TYPE] | [DEFAULT] | [DESCRIPTION]       |
| ---------------- | ------ | --------- | ------------------- |
| `--branch`       | string | (none)    | Branch name         |
| `--pull-request` | string | (none)    | Pull request number |

### [4.3][ISSUES]
| [ARG]          | [TYPE] | [DEFAULT]                 | [DESCRIPTION]                             |
| -------------- | ------ | ------------------------- | ----------------------------------------- |
| `--severities` | string | (none)                    | `BLOCKER,CRITICAL,MAJOR,MINOR,INFO`       |
| `--types`      | string | (none)                    | `BUG,VULNERABILITY,CODE_SMELL`            |
| `--statuses`   | string | `OPEN,CONFIRMED,REOPENED` | `OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED` |

### [4.4][MEASURES]
| [ARG]       | [TYPE] | [DEFAULT]         | [DESCRIPTION]                                    |
| ----------- | ------ | ----------------- | ------------------------------------------------ |
| `--metrics` | string | (all key metrics) | Comma-separated: `coverage,bugs,vulnerabilities` |

**Available Metrics:**
- `ncloc` — Lines of code
- `coverage` — Code coverage %
- `bugs` — Bug count
- `vulnerabilities` — Vulnerability count
- `code_smells` — Code smell count
- `duplicated_lines_density` — Duplication %
- `security_hotspots` — Security hotspot count
- `reliability_rating` — A-E rating
- `security_rating` — A-E rating
- `sqale_rating` — Maintainability A-E rating

### [4.5][HOTSPOTS]
| [ARG]      | [TYPE] | [DEFAULT] | [DESCRIPTION]                       |
| ---------- | ------ | --------- | ----------------------------------- |
| `--status` | string | (none)    | `TO_REVIEW,ACKNOWLEDGED,FIXED,SAFE` |

---
## [5][WORKFLOW_DIAGNOSIS]
>**Dictum:** *Diagnose failed SonarCloud workflow runs.*

<br>

**Step 1: Check Quality Gate**
```bash
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py quality-gate
```
If `passed: false`, examine `conditions` array for failing metrics.

**Step 2: Identify Blockers**
```bash
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py issues --severities BLOCKER,CRITICAL
```

**Step 3: Review Metrics**
```bash
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py measures --metrics coverage,new_coverage,new_bugs
```

**Step 4: Check Security Hotspots**
```bash
uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py hotspots --status TO_REVIEW
```
