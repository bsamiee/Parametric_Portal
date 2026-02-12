# Advanced GitHub Actions Triggers

**Last Updated:** February 2026

## Trigger Selection

| Scenario | Trigger |
|----------|---------|
| Standard PR validation | `pull_request` |
| External PR with secrets | `workflow_run` after `pull_request` |
| Deploy after CI | `workflow_run` |
| External webhook/API | `repository_dispatch` |
| ChatOps commands | `issue_comment` |
| Scheduled tasks | `schedule` |

---

## workflow_run

Chain workflows. Runs with target branch context (safe for external PRs).

```yaml
on:
  workflow_run:
    workflows: ["CI Pipeline"]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7.0.0
        with: { name: build-artifacts, run-id: '${{ github.event.workflow_run.id }}', github-token: '${{ secrets.GITHUB_TOKEN }}' }
```

**Properties:** `.name`, `.conclusion`, `.head_sha`, `.head_branch`, `.id`, `.event`

---

## repository_dispatch

External API triggers via `POST /repos/{owner}/{repo}/dispatches`.

```yaml
on:
  repository_dispatch:
    types: [deploy-prod, deploy-staging, run-migration]

jobs:
  deploy:
    if: startsWith(github.event.action, 'deploy-')
    runs-on: ubuntu-latest
    environment: { name: '${{ github.event.client_payload.environment || ''staging'' }}' }
    steps:
      - run: printf 'Version: %s\n' "${{ github.event.client_payload.version }}"
```

```bash
curl -X POST -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{"event_type":"deploy-prod","client_payload":{"version":"v1.2.3","environment":"production"}}'
```

---

## issue_comment (ChatOps)

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  deploy:
    if: |
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '/deploy') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8.0.0
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner, repo: context.repo.repo,
              comment_id: context.payload.comment.id, content: 'rocket'
            });
```

**Security:** Always validate command is from PR, user has permissions, arguments are sanitized. Use env vars for comment content.

---

## Path Filtering

```yaml
on:
  push:
    paths: ['src/**', '!src/**/*.md', '!**/__tests__/**']
  pull_request:
    paths: ['packages/frontend/**', 'packages/shared/**']
```

---

## workflow_dispatch Inputs

Manual trigger with typed inputs (max 25 inputs, 65535 char payload).

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment target'
        required: true
        type: environment    # dropdown from configured environments
      log-level:
        description: 'Verbosity'
        required: false
        type: choice
        default: 'info'
        options: [debug, info, warn, error]
      dry-run:
        description: 'Simulate without deploying'
        required: false
        type: boolean
        default: false
      version:
        description: 'Release version'
        required: true
        type: string
      replicas:
        description: 'Number of instances'
        required: false
        type: number
        default: 3
```

| Type | Values | Notes |
|------|--------|-------|
| `string` | Free text | Default type if not specified |
| `boolean` | `true` / `false` | Renders as checkbox in UI |
| `choice` | From `options:` list | Renders as dropdown |
| `number` | Integers and floats | Validated as numeric |
| `environment` | Configured environments | Respects environment protection rules |

---

## Other Triggers

| Trigger | Types | Use Case |
|---------|-------|----------|
| `deployment` | _(none)_ | GitHub deployment API integration |
| `deployment_status` | _(none)_ | Post-deploy notifications |
| `check_run` | `created`, `rerequested`, `completed` | CI status integration |
| `package` | `published`, `updated` | Package registry events |
