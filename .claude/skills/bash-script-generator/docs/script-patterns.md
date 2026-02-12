# Bash Script Patterns

## Argument Parsing

### getopts (short options)

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

### Long options (manual loop)

```bash
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) usage; exit 0 ;; -v|--verbose) VERBOSE=true; shift ;;
            -f|--file) INPUT_FILE="${2:?--file requires argument}"; shift 2 ;;
            -o|--output) OUTPUT_FILE="${2:?--output requires argument}"; shift 2 ;;
            --) shift; break ;; -*) printf "Unknown: %s\n" "$1" >&2; exit 1 ;; *) break ;;
        esac
    done
    REMAINING_ARGS=("$@")
}
```

### Subcommand dispatch (associative array)

```bash
# Dispatch table: O(1) lookup replaces case/esac chains
declare -Ar CMD_DISPATCH=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)

main() {
    [[ $# -lt 1 ]] && { usage; exit 1; }
    local -r command="$1"; shift
    case "${command}" in -h|--help) usage; exit 0 ;; esac
    [[ -v CMD_DISPATCH["${command}"] ]] || { printf "Unknown: %s\n" "${command}" >&2; usage; exit 1; }
    "${CMD_DISPATCH[${command}]}" "$@"
}
```

## Configuration

### Key-value parser (safe, no source/eval)

```bash
load_config() {
    local key value
    while IFS='=' read -r key value; do
        [[ -z "${key}" || "${key}" =~ ^[[:space:]]*# ]] && continue
        key="${key%%+([[:space:]])}"                              # Trim trailing whitespace
        value="${value##+([[:space:]])}"                          # Trim leading whitespace
        [[ "${key}" =~ ^[A-Za-z_][A-Za-z_0-9]*$ ]] || continue  # Reject invalid identifiers
        declare -g "${key}=${value}"
    done < "$1"
}
```

## Logging

```bash
# printf -v avoids date subshell; -1 = current time
# Dispatch table: level -> threshold via associative array (O(1) lookup, no if/elif chain)
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
# LOG_LEVEL: 0=DEBUG 1=INFO 2=WARN 3=ERROR

# File + stderr dual output (pure function: takes msg, writes to both)
readonly LOG_FILE="${LOG_FILE:-/var/log/myscript.log}"
log() {
    local ts; printf -v ts '%(%F %T)T' -1
    local -r msg="[$1] ${ts} ${*:2}"
    printf '%s\n' "${msg}" >&2
    printf '%s\n' "${msg}" >> "${LOG_FILE}"
}

# Structured JSON (pure transform: args -> JSON line on stderr)
log_json() {
    local ts; printf -v ts '%(%FT%TZ)T' -1
    printf '{"ts":"%s","level":"%s","msg":"%s","script":"%s"}\n' "${ts}" "$1" "$2" "${SCRIPT_NAME}" >&2
}
```

## Parallel Processing

### Background jobs with wait -n -p (bash 5.1+)

```bash
declare -A job_map                    # pid -> file mapping
readonly MAX_JOBS="${MAX_JOBS:-4}"
readarray -d '' -t files < <(find . -name "*.txt" -print0)
for file in "${files[@]}"; do
    process_file "${file}" & job_map[$!]="${file}"
    if [[ ${#job_map[@]} -ge ${MAX_JOBS} ]]; then
        local finished_pid
        if wait -n -p finished_pid; then
            unset 'job_map[${finished_pid}]'
        else
            printf "Job %d (%s) failed\n" "${finished_pid}" "${job_map[${finished_pid}]}" >&2
            unset 'job_map[${finished_pid}]'
        fi
    fi
done
for pid in "${!job_map[@]}"; do wait "${pid}" || printf "Job %d (%s) failed\n" "${pid}" "${job_map[${pid}]}" >&2; done
```

### xargs parallel (portable)

```bash
process_file() { local -r file="$1"; sed 's/old/new/g' "${file}" > "${file}.out"; }
export -f process_file
find . -name "*.txt" -print0 | xargs -0 -P "${MAX_JOBS:-4}" -I{} bash -c 'process_file "${1}"' _ {}
```

## Lock Files

```bash
# Atomic via flock (preferred)
exec 200>/var/lock/myscript.lock
flock -n 200 || { printf "Already running\n" >&2; exit 1; }

# PID lock with stale detection
acquire_lock() {
    local -r lock_file="${1:-/var/lock/myscript.lock}"
    if [[ -f "${lock_file}" ]]; then
        local old_pid
        old_pid=$(<"${lock_file}")
        if kill -0 "${old_pid}" 2>/dev/null; then
            printf "Running (PID %s)\n" "${old_pid}" >&2; return 1
        fi
        rm -f "${lock_file}"
    fi
    printf '%s' $$ > "${lock_file}"
    trap 'rm -f "${lock_file}"' EXIT
}
```

## Graceful Shutdown

```bash
# Signal-driven loop exit (mutable flag is intentional -- signals are inherently stateful)
SHUTDOWN=false
trap 'printf "Shutting down...\n" >&2; SHUTDOWN=true' INT TERM
while [[ "${SHUTDOWN}" == "false" ]]; do process_next_item || break; done
```

## Retry with Exponential Backoff

```bash
retry() {
    local -r max="${1:-3}" max_delay="${3:-60}"; local delay="${2:-1}" attempt=1; shift 3 || shift $#
    while [[ ${attempt} -le ${max} ]]; do
        "$@" && return 0
        if [[ ${attempt} -lt ${max} ]]; then
            local jitter=$((RANDOM % (delay + 1)))
            printf "Attempt %d/%d failed, retry in %ds...\n" "${attempt}" "${max}" "$((delay + jitter))" >&2
            sleep $((delay + jitter))
            delay=$(( delay * 2 > max_delay ? max_delay : delay * 2 ))
        fi
        ((attempt++))
    done
    printf "All %d attempts failed\n" "${max}" >&2; return 1
}
# Usage: retry 5 1 30 curl -f https://api.example.com/data
```

## Temporary Files

```bash
readonly WORK_DIR="$(mktemp -d)"
cleanup() { local -r rc=$?; rm -rf "${WORK_DIR}"; exit "${rc}"; }
trap cleanup EXIT

process() {
    local -r tmp="$(mktemp "${WORK_DIR}/proc.XXXXXX")"
    sort "$1" > "${tmp}"
    comm -13 "${tmp}" "$2"
}
```

## Heredoc Patterns

```bash
# Indented heredoc with <<- (requires leading TABS, not spaces)
generate_config() {
	cat <<-EOF
	server {
	    listen ${1:?port required};
	    root ${2:?docroot required};
	}
	EOF
}

# Heredoc to variable
read -r -d '' SQL_QUERY <<'EOF' || true
SELECT id, name
FROM users
WHERE active = true
ORDER BY created_at DESC
EOF
```

## Coproc (bidirectional I/O)

```bash
coproc WORKER { while IFS= read -r line; do printf 'processed: %s\n' "${line}"; done; }
printf 'input data\n' >&"${WORKER[1]}"
read -r result <&"${WORKER[0]}"
printf '%s\n' "${result}"               # -> processed: input data
exec {WORKER[1]}>&-                      # Close write end to signal EOF
wait "${WORKER_PID}"
```
