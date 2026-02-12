# GitHub-Hosted Runners (February 2026)

## Standard Labels

| OS | Labels | Default |
|---|---|---|
| Ubuntu | `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` | ubuntu-24.04 |
| Windows | `windows-latest`, `windows-2025`, `windows-2022` | windows-2025 |
| macOS | `macos-latest`, `macos-15`, `macos-14` | macos-15 |

## Deprecated / Retired

| Label | Status | Replacement |
|---|---|---|
| `ubuntu-20.04` | Deprecated | `ubuntu-24.04` |
| `ubuntu-18.04` | Retired | `ubuntu-24.04` |
| `macos-13` | Retired (Nov 2025) | `macos-15` |
| `macos-12` | Retired | `macos-15` |
| `ubuntu-22.04` | Supported (EOL April 2027) | `ubuntu-24.04` -- migrate proactively |
| `windows-2019` | Deprecated | `windows-2025` |
| `windows-2022` | Supported (phasing out) | `windows-2025` -- migrate proactively |
| `macos-15-intel`, `macos-14-large`, `macos-15-large` | Long-term deprecated | ARM64 equivalents |

Apple Silicon (ARM64) required after Fall 2027. Migrate now.

## ARM64 Runners

| Label | Availability |
|---|---|
| `ubuntu-latest-arm64`, `ubuntu-24.04-arm64` | Free for public repos |
| `windows-latest-arm64` | Enterprise Cloud only |

Specs: 4 vCPU ARM64, native execution (no virtualization). Private repos require GitHub Enterprise Cloud.

## GPU Runners

| Label | GPU | Pricing |
|---|---|---|
| `gpu-t4-4-core` | NVIDIA Tesla T4 (16GB VRAM), 4 vCPU, 28GB RAM | $0.07/min |

Requires Team or Enterprise Cloud plan.

## M2 Pro (xlarge) Runners

| Label | Specs | Pricing |
|---|---|---|
| `macos-latest-xlarge`, `macos-15-xlarge` | 5-core M2 Pro, 8-core GPU, 14GB | $0.16/min |
| `macos-14-xlarge` | 5-core M2 Pro, 8-core GPU, 14GB | $0.16/min |

## Multi-Architecture Build

```yaml
strategy:
  matrix:
    include:
      - runner: ubuntu-latest
        arch: x64
      - runner: ubuntu-latest-arm64
        arch: arm64
runs-on: ${{ matrix.runner }}
```

## Self-Hosted Runner Config

```yaml
# .github/actionlint.yaml
self-hosted-runner:
  labels: [my-custom-runner, gpu-runner, arm-runner]
```

## Selection Checklist

| Criterion | Guidance |
|---|---|
| Architecture | ARM64 vs Intel -- ARM64 free only for public repos |
| Cost | Standard included; ARM64 (public) free; GPU $0.07/min; xlarge $0.16/min |
| GPU needs | ML/AI workloads need `gpu-t4-4-core` |
| Deprecations | Avoid `macos-13` (retired), `ubuntu-20.04` (deprecated), plan Intel migration by Fall 2027 |
