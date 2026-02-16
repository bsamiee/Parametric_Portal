# [H1][SCRIPT-PATTERNS]
>**Dictum:** *Reusable patterns eliminate boilerplate.*

<br>

Polymorphic argument parsing, metadata-driven help, middleware composition, nested subcommands,
configuration, parallel processing, retry, locks, signals, ERR traps, exit codes, testing.

| [INDEX] | [PATTERN]              | [SECTION] | [USE_WHEN]                                                |
| :-----: | :--------------------- | :-------: | :-------------------------------------------------------- |
|   [1]   | Polymorphic arg parser |    §1     | Every script — subcommands, short/long flags, positionals |
|   [2]   | Metadata-driven help   |    §2     | Every script — auto-generated, grouped, colorized usage   |
|   [3]   | Configuration loader   |    §3     | Scripts consuming key-value config files                  |
|   [4]   | Structured logging     |    §4     | Every script — caller context, conditional color          |
|   [5]   | ERR trap + exit codes  |    §5     | Every script — debuggable failures, semantic exit codes   |
|   [6]   | Parallel processing    |    §6     | Batch file operations, concurrent jobs with throttling    |
|   [7]   | Locks and signals      |    §7     | Single-instance enforcement, graceful shutdown            |
|   [8]   | Retry with backoff     |    §8     | Network calls, flaky operations, API requests             |
|   [9]   | Atomic I/O             |    §9     | File output, state persistence, config writes             |
|  [10]   | Testing                |    §10    | Inline assertions, self-test mode, BATS integration       |

---
## [1][ARGUMENT_PARSING]
>**Dictum:** *One parser handles all modalities.*

<br>

Single polymorphic parser: subcommand dispatch, short flags, long flags, value flags,
and positional args through one unified structure. `case/esac` is pattern matching
(the bash equivalent of ML-family match expressions), not conditional branching.

| [INDEX] | [PHASE]               | [MECHANISM]                | [BEHAVIOR]                                 |
| :-----: | :-------------------- | :------------------------- | :----------------------------------------- |
|   [1]   | Subcommand dispatch   | `declare -Ar` + `[[ -v ]]` | O(1) lookup, early exit into handler       |
|   [2]   | Flag parsing          | `case/esac` pattern match  | Short/long flags, value flags via `${2:?}` |
|   [3]   | Positional collection | `("$@")` remainder         | Everything after flags or `--`             |

```bash
declare -Ar _SUBCMDS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
_parse_args() {
    # Phase 1: subcommand dispatch (O(1) — skipped when _SUBCMDS is empty)
    (( ${#_SUBCMDS[@]} > 0 )) && [[ -v _SUBCMDS["${1:-}"] ]] && {
        "${_SUBCMDS[$1]}" "${@:2}"; exit $?
    }
    # Phase 2: flag parsing via pattern match
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)      _usage; exit 0 ;;
            -v|--verbose)   VERBOSE=true; shift ;;
            -d|--debug)     LOG_LEVEL=0; VERBOSE=true; shift ;;
            -n|--dry-run)   DRY_RUN=true; shift ;;
            -f|--file)      INPUT_FILE="${2:?--file requires argument}"; shift 2 ;;
            -o|--output)    OUTPUT_FILE="${2:?--output requires argument}"; shift 2 ;;
            --self-test)    _self_test; exit 0 ;;
            --)             shift; break ;;
            -*)             die "Unknown option: $1" ;;
            *)              break ;;
        esac
    done
    # Phase 3: remaining args are positional
    POSITIONAL_ARGS=("$@")
}
```

**Customization:** Remove `_SUBCMDS` (or leave empty) for flag-only scripts.
Add value-flag entries following the `-f|--file` pattern. The three phases compose
without modification — subcommand detection, flag consumption, positional collection.

### [1.1][NESTED_SUBCOMMANDS]

For multi-level CLIs (`tool remote add origin`), each subcommand defines its own dispatch
table and delegates recursively:

```bash
declare -Ar _SUBCMDS=([remote]=_parse_remote [config]=_parse_config)
declare -Ar _REMOTE_SUBCMDS=([add]=cmd_remote_add [remove]=cmd_remote_remove [list]=cmd_remote_list)
_parse_remote() {
    (( ${#_REMOTE_SUBCMDS[@]} > 0 )) && [[ -v _REMOTE_SUBCMDS["${1:-}"] ]] && {
        "${_REMOTE_SUBCMDS[$1]}" "${@:2}"; return $?
    }
    die "Unknown remote subcommand: ${1:-}. Valid: ${!_REMOTE_SUBCMDS[*]}"
}
```

---
### [1.2][MIDDLEWARE]

Chainable pre/post hooks wrapping handlers for cross-cutting concerns (validation,
logging, auth) without coupling to business logic:

```bash
declare -a _MIDDLEWARE=()
_use() { _MIDDLEWARE+=("$1"); }
_run_with_middleware() {
    local -r handler="$1"; shift
    local -A ctx=([handler]="${handler}" [args]="$*")
    local mw
    for mw in "${_MIDDLEWARE[@]}"; do
        "${mw}" ctx || { _err "Middleware ${mw} rejected"; return 1; }
    done
    "${handler}" "$@"
}
# Middleware is a function taking a nameref to ctx
_log_mw()      { local -n c=$1; _debug "Dispatching ${c[handler]}"; }
_validate_mw() { local -n c=$1; [[ -n "${c[args]}" ]] || { _err "No args"; return 1; }; }
_use _log_mw
_use _validate_mw
# Usage: _run_with_middleware cmd_deploy prod
```

---
## [2][METADATA_DRIVEN_HELP]
>**Dictum:** *Options defined once generate help, validation, and parsing from a single source of truth.*

<br>

Encode option metadata in a structured dispatch table. Help text is auto-generated —
never diverges from implementation. Supports grouped sections, conditional ANSI color,
and dynamic terminal width detection.

| [INDEX] | [FEATURE]         | [MECHANISM]                                             |
| :-----: | :---------------- | :------------------------------------------------------ |
|   [1]   | Single source     | `declare -Ar _OPT_META` encodes all option data         |
|   [2]   | Grouped sections  | Separate blocks: Global, Output, Debug                  |
|   [3]   | Conditional color | Precomputed `_BOLD`/`_DIM`/`_RESET` via `$'...'`        |
|   [4]   | Dynamic width     | `tput cols` with fallback to 80                         |
|   [5]   | Progressive help  | Top-level shows subcommands; `cmd --help` shows details |

```bash
# Terminal colors — computed once at startup (ANSI via $'...' = zero forks)
_BOLD="" _DIM="" _RESET=""
[[ -t 2 ]] && (( $(tput colors 2>/dev/null || printf '0') >= 8 )) && {
    _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RESET=$'\033[0m'
}
readonly _BOLD _DIM _RESET
# Option metadata: short|long|description|VALUE_NAME|default
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"
    [V]="-V|--version|Show version||"
    [v]="-v|--verbose|Verbose output||"
    [d]="-d|--debug|Debug mode (implies verbose)||"
    [n]="-n|--dry-run|Dry run||"
    [o]="-o|--output|Output file|FILE|"
)
_usage() {
    local -r cols="$(tput cols 2>/dev/null || printf '80')"
    local -r pad=$(( cols > 100 ? 28 : 24 ))
    printf '%s%s v%s%s\n' "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}"
    printf '\n%sUSAGE:%s\n' "${_BOLD}" "${_RESET}"
    printf '  %s [OPTIONS] [ARGUMENTS]\n' "${SCRIPT_NAME}"
    printf '\n%sOPTIONS:%s\n' "${_BOLD}" "${_RESET}"
    local key short long desc value_name default flag
    for key in h V v d n o; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}, ${long}"
        [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
    printf '\n%sEXAMPLES:%s\n' "${_BOLD}" "${_RESET}"
    printf '  %s -v file.txt\n' "${SCRIPT_NAME}"
    printf '  %s --dry-run input.txt\n' "${SCRIPT_NAME}"
}
```

**Progressive Disclosure:** For nested subcommands, top-level `_usage` lists subcommands
with one-line descriptions. `tool subcmd --help` shows that subcommand's flags and examples.

---
## [3][CONFIGURATION]
>**Dictum:** *Safe key-value parsing eliminates eval injection.*

<br>

Production config loader with comment handling, whitespace trimming, and key validation.
Uses `declare -g` — the controlled immutability exception for loading external state
into the program's constant namespace
(see [bash-scripting-guide.md §6](bash-scripting-guide.md) for the concept).

| [INDEX] | [SAFETY_FEATURE] | [MECHANISM]                           |
| :-----: | :--------------- | :------------------------------------ |
|   [1]   | No eval/source   | `declare -g` with validated key name  |
|   [2]   | Comment skipping | `[[ "${key}" =~ ^[[:space:]]*# ]]`    |
|   [3]   | Whitespace trim  | Extended globbing `%%+([[:space:]])`  |
|   [4]   | Key validation   | `^[A-Za-z_][A-Za-z_0-9]*$` regex gate |

```bash
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
## [4][STRUCTURED_LOGGING]
>**Dictum:** *Structured logs with caller context accelerate debugging.*

<br>

Every log line includes timestamp, level, calling function, and line number. Conditional
color makes logs scannable in terminals while remaining machine-parseable in pipelines.

```bash
declare -Ar _LOG_LEVELS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-3} >= LOG_LEVEL )) || return 0
    local ts; printf -v ts '%(%F %T)T' -1
    printf '%-7s %s [%s:%d] %s\n' \
        "[${level}]" "${ts}" "${FUNCNAME[2]:-main}" "${BASH_LINENO[1]:-0}" "$*" >&2
}
_debug() { _log DEBUG "$@"; }
_info()  { _log INFO "$@"; }
_warn()  { _log WARN "$@"; }
_err()   { _log ERROR "$@"; }
die()    { _err "$@"; exit "${EX_ERR}"; }
```

`FUNCNAME[2]` reaches through `_log` → `_info` → **caller**. `BASH_LINENO[1]`
corresponds to the same caller frame.

---
## [5][ERR_TRAP_AND_EXIT_CODES]
>**Dictum:** *ERR traps with context and semantic exit codes make failures debuggable.*

<br>

### [5.1][ERR_TRAP]

Captures the failing command, source location, and function name automatically.
Requires `set -E` (errtrace) so the trap inherits into functions and subshells.

```bash
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}"
    _err "Command failed (rc=${rc}): ${cmd}"
    _err "  at ${BASH_SOURCE[1]:-unknown}:${BASH_LINENO[0]:-?} in ${FUNCNAME[1]:-main}"
}
trap _on_err ERR
```

---
### [5.2][EXIT_CODES]

| [INDEX] | [CODE]  | [MEANING]      | [USAGE]                                  |
| :-----: | :-----: | :------------- | :--------------------------------------- |
|   [1]   |   `0`   | Success        | Normal completion                        |
|   [2]   |   `1`   | General error  | Unrecoverable runtime failure            |
|   [3]   |   `2`   | Usage error    | Invalid arguments, missing required args |
|   [4]   |  `126`  | Not executable | Permission denied on target command      |
|   [5]   |  `127`  | Not found      | Command/binary not in PATH               |
|   [6]   | `128+N` | Signal N       | Killed by signal (e.g., 130 = Ctrl-C)    |

```bash
readonly EX_OK=0 EX_ERR=1 EX_USAGE=2
die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }
```

---
## [6][PARALLEL_PROCESSING]
>**Dictum:** *Background jobs with wait-n maximize throughput.*

<br>

| [INDEX] | [FEATURE]    | [REQUIREMENT] | [PURPOSE]                             |
| :-----: | :----------- | :------------ | :------------------------------------ |
|   [1]   | `wait -n -p` | Bash 5.1+     | Reap first-completed job, capture PID |
|   [2]   | `wait -f`    | Bash 5.2+     | Wait for PID even without job control |
|   [3]   | `fd -x`      | fd installed  | Built-in parallel execution per match |

```bash
declare -A job_map; readonly MAX_JOBS="${MAX_JOBS:-4}"
readarray -d '' -t files < <(fd -e txt --print0)
for file in "${files[@]}"; do
    process_file "${file}" & job_map[$!]="${file}"
    (( ${#job_map[@]} >= MAX_JOBS )) && {
        local finished_pid; wait -n -p finished_pid || true
        unset 'job_map[${finished_pid}]'
    }
done
for pid in "${!job_map[@]}"; do wait "${pid}" || true; done
# fd built-in parallel execution (replaces find | xargs)
fd -e txt -x process_file {}
```

---
## [7][LOCKS_AND_SIGNALS]
>**Dictum:** *Atomic locks and traps prevent resource leaks.*

<br>

Cleanup and temporary files: use [standard.template.sh](../templates/standard.template.sh)
canonical pattern (`trap _cleanup EXIT` + `WORK_DIR`).

| [INDEX] | [PATTERN]         | [MECHANISM]                           | [USE_WHEN]                             |
| :-----: | :---------------- | :------------------------------------ | :------------------------------------- |
|   [1]   | Atomic lock       | `flock -n` on dynamic file descriptor | Single-instance enforcement            |
|   [2]   | Graceful shutdown | Mutable flag + `INT TERM` trap        | Long-running daemons, queue processors |
|   [3]   | Critical section  | Mask signals during non-interruptible | Atomic multi-step operations           |

```bash
# Atomic lock via flock with dynamic FD allocation (safe — no hardcoded FD numbers)
exec {lock_fd}>/var/lock/myscript.lock
flock -n "${lock_fd}" || { printf "Already running\n" >&2; exit 1; }
# Release in cleanup: exec {lock_fd}>&-
# Graceful shutdown (mutable flag intentional — signals are inherently stateful)
SHUTDOWN=false
trap 'printf "Shutting down...\n" >&2; SHUTDOWN=true' INT TERM
while [[ "${SHUTDOWN}" == "false" ]]; do process_next_item || break; done
# Critical section — block signals during non-interruptible operations
trap '' INT TERM          # Mask signals
critical_multi_step_op    # Cannot be interrupted
trap - INT TERM           # Restore default signal handling
```

---
## [8][RETRY]
>**Dictum:** *Exponential backoff with jitter prevents thundering herds.*

<br>

| [INDEX] | [PARAMETER] | [POSITION] | [DEFAULT] | [PURPOSE]                  |
| :-----: | :---------- | :--------- | :-------- | :------------------------- |
|   [1]   | max         | `$1`       | 3         | Maximum attempts           |
|   [2]   | delay       | `$2`       | 1         | Initial delay (seconds)    |
|   [3]   | max_delay   | `$3`       | 60        | Delay ceiling              |
|   [4]   | command     | `$4+`      | —         | Command with args to retry |

```bash
retry() {
    local -r max="${1:-3}" max_delay="${3:-60}"; local delay="${2:-1}"; shift 3 || shift $#
    for attempt in $(seq 1 "${max}"); do
        "$@" && return 0
        (( attempt < max )) && {
            local jitter=$((RANDOM % (delay + 1)))
            printf "Attempt %d/%d failed, retry in %ds...\n" \
                "${attempt}" "${max}" "$((delay + jitter))" >&2
            sleep $((delay + jitter))
            delay=$(( delay * 2 > max_delay ? max_delay : delay * 2 ))
        }
    done
    return 1
}
# Usage: retry 5 1 30 curl -f https://api.example.com/data
# Composable: use inside parallel processing job_map loop for resilient batch ops
```

---
## [9][ATOMIC_IO]
>**Dictum:** *Atomic writes prevent partial output on failure.*

<br>

File writes must survive interruption. Write to temporary file, then atomic `mv`
(rename is atomic on the same filesystem). Set `umask` before `mktemp` for sensitive data.

```bash
# Atomic file write pattern
write_atomic() {
    local -r dest="$1"; shift
    local tmp
    tmp="$(mktemp "${dest}.tmp.XXXXXX")" || die "mktemp failed"
    "$@" > "${tmp}" || { rm -f "${tmp}"; return 1; }
    mv "${tmp}" "${dest}"
}
# Usage: write_atomic /etc/app/config.json jq '.key = "val"' config.json
# Sensitive data: restrict permissions before mktemp
umask 077
WORK_DIR="$(mktemp -d)"; readonly WORK_DIR
```

---
## [10][TESTING]
>**Dictum:** *Inline assertions and self-test mode catch regressions without external frameworks.*

<br>

### [10.1][ASSERTIONS]

Guard-style assertions that report source location on failure:

```bash
assert_eq() {
    [[ "$1" == "$2" ]] || die "ASSERT at ${FUNCNAME[1]}:${BASH_LINENO[0]}: expected '${2}' got '${1}'"
}
assert_not_empty() {
    [[ -n "$1" ]] || die "ASSERT at ${FUNCNAME[1]}:${BASH_LINENO[0]}: empty value"
}
assert_file() {
    [[ -f "$1" ]] || die "ASSERT at ${FUNCNAME[1]}:${BASH_LINENO[0]}: not a file: ${1}"
}
```

---
### [10.2][SELF_TEST]

Convention: `--self-test` flag runs embedded tests and exits. Add to `_parse_args`:

```bash
_self_test() {
    _info "Running self-tests..."
    assert_eq "$(printf '%s' "hello" | tr 'a-z' 'A-Z')" "HELLO"
    assert_not_empty "${SCRIPT_NAME}"
    # Add domain-specific assertions here
    _info "All tests passed"
}
# In _parse_args case block:
# --self-test) _self_test; exit 0 ;;
```

---
### [10.3][BATS]

For external test suites, use [BATS-core](https://bats-core.readthedocs.io):
- Test files: `tests/*.bats`
- Structure: `@test "description" { run cmd; assert_success; assert_output "expected"; }`
- Load helpers: `load test_helper/bats-support/load` + `load test_helper/bats-assert/load`
- Run: `bats tests/`
