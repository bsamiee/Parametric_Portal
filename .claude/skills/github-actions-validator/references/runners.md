# [H1][RUNNERS]
>**Dictum:** *Runner validation detects deprecated labels, architecture mismatches, and missing timeouts.*

<br>

---
## [1][STANDARD_LABELS]
>**Dictum:** *Standard labels resolve to current OS versions — validate against canonical mapping.*

<br>

| [INDEX] | [OS]        | [LABELS]                                         | [DEFAULT]    |
| :-----: | ----------- | ------------------------------------------------ | ------------ |
|   [1]   | **Ubuntu**  | `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`  | ubuntu-24.04 |
|   [2]   | **Windows** | `windows-latest`, `windows-2025`, `windows-2022` | windows-2025 |
|   [3]   | **macOS**   | `macos-latest`, `macos-15`, `macos-14`           | macos-15     |

---
## [2][DEPRECATED_AND_RETIRED]
>**Dictum:** *Deprecated runner labels cause workflow failures — detect and flag proactively.*

<br>

| [INDEX] | [LABEL]            | [STATUS]                    | [DATE]         | [REPLACEMENT]   |
| :-----: | ------------------ | --------------------------- | -------------- | --------------- |
|   [1]   | **`ubuntu-18.04`** | Retired.                    | Removed.       | `ubuntu-24.04`. |
|   [2]   | **`ubuntu-20.04`** | Retired.                    | April 2025.    | `ubuntu-24.04`. |
|   [3]   | **`ubuntu-22.04`** | Supported (EOL April 2027). | Migrate early. | `ubuntu-24.04`. |
|   [4]   | **`macos-12`**     | Retired.                    | Removed.       | `macos-15`.     |
|   [5]   | **`macos-13`**     | Retired.                    | Nov 2025.      | `macos-15`.     |
|   [6]   | **`windows-2019`** | Retired.                    | June 2025.     | `windows-2025`. |
|   [7]   | **`windows-2022`** | Supported (phasing out).    | Migrate early. | `windows-2025`. |

### [2.1][MACOS_INTEL_DEPRECATION]

| [INDEX] | [LABEL]                                | [STATUS]              | [REPLACEMENT]      |
| :-----: | -------------------------------------- | --------------------- | ------------------ |
|   [1]   | **`macos-15-intel`, `macos-14-large`** | Long-term deprecated. | ARM64 equivalents. |
|   [2]   | **`macos-15-large`**                   | Long-term deprecated. | `macos-15-xlarge`. |

Apple Silicon (ARM64) required after Fall 2027. Flag Intel macOS labels with deprecation warning.

---
## [3][ARM64_RUNNERS]
>**Dictum:** *ARM64 label format validation prevents silent job failures.*

<br>

| [INDEX] | [LABEL]                | [AVAILABILITY]                                                |
| :-----: | ---------------------- | ------------------------------------------------------------- |
|   [1]   | **`ubuntu-24.04-arm`** | Free for public repos; private repos require Team/Enterprise. |
|   [2]   | **`ubuntu-22.04-arm`** | Free for public repos; private repos require Team/Enterprise. |

[IMPORTANT] ARM64 labels: canonical format is `-arm` suffix (NOT `-arm64`). `ubuntu-latest-arm64` and `ubuntu-24.04-arm64` are **invalid** — flag as incorrect label.

### [3.1][DETECTION_RULES]

| [INDEX] | [CHECK]                 | [TAG]      | [WHAT_TO_FLAG]                                                 |
| :-----: | ----------------------- | ---------- | -------------------------------------------------------------- |
|   [1]   | **`-arm64` suffix**     | `[RUNNER]` | Invalid label — use `-arm` suffix (`ubuntu-24.04-arm`).        |
|   [2]   | **`ubuntu-latest-arm`** | `[RUNNER]` | Not a valid label — use explicit version (`ubuntu-24.04-arm`). |
|   [3]   | **ARM in private repo** | `[RUNNER]` | Requires Team or Enterprise plan — free only for public repos. |

---
## [4][GPU_RUNNERS]
>**Dictum:** *GPU runner validation checks plan eligibility and cost awareness.*

<br>

| [INDEX] | [LABEL]             | [GPU]                                            | [PRICING] |
| :-----: | ------------------- | ------------------------------------------------ | --------- |
|   [1]   | **`gpu-t4-4-core`** | NVIDIA Tesla T4 (16 GB VRAM), 4 vCPU, 28 GB RAM. | $0.07/min |

Requires Team or Enterprise Cloud plan. Flag `gpu-*` labels in workflows targeting Free/Pro plans.

---
## [5][XLARGE_RUNNERS]
>**Dictum:** *Xlarge runner validation ensures plan compatibility.*

<br>

| [INDEX] | [LABEL]                                      | [SPECS]                           | [PRICING] |
| :-----: | -------------------------------------------- | --------------------------------- | --------- |
|   [1]   | **`macos-latest-xlarge`, `macos-15-xlarge`** | 5-core M2 Pro, 8-core GPU, 14 GB. | $0.16/min |
|   [2]   | **`macos-14-xlarge`**                        | 5-core M2 Pro, 8-core GPU, 14 GB. | $0.16/min |

---
## [6][LARGER_RUNNERS]
>**Dictum:** *Larger runner specs and limits inform capacity validation.*

<br>

| [INDEX] | [TYPE]        | [SPEC]         | [NOTES]                            |
| :-----: | ------------- | -------------- | ---------------------------------- |
|   [1]   | **Standard**  | 2 vCPU / 7 GB  | Default `ubuntu-latest`.           |
|   [2]   | **4-core**    | 4 vCPU / 16 GB | Team/Enterprise plans; SSD-backed. |
|   [3]   | **8-64-core** | 8-64 vCPU      | Up to 256 GB RAM; SSD-backed.      |

Larger runners (Team/Enterprise): up to 1,000 concurrent jobs; 100 GPU max.

---
## [7][MULTI_ARCHITECTURE]
>**Dictum:** *Cross-architecture matrix validation ensures correct label pairing.*

<br>

```yaml
strategy:
  matrix:
    include:
      - runner: ubuntu-latest
        arch: x64
      - runner: ubuntu-24.04-arm
        arch: arm64
runs-on: ${{ matrix.runner }}
```

[IMPORTANT] Validate ARM64 matrix uses `-arm` suffix (not `-arm64`). Flag `ubuntu-latest-arm64` in matrix definitions.

---
## [8][SELF_HOSTED]
>**Dictum:** *Self-hosted runner validation checks label declarations and security posture.*

<br>

### [8.1][ACTIONLINT_LABELS]

```yaml
# .github/actionlint.yaml
self-hosted-runner:
  labels: [my-custom-runner, gpu-runner, arm-runner]
```

Custom labels must be declared for actionlint validation — unlisted labels produce false-positive errors.

### [8.2][SECURITY_CHECKS]

| [INDEX] | [CHECK]                       | [TAG]           | [WHAT_TO_FLAG]                                                   |
| :-----: | ----------------------------- | --------------- | ---------------------------------------------------------------- |
|   [1]   | **Public repo + self-hosted** | `[SELF-HOSTED]` | Fork PRs can execute arbitrary code on self-hosted runners.      |
|   [2]   | **Non-ephemeral runners**     | `[SELF-HOSTED]` | Persistent runners accumulate state — use `--ephemeral` flag.    |
|   [3]   | **Missing harden-runner**     | `[SELF-HOSTED]` | Self-hosted runners need runtime monitoring (K8s support in v2). |
|   [4]   | **No runner group isolation** | `[SELF-HOSTED]` | Runner groups should restrict org/repo access boundaries.        |

---
## [9][SELECTION_CHECKLIST]
>**Dictum:** *Runner selection criteria balance architecture, cost, and deprecation risk.*

<br>

| [INDEX] | [CRITERION]      | [GUIDANCE]                                                                                  |
| :-----: | ---------------- | ------------------------------------------------------------------------------------------- |
|   [1]   | **Architecture** | ARM64 via `-arm` suffix — free for public repos only.                                       |
|   [2]   | **Cost**         | Standard included; ARM64 (public) free; GPU $0.07/min; xlarge $0.16/min.                    |
|   [3]   | **GPU needs**    | ML/AI workloads need `gpu-t4-4-core` — Team/Enterprise only.                                |
|   [4]   | **Deprecations** | Retired: `ubuntu-20.04`, `macos-12/13`, `windows-2019`. Plan Intel macOS exit by Fall 2027. |
|   [5]   | **Timeouts**     | Flag every job missing `timeout-minutes:` — prevents runaway billing.                       |
