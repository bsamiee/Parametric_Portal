# [H1][INFRASTRUCTURE_TOOLING]
>**Dictum:** *Local CLI tools accelerate cluster operations.*

<br>

Developer tooling for Kubernetes and CI/CD operations.

---
## [1][ARCHITECTURE]
>**Dictum:** *Tool ownership determines installation location.*

<br>

| [INDEX] | [SCOPE]                   | [MANAGER]              | [LOCATION]                               |
| :-----: | ------------------------- | ---------------------- | ---------------------------------------- |
|   [1]   | System CLIs (kubectl)     | Nix/Parametric_Forge   | `modules/home/programs/container-tools/` |
|   [2]   | Workflow CLIs (act)       | Nix/Parametric_Forge   | `modules/home/programs/shell-tools/`     |
|   [3]   | Runtime versions (node)   | mise/Parametric_Portal | `mise.toml`                              |
|   [4]   | Infrastructure tasks      | mise/Parametric_Portal | `mise.toml`                              |

---
## [2][MISE_TASKS]
>**Dictum:** *Unified task runner eliminates script sprawl.*

<br>

**File:** `mise.toml` (275 LOC)

### [2.1][CLUSTER_SETUP]

| [INDEX] | [TASK]        | [PURPOSE]                                      |
| :-----: | ------------- | ---------------------------------------------- |
|   [1]   | `setup-k3s`   | Install K3s + ArgoCD + Sealed Secrets + Traefik |
|   [2]   | `seal-secret` | Create SealedSecret from env vars              |
|   [3]   | `backup-db`   | Backup PostgreSQL with retention               |

```bash
# Full cluster setup (requires ACME_EMAIL and DOMAIN env vars)
export ACME_EMAIL=admin@example.com DOMAIN=example.com
mise run setup-k3s

# Create sealed secret
export POSTGRES_PASSWORD=secret ENCRYPTION_KEY=key
mise run seal-secret api-secrets parametric-portal

# Backup database
mise run backup-db
```

---
### [2.2][KUBERNETES_VALIDATION]

| [INDEX] | [TASK]         | [PURPOSE]                              |
| :-----: | -------------- | -------------------------------------- |
|   [1]   | `k8s:build`    | Build Kustomize manifests for prod     |
|   [2]   | `k8s:validate` | Validate with kubeconform + kubectl    |
|   [3]   | `k8s:diff`     | Show diff between current and desired  |

```bash
mise run k8s:build      # Output manifests to stdout
mise run k8s:validate   # Validate schemas + dry-run
mise run k8s:diff       # Compare with cluster state
```

---
### [2.3][LINTING]

| [INDEX] | [TASK]       | [PURPOSE]                                  |
| :-----: | ------------ | ------------------------------------------ |
|   [1]   | `yaml:lint`  | Lint YAML (infrastructure + workflows)     |
|   [2]   | `infra:lint` | Full lint: YAML + Dockerfiles + Actions + K8s |

```bash
mise run yaml:lint   # yamllint only
mise run infra:lint  # Full infrastructure validation
```

---
### [2.4][CONTAINER_RUNTIME]

| [INDEX] | [TASK]             | [PURPOSE]                    |
| :-----: | ------------------ | ---------------------------- |
|   [1]   | `container:start`  | Start Colima (VZ + Rosetta)  |
|   [2]   | `container:stop`   | Stop Colima                  |
|   [3]   | `container:status` | Show Colima status           |

```bash
mise run container:start   # Starts with 4 CPU, 8GB RAM, 60GB disk
mise run container:status  # Check if running
mise run container:stop    # Shutdown VM
```

---
### [2.5][WORKFLOW_TESTING]

| [INDEX] | [TASK]          | [PURPOSE]                              |
| :-----: | --------------- | -------------------------------------- |
|   [1]   | `workflow:lint` | Lint workflows with actionlint        |
|   [2]   | `workflow:list` | List all workflows and jobs           |
|   [3]   | `workflow:test` | Dry-run workflows locally             |
|   [4]   | `workflow:run`  | Execute workflows locally             |

```bash
# Lint all workflows
mise run workflow:lint

# List available jobs
mise run workflow:list

# Dry-run push event workflows
mise run workflow:test -- push

# Run specific job
mise run workflow:run -- -j dependency-audit push
```

[IMPORTANT] Requires Colima running. Start with `mise run container:start` first.

---
## [3][NIX_TOOLS]
>**Dictum:** *Nix ensures reproducible CLI installations.*

<br>

### [3.1][CONTAINER_RUNTIME]

| [INDEX] | [TOOL]         | [PURPOSE]                     |
| :-----: | -------------- | ----------------------------- |
|   [1]   | colima         | VM manager (Lima-based)       |
|   [2]   | docker-client  | CLI only (connects to Colima) |
|   [3]   | docker-compose | Compose v2 plugin             |

---
### [3.2][KUBERNETES_CORE]

| [INDEX] | [TOOL]    | [PURPOSE]                  |
| :-----: | --------- | -------------------------- |
|   [1]   | kubectl   | Kubernetes CLI             |
|   [2]   | kubecolor | Colorized kubectl output   |
|   [3]   | kubectx   | Context/namespace switcher |
|   [4]   | kustomize | Config management          |
|   [5]   | helm      | Package management         |

---
### [3.3][GITOPS]

| [INDEX] | [TOOL]   | [PURPOSE]          |
| :-----: | -------- | ------------------ |
|   [1]   | argocd   | ArgoCD CLI         |
|   [2]   | kubeseal | Sealed Secrets CLI |

---
### [3.4][WORKFLOW_TESTING]

| [INDEX] | [TOOL]     | [PURPOSE]                      |
| :-----: | ---------- | ------------------------------ |
|   [1]   | act        | Local GitHub Actions runner    |
|   [2]   | actionlint | GitHub Actions workflow linter |

---
### [3.5][DEBUGGING]

| [INDEX] | [TOOL]        | [PURPOSE]             |
| :-----: | ------------- | --------------------- |
|   [1]   | k9s           | TUI cluster manager   |
|   [2]   | stern         | Multi-pod log tailing |
|   [3]   | kube-capacity | Resource usage viewer |

---
### [3.6][OCI_TOOLS]

| [INDEX] | [TOOL]   | [PURPOSE]           |
| :-----: | -------- | ------------------- |
|   [1]   | skopeo   | Copy/inspect images |
|   [2]   | crane    | Fast registry ops   |
|   [3]   | dive     | Image layer analyzer|
|   [4]   | hadolint | Dockerfile linter   |

---
## [4][ALIASES]
>**Dictum:** *Short aliases accelerate common operations.*

<br>

**File:** `Parametric_Forge/modules/home/aliases/containers.nix`

| [INDEX] | [ALIAS]    | [COMMAND]          | [PURPOSE]         |
| :-----: | ---------- | ------------------ | ----------------- |
|   [1]   | `k`        | `kubecolor`        | Colorized kubectl |
|   [2]   | `kx`       | `kubectx`          | Switch context    |
|   [3]   | `kn`       | `kubens`           | Switch namespace  |
|   [4]   | `kgp`      | `kubectl get pods` | List pods         |
|   [5]   | `kl`       | `kubectl logs -f`  | Follow pod logs   |
|   [6]   | `k9`       | `k9s`              | Launch TUI        |
|   [7]   | `argo`     | `argocd`           | ArgoCD CLI        |
|   [8]   | `argosync` | `argocd app sync`  | Sync application  |

---
## [5][K9S_CONFIGURATION]
>**Dictum:** *Custom hotkeys accelerate CRD navigation.*

<br>

### [5.1][HOTKEYS]

| [INDEX] | [KEY]     | [RESOURCE]                         | [PURPOSE]           |
| :-----: | --------- | ---------------------------------- | ------------------- |
|   [1]   | `Shift-A` | `applications.argoproj.io`         | ArgoCD Applications |
|   [2]   | `Shift-D` | `clusters.postgresql.cnpg.io`      | CloudNativePG       |
|   [3]   | `Shift-I` | `ingressroutes.traefik.io`         | Traefik Routes      |
|   [4]   | `Shift-K` | `policyreports.wgpolicyk8s.io`     | Kyverno Reports     |
|   [5]   | `Shift-S` | `sealedsecrets.bitnami.com`        | SealedSecrets       |

---
### [5.2][ALIASES]

| [INDEX] | [ALIAS] | [RESOURCE]                          |
| :-----: | ------- | ----------------------------------- |
|   [1]   | `app`   | `argoproj.io/v1alpha1/applications` |
|   [2]   | `pg`    | `postgresql.cnpg.io/v1/clusters`    |
|   [3]   | `ir`    | `traefik.io/v1alpha1/ingressroutes` |
|   [4]   | `ss`    | `bitnami.com/v1alpha1/sealedsecrets`|
|   [5]   | `hpa`   | `autoscaling/v2/horizontalpodautoscalers` |

---
## [6][ENVIRONMENT]
>**Dictum:** *XDG compliance centralizes configuration.*

<br>

**File:** `Parametric_Forge/modules/home/environments/containers.nix`

| [INDEX] | [VARIABLE]     | [VALUE]                               |
| :-----: | -------------- | ------------------------------------- |
|   [1]   | `KUBECONFIG`   | `~/.config/kube/config`               |
|   [2]   | `DOCKER_HOST`  | `~/.local/share/colima/default/docker.sock` |
|   [3]   | `COLIMA_HOME`  | `~/.local/share/colima`               |
|   [4]   | `HELM_CONFIG_HOME` | `~/.config/helm`                  |
|   [5]   | `K9S_CONFIG_DIR`   | `~/.config/k9s`                   |

---
## [7][QUICK_REFERENCE]
>**Dictum:** *Common workflows require minimal keystrokes.*

<br>

### [7.1][DAILY_WORKFLOW]

```bash
# Start container runtime (required for act)
mise run container:start

# Validate infrastructure before commit
mise run infra:lint

# Test workflows locally
mise run workflow:test -- push
```

---
### [7.2][CLUSTER_OPERATIONS]

```bash
# Navigate cluster
k9                         # Launch TUI
kgp                        # List pods
kl <pod-name>              # Follow logs

# ArgoCD operations
argo app list
argosync <app-name>

# Seal secrets
mise run seal-secret api-secrets parametric-portal
```

---
### [7.3][MANIFEST_VALIDATION]

```bash
# Build and validate
mise run k8s:validate

# Compare with cluster
mise run k8s:diff
```

---
## [8][TROUBLESHOOTING]
>**Dictum:** *Systematic diagnosis accelerates resolution.*

<br>

| [INDEX] | [SYMPTOM]                | [CHECK]                        | [FIX]                               |
| :-----: | ------------------------ | ------------------------------ | ----------------------------------- |
|   [1]   | act fails to connect     | `mise run container:status`    | `mise run container:start`          |
|   [2]   | k9s won't connect        | `echo $KUBECONFIG`             | Verify path, copy from cluster      |
|   [3]   | Sealed Secrets expired   | `kubeseal --fetch-cert`        | `mise run seal-secret`              |
|   [4]   | Workflow lint fails      | `mise run workflow:lint`       | Fix actionlint errors               |
|   [5]   | Kyverno blocking pod     | `kubectl get policyreports -A` | Add PolicyException or fix spec     |
|   [6]   | Docker socket not found  | Check DOCKER_HOST env var      | Restart Colima, check containers.nix|

---
## [9][INSTALLATION]
>**Dictum:** *Nix manages all system CLIs.*

<br>

```bash
# Rebuild system (from Parametric_Forge)
darwin-rebuild switch --flake .#macbook

# Verify core tools
which kubectl act actionlint k9s argocd kubeseal
```

[IMPORTANT] Do not install via Homebrew. Nix ensures reproducibility.
