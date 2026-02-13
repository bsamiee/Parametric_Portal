# [H1][INDEX]
>**Dictum:** *Centralized index enables rapid reference discovery.*

<br>

| [INDEX] | [DOMAIN]              | [PATH]                                                                 | [DICTUM]                                                          |
| :-----: | --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
|   [1]   | **Best Practices**    | [→best-practices.md](references/best-practices.md)                     | Security hardening, supply chain integrity, performance.          |
|   [2]   | **Advanced Triggers** | [→advanced-triggers.md](references/advanced-triggers.md)               | Orchestration, dispatch, matrix, merge queue, security models.    |
|   [3]   | **Custom Actions**    | [→custom-actions.md](references/custom-actions.md)                     | Composite, Docker, JavaScript action authoring and versioning.    |
|   [4]   | **Expressions**       | [→expressions-and-contexts.md](references/expressions-and-contexts.md) | Contexts, functions, injection prevention, output protocol.       |
|   [5]   | **Version Discovery** | [→version-discovery.md](references/version-discovery.md)               | SHA resolution, action index, permissions, automated maintenance. |

<br>

| [INDEX] | [DOMAIN]     | [PATH]                                                                    | [DICTUM]                                                                |
| :-----: | ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
|   [6]   | **Template** | [→basic_workflow.yml](assets/templates/workflow/basic_workflow.yml)       | CI pipeline: lint, test, build, deploy with parameterized runtime.      |
|   [7]   | **Template** | [→reusable_workflow.yml](assets/templates/workflow/reusable_workflow.yml) | Reusable workflow with typed inputs, version extraction, secrets.       |
|   [8]   | **Template** | [→composite/action.yml](assets/templates/action/composite/action.yml)     | Multi-step composite action with parameterized runtime, error handling. |
|   [9]   | **Template** | [→docker/action.yml](assets/templates/action/docker/action.yml)           | Container action with distroless multi-stage Dockerfile pattern.        |
|  [10]   | **Template** | [→javascript/action.yml](assets/templates/action/javascript/action.yml)   | Node 24 action with pre/post lifecycle, typed error handling.           |

<br>

| [INDEX] | [DOMAIN]    | [PATH]                                                                         | [DICTUM]                                                      |
| :-----: | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
|  [11]   | **Example** | [→nodejs-ci.yml](examples/workflows/nodejs-ci.yml)                             | Matrix testing, caching, coverage, job summaries.             |
|  [12]   | **Example** | [→docker-build-push.yml](examples/workflows/docker-build-push.yml)             | Multi-platform builds, BuildKit cache, SLSA provenance.       |
|  [13]   | **Example** | [→monorepo-ci.yml](examples/workflows/monorepo-ci.yml)                         | Nx affected detection, pnpm workspace, sparse checkout.       |
|  [14]   | **Example** | [→dependency-review.yml](examples/security/dependency-review.yml)              | Vulnerability scanning, license compliance, PR gating.        |
|  [15]   | **Example** | [→sbom-attestation.yml](examples/security/sbom-attestation.yml)                | SBOM generation, Trivy scan, SARIF upload, attestation.       |
|  [16]   | **Example** | [→setup-node-cached/action.yml](examples/actions/setup-node-cached/action.yml) | Composite action with smart caching, corepack detection.      |
|  [17]   | **Example** | [→chatops-dispatch.yml](examples/workflows/chatops-dispatch.yml)               | Slash commands, injection prevention, App token.              |
|  [18]   | **Example** | [→oidc-cloud-auth/action.yml](examples/actions/oidc-cloud-auth/action.yml)     | Composite action: AWS/GCP/Azure OIDC, output normalization.   |
|  [19]   | **Example** | [→release-deploy.yml](examples/workflows/release-deploy.yml)                   | Environment promotion, reusable workflow, concurrency groups. |
|  [20]   | **Example** | [→docker-lint-scan/action.yml](examples/actions/docker-lint-scan/action.yml)   | Composite action: Trivy scan, hadolint, SARIF output.         |
|  [21]   | **Example** | [→pr-change-router/action.yml](examples/actions/pr-change-router/action.yml)   | Composite action: paths-filter, dynamic matrix, label sync.   |
