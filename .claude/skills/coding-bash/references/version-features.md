# [H1][VERSION-FEATURES]
>**Dictum:** *Version-specific primitives eliminate fork overhead and enable production patterns impossible in prior releases.*

<br>

Bash 5.2/5.3 feature exploitation. Fork-free substitution, REPLY capture, GLOBSORT pipelines, epoch instrumentation, monotonic clock, trap signal dispatch, loadable builtins (fltexpr, strptime, kv), shell options (array_expand_once, read -E, source -p), version gating. Minimum baseline is 5.2 — features below that threshold are unconditionally available.

| [IDX] | [PATTERN]              |  [S]  | [VER] | [USE_WHEN]                                           |
| :---: | :--------------------- | :---: | :---: | :--------------------------------------------------- |
|  [1]  | Fork-free substitution |  S1   |  5.3  | Tight loops, accumulator patterns, hot-path captures |
|  [2]  | REPLY capture          |  S2   |  5.3  | Result binding, conditional stdout processing        |
|  [3]  | GLOBSORT pipelines     |  S3   |  5.3  | File processing by size/mtime without sort(1)        |
|  [4]  | Epoch instrumentation  |  S4   | 5.2+  | Benchmarking, TTL caches, SRANDOM nonces             |
|  [5]  | Monotonic clock        |  S5   |  5.3  | Elapsed time immune to NTP drift, SLA enforcement    |
|  [6]  | Trap signal dispatch   |  S6   |  5.3  | Multi-signal handlers, graceful shutdown dispatch    |
|  [7]  | Loadable builtins      |  S7   |  5.3  | Float math, date/KV ops without awk/date forks       |
|  [8]  | Shell options (5.3)    |  S8   |  5.3  | array_expand_once, read -E, source -p PATH           |
|  [9]  | Wait primitives        |  S9   | 5.2+  | Bounded concurrency, PID tracking, job completion    |
| [10]  | Version gating         |  S10  | 5.2+  | Feature dispatch across 5.2/5.3 fleet boundary       |

---
## [1][FORK_FREE_SUBSTITUTION]
>**Dictum:** *Current-shell substitution eliminates the dominant cost in tight loops.*

<br>

`${ cmd; }` (whitespace after `{` mandatory) runs in the current shell, capturing stdout without fork/exec. Side effects propagate — variable assignments, traps, `cd` persist. This is NOT sandboxed capture.

The performance gap is structural: `$()` forks a subshell (clone + pipe + exec), `${ }` runs inline. In a 10k-iteration loop, `${ printf '%s' x; }` completes ~5-8x faster than `$(printf '%s' x)` — fork/exec overhead dominates at scale.

```bash
# Fork cost quantified: measure the gap directly
_bench_fork_vs_insitu() {
    local -r iterations=10000
    local -i i result
    local t0 t1
    t0="${EPOCHREALTIME}"
    for (( i = 0; i < iterations; i++ )); do
        result=$(printf '%d' "${i}")
    done
    t1="${EPOCHREALTIME}"
    printf 'subshell:  %d us\n' \
        "$(( (${t1%.*} - ${t0%.*}) * 1000000 + 10#${t1#*.} - 10#${t0#*.} ))" >&2

    t0="${EPOCHREALTIME}"
    for (( i = 0; i < iterations; i++ )); do
        result=${ printf '%d' "${i}"; }
    done
    t1="${EPOCHREALTIME}"
    printf 'insitu:    %d us\n' \
        "$(( (${t1%.*} - ${t0%.*}) * 1000000 + 10#${t1#*.} - 10#${t0#*.} ))" >&2
}
# Composed expansion: parameter ops + case modification + ${ } capture
# No forks — everything resolves in the current shell
_normalize_path() {
    local -r raw="$1"
    local -r lower="${raw,,}" cleaned="${raw// /_}"
    local result; result=${ printf '%s/%s' "${lower%%/*}" "${cleaned##*/}"; }
    printf '%s' "${result}"
}
# Accumulator pattern: side effects persist across iterations
declare -a checksums=()
readarray -d '' -t files < <(fd -e sh --print0)
local file; for file in "${files[@]}"; do
    checksums+=("${ sha256sum "${file}" | choose 0; }")
done
# Side-effect propagation — mutations inside ${ } survive
declare -i counter=0
_=${ (( counter++ )); printf '%d' "${counter}"; }
# counter is now 1 — $() would fork, losing the mutation
# Scope isolation: use $() when side effects must NOT propagate
subdir=$(cd /tmp && pwd)    # PWD unchanged — subshell isolated
subdir=${ cd /tmp && pwd; } # PWD IS /tmp — current shell mutated
```

Use `${ }` for inline value construction in hot paths. Use `$()` when isolation is required — side-effect propagation is load-bearing for accumulators but hazardous for pure transforms.

---
## [2][REPLY_CAPTURE]
>**Dictum:** *REPLY capture decouples command execution from stdout interception.*

<br>

`${| cmd; }` executes in the current shell, stores stdout in `REPLY`, and expands to empty string. REPLY is overwritten on each invocation — bind immediately.

```bash
# Sequential capture: each ${| } overwrites REPLY — bind immediately
get_system_profile() {
    local os kernel arch
    ${| uname -s; };  os="${REPLY}"
    ${| uname -r; };  kernel="${REPLY}"
    ${| uname -m; };  arch="${REPLY}"
    printf '%s/%s (%s)' "${os}" "${kernel}" "${arch}"
}
# Nameref integration: REPLY capture feeding higher-order return
extract_field() {
    local -n _out=$1
    ${| jq -r ".${2}" < "${3}"; }
    _out="${REPLY}"
}
local db_host; extract_field db_host "database.host" config.json

# Guard pattern: REPLY + arithmetic for threshold checks
${| df --output=pcent / | tail -1 | tr -d '[:space:]%'; }
(( REPLY > 90 )) && _warn "Disk usage critical: ${REPLY}%"
```

`${| }` vs `${ }`: the latter expands to captured stdout inline; the former stores in REPLY and expands to empty. Use `${ }` for inline value construction, `${| }` when the result needs conditional processing or the command has both stdout and side effects worth separating.

---
## [3][GLOBSORT_PIPELINES]
>**Dictum:** *Glob-level sorting eliminates post-hoc sort pipelines.*

<br>

GLOBSORT (5.3) controls pathname expansion order globally. `+` prefix = ascending (default), `-` = descending.

| [IDX] | [SPECIFIER] | [SORTS_BY]                  |
| :---: | :---------- | :-------------------------- |
|  [1]  | `name`      | Alphabetical (default)      |
|  [2]  | `size`      | File size (st_size)         |
|  [3]  | `mtime`     | Modification time           |
|  [4]  | `atime`     | Access time                 |
|  [5]  | `ctime`     | Inode change time           |
|  [6]  | `blocks`    | Allocated block count       |
|  [7]  | `numeric`   | Leading digits in filename  |
|  [8]  | `nosort`    | Raw readdir order (fastest) |

```bash
# Process newest logs first — no ls/stat/sort pipeline
GLOBSORT="-mtime"
for log in /var/log/app/*.log; do
    [[ -f "${log}" ]] || continue
    rg -c 'ERROR' "${log}" 2>/dev/null
done
# Numeric version ordering: v1.log, v2.log, ..., v10.log (NOT v1, v10, v2)
GLOBSORT="+numeric"
versions=(releases/v*.tar.gz)
readonly latest="${versions[-1]}"
# Scoped GLOBSORT — variable is global, no local support
_with_globsort() {
    local -r saved="${GLOBSORT:-name}" spec="$1"; shift
    GLOBSORT="${spec}"; "$@"; GLOBSORT="${saved}"
}
_with_globsort "-mtime" process_logs /var/log/
# nosort: bypass sorting for large directories where order is irrelevant
GLOBSORT="nosort"
readarray -t files < <(printf '%s\n' /tmp/builds/*)
readonly file_count="${#files[@]}"
```

`nosort` bypasses sorting entirely — use for 10k+ entry directories where readdir performance matters and order is irrelevant.

---
## [4][EPOCH_INSTRUMENTATION]
>**Dictum:** *Builtin epoch variables eliminate the dominant fork in timing and security patterns.*

<br>

Three builtin variables replace `date(1)` forks entirely. All are unconditionally available at the 5.2+ baseline:

| [IDX] | [VARIABLE]      | [PROVIDES]                     | [REPLACES]      |
| :---: | :-------------- | :----------------------------- | :-------------- |
|  [1]  | `EPOCHSECONDS`  | Integer seconds since epoch    | `$(date +%s)`   |
|  [2]  | `EPOCHREALTIME` | Microsecond float (sec.usec)   | `$(date +%s%N)` |
|  [3]  | `SRANDOM`       | 32-bit getrandom(2)/getentropy | `$RANDOM`       |

`SRANDOM` uses the kernel's getrandom(2) syscall — `RANDOM` is a predictable LCG (linear congruential generator). `SRANDOM` is suitable for nonces, session IDs, and jitter values but NOT for cryptographic key material (32-bit space). For keys: `head -c 32 /dev/urandom | base64`.

`printf -v ts '%(%F %T)T' -1` is the fork-free timestamp — replaces `$(date '+%F %T')` entirely. `-1` means "now"; strftime format via `%(...)T`.

```bash
# Microsecond benchmarking — pure integer arithmetic, no bc/awk
_bench() {
    local -r label="$1"; shift
    local -r start="${EPOCHREALTIME}"
    "$@"
    local -r end="${EPOCHREALTIME}"
    local -r s_sec="${start%.*}" s_usec="${start#*.}"
    local -r e_sec="${end%.*}" e_usec="${end#*.}"
    printf '%s: %d us\n' "${label}" \
        "$(( (e_sec - s_sec) * 1000000 + 10#${e_usec} - 10#${s_usec} ))" >&2
}
# Fork-free timestamps — printf -v avoids $(date) entirely
_timestamp() {
    local -n _out=$1
    printf -v _out '%(%F %T)T' -1
}
local ts; _timestamp ts
# ts = "2026-03-09 14:30:00" — zero forks
# SRANDOM: unpredictable nonces and session identifiers
readonly SESSION_ID="${SRANDOM}${SRANDOM}"
readonly NONCE="$(printf '%08x%08x' "${SRANDOM}" "${SRANDOM}")"
readonly WORK_DIR="$(mktemp -d "/tmp/job-${SRANDOM}-XXXXXX")"
# W3C trace context: 128-bit trace ID + 64-bit span ID via SRANDOM
printf -v TRACE_ID '%08x%08x%08x%08x' "${SRANDOM}" "${SRANDOM}" "${SRANDOM}" "${SRANDOM}"
printf -v SPAN_ID '%08x%08x' "${SRANDOM}" "${SRANDOM}"
export TRACEPARENT="00-${TRACE_ID}-${SPAN_ID}-01"
# Reusable _bench: pass label + start timestamp, compute delta at call site
_bench() {
    local -r label="$1" start="$2" end="${EPOCHREALTIME}"
    local -r ms=$(( ((${end%.*} - ${start%.*}) * 1000000 + 10#${end#*.} - 10#${start#*.}) / 1000 ))
    _info "${label}: ${ms}ms"
}
local -r t0="${EPOCHREALTIME}"; expensive_op; _bench "Operation" "${t0}"
# TTL cache using EPOCHSECONDS — no date(1) fork for expiry
declare -A _CACHE=() _CACHE_TS=()
_cache_get() {
    local -r key="$1" ttl="${2:-300}"
    [[ -v _CACHE_TS["${key}"] ]] || return 1
    (( EPOCHSECONDS - _CACHE_TS["${key}"] < ttl )) || {
        unset "_CACHE[${key}]" "_CACHE_TS[${key}]"; return 1
    }
    printf '%s' "${_CACHE["${key}"]}"
}
_cache_set() { _CACHE["$1"]="$2"; _CACHE_TS["$1"]="${EPOCHSECONDS}"; }
# Rate limiter: token bucket with EPOCHSECONDS resolution
declare -A _BUCKET_TS=() _BUCKET_TOKENS=()
_rate_check() {
    local -r key="$1" rate="${2:-10}" burst="${3:-20}"
    local -r now="${EPOCHSECONDS}" last="${_BUCKET_TS["${key}"]:-${EPOCHSECONDS}}"
    local -i tokens=$(( ${_BUCKET_TOKENS["${key}"]:-${burst}} + (now - last) * rate ))
    (( tokens > burst )) && tokens="${burst}"
    (( tokens > 0 )) || return 1
    _BUCKET_TOKENS["${key}"]=$(( tokens - 1 ))
    _BUCKET_TS["${key}"]="${now}"
}
```

`10#${usec}` forces base-10 interpretation — microsecond strings like `09` would otherwise parse as invalid octal.

---
## [5][MONOTONIC_CLOCK]
>**Dictum:** *Monotonic timing eliminates NTP-induced measurement corruption in production instrumentation.*

<br>

`BASH_MONOSECONDS` (5.3) reads the system monotonic clock — immune to NTP adjustments, leap seconds, and manual `date -s` changes that corrupt `EPOCHREALTIME`-based elapsed measurements. Integer seconds resolution. Availability depends on OS `clock_gettime(CLOCK_MONOTONIC)` support (Linux, macOS, BSDs — universally present on modern systems).

The critical distinction: `EPOCHREALTIME` measures wall-clock time (subject to NTP step corrections mid-measurement), `BASH_MONOSECONDS` measures elapsed time (monotonically increasing, never adjusted). Use `EPOCHREALTIME` for timestamps, `BASH_MONOSECONDS` for durations.

```bash
# Elapsed-time measurement: NTP-immune, integer-resolution
_elapsed() {
    local -r label="$1" start="$2"
    local -r delta=$(( BASH_MONOSECONDS - start ))
    printf '%s: %ds\n' "${label}" "${delta}" >&2
}
local -r t0="${BASH_MONOSECONDS}"; deploy_service; _elapsed "deploy" "${t0}"
# SLA enforcement: timeout based on monotonic clock
_with_deadline() {
    local -r timeout_sec="$1"; shift
    local -r deadline=$(( BASH_MONOSECONDS + timeout_sec ))
    "$@"
    local -r rc=$?
    (( BASH_MONOSECONDS <= deadline )) || {
        _warn "SLA breach: ${*} exceeded ${timeout_sec}s deadline"
        return 124
    }
    return "${rc}"
}
_with_deadline 30 run_migration
# Monotonic watchdog: detect stalled pipelines
_watchdog() {
    local -r pid="$1" max_stall="$2"
    local -i last_check="${BASH_MONOSECONDS}"
    local prev_size; prev_size="$(wc -c < /proc/"${pid}"/fd/1 2>/dev/null)" || return 1
    local curr_size
    while kill -0 "${pid}" 2>/dev/null; do
        sleep 1
        curr_size="$(wc -c < /proc/"${pid}"/fd/1 2>/dev/null)" || break
        [[ "${curr_size}" != "${prev_size}" ]] && last_check="${BASH_MONOSECONDS}"
        (( BASH_MONOSECONDS - last_check > max_stall )) && {
            _error "Process ${pid} stalled for ${max_stall}s"; kill -TERM "${pid}"; return 1
        }
        prev_size="${curr_size}"
    done
}
# Version-safe elapsed: BASH_MONOSECONDS on 5.3, EPOCHREALTIME fallback
_mono_now() {
    [[ -v BASH_MONOSECONDS ]] && { printf '%d' "${BASH_MONOSECONDS}"; return; }
    printf '%d' "${EPOCHSECONDS}"
}
```

`BASH_MONOSECONDS` replaces the common pattern of `EPOCHREALTIME` arithmetic for duration measurement — simpler (integer vs microsecond string splitting), correct (monotonic vs wall-clock), and fork-free. Reserve `EPOCHREALTIME` for timestamps and sub-second precision where monotonicity is not required.

---
## [6][TRAP_SIGNAL_DISPATCH]
>**Dictum:** *Signal-aware trap handlers enable single-handler dispatch across heterogeneous shutdown signals.*

<br>

`BASH_TRAPSIG` (5.3) is set to the numeric signal number inside a trap handler. Before 5.3, a single handler shared across signals had no way to determine which signal fired — requiring separate handler functions per signal or wrapper hacks.

```bash
# Dispatch-on-signal: one handler, differentiated cleanup
_shutdown() {
    local -r sig="${BASH_TRAPSIG}"
    local -Ar _ACTIONS=(
        [2]="interrupt"    # SIGINT
        [15]="terminate"   # SIGTERM
        [1]="hangup"       # SIGHUP (reload config)
    )
    local -r action="${_ACTIONS[${sig}]:-unknown}"
    _info "Received signal ${sig} (${action})"
    # Signal-specific cleanup via dispatch table
    local -Ar _EXIT_CODES=( [2]=130 [15]=143 [1]=0 )
    _cleanup
    exit "${_EXIT_CODES[${sig}]:-1}"
}
trap '_shutdown' INT TERM HUP
# Graceful shutdown with drain period differentiated by signal urgency
_graceful_shutdown() {
    local -r sig="${BASH_TRAPSIG}"
    # SIGTERM: full drain period; SIGINT: abbreviated
    local -r drain=$(( sig == 15 ? 30 : 5 ))
    _info "Draining connections (${drain}s, signal=${sig})"
    _drain_connections "${drain}"
    _cleanup
    exit $(( 128 + sig ))
}
trap '_graceful_shutdown' INT TERM
# Log rotation on SIGHUP without exit
_on_signal() {
    local -r sig="${BASH_TRAPSIG}"
    (( sig == 1 )) && { _rotate_logs; return; }
    _shutdown
}
trap '_on_signal' HUP INT TERM
```

Before 5.3, achieving signal discrimination required `trap '_handler INT' INT; trap '_handler TERM' TERM` — duplicating the trap registration and passing signal identity as a string argument. `BASH_TRAPSIG` collapses this to a single registration with runtime discrimination.

---
## [7][LOADABLE_BUILTINS]
>**Dictum:** *Loadable builtins eliminate external process overhead for domain-specific operations.*

<br>

Bash 5.3 ships loadable builtins as shared objects — `enable -f /path/to/builtin name` loads them into process memory with zero IPC overhead. Guard with `enable -f ... 2>/dev/null || fallback` — availability depends on compile-time options.

Key 5.3 additions: `kv` (in-process key-value store) and `strptime` (date string parsing). Combined with existing `fltexpr` (float arithmetic), these eliminate the three most common fork-to-external-tool patterns: `awk` for math, `date` for parsing, and temp files / associative arrays for lookup tables.

```bash
# Bootstrap: load available builtins, set capability flags
_load_builtins() {
    local -r lib="${BASH_LOADABLES_PATH:-/usr/local/lib/bash}"
    enable -f "${lib}/fltexpr" fltexpr 2>/dev/null \
        && readonly _HAS_FLTEXPR=1 || readonly _HAS_FLTEXPR=0
    enable -f "${lib}/strptime" strptime 2>/dev/null \
        && readonly _HAS_STRPTIME=1 || readonly _HAS_STRPTIME=0
    enable -f "${lib}/kv" kv 2>/dev/null \
        && readonly _HAS_KV=1 || readonly _HAS_KV=0
}
# Polymorphic float: builtin when available, awk fallback
_flt() {
    (( _HAS_FLTEXPR )) && { fltexpr "$1"; return; }
    awk "BEGIN { printf \"%.6f\", $1 }"
}
# Percentile on sorted array — pure bash with fltexpr
_percentile() {
    local -n _arr=$1; local -r p="$2"
    local -r n="${#_arr[@]}"
    local -r rank="$(_flt "${p} * (${n} - 1) / 100.0")"
    local -r lo="${rank%.*}" hi="$(( lo + 1 ))"
    local -r frac="$(_flt "${rank} - ${lo}")"
    _flt "${_arr[${lo}]} + ${frac} * (${_arr[${hi}]} - ${_arr[${lo}]})"
}
# Polymorphic timestamp parse: strptime when available, date(1) fallback
_parse_ts() {
    local -r fmt="$1" str="$2"
    (( _HAS_STRPTIME )) && { strptime "${fmt}" "${str}"; return; }
    date -d "${str}" '+%s' 2>/dev/null \
        || date -jf "${fmt}" "${str}" '+%s' 2>/dev/null
}
# kv: in-process key-value store — replaces associative arrays for large datasets
# Advantages over declare -A: handles binary values, no variable namespace pollution,
# persistent across subshell boundaries when backed by file
_kv_registry() {
    (( _HAS_KV )) || { _error "kv builtin unavailable"; return 1; }
    local -r store="$1"
    kv open "${store}"
    # Bulk registration from config
    local key value
    while IFS='=' read -r key value; do
        [[ -n "${key}" && "${key}" != \#* ]] || continue
        kv set "${store}" "${key}" "${value}"
    done < "$2"
    # Lookup
    kv get "${store}" "database.host"
    kv close "${store}"
}
# Polymorphic KV: builtin kv when available, associative array fallback
declare -A _KV_FALLBACK=()
_kv_set() {
    (( _HAS_KV )) && { kv set "$1" "$2" "$3"; return; }
    _KV_FALLBACK["$1:$2"]="$3"
}
_kv_get() {
    (( _HAS_KV )) && { kv get "$1" "$2"; return; }
    printf '%s' "${_KV_FALLBACK["$1:$2"]}"
}
```

`BASH_LOADABLES_PATH` provides default search path. Verify interfaces with `help <builtin>` after loading — APIs may vary across installations. Always provide awk/date/associative-array fallback.

---
## [8][SHELL_OPTIONS_53]
>**Dictum:** *5.3 shell options and builtin changes close long-standing usability and safety gaps.*

<br>

Three additions address distinct production needs: array expansion safety, interactive prompting, and library loading isolation.

**array_expand_once** replaces `assoc_expand_once` (5.2) with broader scope — subscript expressions in assignment statements, `${name[sub]}` expansions, and `unset` are evaluated only once. Prevents double-evaluation bugs where a subscript containing command substitution or arithmetic side effects fires twice.

```bash
# array_expand_once: prevent double-evaluation of subscript expressions
shopt -s array_expand_once

declare -A counters=()
declare -i call_count=0
_next_key() { (( call_count++ )); printf 'key_%d' "${call_count}"; }
# Without array_expand_once: _next_key runs TWICE (once for subscript resolution,
# once for assignment). With it: runs ONCE.
counters[$(_next_key)]=1
# call_count is now 1 (correct), not 2 (double-evaluation bug)
```

**read -E** enables Readline with programmable completion during `read` — transforms `read -ep` from a bare prompt into a fully interactive input with tab completion, history, and key bindings. Production use: interactive CLIs that need domain-specific completions during user input.

```bash
# Interactive prompt with Readline completion (5.3)
# Provides tab-completion and history editing during read
_prompt_service() {
    local -r services="nginx postgres redis kafka"
    # Register completions for the read prompt
    complete -W "${services}" -E
    local selection
    read -rE -p "Service to restart: " selection
    [[ " ${services} " == *" ${selection} "* ]] || {
        _error "Unknown service: ${selection}"; return 1
    }
    printf '%s' "${selection}"
}
```

**source -p PATH** specifies a custom search path for sourcing files — isolates library loading from the ambient `PATH`. Prevents accidental sourcing of same-named files from unexpected directories.

```bash
# Controlled library loading: source only from approved paths
_load_libs() {
    local -r lib_path="/opt/app/lib:/opt/app/vendor"
    local lib
    # source -p restricts file lookup to lib_path — ignores ambient PATH
    source -p "${lib_path}" logging.sh || { _error "logging.sh not found"; return 1; }
    source -p "${lib_path}" config.sh  || { _error "config.sh not found"; return 1; }
}
# Version-safe library loading
_source_lib() {
    local -r lib="$1" search_path="${2:-/opt/app/lib}"
    # 5.3: use -p for controlled search; fallback: explicit path
    (( _BASH_V >= 503 )) \
        && source -p "${search_path}" "${lib}" \
        || source "${search_path}/${lib}"
}
```

`array_expand_once` should be enabled globally in scripts using associative arrays with computed subscripts — it is strictly safer than the default. `read -E` is interactive-only (no effect in non-interactive scripts). `source -p` is the 5.3 equivalent of controlling `LD_LIBRARY_PATH` for shell libraries.

---
## [9][WAIT_PRIMITIVES]
>**Dictum:** *Wait primitives enable bounded-concurrency pools without external job managers.*

<br>

`wait -n` (5.1+, unconditional at 5.2 baseline) blocks until ANY background job completes — the foundation for worker pools. `wait -n -p VARNAME` (5.2+) additionally stores the completed PID, enabling per-job result tracking. `wait -f PID` (5.2+) waits for a specific PID even outside job control — critical for scripts running under `set -m` restrictions.

`shopt -s patsub_replacement` (5.2) changes `${var//pat/rep}` behavior: `&` in the replacement expands to the matched text, mirroring sed's `\&`. Disabled by default for backwards compatibility — enable explicitly.

```bash
# Bounded-concurrency pool with PID tracking (5.2+)
_parallel_pool() {
    local -r max_workers="${1:-4}"; shift
    local -a items=("$@")
    local -A pids=()          # pid → item mapping
    local -i active=0 completed=0 failed=0
    local pid item
    for item in "${items[@]}"; do
        # Throttle: when at capacity, wait for any completion
        (( active >= max_workers )) && {
            wait -n -p pid
            local rc=$?
            (( rc == 0 )) && (( completed++ )) || (( failed++ ))
            _info "Done: ${pids[${pid}]} (rc=${rc})"
            unset "pids[${pid}]"
            (( active-- ))
        }
        _process_item "${item}" &
        pids[$!]="${item}"
        (( active++ ))
    done
    # Drain remaining — wait -f for robust non-job-control waits
    local remaining_pid; for remaining_pid in "${!pids[@]}"; do
        wait -f "${remaining_pid}"
        local drain_rc=$?
        (( drain_rc == 0 )) && (( completed++ )) || (( failed++ ))
        _info "Done: ${pids[${remaining_pid}]} (rc=${drain_rc})"
    done
    printf 'completed=%d failed=%d\n' "${completed}" "${failed}" >&2
    (( failed == 0 ))
}
# Dynamic FD allocation for parallel output aggregation (data-pipeline pattern)
# Workers write results/progress to separate FDs — no temp file contention
exec {rfd}>>"${result_file}"; exec {pfd}>>"${progress_file}"
_register_cleanup "exec ${rfd}>&- 2>/dev/null; exec ${pfd}>&- 2>/dev/null"
# Workers: printf '%s\n' "${row}" >&"${rfd}"; printf 'ok\n' >&"${pfd}"
# patsub_replacement (5.2): & in replacement expands to matched text
shopt -s patsub_replacement
readonly raw="error_code:404 error_code:500 error_code:503"
readonly wrapped="${raw//error_code:[0-9]*/[&]}"
# result: "[error_code:404] [error_code:500] [error_code:503]"
shopt -u patsub_replacement   # restore default — scope carefully
```

`wait -n` without `-p` is sufficient when you only need backpressure (throttle to N concurrent). Add `-p` when you need to correlate completion with the specific job that finished. `wait -f` is needed in non-job-control contexts where `wait PID` would fail silently.

---
## [10][VERSION_GATING]
>**Dictum:** *Feature gating at startup enables polymorphic dispatch across 5.2/5.3 fleet boundary.*

<br>

Since the minimum baseline is 5.2, version gating discriminates only the 5.2 vs 5.3 boundary. Features at or below 5.2 (EPOCHSECONDS, EPOCHREALTIME, SRANDOM, `wait -n -p`, `wait -f`) are unconditionally available — no flags needed.

```bash
# Packed version integer: single comparison per feature check
readonly _BASH_V=$(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] ))
# Only 5.3 features need gating — 5.2 features are baseline
readonly _HAS_INSITU=$(( _BASH_V >= 503 ))       # ${ cmd; }
readonly _HAS_REPLY=$(( _BASH_V >= 503 ))        # ${| cmd; }
readonly _HAS_GLOBSORT=$(( _BASH_V >= 503 ))     # GLOBSORT variable
readonly _HAS_MONOSEC=$(( _BASH_V >= 503 ))      # BASH_MONOSECONDS
readonly _HAS_TRAPSIG=$(( _BASH_V >= 503 ))      # BASH_TRAPSIG
readonly _HAS_LOADABLE=$(( _BASH_V >= 503 ))     # loadable builtins (kv, strptime)
readonly _HAS_SOURCE_P=$(( _BASH_V >= 503 ))     # source -p PATH
# Feature dispatch table: version → available capabilities
declare -Ar _VERSION_CAPS=(
    [502]="epoch srandom wait_np wait_f patsub_replacement"
    [503]="epoch srandom wait_np wait_f patsub_replacement insitu reply globsort monosec trapsig loadable source_p array_expand_once"
)
# Polymorphic capture: fork-free on 5.3, subshell fallback on 5.2
# eval is acceptable — compile-time generated, not user-input derived
_capture() {
    (( _HAS_INSITU )) && eval "$1=\${ $2; }" || eval "$1=\$($2)"
}
# Polymorphic elapsed time: monotonic on 5.3, wall-clock on 5.2
_elapsed_start() {
    (( _HAS_MONOSEC )) && { printf '%d' "${BASH_MONOSECONDS}"; return; }
    printf '%d' "${EPOCHSECONDS}"
}
_elapsed_delta() {
    local -r start="$1"
    (( _HAS_MONOSEC )) && { printf '%d' "$(( BASH_MONOSECONDS - start ))"; return; }
    printf '%d' "$(( EPOCHSECONDS - start ))"
}
# Polymorphic random: SRANDOM is baseline — urandom for pre-5.2 edge case
_secure_random() {
    [[ -v SRANDOM ]] && { printf '%d' "${SRANDOM}"; return; }
    od -An -tu4 -N4 /dev/urandom | tr -d '[:space:]'
}
# 5.3 safety defaults: enable array_expand_once when available
(( _BASH_V >= 503 )) && shopt -s array_expand_once
# Feature diagnostics
_features() {
    printf 'bash %s (v%d)\n' "${BASH_VERSION}" "${_BASH_V}"
    printf '  baseline: epoch srandom wait_np wait_f patsub_replacement\n'
    printf '  insitu: %d  reply: %d  globsort: %d  monosec: %d  trapsig: %d  loadable: %d\n' \
        "${_HAS_INSITU}" "${_HAS_REPLY}" "${_HAS_GLOBSORT}" \
        "${_HAS_MONOSEC}" "${_HAS_TRAPSIG}" "${_HAS_LOADABLE}"
}
```

Version gating via packed integer eliminates nested `[[ ]]` chains. `_capture` uses eval (the only acceptable use — template-generated, not user-input derived) to select syntax at call site. Feature flags as `readonly` arithmetic — `(( _HAS_X ))` is zero-cost branching. `array_expand_once` is unconditionally enabled on 5.3 — it is strictly safer than the default and has no backwards-compatibility cost within a controlled script.

---
## [RULES]

- `${ cmd; }` for all captures in tight loops — fork overhead dominates at >100 iterations (~5-8x speedup).
- `${| cmd; }` when stdout needs conditional processing or value crosses function boundary via REPLY.
- GLOBSORT scoped via `_with_globsort` wrapper — never leak sort order into caller's glob behavior.
- BASH_MONOSECONDS for elapsed-time measurement — immune to NTP drift. EPOCHREALTIME for timestamps only.
- BASH_TRAPSIG for multi-signal handlers — dispatch on signal number via table, not per-signal trap registration.
- SRANDOM for unpredictable identifiers and nonces — NEVER for cryptographic key material (32-bit).
- EPOCHSECONDS/EPOCHREALTIME are baseline (5.2+) — use unconditionally, never gate.
- `printf -v var '%(%F %T)T' -1` is THE fork-free timestamp — never `$(date)`.
- EPOCHREALTIME microsecond diff via integer arithmetic with `10#` prefix — never float subtraction via bc.
- `shopt -s array_expand_once` on 5.3 — unconditionally safer, prevents double-evaluation of subscripts.
- `read -E` for interactive prompts requiring tab completion — no effect in non-interactive scripts.
- `source -p PATH` to isolate library loading from ambient PATH — version-gate with `_source_lib` wrapper.
- Loadable builtins (`fltexpr`, `strptime`, `kv`) guarded by `enable -f ... 2>/dev/null` — always provide fallback.
- `wait -n -p` for bounded-concurrency pools with PID tracking; `wait -f` for non-job-control waits — both baseline.
- `shopt -s patsub_replacement` enables `&` expansion in `${var//pat/rep}` — scope with shopt -u after use.
- Version gating via packed integer `(major * 100 + minor)` — gate only the 5.2/5.3 boundary.
- Feature-polymorphic helpers (`_capture`, `_flt`, `_parse_ts`, `_secure_random`, `_elapsed_start`, `_kv_get`) centralize version dispatch — call sites remain version-agnostic.
