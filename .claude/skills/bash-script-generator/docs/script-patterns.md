# [H1][SCRIPT-PATTERNS]
>**Dictum:** *Reusable patterns eliminate boilerplate.*

<br>

Argument parsing, configuration, logging, parallel processing, retry, signals, temporary files.

---
## [1][ARGUMENT_PARSING]
>**Dictum:** *Structured parsing prevents argument ambiguity.*

<br>

### [1.1][GETOPTS]

```bash
main() {
    local verbose=false input_file="" output_file=""
    while getopts ":hvf:o:" opt; do
        case ${opt} in
            h) usage; exit 0 ;; v) verbose=true ;; f) input_file="${OPTARG}" ;; o) output_file="${OPTARG}" ;;
            :) printf "Option -%s requires argument\n" "${OPTARG}" >&2; exit 1 ;;
            \?) printf "Invalid: -%s\n" "${OPTARG}" >&2; exit 1 ;;
        esac
    done
    shift $((OPTIND - 1))
    [[ -n "${input_file}" ]] || { printf "Error: -f required\n" >&2; exit 1; }
}
```

---
### [1.2][LONG_OPTIONS]

```bash
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) usage; exit 0 ;; -v|--verbose) VERBOSE=true; shift ;;
            -f|--file) INPUT_FILE="${2:?--file requires argument}"; shift 2 ;;
            --) shift; break ;; -*) printf "Unknown: %s\n" "$1" >&2; exit 1 ;; *) break ;;
        esac
    done
    REMAINING_ARGS=("$@")
}
```

---
### [1.3][SUBCOMMAND_DISPATCH]

```bash
declare -Ar CMD_DISPATCH=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
main() {
    [[ $# -lt 1 ]] && { usage; exit 1; }
    local -r command="$1"; shift
    [[ -v CMD_DISPATCH["${command}"] ]] || { printf "Unknown: %s\n" "${command}" >&2; exit 1; }
    "${CMD_DISPATCH[${command}]}" "$@"
}
```

---
## [2][CONFIGURATION]
>**Dictum:** *Safe key-value parsing eliminates eval injection.*

<br>

```bash
# Key-value parser (safe, no source/eval)
load_config() {
    local -a raw_lines; mapfile -t raw_lines < "$1"
    local key value
    for line in "${raw_lines[@]}"; do
        IFS='=' read -r key value <<< "${line}"
        [[ -z "${key}" || "${key}" =~ ^[[:space:]]*# ]] && continue
        key="${key%%+([[:space:]])}"
        value="${value##+([[:space:]])}"
        [[ "${key}" =~ ^[A-Za-z_][A-Za-z_0-9]*$ ]] || continue
        declare -g "${key}=${value}"
    done
}
```

---
## [3][LOGGING]
>**Dictum:** *Dispatch-table logging eliminates conditional chains.*

<br>

```bash
# Level-gated logging via dispatch table (O(1) lookup, no if/elif chain)
declare -Ar _LOG_THRESHOLDS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_log() { local ts; printf -v ts '%(%F %T)T' -1; printf '[%-5s] %s %s\n' "$1" "${ts}" "${*:2}" >&2; }
_log_at() {
    local -r level="$1"; shift
    [[ ${LOG_LEVEL:-1} -le ${_LOG_THRESHOLDS[${level}]:-3} ]] && _log "${level}" "$@"
}
log_debug() { _log_at DEBUG "$@"; }
log_info()  { _log_at INFO "$@"; }
log_warn()  { _log_at WARN "$@"; }
log_error() { _log ERROR "$@"; }

# Structured JSON (pure transform: args -> JSON line on stderr)
log_json() {
    local ts; printf -v ts '%(%FT%TZ)T' -1
    printf '{"ts":"%s","level":"%s","msg":"%s","script":"%s"}\n' "${ts}" "$1" "$2" "${SCRIPT_NAME}" >&2
}
```

---
## [4][PARALLEL_PROCESSING]
>**Dictum:** *Background jobs with wait-n maximize throughput.*

<br>

```bash
# Background jobs with wait -n -p (bash 5.1+)
declare -A job_map; readonly MAX_JOBS="${MAX_JOBS:-4}"
readarray -d '' -t files < <(fd -e txt --print0)
for file in "${files[@]}"; do
    process_file "${file}" & job_map[$!]="${file}"
    (( ${#job_map[@]} >= MAX_JOBS )) && {
        local finished_pid; wait -n -p finished_pid || true; unset 'job_map[${finished_pid}]'
    }
done
for pid in "${!job_map[@]}"; do wait "${pid}" || true; done

# fd built-in parallel execution (replaces find | xargs)
fd -e txt -x process_file {}
```

---
## [5][LOCKS_AND_SIGNALS]
>**Dictum:** *Atomic locks and traps prevent resource leaks.*

<br>

```bash
# Atomic lock via flock
exec 200>/var/lock/myscript.lock
flock -n 200 || { printf "Already running\n" >&2; exit 1; }

# Graceful shutdown (mutable flag intentional -- signals are inherently stateful)
SHUTDOWN=false
trap 'printf "Shutting down...\n" >&2; SHUTDOWN=true' INT TERM
while [[ "${SHUTDOWN}" == "false" ]]; do process_next_item || break; done

# Temporary files with cleanup
WORK_DIR="$(mktemp -d)"; readonly WORK_DIR
cleanup() { local -r rc=$?; rm -rf "${WORK_DIR}"; exit "${rc}"; }
trap cleanup EXIT
```

---
## [6][RETRY]
>**Dictum:** *Exponential backoff with jitter prevents thundering herds.*

<br>

```bash
retry() {
    local -r max="${1:-3}" max_delay="${3:-60}"; local delay="${2:-1}"; shift 3 || shift $#
    for attempt in $(seq 1 "${max}"); do
        "$@" && return 0
        (( attempt < max )) && {
            local jitter=$((RANDOM % (delay + 1)))
            printf "Attempt %d/%d failed, retry in %ds...\n" "${attempt}" "${max}" "$((delay + jitter))" >&2
            sleep $((delay + jitter)); delay=$(( delay * 2 > max_delay ? max_delay : delay * 2 ))
        }
    done
    return 1
}
# Usage: retry 5 1 30 curl -f https://api.example.com/data
```

---
## [7][HEREDOC_AND_COPROC]
>**Dictum:** *Heredocs embed multi-line data; coprocs enable bidirectional I/O.*

<br>

```bash
# Heredoc to variable
read -r -d '' SQL_QUERY <<'EOF' || true
SELECT id, name FROM users WHERE active = true ORDER BY created_at DESC
EOF

# Coproc (bidirectional I/O)
coproc WORKER { while IFS= read -r line; do printf 'processed: %s\n' "${line}"; done; }
printf 'input data\n' >&"${WORKER[1]}"
read -r result <&"${WORKER[0]}"
exec {WORKER[1]}>&-; wait "${WORKER_PID}"
```

---
## [8][STRUCTURED_DATA_PROCESSING]
>**Dictum:** *Match tool to data format.*

<br>

| [INDEX] | [TOOL]   | [DOMAIN]           | [PATTERN]                                         |
| :-----: | -------- | ------------------ | ------------------------------------------------- |
|   [1]   | `jq`     | JSON               | `jq -r '.items[] \| select(.active)' data.json`   |
|   [2]   | `yq-go`  | YAML/JSON/TOML     | `yq eval -o=json config.yaml \| jq '.db'`         |
|   [3]   | `miller` | CSV/TSV/JSON       | `mlr --icsv --ojson filter '$amt > 100' data.csv` |
|   [4]   | `jnv`    | JSON (interactive) | `curl -s api/data \| jnv`                         |

<br>

### [8.1][COMBINED_PIPELINES]

```bash
# --- rg + jq: extract from structured log ---
rg --json 'ERROR' app.log | jq -r '.data.lines.text'

# --- fd + jq: process all JSON files ---
fd -e json -x jq -r '.name' {}

# --- yq + rg: search YAML values ---
yq eval -o=json config.yaml | rg -i 'database'

# --- miller + awk: CSV transform with post-processing ---
mlr --icsv --ojson head -n 100 data.csv | jq -r '.[].email'
```
