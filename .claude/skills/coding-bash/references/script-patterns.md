# [H1][SCRIPT-PATTERNS]
>**Dictum:** *Reusable patterns eliminate boilerplate.*

<br>

| [IDX] | [PATTERN]              |  [S]  | [USE_WHEN]                                      |
| :---: | :--------------------- | :---: | :---------------------------------------------- |
|  [1]  | Polymorphic arg parser |  S1   | Multi-axis dispatch, short/long flags           |
|  [2]  | Metadata-driven help   |  S2   | Auto-generated, grouped, colorized usage        |
|  [3]  | Configuration loader   |  S3   | Key-value config files with validation          |
|  [4]  | Structured logging     |  S4   | Caller context, JSON-ND/text polymorphic output |
|  [5]  | Trap chain + cleanup   |  S5   | ERR trap, signal internals, EXIT interaction    |
|  [6]  | Parallel processing    |  S6   | Bounded concurrency with PID tracking           |
|  [7]  | Locks and signals      |  S7   | Single-instance, graceful shutdown              |
|  [8]  | Retry with backoff     |  S8   | Network calls, flaky ops, SRANDOM jitter        |
|  [9]  | Atomic I/O             |  S9   | File output, state persistence, config writes   |
| [10]  | Coprocess              |  S10  | Persistent subprocess, sentinel-framed I/O      |
| [11]  | Testing                |  S11  | Inline assertions, self-test mode               |

---
## [1][ARGUMENT_PARSING]
>**Dictum:** *One parser handles all modalities.*

<br>

Three-phase pipeline: subcommand dispatch (O(1) via `declare -Ar`), flag parsing (`case/esac`),
positional collection (remainder after `--`). Flags consumed exhaustively before positionals.

```bash
declare -Ar _SUBCMDS=([start]=_cmd_start [stop]=_cmd_stop [status]=_cmd_status)
declare -a POSITIONAL_ARGS=()
declare -i LOG_LEVEL=2

_parse_args() {
    # Phase 1: subcommand dispatch (O(1) — skipped when _SUBCMDS is empty)
    (( $# > 0 )) && [[ -v _SUBCMDS["${1:-}"] ]] && {
        local -r cmd="$1"; shift
        _parse_flags "$@"
        readonly LOG_LEVEL POSITIONAL_ARGS
        _run_with_middleware "${_SUBCMDS[${cmd}]}" "${POSITIONAL_ARGS[@]}"; exit $?
    }
    _parse_flags "$@"
}
_parse_flags() {
    # Phase 2: flag parsing via pattern match — exhaustive consumption before positionals
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)      _usage; exit 0 ;;
            -V|--version)   printf '%s v%s (bash %s)\n' \
                                "${SCRIPT_NAME}" "${VERSION}" "${BASH_VERSION}"; exit 0 ;;
            -v|--verbose)   LOG_LEVEL=1; shift ;;
            -d|--debug)     LOG_LEVEL=0; shift ;;
            -n|--dry-run)   DRY_RUN=true; shift ;;
            -f|--file)      INPUT_FILE="${2:?--file requires argument}"; shift 2 ;;
            -o|--output)    OUTPUT_FILE="${2:?--output requires argument}"; shift 2 ;;
            --self-test)    _self_test; exit 0 ;;
            --)             shift; break ;;
            -*)             _die_usage "Unknown option: $1" ;;
            *)              break ;;
        esac
    done
    # Phase 3: remaining args are positional
    POSITIONAL_ARGS=("$@")
}
```

Remove `_SUBCMDS` (or leave empty) for flag-only scripts. Handlers receive only positional
args — flags frozen via `readonly` before invocation.

### [1.1][MULTI_AXIS_DISPATCH]

Two-dimensional `verb:resource` keyed dispatch with parallel metadata arrays. Subsumes
nested subcommands — the composite key encodes the full route:

```bash
declare -Ar _DISPATCH=(
    [get:user]=_handle_get_user       [get:project]=_handle_get_project
    [create:user]=_handle_create_user [create:project]=_handle_create_project
    [delete:user]=_handle_delete_user [delete:project]=_handle_delete_project
)
declare -Ar _USAGE=(
    [get:user]="get user <id>"        [get:project]="get project <slug>"
    [create:user]="create user <name> <email>"
    [create:project]="create project <name>"
    [delete:user]="delete user <id>"  [delete:project]="delete project <slug>"
)
declare -Ar _REQUIRED_ARGS=(
    [get:user]=1 [get:project]=1 [create:user]=2
    [create:project]=1 [delete:user]=1 [delete:project]=1
)
dispatch() {
    local -r key="${1:?verb required}:${2:?resource required}"; shift 2
    [[ -v _DISPATCH["${key}"] ]] || {
        printf 'Unknown route: %s\nValid:\n' "${key}" >&2
        printf '  %s\n' "${!_DISPATCH[@]}" | sort >&2; return 1
    }
    (( $# >= _REQUIRED_ARGS[${key}] )) || {
        printf 'Usage: %s\n' "${_USAGE[${key}]}" >&2; return 1
    }
    "${_DISPATCH[${key}]}" "$@"
}
# Self-documenting help — derived from metadata, never hand-maintained
_dispatch_help() {
    declare -A _verbs=() _resources=()
    local key; for key in "${!_DISPATCH[@]}"; do
        _verbs["${key%%:*}"]=1; _resources["${key##*:}"]=1
    done
    printf 'Verbs:     %s\nResources: %s\n\nRoutes:\n' "${!_verbs[*]}" "${!_resources[*]}"
    local k; for k in $(printf '%s\n' "${!_USAGE[@]}" | sort); do
        printf '  %-25s %s\n' "${k}" "${_USAGE[${k}]}"
    done
}
```

---
### [1.2][MIDDLEWARE]

Pre/post hooks wrapping handlers via chainable dispatch. Each middleware receives a nameref to
context — rejection short-circuits the chain without coupling to business logic:

```bash
declare -a _MIDDLEWARE=()
_use() { _MIDDLEWARE+=("$1"); }
_run_with_middleware() {
    local -r handler="$1"; shift
    local -A _mw_ctx=([handler]="${handler}" [args]="$*")
        local mw; for mw in "${_MIDDLEWARE[@]}"; do
        "${mw}" _mw_ctx || { _err "Middleware '${mw}' rejected"; return 1; }
    done
    "${handler}" "$@"
}
# Middleware functions take a nameref to _mw_ctx
_mw_log()      { local -n _ref=$1; _debug "Dispatching: ${_ref[handler]}"; }
_mw_validate() { local -n _ref=$1; [[ -n "${_ref[args]}" ]] || { _err "No args"; return 1; }; }
_mw_version()  {
    local -n _ref=$1
    (( _BASH_V >= _MIN_BASH_V )) || _die "Bash ${_MIN_BASH_V}+ required (${_ref[handler]})"
}
_use _mw_log
_use _mw_version
# Usage: _run_with_middleware _cmd_deploy prod
```

---
## [2][METADATA_DRIVEN_HELP]
>**Dictum:** *Options defined once generate help, validation, and parsing from a single source of truth.*

<br>

`_OPT_META` encodes all option data — adding an option = one table entry + one `case` branch.
Explicit key list controls iteration order (associative arrays have no insertion order).

```bash
# Terminal colors — NO_COLOR compliant (https://no-color.org), CI-aware
_BOLD="" _DIM="" _RESET=""
[[ -z "${NO_COLOR+set}" ]] && [[ -t 2 ]] \
    && (( $(tput colors 2>/dev/null || printf '0') >= 8 )) && {
    _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RESET=$'\033[0m'
}
readonly _BOLD _DIM _RESET
# Option metadata: short|long|description|VALUE_NAME|default
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"         [V]="-V|--version|Show version||"
    [v]="-v|--verbose|Verbose output||" [d]="-d|--debug|Debug mode||"
    [n]="-n|--dry-run|Dry run||"        [o]="-o|--output|Output file|FILE|"
)
readonly _OPT_DISPLAY_ORDER="h V v d n o"

_usage() {
    local -r pad=$(( $(tput cols 2>/dev/null || printf '80') > 100 ? 28 : 24 ))
    printf '%s%s v%s%s\n\n%sUSAGE:%s\n  %s [OPTIONS] [ARGUMENTS]\n\n%sOPTIONS:%s\n' \
        "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}" \
        "${_BOLD}" "${_RESET}" "${SCRIPT_NAME}" "${_BOLD}" "${_RESET}"
    # Paradigm exception: bash lacks higher-order array iteration primitives
    local key short long desc value_name default flag
    for key in ${_OPT_DISPLAY_ORDER}; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}, ${long}"; [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
}
```

---
## [3][CONFIGURATION]
>**Dictum:** *Safe key-value parsing eliminates eval injection.*

<br>

No `eval`/`source` — `declare -g` with regex-validated key names, comment skip, extglob trimming:

```bash
load_config() {
    local -a raw_lines; mapfile -t raw_lines < "$1"
    # Paradigm exception: bash lacks higher-order array iteration primitives
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
## [4][STRUCTURED_LOGGING]
>**Dictum:** *Structured logs with caller context accelerate debugging.*

<br>

Canonical reference: [bash-logging.md](./bash-logging.md). API signatures:

```bash
_debug() _info() _warn() _err()     # Level-gated, caller-context injection via FUNCNAME[2]
_die()                              # _err + exit ${EX_ERR}
# W3C trace context propagation (service-wrapper pattern)
_init_trace() {
    [[ "${TRACEPARENT:-}" =~ ^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$ ]] && {
        TRACE_ID="${BASH_REMATCH[2]}"; SPAN_ID="${BASH_REMATCH[3]}"; return
    }
    printf -v TRACE_ID '%08x%08x%08x%08x' "${SRANDOM}" "${SRANDOM}" "${SRANDOM}" "${SRANDOM}"
    printf -v SPAN_ID '%08x%08x' "${SRANDOM}" "${SRANDOM}"
    export TRACEPARENT="00-${TRACE_ID}-${SPAN_ID}-01"
}
```

---
## [5][TRAP_CHAIN_AND_CLEANUP]
>**Dictum:** *ERR traps, cleanup registries, and EXIT traps form a three-layer safety net.*

<br>

ERR fires on command failure (diagnostic only), EXIT fires unconditionally and invokes the
cleanup registry. Cleanup is LIFO — later-acquired resources depend on earlier ones.

### [5.1][ERR_TRAP]

Full stack trace via `FUNCNAME`/`BASH_LINENO`/`BASH_SOURCE`. Requires `set -E` (errtrace)
so the trap inherits into functions and subshells:

```bash
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"
    printf '\n[ERROR] exit %d: %s\n[STACK]\n' "${rc}" "${cmd}" >&2
    local i; for (( i = 1; i < depth; i++ )); do
        printf '  %d) %s:%d in %s()\n' "${i}" \
            "${BASH_SOURCE[i]:-unknown}" "${BASH_LINENO[i-1]:-?}" "${FUNCNAME[i]:-main}" >&2
    done
}
trap '_on_err' ERR
```

### [5.2][CLEANUP_REGISTRY]

LIFO stack — `eval` acceptable here because all registered commands are script-controlled
string literals, never user input:

```bash
declare -a _CLEANUP_STACK=()
declare -i _CLEANING=0
_register_cleanup() { _CLEANUP_STACK+=("$1"); }
_run_cleanups() {
    (( _CLEANING )) && return; _CLEANING=1
    local i; for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[i]}" 2>/dev/null || true
    done
}
trap '_run_cleanups' EXIT
# Registration examples:
WORK_DIR="$(mktemp -d)" || _die "mktemp failed"
_register_cleanup "rm -rf '${WORK_DIR}'"
exec {lock_fd}>/var/lock/myscript.lock
_register_cleanup "exec ${lock_fd}>&-"
```

### [5.3][SIGNAL_INTERNALS]

| [IDX] | [BEHAVIOR]          | [DETAIL]                                                               |
| :---: | :------------------ | :--------------------------------------------------------------------- |
|  [1]  | Deferred execution  | Trap runs after current foreground command completes, not during       |
|  [2]  | `wait` interruption | `wait` returns immediately (rc >128); trap fires after `wait` returns  |
|  [3]  | Signal coalescing   | POSIX signals not queued — N deliveries while masked yield one pending |
|  [4]  | `trap ''` (ignore)  | Signal discarded; inherited across `exec` and into subshells           |
|  [5]  | `trap -` (reset)    | Restores default disposition; trapped handlers reset in subshells      |
|  [6]  | EXIT + signal       | Signal handler runs first, then EXIT trap fires (two-phase teardown)   |
|  [7]  | SIGKILL             | Cannot be trapped — EXIT trap does NOT fire on `kill -9`               |

Coalescing matters for `SIGCHLD` — multiple children exiting may deliver one signal:

```bash
# Wrong: single wait loses child exits due to coalescing
# Right: drain all completed children per signal delivery
trap 'while wait -n 2>/dev/null; do :; done' CHLD
```

### [5.4][EXIT_CODES]

| [IDX] | [CODE]  | [MEANING]      | [USAGE]                        |
| :---: | :-----: | :------------- | :----------------------------- |
|  [1]  |   `0`   | Success        | Normal completion              |
|  [2]  |   `1`   | General error  | Unrecoverable runtime failure  |
|  [3]  |   `2`   | Usage error    | Invalid args, missing required |
|  [4]  |  `126`  | Not executable | Permission denied              |
|  [5]  |  `127`  | Not found      | Command not in PATH            |
|  [6]  | `128+N` | Signal N       | Killed by signal (130=Ctrl-C)  |

```bash
readonly EX_OK=0 EX_ERR=1 EX_USAGE=2
_die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }
```

---
## [6][PARALLEL_PROCESSING]
>**Dictum:** *Background jobs with wait -n -p maximize throughput.*

<br>

`wait -n -p VARNAME` (Bash 5.1+) captures the finished PID — required for mapping results
back to inputs. Without `-p`, a failed job is unidentifiable in the batch.

```bash
declare -A _job_pids=()
readonly MAX_JOBS="${MAX_JOBS:-4}"
readarray -d '' -t files < <(fd -e txt --print0)

# Paradigm exception: bash lacks higher-order array iteration primitives
for file in "${files[@]}"; do
    process_file "${file}" & _job_pids[$!]="${file}"
    # Slot limiting: block until a slot opens when at capacity
    (( ${#_job_pids[@]} >= MAX_JOBS )) && {
        local finished_pid; wait -n -p finished_pid; local rc=$?
        (( rc == 0 )) || _err "Job ${finished_pid} failed (${_job_pids[${finished_pid}]}): rc=${rc}"
        unset "_job_pids[${finished_pid}]"
    }
done
# Reap remaining — each PID tracked to its input for error reporting
for pid in "${!_job_pids[@]}"; do
    wait "${pid}" || _err "Job ${pid} failed (${_job_pids[${pid}]})"
done

# fd built-in parallel (replaces find | xargs)
fd -e txt -x process_file {}
```

---
## [7][LOCKS_AND_SIGNALS]
>**Dictum:** *Atomic locks and traps prevent resource leaks.*

<br>

Lock FDs register with `_CLEANUP_STACK` so they release even on ERR paths.

```bash
# Atomic lock via flock with dynamic FD allocation (no hardcoded FD numbers)
exec {lock_fd}>/var/lock/myscript.lock
flock -n "${lock_fd}" || { printf 'Already running\n' >&2; exit 1; }
_register_cleanup "exec ${lock_fd}>&-"
# Graceful shutdown (mutable flag intentional — signals are inherently stateful)
SHUTDOWN=false
trap 'printf "Shutting down...\n" >&2; SHUTDOWN=true' INT TERM
# Signal forwarding to child process (container entrypoint pattern)
_CHILD_PID=0
_forward_signal() { (( _CHILD_PID > 0 )) && kill -"$1" "${_CHILD_PID}" 2>/dev/null || true; }
trap '_forward_signal TERM; exit 143' TERM
trap '_forward_signal INT; exit 130' INT
"${SERVICE_CMD}" & _CHILD_PID=$!; wait "${_CHILD_PID}"
# Critical section — trap '' ignores (inherited across exec); trap - resets to default
trap '' INT TERM          # Ignore: signals discarded, not deferred
critical_multi_step_op    # Cannot be interrupted
trap - INT TERM           # Reset: default disposition restored
```

---
## [8][RETRY]
>**Dictum:** *Exponential backoff with jitter prevents thundering herds.*

<br>

`SRANDOM` provides kernel entropy — `RANDOM` is LCG, unsuitable for jitter (correlated storms
across near-simultaneously seeded processes). Parameters: `max` ($1, default 3), `delay` ($2,
default 1s), `max_delay` ($3, default 60s), command ($4+).

```bash
retry() {
    local -r max="${1:-3}" max_delay="${3:-60}"; local delay="${2:-1}"; shift 3 || shift $#
    # Paradigm exception: retry is inherently stateful (mutable delay, attempt counter)
    local attempt; for (( attempt = 1; attempt <= max; attempt++ )); do
        "$@" && return 0
        (( attempt < max )) && {
            local jitter=$(( SRANDOM % (delay + 1) ))
            printf 'Attempt %d/%d failed, retry in %ds...\n' \
                "${attempt}" "${max}" "$(( delay + jitter ))" >&2
            sleep $(( delay + jitter ))
            delay=$(( delay * 2 > max_delay ? max_delay : delay * 2 ))
        }
    done
    return 1
}
# Usage: retry 5 1 30 curl -f https://api.example.com/data
```

---
## [9][ATOMIC_IO]
>**Dictum:** *Atomic writes prevent partial output on failure.*

<br>

Write to temporary file, then atomic `mv` (same filesystem). `umask 077` before `mktemp` for sensitive data:

```bash
write_atomic() {
    local -r dest="$1"; shift
    local tmp
    tmp="$(mktemp "${dest}.tmp.XXXXXX")" || _die "mktemp failed"
    _register_cleanup "rm -f '${tmp}'"
    "$@" > "${tmp}" || { rm -f "${tmp}"; return 1; }
    mv "${tmp}" "${dest}"
}
# Usage: write_atomic /etc/app/config.json jq '.key = "val"' config.json
umask 077
WORK_DIR="$(mktemp -d)"; readonly WORK_DIR
_register_cleanup "rm -rf '${WORK_DIR}'"
```

---
## [10][COPROCESS]
>**Dictum:** *Persistent subprocess sessions amortize fork cost across many interactions.*

<br>

`coproc` (Bash 4.0+) creates a bidirectional pipe — `${COPROC[0]}` reads stdout,
`${COPROC[1]}` writes stdin. Sentinel-based framing solves the result boundary problem
(knowing when a multi-line response ends):

```bash
# Persistent database session — sentinel marks end of each result set
coproc DB {
    PGOPTIONS='--client-min-messages=warning' \
    psql -X -q -t -A -F'|' -d "${DATABASE_URL}" 2>/dev/null
}
db_query() {
    local -r sentinel="__END_${SRANDOM}__"
    printf "%s;\nSELECT '%s';\n" "$1" "${sentinel}" >&"${DB[1]}"
    local line; while IFS= read -r line <&"${DB[0]}"; do
        [[ "${line}" == "${sentinel}" ]] && break
        printf '%s\n' "${line}"
    done
}
db_close() {
    printf '\\q\n' >&"${DB[1]}"; exec {DB[1]}>&-
    wait "${DB_PID}" 2>/dev/null
}
```

| [IDX] | [CONSTRAINT]            | [COPROC]                                 | [NAMED_PIPES]             |
| :---: | :---------------------- | :--------------------------------------- | :------------------------ |
|  [1]  | Concurrent subprocesses | One unnamed coproc at a time             | Unlimited                 |
|  [2]  | Cleanup                 | Automatic FD cleanup on exit             | Manual `rm` of FIFO files |
|  [3]  | Buffering               | Pipe-buffered; use `stdbuf -oL` for line | Same buffering rules      |
|  [4]  | Portability             | Bash 4.0+ only                           | POSIX-portable            |
|  [5]  | Directionality          | Built-in bidirectional                   | Requires two FIFOs        |

Use named pipes when multiple concurrent workers or POSIX portability is required.

---
## [11][TESTING]
>**Dictum:** *Inline assertions and self-test mode catch regressions without external frameworks.*

<br>

```bash
assert_eq()        { [[ "$1" == "$2" ]] || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${2}' != '${1}'"; }
assert_not_empty() { [[ -n "$1" ]]     || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: empty value"; }
assert_file()      { [[ -f "$1" ]]     || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: not a file: ${1}"; }
_self_test() {
    _info "Running self-tests..."
    assert_eq "$(printf '%s' "hello" | tr 'a-z' 'A-Z')" "HELLO"
    assert_not_empty "${SCRIPT_NAME}"
    _info "All tests passed"
}
# In _parse_flags: --self-test) _self_test; exit 0 ;;
```
