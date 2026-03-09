# [H1][SHELL-INTROSPECTION]
>**Dictum:** *Runtime reflection — call stacks, trap hierarchies, process lifecycle, and capability detection — enables production-grade diagnostics and resource safety.*

<br>

Call stack introspection, nameref composition patterns, hierarchical trap composition, process lifecycle with PID maps, and dispatch-table capability detection including Bash 5.3 variables. Basic variable types, arithmetic, and brace expansion are in [bash-scripting-guide.md S4/S6](./bash-scripting-guide.md).

| [IDX] | [PATTERN]          |  [S]  | [USE_WHEN]                               |
| :---: | :----------------- | :---: | :--------------------------------------- |
|  [1]  | Call stack diag    |  S1   | ERR traps, reporting, auto-span          |
|  [2]  | Nameref patterns   |  S2   | Return channels, multi-return, pitfalls  |
|  [3]  | Trap hierarchy     |  S3   | ERR→EXIT ordering, resource scopes       |
|  [4]  | Process lifecycle  |  S4   | PID maps, signal fwd, wait -n, exec      |
|  [5]  | Runtime capability |  S5   | Fallback chains, env contracts, 5.3 vars |

---
## [1][CALL_STACK_DIAGNOSTICS]
>**Dictum:** *FUNCNAME, BASH_LINENO, and BASH_SOURCE are parallel arrays — index i gives the caller at depth i in the call stack.*

<br>

`BASH_LINENO[i-1]` pairs with `FUNCNAME[i]` — line number records the call site, FUNCNAME records the called function. `set -E` (errtrace) is mandatory: without it, ERR fires only at top-level scope.

```bash
# ERR trap: structured stack trace with failing command
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"
    printf '\n[ERROR] exit %d: %s\n' "${rc}" "${cmd}" >&2
    printf '[STACK]\n' >&2
    local i; for (( i = 1; i < depth; i++ )); do
        printf '  %d) %s:%d in %s()\n' "${i}" \
            "${BASH_SOURCE[i]}" "${BASH_LINENO[i-1]}" "${FUNCNAME[i]}" >&2
    done
}
trap '_on_err' ERR
# Auto-span logging: FUNCNAME[1] = caller name, zero annotation cost
_log() {
    local -r level="$1"; shift
    printf '%(%FT%T)T [%-5s] [%s:%d] %s\n' \
        -1 "${level}" "${FUNCNAME[1]}" "${BASH_LINENO[0]}" "$*" >&2
}
# Assertion: caller context via FUNCNAME[1]/BASH_SOURCE[1]
_assert() {
    local -r condition="$1" msg="${2:-Assertion failed}"
    (( condition )) || {
        printf '[ASSERT] %s at %s:%d in %s()\n' \
            "${msg}" "${BASH_SOURCE[1]}" "${BASH_LINENO[0]}" "${FUNCNAME[1]}" >&2
        return 1
    }
}
# Full call chain: serialize FUNCNAME array for structured JSON logging
_caller_chain() {
    local -n _out="$1"
    local -r depth="${#FUNCNAME[@]}"
    _out=""
    local i; for (( i = 1; i < depth; i++ )); do
        [[ -n "${_out}" ]] && _out+=" <- "
        _out+="${FUNCNAME[i]}:${BASH_LINENO[i-1]}"
    done
}
```

`FUNCNAME[0]` = current function, `FUNCNAME[1]` = caller — `_log` uses this for automatic span labels. `_caller_chain` serializes the full stack via nameref (`deploy:42 <- _main:15 <- main:0`). `BASH_COMMAND` in ERR traps contains the exact failing command text.

---
## [2][NAMEREF_PATTERNS]
>**Dictum:** *`local -n` eliminates subshell forks for multi-value return — the caller allocates, the callee populates.*

<br>

Namerefs (`local -n`) bind a local name to a caller-scope variable, replacing `$(subshell)` capture with direct writes. Scales to multiple return channels where subshell can only return one string.

```bash
# Return channel: caller allocates, callee populates via nameref — zero forks
parse_uri() {
    local -n __scheme="$1" __host="$2" __path="$3"
    local -r uri="$4"
    __scheme="${uri%%://*}"
    local -r remainder="${uri#*://}"
    __host="${remainder%%/*}"
    __path="/${remainder#*/}"
}
local scheme host path  # populated in-place, no $() fork
parse_uri scheme host path "https://api.example.com/v2/users"
# Multi-return: callee writes quotient AND remainder via two namerefs
divide() {
    local -n __q="$1" __r="$2"
    __q=$(( $3 / $4 ))
    __r=$(( $3 % $4 ))
}
local quot rem
divide quot rem 17 5  # quot=3, rem=2
```

**Pitfalls** — nameref resolution uses dynamic scope, producing three failure modes:

| [PITFALL]       | [TRIGGER]                          | [SYMPTOM]                              | [MITIGATION]                  |
| :-------------- | :--------------------------------- | :------------------------------------- | :---------------------------- |
| Circular ref    | `local -n ref="ref"`               | `circular name reference` error        | Never nameref to own name     |
| Scope collision | `local` shadows nameref target     | Binds callee's local, not caller's var | `__` prefix for nameref names |
| Nested alias    | Nested callee re-namerefs same ref | Silent overwrites across call depth    | Unique prefixes per depth     |

The `__` prefix convention prevents callee nameref names from colliding with caller variables — the Bash equivalent of name mangling.

---
## [3][TRAP_HIERARCHY]
>**Dictum:** *ERR fires first (diagnostic capture), then EXIT (cleanup orchestrator), then the process terminates — this ordering is a guarantee, not convention.*

<br>

Execution order: ERR (stack intact for diagnostics) then EXIT (cleanup). Signal traps (INT/TERM) trigger EXIT via `exit`. `_CLEANUP_STACK` LIFO separates registration from release — reverse iteration ensures dependent resources release before their dependencies.

```bash
# --- Trap hierarchy: ERR (S1 _on_err) → _CLEANUP_STACK (LIFO release) → EXIT (orchestrator)
# ERR trap defined in S1 — _on_err captures stack diagnostics

# _CLEANUP_STACK: LIFO release — last acquired releases first
declare -a _CLEANUP_STACK=()
declare -i _CLEANING=0
_register_cleanup() { _CLEANUP_STACK+=("$1"); }
_run_cleanups() {
    (( _CLEANING )) && return
    _CLEANING=1
    local i; for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[i]}" 2>/dev/null || true
    done
}
# EXIT orchestrator + signal traps (forward then trigger EXIT)
trap '_on_err' ERR
trap '_run_cleanups' EXIT
trap '_forward_signal TERM; exit 143' TERM
trap '_forward_signal INT; exit 130' INT
# Resource registration: each resource owns its cleanup
readonly _WORK_DIR="$(mktemp -d)"
_register_cleanup "rm -rf '${_WORK_DIR}'"
exec {_LOCK_FD}>"/var/run/app.lock"
flock -n "${_LOCK_FD}" || { printf 'Locked\n' >&2; exit 1; }
_register_cleanup "exec {_LOCK_FD}>&-"
exec {_REPORT_FD}>"${_WORK_DIR}/report.json"
_register_cleanup "exec {_REPORT_FD}>&-"
```

Signal traps call `exit` with conventional codes (130=INT, 143=TERM) to trigger the EXIT trap. `_CLEANING` guard prevents re-entrant execution on cascading signals. `eval` in `_run_cleanups` is safe — handlers are script-registered, never user input.

---
## [4][PROCESS_LIFECYCLE]
>**Dictum:** *Bash does not propagate signals to background children — PID tracking and explicit forwarding are mandatory for clean shutdown.*

<br>

`wait -f PID` (5.2+) waits without job control. `wait -n -p VARNAME` (5.1+) returns the specific completed PID for per-job error handling. `SRANDOM` draws from `/dev/urandom` (kernel CSPRNG) — use for jitter and temp names where `RANDOM` (LCG) is insufficient.

```bash
# PID map: name → PID for targeted signal delivery and per-job error tracking
declare -A _JOBS=()

_spawn() {
    local -r name="$1"; shift
    "$@" &
    _JOBS["${name}"]=$!
    _register_cleanup "kill -TERM ${!} 2>/dev/null || true"
}
_forward_signal() {
    local -r sig="$1"
    local name; for name in "${!_JOBS[@]}"; do
        kill -"${sig}" "${_JOBS[${name}]}" 2>/dev/null || true
    done
}
_wait_all() {
    local -i failures=0
    local name; for name in "${!_JOBS[@]}"; do
        wait -f "${_JOBS[${name}]}" 2>/dev/null || (( failures++ ))
    done
    return "$(( failures > 0 ))"
}
# Graceful shutdown: SIGTERM → grace period → SIGKILL
_graceful_stop() {
    _forward_signal TERM
    local -r deadline="$(( EPOCHSECONDS + ${1:-10} ))"
    local name pid; for name in "${!_JOBS[@]}"; do
        pid="${_JOBS[${name}]}"
        while kill -0 "${pid}" 2>/dev/null && (( EPOCHSECONDS < deadline )); do
            read -rt 0.5 <> <(:) || :  # fork-free sub-second sleep
        done
        kill -0 "${pid}" 2>/dev/null && kill -KILL "${pid}" 2>/dev/null || true
    done
}
# Bounded concurrency pool: wait -n -p captures WHICH child finished
_parallel() {
    local -r max_jobs="$1"; shift
    local -A _pool=()
    local arg; for arg in "$@"; do
        # Drain one slot when at capacity
        (( ${#_pool[@]} >= max_jobs )) && {
            local finished_pid
            wait -n -p finished_pid "${!_pool[@]}" 2>/dev/null
            unset "_pool[${finished_pid}]"
        }
        _process_item "${arg}" &
        _pool[$!]="${arg}"
    done
    wait
}
# exec replacement: become target process (PID 1 containers) — must _run_cleanups first
_exec_service() {
    _run_cleanups
    exec "$@"  # unreachable after success; ERR trap fires on failure
}
```

`_JOBS` maps logical names to PIDs for targeted signal delivery. `_graceful_stop` uses `read -rt 0.5 <> <(:)` as fork-free sub-second sleep, then escalates to SIGKILL after deadline. `_parallel` uses `wait -n -p` with PID as associative key; `unset` (not pattern substitution) removes array elements. `_exec_service` calls `_run_cleanups` before `exec` — EXIT traps do not fire after successful exec.

---
## [5][RUNTIME_CAPABILITY]
>**Dictum:** *Capability detection at startup populates readonly flags — dispatch tables select implementation at init, not per-call.*

<br>

```bash
declare -Ar _TOOL_FALLBACKS=(
    [search]="rg:_search_rg fd:_search_fd grep:_search_grep"
    [json]="jq:_parse_jq python3:_parse_python"
    [hash]="sha256sum:_hash_sha256 shasum:_hash_shasum"
)

_resolve_tool() {
    local -r capability="$1"
    local -r chain="${_TOOL_FALLBACKS[${capability}]}"
    local entry tool func
    local found=0; for entry in ${chain}; do
        tool="${entry%%:*}"; func="${entry#*:}"
        command -v "${tool}" >/dev/null 2>&1 && { found=1; break; }
    done
    (( found )) || { printf 'No provider for: %s\n' "${capability}" >&2; return 1; }
    printf '%s' "${func}"
}
# Terminal capability flags: computed once, readonly for lifetime
_IS_TTY=0; [[ -t 1 ]] && _IS_TTY=1; readonly _IS_TTY
readonly _HAS_COLOR="$(( _IS_TTY && $(tput colors 2>/dev/null || printf 0) >= 8 ))"
readonly _TERM_COLS="$(tput cols 2>/dev/null || printf 80)"
declare -Ar _ANSI=([red]=31 [green]=32 [yellow]=33 [blue]=34 [bold]=1 [reset]=0)
_color() {
    (( _HAS_COLOR )) || { printf '%s' "$2"; return; }
    printf '\e[%dm%s\e[0m' "${_ANSI[$1]}" "$2"
}
# Environment contract: var → regex. '.+' = required-any, '^[0-9]+$' = int
declare -Ar _ENV_CONTRACT=(
    [DATABASE_URL]='.+'
    [PORT]='^[0-9]+$'
    [LOG_LEVEL]='^(debug|info|warn|error)$'
    [WORKERS]='^[0-9]+$'
    [SERVICE_NAME]='^[a-zA-Z][a-zA-Z0-9_-]+$'
)
_validate_env() {
    local var pattern; for var in "${!_ENV_CONTRACT[@]}"; do
        pattern="${_ENV_CONTRACT[${var}]}"
        [[ -v "${var}" ]] || { printf 'Missing: %s\n' "${var}" >&2; return 1; }
        [[ "${!var}" =~ ${pattern} ]] \
            || { printf 'Invalid %s=%s (expected: %s)\n' "${var}" "${!var}" "${pattern}" >&2; return 1; }
    done
}
# EPOCHREALTIME microsecond benchmarking — PE arithmetic, zero forks
_bench() {
    local -r label="$1" start="$2" end="${EPOCHREALTIME}"
    local -r start_s="${start%.*}" start_us="${start#*.}"
    local -r end_s="${end%.*}" end_us="${end#*.}"
    local -r ms=$(( ((end_s - start_s) * 1000000 + 10#${end_us} - 10#${start_us}) / 1000 ))
    printf '[BENCH] %s: %dms\n' "${label}" "${ms}" >&2
}
_dump_config() {  # ${!prefix@} enumerates all matching variable names
    local -r prefix="$1"
    local var; for var in ${!prefix@}; do
        printf '%s=%s\n' "${var}" "${!var}"
    done
}

# --- Bash 5.3 variables ---
# BASH_MONOSECONDS: monotonic clock immune to NTP drift / wall-clock jumps
# Use for elapsed-time measurement where EPOCHSECONDS would skew on clock sync
_elapsed_since() {
    local -r start="$1"
    printf '%d' "$(( BASH_MONOSECONDS - start ))"
}
# BASH_TRAPSIG: signal number inside trap handler — enables dispatch-table routing
# Without this, trap handlers cannot distinguish SIGTERM from SIGINT programmatically
trap '_signal_dispatch' TERM INT HUP
_signal_dispatch() {
    local -Ar _SIG_ACTIONS=([15]=_on_term [2]=_on_int [1]=_on_hup)
    "${_SIG_ACTIONS[${BASH_TRAPSIG}]}"
}
# GLOBSORT: control glob result ordering (name/size/mtime, +/- prefix for direction)
# Default is 'name' (lexicographic). Prefix '-' reverses. Eliminates ls/sort pipelines
GLOBSORT='-mtime'  # newest first — process most recent logs without ls -t pipe
local -a recent_logs=( /var/log/app/*.log )
# array_expand_once (shopt): prevents double-evaluation of associative array subscripts
# Without it, unset 'arr[$key]' evaluates $key twice — once for expansion, once for unset
# Security-relevant when keys contain arithmetic expressions or special characters
shopt -s array_expand_once
```

`_TOOL_FALLBACKS` encodes preference-ordered fallback chains — `_resolve_tool` walks via `command -v` and returns the first available implementation. `_ENV_CONTRACT` unifies required/type/enum validation into regex patterns. `_bench` uses EPOCHREALTIME PE arithmetic; `10#${us}` forces decimal on zero-padded microseconds. `BASH_SOURCE[-1]` is the entry script, `BASH_SOURCE[0]` is the current file. `BASH_MONOSECONDS` replaces `EPOCHSECONDS` where NTP drift matters. `BASH_TRAPSIG` enables dispatch-table signal routing from a single handler. `array_expand_once` (replacing `assoc_expand_once`) prevents subscript double-evaluation.

---
## [RULES]

- `FUNCNAME[i]` + `BASH_LINENO[i-1]` — arrays are offset by one; line number records call site, FUNCNAME records called function.
- `set -E` (errtrace) mandatory for ERR traps inside functions — without it, only top-level failures trigger.
- ERR fires before EXIT (ordering guarantee) — stack arrays still populated for diagnostic capture.
- `_CLEANUP_STACK` LIFO release prevents dependency violation — last acquired resource released first.
- `_CLEANING` guard prevents re-entrant cleanup on cascading signals (INT during EXIT).
- Signal traps call `exit CODE` to trigger EXIT trap — `exit 130` for INT, `exit 143` for TERM.
- `exec` replacement bypasses EXIT trap — call `_run_cleanups` explicitly before exec.
- `wait -f PID` (5.2+) for non-job-control waits — without `-f`, `wait` may return immediately for unknown PIDs.
- `wait -n -p var` (5.1+) returns the specific completed PID — enables per-job error handling in pools.
- `SRANDOM` uses `/dev/urandom` (kernel CSPRNG) — use for jitter, temp names, tokens where `RANDOM` (LCG) is insufficient.
- `command -v` over `which` — POSIX portable, no external process, no path caching issues.
- `${!prefix@}` for variable name enumeration — configuration discovery without hardcoded lists.
- `declare -Ar` for capability fallback chains — resolve at init, dispatch at call site.
- `_ENV_CONTRACT` as regex map (one pattern per var) — unifies required/type/enum validation without dispatch indirection.
- `EPOCHREALTIME` PE arithmetic for microsecond benchmarking — `10#${us}` forces decimal on zero-padded fractional part.
- `local -n` namerefs use `__` prefix for callee-internal names — prevents dynamic scope collision with caller variables.
- Never `local -n ref="ref"` — circular nameref produces runtime error or infinite loop.
- `BASH_MONOSECONDS` (5.3) for elapsed-time measurement — immune to NTP drift unlike `EPOCHSECONDS`.
- `BASH_TRAPSIG` (5.3) inside trap handlers for dispatch-table signal routing — replaces per-signal trap registration.
- `GLOBSORT` (5.3) controls glob ordering (`name`/`size`/`mtime`, `-` prefix reverses) — eliminates `ls | sort` pipelines.
- `shopt -s array_expand_once` (5.3, replaces `assoc_expand_once`) — prevents double-evaluation of subscripts in assignments/unset.
