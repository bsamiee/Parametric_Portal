# Action Version Reference (February 2026)

## Recommended Versions

| Action | Current | Minimum | Notes |
|---|---|---|---|
| `actions/checkout` | **v6** | v4 | v6 stores credentials in $RUNNER_TEMP |
| `actions/setup-node` | **v6** | v4 | v6 adds Node 24 support, requires runner >= 2.327.1 |
| `actions/setup-python` | **v6** | v5 | v6 adds Python 3.13 support, Node 24 runtime |
| `actions/setup-java` | **v5** | v4 | v5 adds JDK 23 support, Node 24 runtime |
| `actions/setup-go` | **v6** | v5 | v6 adds Go toolchain directive support, Node 24 runtime |
| `actions/cache` | **v5** | v4 | v5 requires Node 24 runtime, runner >= 2.327.1 |
| `actions/upload-artifact` | **v6** | v4 | v6 runs on Node 24, v3 deprecated |
| `actions/download-artifact` | **v7** | v4 | v7 runs on Node 24, v3 deprecated |
| `actions/github-script` | **v8** | v7 | v8 runs on Node 24 |
| `docker/setup-buildx-action` | **v3** | v3 | Current latest (v3.12.0) |
| `docker/login-action` | **v3** | v3 | Current latest (v3.7.0) |
| `docker/build-push-action` | **v6** | v5 | v6 adds provenance attestation |
| `docker/metadata-action` | **v5** | v5 | Current latest (v5.10.0) |
| `aws-actions/configure-aws-credentials` | **v6** | v4 | v6 requires Node 24 runtime, OIDC improved |
| `sigstore/cosign-installer` | **v4** | v3 | v4.0.0 adds keyless signing improvements, Rekor transparency |
| `actions/attest-build-provenance` | **v3** | v2 | v3 runs on Node 24 |
| `actions/attest-sbom` | **v3** | v2 | v3 runs on Node 24 |
| `actions/create-github-app-token` | **v2** | v1 | v2 adds multi-repo scope, owner parameter |
| `actions/publish-immutable-action` | **v0.0.4** | v0.0.1 | Publishes action as immutable OCI artifact to GHCR |
| `step-security/harden-runner` | **v2** | v2 | v2.12.0 latest; egress monitoring, process auditing |

## Validation Process

1. Extract `uses:` statements -- action name + version (tag or SHA)
2. Compare against table: **DEPRECATED** (below minimum), **OUTDATED** (older major), **UP-TO-DATE**
3. Flag findings with upgrade path

```bash
bash scripts/validate_workflow.sh --check-versions .github/workflows/ci.yml
```

## Node.js Runtime Deprecation

| Runtime | Status |
|---|---|
| Node.js 12 (EOL Apr 2022) | Deprecated -- actions using this will fail |
| Node.js 16 (EOL Sep 2023) | Deprecated -- actions using this will fail |
| Node.js 20 (EOL Apr 2026) | Deprecated -- forced migration to node24 March 4, 2026 |
| Node.js 24 | Required by v5+/v6+ actions (cache, upload-artifact, setup-node, etc.) |

## SHA Pinning

```yaml
# Recommended: SHA + version comment
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2

# Acceptable: Major version tag
- uses: actions/checkout@v6

# Not recommended: Branch reference
- uses: actions/checkout@main
```

## Cache Storage (Feb 2026)

- Default 10 GB per repository (free)
- `actions/cache` v5 requires runner >= 2.327.1 (Node 24 runtime)
- Pay-as-you-go for additional storage (requires Pro/Team/Enterprise)
- Cache size eviction limit (GB), cache retention limit (days)
