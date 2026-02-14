# Phase 2: State Backend - Research

**Researched:** 2026-02-13
**Domain:** Pulumi S3 state backend + AWS KMS secrets encryption
**Confidence:** HIGH

## Summary

Phase 2 configures Pulumi to store state in an S3 bucket with AWS KMS encryption for secrets, replacing the current unconfigured (effectively local/default) backend. The primary challenge is the bootstrap chicken-and-egg problem: the S3 bucket and KMS key that Pulumi needs must themselves be provisioned. The standard solution is a dedicated bootstrap Pulumi project that runs against a local filesystem backend, creates the S3 bucket + KMS key, then the main infrastructure project is configured to use those resources as its backend and secrets provider.

The scope is narrow but foundational: one S3 bucket (versioned, encrypted, public-access-blocked), one KMS key (with alias, rotation enabled), backend URL configuration in `Pulumi.yaml`, and stack initialization with the `--secrets-provider` flag. No code changes to `deploy.ts` are required -- the existing `pulumi.secret()` calls already mark values correctly; the secrets provider change only affects how those marked values are encrypted at rest in the state file.

**Primary recommendation:** Create a bootstrap Pulumi project (`infrastructure/bootstrap/`) that provisions the state bucket and KMS key via `pulumi login --local`, then configure the main `infrastructure/Pulumi.yaml` with `backend.url` pointing to the S3 bucket. Initialize stacks with `--secrets-provider="awskms://alias/parametric-pulumi?region=<region>"`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@pulumi/pulumi` | 3.220.0 | CLI + SDK for state backend interaction | Already in catalog; `pulumi login`, `pulumi stack init` are CLI commands |
| `@pulumi/aws` | 7.19.0 | Bootstrap project creates S3 bucket + KMS key | Already in catalog; provisions the backend infrastructure |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@pulumi/random` | 4.18.5 | Unique suffix for bucket name (optional) | Only if bucket name collision is a concern |

No new dependencies are required. Everything needed is already in the `pnpm-workspace.yaml` catalog.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bootstrap Pulumi project | AWS CLI / CloudFormation | Loses IaC-as-code consistency; one-off manual step |
| AWS KMS secrets provider | Passphrase secrets provider | Passphrase requires `PULUMI_CONFIG_PASSPHRASE` env var management; KMS integrates with existing AWS IAM |
| S3 file-based locking | DynamoDB locking (via community `pulumi-locked`) | Pulumi's built-in S3 file locking is sufficient; DynamoDB adds complexity for no gain in single-team setup |
| Dedicated state bucket | Reuse existing `parametric-assets-${stack}` bucket | State bucket should be separate from application data; different lifecycle, retention, access patterns |

## Architecture Patterns

### Recommended Project Structure

```
infrastructure/
├── bootstrap/                  # NEW: one-time state backend provisioning
│   ├── Pulumi.yaml             # name: parametric-bootstrap, runtime: nodejs
│   ├── Pulumi.bootstrap.yaml   # Stack config (local backend, no secrets provider)
│   ├── package.json            # @pulumi/aws, @pulumi/pulumi only
│   ├── tsconfig.json
│   └── src/
│       └── index.ts            # Creates S3 bucket + KMS key + alias
├── Pulumi.yaml                 # MODIFIED: adds backend.url field
├── Pulumi.dev.yaml             # NEW: stack config with secretsprovider + encryptedkey
├── Pulumi.prod.yaml            # NEW: stack config with secretsprovider + encryptedkey
├── src/
│   ├── platform.ts             # UNCHANGED
│   ├── deploy.ts               # UNCHANGED
│   └── runtime-env.ts          # UNCHANGED
└── ...
```

### Pattern 1: Bootstrap with Local Backend

**What:** A separate Pulumi project that provisions the state bucket and KMS key using `pulumi login --local` (filesystem backend). Once created, the main project configures its `Pulumi.yaml` to use the S3 backend.

**When to use:** Always -- this is the standard pattern for self-managed backends.

**Workflow:**

```bash
# Step 1: Bootstrap (one-time)
cd infrastructure/bootstrap
pulumi login --local
pulumi stack init bootstrap
pulumi config set aws:region us-east-1
pulumi up

# Step 2: Get outputs
STATE_BUCKET=$(pulumi stack output stateBucketName)
KMS_ALIAS=$(pulumi stack output kmsKeyAlias)

# Step 3: Configure main project
cd ../
# Pulumi.yaml already has backend.url configured
pulumi login "s3://${STATE_BUCKET}?region=us-east-1&awssdk=v2"
pulumi stack init dev --secrets-provider="awskms://alias/${KMS_ALIAS}?region=us-east-1"
pulumi stack init prod --secrets-provider="awskms://alias/${KMS_ALIAS}?region=us-east-1"
```

### Pattern 2: Pulumi.yaml Backend URL Configuration

**What:** Declare the backend URL in `Pulumi.yaml` so all developers and CI automatically use the S3 backend without manual `pulumi login`.

**When to use:** Always after bootstrap completes.

**Example:**

```yaml
# infrastructure/Pulumi.yaml
name: parametric
runtime: nodejs
main: src/platform.ts
description: Parametric Portal infrastructure -- zero-YAML IAC
backend:
  url: s3://parametric-pulumi-state?region=us-east-1&awssdk=v2
```

Source: [Pulumi State and Backends docs](https://www.pulumi.com/docs/iac/concepts/state-and-backends/)

### Pattern 3: Stack Config with KMS Secrets Provider

**What:** Each `Pulumi.<stack>.yaml` file stores the secrets provider URL and encrypted data key. Created automatically by `pulumi stack init --secrets-provider`.

**When to use:** Automatically created per stack.

**Example (auto-generated):**

```yaml
# infrastructure/Pulumi.dev.yaml
secretsprovider: awskms://alias/parametric-pulumi?region=us-east-1
encryptedkey: AQECAHgFl1+CIJQc3Tn...base64...
config: {}
```

Source: [Pulumi Stack Settings File Reference](https://www.pulumi.com/docs/iac/concepts/projects/stack-settings-file/)

### Anti-Patterns to Avoid

- **Using passphrase secrets provider with S3 backend:** Requires distributing `PULUMI_CONFIG_PASSPHRASE` to all operators and CI. KMS uses IAM -- no shared secrets needed.
- **Storing state in the application S3 bucket:** State has different lifecycle, retention, and access control requirements. Dedicated bucket is standard.
- **Manual bucket/key creation via AWS Console:** Loses reproducibility. Bootstrap project ensures the backend infra is IaC-managed.
- **Skipping bucket versioning:** State corruption without versioning is unrecoverable. Versioning enables rollback via `pulumi stack export/import`.
- **Wide KMS key policy:** Granting `kms:*` on the key to broad principals undermines the security benefit of KMS encryption.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State locking | Custom DynamoDB lock table | Pulumi built-in S3 file locking | Built-in since v3.x; file-based locks in `.pulumi/locks/` directory |
| Secret encryption | Custom AES wrapper | `--secrets-provider="awskms://..."` flag | Pulumi handles envelope encryption with data keys; `pulumi.secret()` marks values |
| State migration | Manual JSON editing | `pulumi stack export --show-secrets` + `pulumi stack import` | Official migration path preserves all resource URNs |
| KMS key rotation | Manual re-encryption | `enableKeyRotation: true` on KMS key | AWS handles annual rotation transparently; old ciphertext still decryptable |

**Key insight:** Pulumi's state backend and secrets provider are independent, composable systems. The S3 backend handles where state lives; the KMS provider handles how secrets within state are encrypted. Both are configured declaratively and require zero custom code.

## Common Pitfalls

### Pitfall 1: Chicken-and-Egg Bootstrap

**What goes wrong:** Attempting to create the state bucket using Pulumi with S3 backend -- but the bucket does not exist yet, so `pulumi login` fails.
**Why it happens:** Circular dependency between "need backend to run Pulumi" and "need Pulumi to create backend."
**How to avoid:** Dedicated bootstrap project using `pulumi login --local`. The bootstrap state is committed to git or stored locally (it is small and non-sensitive -- only bucket/key metadata).
**Warning signs:** `pulumi login s3://...` fails with "bucket does not exist."

### Pitfall 2: Missing awssdk=v2 Query Parameter

**What goes wrong:** `pulumi login s3://bucket` fails with authentication errors or uses legacy SDK behavior.
**Why it happens:** Pulumi defaults to AWS SDK v1 for S3 backend. v2 is required for modern credential resolution (SSO, profiles, IMDS v2).
**How to avoid:** Always include `?awssdk=v2` in the S3 backend URL.
**Warning signs:** Credential errors when AWS CLI works fine; profile not respected.

Source: [Pulumi docs](https://www.pulumi.com/docs/iac/concepts/state-and-backends/) (CLI v3.33.1+)

### Pitfall 3: Forgetting --secrets-provider on Stack Init

**What goes wrong:** Stack is created with default passphrase provider. All secrets require `PULUMI_CONFIG_PASSPHRASE` or are encrypted with Pulumi Cloud key.
**Why it happens:** `pulumi stack init <name>` without `--secrets-provider` uses the default provider.
**How to avoid:** Always pass `--secrets-provider="awskms://alias/parametric-pulumi?region=<region>"` on `pulumi stack init`. Can also be fixed after the fact with `pulumi stack change-secrets-provider`.
**Warning signs:** Prompted for passphrase on `pulumi up`; `encryptionsalt` in stack yaml instead of `encryptedkey`.

### Pitfall 4: Project-Scoped Stacks Compatibility

**What goes wrong:** Stack files in S3 are not found by other team members or CI.
**Why it happens:** Pulumi v3.61.0+ creates project-scoped stacks by default in new backends. Stacks are stored at `.pulumi/stacks/<project>/<stack>.json` instead of `.pulumi/stacks/<stack>.json`.
**How to avoid:** This is the correct behavior for new backends. Ensure all team members use Pulumi CLI >= 3.61.0. The catalog has 3.220.0, which is well past this version.
**Warning signs:** `pulumi stack ls` shows empty list despite state files existing in S3.

### Pitfall 5: KMS Key Deletion Window Too Short

**What goes wrong:** KMS key is deleted (7-day minimum window), all encrypted state secrets become permanently unrecoverable.
**Why it happens:** Default deletion window is 30 days, but can be set as low as 7. Accidental `pulumi destroy` on bootstrap stack could schedule key deletion.
**How to avoid:** Set `deletionWindowInDays: 30` and `protect: true` on the KMS key resource. Also enable `enableKeyRotation: true` for compliance.
**Warning signs:** Key shows "Pending deletion" status in AWS Console.

### Pitfall 6: Bucket Namespace Collision

**What goes wrong:** S3 bucket creation fails because the name is globally taken.
**Why it happens:** S3 bucket names are globally unique across all AWS accounts.
**How to avoid:** Use a project-specific prefix with random suffix or account ID, e.g., `parametric-pulumi-state-${accountId}` or `parametric-pulumi-state-${randomSuffix}`.
**Warning signs:** `BucketAlreadyExists` error on `pulumi up`.

## Code Examples

### Bootstrap Project: S3 Bucket + KMS Key (TypeScript)

```typescript
// Source: Pulumi Registry (aws.kms.Key, aws.s3.Bucket)
// infrastructure/bootstrap/src/index.ts

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const account = aws.getCallerIdentityOutput();
const region = aws.getRegionOutput();

// KMS key for Pulumi secrets encryption
const key = new aws.kms.Key('pulumi-secrets-key', {
    description: 'Encrypts Pulumi stack secrets for Parametric Portal',
    enableKeyRotation: true,
    deletionWindowInDays: 30,
}, { protect: true });

const alias = new aws.kms.Alias('pulumi-secrets-alias', {
    name: 'alias/parametric-pulumi',
    targetKeyId: key.id,
});

// S3 bucket for Pulumi state storage
const bucket = new aws.s3.Bucket('pulumi-state-bucket', {
    bucket: pulumi.interpolate`parametric-pulumi-state-${account.accountId}`,
    forceDestroy: false,
}, { protect: true });

new aws.s3.BucketVersioning('pulumi-state-versioning', {
    bucket: bucket.id,
    versioningConfiguration: { status: 'Enabled' },
});

new aws.s3.BucketServerSideEncryptionConfiguration('pulumi-state-encryption', {
    bucket: bucket.id,
    rules: [{
        applyServerSideEncryptionByDefault: {
            kmsMasterKeyId: key.arn,
            sseAlgorithm: 'aws:kms',
        },
        bucketKeyEnabled: true,
    }],
});

new aws.s3.BucketPublicAccessBlock('pulumi-state-public-block', {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
});

export const stateBucketName = bucket.bucket;
export const stateBucketArn = bucket.arn;
export const kmsKeyId = key.id;
export const kmsKeyArn = key.arn;
export const kmsKeyAlias = alias.name;
export const loginCommand = pulumi.interpolate`pulumi login 's3://${bucket.bucket}?region=${region.id}&awssdk=v2'`;
export const secretsProvider = pulumi.interpolate`awskms://alias/parametric-pulumi?region=${region.id}`;
```

### Modified Pulumi.yaml (Main Project)

```yaml
# Source: Pulumi State and Backends docs
# infrastructure/Pulumi.yaml
name: parametric
runtime: nodejs
main: src/platform.ts
description: Parametric Portal infrastructure -- zero-YAML IAC
backend:
  url: s3://parametric-pulumi-state-ACCOUNT_ID?region=us-east-1&awssdk=v2
```

### Stack Init with KMS Provider

```bash
# Source: Pulumi Secrets Handling docs
cd infrastructure/
pulumi stack init dev --secrets-provider="awskms://alias/parametric-pulumi?region=us-east-1"
pulumi stack init prod --secrets-provider="awskms://alias/parametric-pulumi?region=us-east-1"
```

### Verification Commands

```bash
# Verify no plaintext secrets in state
pulumi stack export | grep -c "plaintext"
# Expected: 0

# Verify secrets provider in stack config
grep "secretsprovider" Pulumi.dev.yaml
# Expected: secretsprovider: awskms://alias/parametric-pulumi?region=us-east-1

# Verify encryptedkey (not encryptionsalt) is present
grep "encryptedkey" Pulumi.dev.yaml
# Expected: encryptedkey: AQECAH... (base64 KMS-encrypted data key)

# Verify state is in S3 (not local)
aws s3 ls s3://parametric-pulumi-state-ACCOUNT_ID/.pulumi/ --recursive
# Expected: lists stacks/, history/, meta.yaml
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat stack naming in DIY backends | Project-scoped stacks (`project/stack`) | Pulumi v3.61.0 (Apr 2023) | Multi-project S3 backends no longer collide |
| AWS SDK v1 for S3 backend | AWS SDK v2 (`?awssdk=v2`) | Pulumi v3.33.1 | Profile/SSO/IMDS v2 credential resolution works correctly |
| `PULUMI_CONFIG_PASSPHRASE` only | Cloud KMS providers (awskms, gcpkms, etc.) | Pulumi v1.x (2019) | IAM-based access control replaces shared passphrase |
| `encryptionsalt` (passphrase) | `encryptedkey` (KMS envelope encryption) | Pulumi v1.x | Envelope encryption: KMS encrypts a data key, data key encrypts secrets |
| DynamoDB required for locking (Terraform pattern) | Built-in file-based locking in S3 | Always (Pulumi design) | No extra infrastructure needed for state locking |

**Deprecated/outdated:**
- `PULUMI_DIY_BACKEND_LEGACY_LAYOUT`: Pre-v3.61.0 flat layout. Suppresses warning but should not be used for new backends.
- AWS SDK v1 (default without `?awssdk=v2`): Still works but missing modern credential chain features.

## Open Questions

1. **AWS Region for State Bucket**
   - What we know: The project uses `us-east-1` for cloud mode resources.
   - What's unclear: Whether the state bucket should be in the same region as application resources or a different region for disaster recovery.
   - Recommendation: Same region (`us-east-1`) for simplicity. Cross-region replication can be added later if needed.

2. **Bucket Naming Strategy**
   - What we know: Application bucket uses `parametric-assets-${stack}`. Bootstrap needs a globally unique name.
   - What's unclear: Whether to include AWS account ID, random suffix, or fixed name.
   - Recommendation: `parametric-pulumi-state-${accountId}` -- deterministic, unique, identifiable. Account ID is not sensitive.

3. **Bootstrap State Storage**
   - What we know: Bootstrap project uses `pulumi login --local`, producing a `.pulumi` directory.
   - What's unclear: Whether to commit bootstrap state to git or store it externally.
   - Recommendation: Commit to git (it is small, non-sensitive -- just bucket/key ARNs). Add to `.gitignore` the `.pulumi/backups/` subdirectory to avoid bloat. Alternatively, the bootstrap is truly one-time and the state can be discarded after the resources are created (resources have `protect: true`).

4. **CI/CD Environment Variables**
   - What we know: `PULUMI_BACKEND_URL` env var can override `Pulumi.yaml` backend URL. AWS credentials needed for both S3 access and KMS decryption.
   - What's unclear: Exact GitHub Actions secret names to use. Phase 8 will handle CI/CD in detail.
   - Recommendation: Document the required env vars now; implement in Phase 8.

5. **Existing State Migration**
   - What we know: No `.pulumi` directory exists, no stacks have been initialized. The project has never run `pulumi up`.
   - What's unclear: Nothing -- this is a greenfield setup.
   - Recommendation: No migration needed. Initialize fresh stacks directly against the S3 backend.

## Sources

### Primary (HIGH confidence)
- [Pulumi State and Backends docs](https://www.pulumi.com/docs/iac/concepts/state-and-backends/) - S3 backend URL format, login command, project-scoped stacks, file-based locking
- [Pulumi Secrets Handling docs](https://www.pulumi.com/docs/iac/concepts/secrets/) - awskms provider URL format (ID/alias/ARN), encryption behavior, `pulumi.secret()` tracking, `--secrets-provider` flag
- [Pulumi Stack Settings File Reference](https://www.pulumi.com/docs/iac/concepts/projects/stack-settings-file/) - `Pulumi.<stack>.yaml` format: secretsprovider, encryptedkey, encryptionsalt fields
- [Pulumi Environment Variables docs](https://www.pulumi.com/docs/iac/cli/environment-variables/) - `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `PULUMI_DIY_BACKEND_*` variables
- [Pulumi Registry: aws.kms.Key](https://www.pulumi.com/registry/packages/aws/api-docs/kms/key/) - KMS key TypeScript API, enableKeyRotation, deletionWindowInDays, key policy
- [Pulumi Project-Scoped Stacks blog](https://www.pulumi.com/blog/project-scoped-stacks-in-self-managed-backend/) - v3.61.0 introduction, upgrade path, `organization/project/stack` naming

### Secondary (MEDIUM confidence)
- [Bootstrap Pulumi Self-Managed Backend (justedagain.com)](https://justedagain.com/posts/2022/pulumi-backend-bootstrap/) - Bootstrap pattern: local backend -> create S3/KMS -> migrate. Verified against official docs.
- [Bootstrap Pulumi Self-Managed Backend (eriklz.online)](https://eriklz.online/posts/bootstrap-pulumi-self-managed-backend/) - CloudFormation + Pulumi dual bootstrap approach; `protect: true` pattern. Verified.
- [Nelson Figueroa: S3 Backend Guide](https://nelson.cloud/how-to-use-an-aws-s3-bucket-as-a-pulumi-state-backend/) - Practical walkthrough; `Pulumi.yaml` backend.url field. Verified.
- [Pulumi Cloud Secret Providers blog](https://www.pulumi.com/blog/peace-of-mind-with-cloud-secret-providers/) - State backend and secrets provider are independent systems; envelope encryption pattern.
- [GitHub: Mdrbhatti/pulumi-backend-bootstrap](https://github.com/Mdrbhatti/pulumi-backend-bootstrap) - Community bootstrap project (Python); validates the local->S3 migration pattern.

### Tertiary (LOW confidence)
- None. All findings verified against official Pulumi documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already in catalog; no new dependencies needed
- Architecture: HIGH - Bootstrap pattern is well-documented across official docs and multiple verified community sources
- Pitfalls: HIGH - All pitfalls sourced from official documentation or verified community reports; none are speculative

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable domain; Pulumi backend/secrets APIs change infrequently)
