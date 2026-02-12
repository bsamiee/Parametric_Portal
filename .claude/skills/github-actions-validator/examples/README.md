# Example Workflows

| File | Purpose | Command |
|---|---|---|
| `valid-ci.yml` | Valid CI pipeline (all checks pass) | `bash scripts/validate_workflow.sh examples/valid-ci.yml` |
| `with-errors.yml` | 10 intentional errors (actionlint + best practice violations) | `bash scripts/validate_workflow.sh examples/with-errors.yml` |
| `outdated-versions.yml` | Outdated action versions (checkout@v4, upload-artifact@v3, cache@v4) | `bash scripts/validate_workflow.sh --check-versions examples/outdated-versions.yml` |
