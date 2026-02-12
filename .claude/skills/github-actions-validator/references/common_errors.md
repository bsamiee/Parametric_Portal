# Common GitHub Actions Errors

## Syntax Errors

| Error | Cause | Fix |
|---|---|---|
| `Unable to process file command 'workflow'` | Bad YAML indentation, missing colons, tabs instead of spaces | Fix indentation (2 spaces per level), add missing colons |
| `Required property is missing: name` | Missing required workflow field | Add `name:`, `on:`, `jobs:` at top level |
| `Unexpected value 'on'` | Wrong event name | Use `pull_request` not `pull-request`, `workflow_dispatch` not `workflow-dispatch` |

```yaml
# Bad                          # Good
name:My Workflow               name: My Workflow
jobs:                          jobs:
build:                           build:
  runs-on: ubuntu-latest           runs-on: ubuntu-latest
```

## Expression Errors

| Error | Cause | Fix |
|---|---|---|
| `Unrecognized named-value: 'github'` | Missing `${{ }}` wrapper (note: `if:` auto-evaluates) | Wrap in `${{ }}` or use bare expression in `if:` |
| `Expected boolean value, got string` | Type mismatch (`'true'` vs `true`) | Use `true`/`false` literals, not strings |
| `Potential script injection` | Untrusted input directly in `run:` | Pass through `env:` variable |

```yaml
# Script injection fix
# Bad:  run: printf '%s\n' ${{ github.event.issue.title }}
# Good:
env:
  TITLE: ${{ github.event.issue.title }}
run: printf '%s\n' "$TITLE"
```

## Deprecated Commands

| Command | Status | Replacement |
|---|---|---|
| `::set-output name=KEY::VALUE` | Removed (Jun 2023) | `echo "KEY=VALUE" >> $GITHUB_OUTPUT` |
| `::save-state name=KEY::VALUE` | Removed (Jun 2023) | `echo "KEY=VALUE" >> $GITHUB_STATE` |
| `::set-env name=KEY::VALUE` | Removed | `echo "KEY=VALUE" >> $GITHUB_ENV` |
| `::add-path::VALUE` | Removed | `echo "VALUE" >> $GITHUB_PATH` |

## Action Errors

| Error | Cause | Fix |
|---|---|---|
| `Can't find 'action.yml'` | Typo in action name | Verify spelling: `actions/checkout` not `actions/chekout` |
| `Input required and not supplied` | Missing required `with:` input | Add required inputs per action docs |
| `Unexpected input` | Invalid input name | Remove undocumented inputs, check action docs |
| `Node.js 12/16 actions are deprecated` | Outdated action version | Update to current version (see `action_versions.md`) |
| `Node.js 20 actions are deprecated` | node20 EOL April 2026 | Update to latest major version (node24 required March 4, 2026) |
| Action produces unexpected results | Supply chain compromise (tag poisoning) | Pin to SHA, verify via `git ls-remote`, enable Dependabot |

## Job Configuration Errors

| Error | Cause | Fix |
|---|---|---|
| `label "ubuntu-lastest" is unknown` | Typo in runner label | Use valid labels (see `runners.md`) |
| `Job 'X' depends on job 'Y' which does not exist` | Typo in `needs:` | Match exact job ID |
| `Circular dependency detected` | Jobs depend on each other | Break circular chain |

## Schedule Errors

| Error | Cause | Fix |
|---|---|---|
| `Invalid CRON expression` | Bad CRON value | Format: `minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sunday)` |

```yaml
# Bad:  cron: '0 0 * * 8'   # Day 8 doesn't exist
# Good: cron: '0 0 * * 0'   # Sunday
```

## Path Filter Errors

| Error | Cause | Fix |
|---|---|---|
| `Invalid glob pattern: '**.js'` | Missing directory separator | Use `**/*.js` not `**.js` |

## Environment and Secrets

| Error | Cause | Fix |
|---|---|---|
| `Secret MY_SECRET not found` | Undefined or misspelled secret | Verify name in repository settings (case-sensitive) |
| Env var not accessible | Platform mismatch | Unix: `echo "$MY_VAR"`, Windows: `echo $env:MY_VAR` |

## Matrix Strategy Errors

| Error | Cause | Fix |
|---|---|---|
| `Matrix configuration is invalid` | Non-array matrix value | Values must be arrays: `os: [ubuntu-latest, windows-latest]` |

## Debugging

| Method | How |
|---|---|
| Debug logging | Set secrets: `ACTIONS_STEP_DEBUG=true`, `ACTIONS_RUNNER_DEBUG=true` |
| Interactive debug | `uses: mxschmitt/action-tmate@v3` with `if: failure()` |
| Dump context | `run: printf '%s\n' '${{ toJSON(github) }}'` |

## Best Practices

1. Pin action versions (`@v6` not `@main`; SHA pinning for security)
2. Quote strings with special characters: `name: "My: Workflow"`
3. Set `timeout-minutes` to prevent runaway jobs (default is 6 hours)
4. Use `concurrency` groups to cancel redundant runs
5. Pass secrets through `env:`, never directly in `run:`
6. Add top-level `permissions:` block for least privilege (default is read-write)
7. Avoid deprecated commands (`set-output`, `save-state`) -- use environment files
