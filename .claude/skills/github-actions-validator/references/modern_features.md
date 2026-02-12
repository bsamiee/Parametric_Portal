# Modern GitHub Actions Features

## Reusable Workflows

**Validation points:** `workflow_call` trigger, input types (string/number/boolean), secrets declaration, outputs.

**Limits:** 10 nested levels, 50 workflows per run.

```yaml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
    secrets:
      deploy-token:
        required: true
    outputs:
      deployment-url:
        value: ${{ jobs.deploy.outputs.url }}
```

| Common Error | Fix |
|---|---|
| Incorrect input types | Use `string`, `number`, or `boolean` only |
| Missing required secrets | Declare all secrets consumed by the reusable workflow |
| Invalid output references | Must match `jobs.<id>.outputs.<name>` |

## SBOM and Build Provenance Attestations

**Required permissions:** `id-token: write`, `contents: read`, `attestations: write`

```yaml
- uses: actions/attest-sbom@4651f806c01d8637787e274ac3bdf724ef169f34 # v3.0.0
  with:
    subject-path: '${{ github.workspace }}/dist/*.tar.gz'
    sbom-path: '${{ github.workspace }}/sbom.spdx.json'
- uses: actions/attest-build-provenance@62fc1d596301d0ab9914e1fec14dc5c8d93f65cd # v3.2.0
  with:
    subject-path: '${{ github.workspace }}/dist/*.tar.gz'
```

## OIDC Authentication (Keyless Federation)

**Required permissions:** `id-token: write`, `contents: read`

OIDC eliminates long-lived credentials. GitHub mints a short-lived JWT for each workflow run; cloud providers validate the token claims to authorize access.

| Claim | Description |
|---|---|
| `repository` | Repository name (`owner/repo`) |
| `repository_owner` | Organization or user account |
| `ref` | Git ref (branch/tag) |
| `sha` | Commit SHA |
| `workflow` / `run_id` / `run_attempt` | Workflow identification |
| `check_run_id` | Specific check run ID for the job |
| `actor` | User who triggered the workflow |
| `environment` | Deployment environment (if applicable) |
| `job_workflow_ref` | Reusable workflow ref (SLSA Level 3 claim) |

### Multi-Cloud Federation

```yaml
# AWS -- OIDC with role assumption
- uses: aws-actions/configure-aws-credentials@8df5847569e6427dd6c4fb1cf565c83acfa8afa7 # v6.0.0
  with:
    role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
    aws-region: us-east-1
    # audience defaults to sts.amazonaws.com

# Azure -- Federated identity credential
- uses: azure/login@eec3c95657c1536435858eda1f3ff5437fee8474 # v2.3.0
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

# GCP -- Workload identity federation
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/repo
    service_account: deploy@project.iam.gserviceaccount.com
```

### Trust Policy Pattern (AWS Example)

```json
{
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:owner/repo:ref:refs/heads/main"
    }
  }
}
```

| Common Error | Fix |
|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` claim does not match workflow context |
| `No OpenIDConnect provider found` | Create OIDC identity provider in cloud account first |
| Missing `id-token: write` | Add to job-level `permissions:` block |

## Deployment Environments

```yaml
jobs:
  deploy-production:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://prod.example.com
```

### Protection Rules

| Rule | Description |
|---|---|
| Required reviewers | Up to 6 reviewers must approve before deployment proceeds |
| Wait timer | Delay (0-43200 minutes) before deployment starts |
| Deployment branches | Restrict which branches can deploy to this environment |
| Environment secrets | Secrets scoped to this environment only |
| Custom deployment protection | Third-party gates (Datadog, Honeycomb, ServiceNow) |

### Custom Deployment Protection Rules (Feb 2026)

Third-party integrations that gate deployments on external conditions (monitoring health, change management tickets, compliance checks). Configure in Settings > Environments > Deployment protection rules.

```yaml
# Workflow waits for external gate approval before proceeding
jobs:
  deploy:
    environment:
      name: production  # has custom protection rule configured
    steps:
      - run: printf '%s\n' "This only runs after all protection rules pass"
```

| Common Error | Fix |
|---|---|
| Undefined environment names | Create environment in repository settings first |
| Missing URL | Add `url:` for deployment tracking |
| Protection rule timeout | External gate must respond within 30 days (default) |
| Skipped protection rules | `github.event_name == 'schedule'` bypasses wait timers |

## Job Summaries

Write Markdown to `$GITHUB_STEP_SUMMARY`. Actionlint validates script syntax but not summary content.

## Container Jobs

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:24
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
```

| Common Error | Fix |
|---|---|
| Invalid image tags | Verify tag exists on Docker Hub / registry |
| Service networking | Use service name as hostname (e.g., `postgres://postgres:5432`) |
| Missing health checks | Add `options: --health-cmd ...` for service containers |

## Concurrency Control

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Prevents redundant runs while protecting main branch from cancellation.

## Supply Chain Security (SLSA)

| Level | Requirement | GitHub Implementation |
|---|---|---|
| Build L1 | Documented build process | Workflow file in repository |
| Build L2 | Signed provenance | `actions/attest-build-provenance` + OIDC |
| Build L3 | Hardened build platform | Reusable workflows (isolated `job_workflow_ref` claim) |

```yaml
# Cosign keyless signing (OIDC-based, no key management)
permissions: { id-token: write, packages: write, attestations: write }
steps:
  - uses: sigstore/cosign-installer@faadad0cce49287aee09b3a48701e75088a2c6ad # v4.0.0
  - run: cosign sign --yes "$IMAGE@$DIGEST"
  - uses: actions/attest-build-provenance@62fc1d596301d0ab9914e1fec14dc5c8d93f65cd # v3.2.0
    with: { subject-name: '${{ env.IMAGE }}', subject-digest: '${{ env.DIGEST }}', push-to-registry: true }
```

### tj-actions/changed-files Incident (March 2025)

Supply chain attack affected 23,000+ repositories. Compromised action tag pointed to malicious commit. Lessons:

- **SHA pinning** prevents tag poisoning (mutable tags can be redirected)
- **Dependabot** for automated SHA updates: `.github/dependabot.yml` with `package-ecosystem: "github-actions"`
- **Step Security Harden-Runner** detects anomalous network/process activity in CI

## YAML Anchors

Reduce duplication within a single workflow file. Define once, reference multiple times.

```yaml
# Define anchor
x-common-setup: &common-setup
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  - uses: actions/setup-node@6044e13b5dc448c55e2357c09f80417699197238 # v6.2.0
    with: { node-version: '24', cache: 'pnpm' }
  - run: corepack enable && pnpm install --frozen-lockfile

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - *common-setup  # Reference anchor
      - run: pnpm lint
  test:
    runs-on: ubuntu-latest
    steps:
      - *common-setup  # Reuse same steps
      - run: pnpm test
```

| Common Error | Fix |
|---|---|
| `unknown alias *name` | Anchor `&name` must be defined before `*name` reference |
| Anchors not merging keys | Use `<<: *anchor` for mapping merge, `- *anchor` for sequence items |
| Cross-file anchors | YAML anchors are file-scoped; use reusable workflows for cross-file reuse |

## Node.js Runtime Migration

| Runtime | Status (Feb 2026) |
|---|---|
| Node.js 12 | Removed -- actions fail |
| Node.js 16 | Removed -- actions fail |
| Node.js 20 | Deprecated -- forced migration to node24 on March 4, 2026 |
| Node.js 24 | Required by v5+/v6+ actions |

Actions using `runs.using: 'node20'` will be force-migrated. Update to latest major versions of all actions before March 4, 2026.

## Immutable Actions (OCI)

Actions published via `actions/publish-immutable-action` to GHCR as OCI artifacts. Tags are immutable once published -- prevents tag poisoning attacks.

```yaml
# Publishing (in action repo release workflow):
- uses: actions/publish-immutable-action@4e89a6a924d2f75641255b9e589f4a7bc672f498 # v0.0.4

# Consuming (in workflow):
- uses: ghcr.io/owner/action-name@1.0.0  # immutable, provenance-attested
```

| Common Error | Fix |
|---|---|
| `Unable to resolve action` | Verify GHCR package exists and is public, or add `packages: read` permission |
| Version not found | Immutable tags cannot be overwritten; publish a new version instead |

## GitHub App Token Authentication

Use `actions/create-github-app-token` instead of PATs for cross-repo operations. App tokens are scoped, short-lived (1h), and auditable.

```yaml
- uses: actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v2.0.6
  id: app-token
  with:
    app-id: ${{ vars.APP_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  with:
    token: ${{ steps.app-token.outputs.token }}
```

| Common Error | Fix |
|---|---|
| `Could not create installation access token` | Verify App is installed on the target org/repo |
| `Resource not accessible by integration` | Add required permissions to the GitHub App configuration |
| Token expired | App tokens last 1 hour; for long jobs, generate a fresh token before the step that needs it |

## Step Security Harden-Runner

Network and process monitoring for CI jobs. Detects anomalous egress (supply chain attacks, data exfiltration).

```yaml
steps:
  - uses: step-security/harden-runner@002fdce3c6a235733a90a27c80493a3241e56863 # v2.12.0
    with:
      egress-policy: audit          # or 'block' for strict mode
      allowed-endpoints: >          # only in block mode
        github.com:443
        registry.npmjs.org:443
```
