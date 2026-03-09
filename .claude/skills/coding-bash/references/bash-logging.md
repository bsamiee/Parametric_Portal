# [H1][BASH-LOGGING]
>**Dictum:** *Structured emission with machine-first format, human-second rendering, and zero-fork hot paths.*

<br>

Production logging for Bash 5.2+/5.3. JSON-ND structured emission, numeric level dispatch, caller-context injection, terminal capability detection, CI platform integration, coprocess log shipping, OpenTelemetry context propagation, fork-free hot paths.

| [IDX] | [PATTERN]            |  [S]  | [USE_WHEN]                                          |
| :---: | :------------------- | :---: | :-------------------------------------------------- |
|  [1]  | JSON-ND structured   |  S1   | Container workloads, log aggregation                |
|  [2]  | Level-gated dispatch |  S2   | Every script — numeric gate, caller injection       |
|  [3]  | Terminal capability  |  S3   | Interactive output — NO_COLOR, tput, CI detect      |
|  [4]  | CI platform          |  S4   | GH Actions / GitLab — annotations, collapsible      |
|  [5]  | Async log shipping   |  S5   | High-throughput — coprocess sink, FD rotation       |
|  [6]  | Context propagation  |  S6   | Distributed tracing — correlation, OTEL traceparent |
|  [7]  | Fork-free emission   |  S7   | Bash 5.3+ — zero-fork timestamps, elapsed timing    |

---
## [1][JSON_ND_STRUCTURED_LOGGING]
>**Dictum:** *Machine-first format enables aggregation; human rendering is a presentation concern.*

<br>

`jq -nc` with `--arg`/`--argjson` — injection-safe. `printf`-based JSON only for fixed-schema, program-controlled values. `_LOG_FD` defaults to stderr because container runtimes capture stderr independently — preserves stdout as a clean data channel for pipeline composition. `_ts` centralizes timestamp generation with a fork-free path on Bash 5.3+ (see S7).

```bash
# Caller context via FUNCNAME[2]/BASH_LINENO[1] (through _log -> _json_log -> caller)
_LOG_FD="${_LOG_FD:-2}"

# _ts defined in S7 — version-gated fork-free timestamp, sets REPLY

_json_log() {
    local -r level="$1" code="$2"; shift 2
    _ts; local -r ts_full="${REPLY}"
    jq -nc \
        --arg ts "${ts_full}" --arg level "${level}" --argjson code "${code}" \
        --arg fn "${FUNCNAME[2]:-main}" --argjson line "${BASH_LINENO[1]:-0}" \
        --arg msg "$*" \
        --arg trace_id "${TRACE_ID:-}" --arg span_id "${SPAN_ID:-}" \
        '{ ts:$ts, level:$level, code:$code, fn:$fn, line:$line, msg:$msg }
         | if $trace_id != "" then . + {trace_id:$trace_id, span_id:$span_id} else . end' \
        >&"${_LOG_FD}"
}

_json_log_fields() {
    local -r level="$1" code="$2"; shift 2
    local -r msg="$1"; shift
    local -n _fields=$1
    _ts; local -r ts_full="${REPLY}"
    local -a jq_args=(--arg ts "${ts_full}" --arg level "${level}" --argjson code "${code}"
        --arg fn "${FUNCNAME[2]:-main}" --argjson line "${BASH_LINENO[1]:-0}" --arg msg "${msg}")
    local filter='{ ts:$ts, level:$level, code:$code, fn:$fn, line:$line, msg:$msg }'
    local -i idx=0
    local key; for key in "${!_fields[@]}"; do
        jq_args+=(--arg "fk${idx}" "${key}" --arg "fv${idx}" "${_fields[${key}]}")
        filter+=" | . + {(\$fk${idx}): \$fv${idx}}"
        (( idx++ ))
    done
    jq -nc "${jq_args[@]}" "${filter}" >&"${_LOG_FD}"
}

# Usage: structured fields with safe serialization
declare -A ctx=([host]="$(hostname -s)" [pid]="$$" [deploy]="canary")
_json_log_fields INFO 0 "Service started" ctx

# High-cardinality: nested/pre-serialized JSON payloads
_json_log_rich() {
    local -r level="$1"; shift
    _ts; local -r ts_full="${REPLY}"
    jq -nc --arg ts "${ts_full}" --arg level "${level}" \
        --arg fn "${FUNCNAME[2]:-main}" --argjson line "${BASH_LINENO[1]:-0}" \
        --arg msg "$1" --argjson data "${2:-null}" \
        '{ts:$ts,level:$level,fn:$fn,line:$line,msg:$msg,data:$data}' >&"${_LOG_FD}"
}
```

All emitters write a single atomic line via `jq -nc` — prevents interleaved partial writes. EPOCHREALTIME precision owned by version-features.md S4. jq 1.8+: `if` without `else` defaults to identity; `trim`/`ltrim`/`rtrim` replace regex-based cleanup.

---
## [2][LEVEL_GATED_DISPATCH]
>**Dictum:** *Numeric level comparison outperforms string matching and enables arithmetic gating.*

<br>

```bash
declare -Ar _LOG_LEVELS=([TRACE]=0 [DEBUG]=1 [INFO]=2 [WARN]=3 [ERROR]=4 [FATAL]=5)
declare -i LOG_LEVEL="${_LOG_LEVELS[${LOG_LEVEL_NAME:-INFO}]:-2}"

readonly _LOG_MODE="${LOG_FORMAT:-text}"

_log_text_emit() {
    local -r level="$1"; shift
    _ts; printf '%-7s %s [%s:%d] %s\n' \
        "[${level}]" "${REPLY}" "${FUNCNAME[3]:-main}" "${BASH_LINENO[2]:-0}" "$*" >&2
}
declare -Ar _LOG_EMIT=([json]=_json_log [text]=_log_text_emit)
readonly _LOG_EMITTER="${_LOG_EMIT[${_LOG_MODE}]:-_log_text_emit}"

_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-4} >= LOG_LEVEL )) || return 0
    "${_LOG_EMITTER}" "${level}" "${_LOG_LEVELS[${level}]}" "$@"
}
# Level wrappers — stderr for WARN+ (convention: stdout is data, stderr is diagnostics)
_trace() { _log TRACE "$@"; }
_debug() { _log DEBUG "$@"; }
_info()  { _log INFO "$@"; }
_warn()  { _log WARN "$@"; }
_err()   { _log ERROR "$@"; }
_fatal() { _log FATAL "$@"; exit 1; }
_die()   { _err "$@"; exit "${EX_ERR:-1}"; }
# Conditional verbose: gate entire blocks without per-line checks
_verbose() { (( LOG_LEVEL <= ${_LOG_LEVELS[DEBUG]} )) && "$@"; }
# Scoped level override: temporarily lower threshold for diagnostic sections
_with_level() {
    local -r saved="${LOG_LEVEL}" target="${_LOG_LEVELS[${1}]:-${LOG_LEVEL}}"
    shift; LOG_LEVEL="${target}"; "$@"; LOG_LEVEL="${saved}"
}
# Usage: _with_level DEBUG expensive_diagnostic_routine
```

`_LOG_EMITTER` resolves once at startup — zero branching per call. `_with_level` enables diagnostic sections without global level mutation.

---
## [3][TERMINAL_CAPABILITY]
>**Dictum:** *NO_COLOR compliance and capability detection prevent garbled output in non-terminal contexts.*

<br>

Three-tier detection: (1) `NO_COLOR` env (no-color.org), (2) FD test (`-t 2`), (3) `tput colors`. CI platforms support ANSI without TTY.

```bash
# NO_COLOR spec: if set (any value including empty), disable all color
_init_color() {
    local -r _nc="${NO_COLOR+set}"
    local -r _ci="${CI:-}${GITHUB_ACTIONS:-}${GITLAB_CI:-}${BUILDKITE:-}"
    local -r _tty_out="$( [[ -t 1 ]] && printf '1' || printf '0' )"
    local -r _tty_err="$( [[ -t 2 ]] && printf '1' || printf '0' )"
    local -i _depth=0
    (( _tty_err )) && _depth="$(tput colors 2>/dev/null || printf '0')"
    local _enabled=0
    [[ -z "${_nc}" ]] && { (( _tty_err )) || [[ -n "${_ci}" ]]; } \
        && (( _depth >= 8 || ${#_ci} > 0 )) && _enabled=1
    # FORCE_COLOR (force-color.org): levels 1=16, 2=256, 3=truecolor
    # FORCE_COLOR=0 is ambiguous (chalk treats as "no color") — treat as NO_COLOR for safety
    [[ -n "${FORCE_COLOR:-}" ]] && [[ "${FORCE_COLOR}" != "0" ]] && _enabled=1
    # Empty strings when disabled — zero-cost in printf
    (( _enabled )) && {
        readonly _C_RESET=$'\033[0m' _C_BOLD=$'\033[1m' _C_DIM=$'\033[2m'
        readonly _C_RED=$'\033[0;31m' _C_GREEN=$'\033[0;32m'
        readonly _C_YELLOW=$'\033[1;33m' _C_BLUE=$'\033[0;34m' _C_CYAN=$'\033[0;36m'
    } || {
        readonly _C_RESET="" _C_BOLD="" _C_DIM=""
        readonly _C_RED="" _C_GREEN="" _C_YELLOW="" _C_BLUE="" _C_CYAN=""
    }
}
_init_color

# Pre-computed ANSI + marker — zero string operations per log call
declare -Ar _LEVEL_STYLE=(
    [TRACE]="${_C_DIM}[TRACE]${_C_RESET}"
    [DEBUG]="${_C_BLUE}[DEBUG]${_C_RESET}"
    [INFO]="${_C_GREEN}[INFO] ${_C_RESET}"
    [WARN]="${_C_YELLOW}[WARN] ${_C_RESET}"
    [ERROR]="${_C_RED}[ERROR]${_C_RESET}"
    [FATAL]="${_C_RED}${_C_BOLD}[FATAL]${_C_RESET}"
)
_log_text() {
    local -r level="$1"; shift
    local ts; printf -v ts '%(%F %T)T' -1
    printf '%s %s [%s:%d] %s\n' \
        "${_LEVEL_STYLE[${level}]:-[${level}]}" "${ts}" \
        "${FUNCNAME[3]:-main}" "${BASH_LINENO[2]:-0}" "$*" >&2
}
```

`NO_COLOR+set` tests existence not value — spec mandates any value (including empty) disables color. CI enables ANSI without TTY because log viewers render it natively.

---
## [4][CI_PLATFORM_INTEGRATION]
>**Dictum:** *Platform-polymorphic grouping adapts output to the CI environment without caller awareness.*

<br>

Platform resolved once at startup. `case/esac` retained for genuine glob-pattern matching, not if/elif routing.

```bash
readonly _CI_PLATFORM="$(
    [[ -n "${GITHUB_ACTIONS:-}" ]] && printf 'github' \
    || { [[ -n "${GITLAB_CI:-}" ]] && printf 'gitlab'; } \
    || { [[ -n "${BUILDKITE:-}" ]] && printf 'buildkite'; } \
    || printf 'plain'
)"
_section_open() {
    local -r key="$1" label="${2:-$1}"
    case "${_CI_PLATFORM}" in
        github)    printf '::group::%s\n' "${label}" ;;
        gitlab)    printf '\e[0Ksection_start:%s:%s[collapsed=true]\r\e[0K%s\n' \
                       "${EPOCHSECONDS}" "${key}" "${label}" ;;
        buildkite) printf '--- %s\n' "${label}" ;;
        *)         printf '\n%s=== %s ===%s\n' "${_C_BOLD}" "${label}" "${_C_RESET}" ;;
    esac
}
_section_close() {
    local -r key="$1"
    case "${_CI_PLATFORM}" in
        github)    printf '::endgroup::\n' ;;
        gitlab)    printf '\e[0Ksection_end:%s:%s\r\e[0K\n' "${EPOCHSECONDS}" "${key}" ;;
        buildkite) ;; # Buildkite sections auto-close on next `---` or job end
        *)         ;;
    esac
}
# Exception-safe: open, execute, close — return code propagates
_with_section() {
    local -r key="$1" label="${2:-$1}"; shift 2
    _section_open "${key}" "${label}"
    local -i rc=0; "$@" || rc=$?
    _section_close "${key}"
    return "${rc}"
}
declare -Ar _GH_ANNOTATION=([WARN]="warning" [ERROR]="error" [INFO]="notice")
_annotate() {
    local -r level="$1"; shift
    [[ "${_CI_PLATFORM}" == "github" ]] && [[ -v _GH_ANNOTATION["${level}"] ]] && {
        local -r type="${_GH_ANNOTATION[${level}]}"
        local -r file="${BASH_SOURCE[2]:-}" line="${BASH_LINENO[1]:-}"
        [[ -n "${file}" ]] \
            && printf '::%s file=%s,line=%s::%s\n' "${type}" "${file}" "${line}" "$*" \
            || printf '::%s::%s\n' "${type}" "$*"
    }
    # Buildkite persistent annotations — survives log truncation
    [[ "${_CI_PLATFORM}" == "buildkite" ]] && [[ -v _GH_ANNOTATION["${level}"] ]] && \
        buildkite-agent annotate --style "${_GH_ANNOTATION[${level}]}" "$*" \
            --context "${FUNCNAME[2]:-}" 2>/dev/null
}
_step_start() { printf '%s[*]%s %s... ' "${_C_CYAN}" "${_C_RESET}" "$1"; }
_step_pass()  { printf '%s[PASS]%s\n' "${_C_GREEN}" "${_C_RESET}"; }
_step_fail()  { printf '%s[FAIL]%s\n' "${_C_RED}" "${_C_RESET}"; }
_step_skip()  { printf '%s[SKIP]%s\n' "${_C_YELLOW}" "${_C_RESET}"; }
# Job summary: append Markdown to $GITHUB_STEP_SUMMARY (1 MiB/step cap)
_summary() {
    [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && printf '%s\n' "$@" >> "${GITHUB_STEP_SUMMARY}"
}
_summary_table() {
    local -r header="$1"; shift
    _summary "### ${header}" "| Key | Value |" "| --- | --- |"
    local kv; for kv in "$@"; do _summary "| ${kv%%=*} | ${kv#*=} |"; done
}
```

`_annotate` fires on GitHub Actions and Buildkite for mapped levels. `_summary` writes to `$GITHUB_STEP_SUMMARY` for persistent Markdown output.

---
## [5][ASYNC_LOG_SHIPPING]
>**Dictum:** *Coprocess sinks decouple log emission from log persistence.*

<br>

```bash
# NOTE: while-read is intentional here — streaming consumer, not collection
_start_log_sink() {
    local -r dest="${1:?destination required}"
    coproc _LOG_SINK {
        local -r batch_size=100
        local -a buffer=(); local -i count=0
        while IFS= read -r -t 1 line; do
            buffer+=("${line}"); (( ++count ))
            (( count >= batch_size )) && {
                printf '%s\n' "${buffer[@]}" >> "${dest}"
                buffer=(); count=0
            }
        done
        # Flush remainder on pipe close
        (( count > 0 )) && printf '%s\n' "${buffer[@]}" >> "${dest}"
    }
    readonly _LOG_SINK_FD="${_LOG_SINK[1]}"
}
_start_log_sink "/var/log/app/structured.jsonl"
_LOG_FD="${_LOG_SINK_FD}"
# SIGUSR1 reopens the log file — kernel resolves new inode after external rotation
_log_dest="/var/log/app/script.log"
exec {_ROTATE_FD}>"${_log_dest}"
_rotate_handler() {
    exec {_ROTATE_FD}>&-
    exec {_ROTATE_FD}>"${_log_dest}"
    _info "Log rotated: ${_log_dest}"
}
trap _rotate_handler USR1
# Dual-channel: JSON to coprocess (machine), colored text to stderr (human)
_log_dual() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-4} >= LOG_LEVEL )) || return 0
    _json_log "${level}" "${_LOG_LEVELS[${level}]}" "$@"
    _log_text "${level}" "$@"
}
```

Batch buffering (100 lines or 1s timeout) amortizes syscalls. Shipping alternatives:

| [METHOD]              | [COMMAND]                                                              | [TRADEOFF]                    |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| Direct OTLP           | `curl -s -X POST "${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs" -d @payload` | Simple; one fork per batch    |
| Fluent Bit stdin pipe | `script.sh \| fluent-bit -i stdin -o <output>`                         | Zero-change to emitters       |
| syslog (Linux)        | `logger -t "${SCRIPT_NAME}" --sd-id meta@0 "key=val"`                  | Zero-fork on Linux via socket |

---
## [6][CONTEXT_PROPAGATION]
>**Dictum:** *Correlation identifiers thread causality through distributed bash pipelines.*

<br>

`_init_trace` is the canonical owner of TRACEPARENT generation — version-features.md S4 references this file. `TRACEPARENT` propagates through `exec` and subshell boundaries via `export`.

```bash
_corr_hi="" _corr_lo=""
printf -v _corr_hi '%08x' "${SRANDOM}"
printf -v _corr_lo '%08x' "${SRANDOM}"
readonly CORRELATION_ID="${CORRELATION_ID:-${_corr_hi}${_corr_lo}}"
export CORRELATION_ID
# Format: version-trace_id-span_id-flags (e.g., 00-abc...-def...-01)
_parse_traceparent() {
    local -r tp="${TRACEPARENT:-}"
    [[ "${tp}" =~ ^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$ ]] || return 1
    TRACE_ID="${BASH_REMATCH[2]}"
    SPAN_ID="${BASH_REMATCH[3]}"
    TRACE_FLAGS="${BASH_REMATCH[4]}"
}
_new_span() {
    PARENT_SPAN_ID="${SPAN_ID:-}"
    printf -v SPAN_ID '%08x%08x' "${SRANDOM}" "${SRANDOM}"
    [[ -n "${TRACE_ID:-}" ]] && \
        export TRACEPARENT="00-${TRACE_ID}-${SPAN_ID}-${TRACE_FLAGS:-01}"
}
# Canonical owner of trace context initialization — sibling files reference here
_init_trace() {
    _parse_traceparent || {
        printf -v TRACE_ID '%08x%08x%08x%08x' "${SRANDOM}" "${SRANDOM}" "${SRANDOM}" "${SRANDOM}"
        printf -v SPAN_ID '%08x%08x' "${SRANDOM}" "${SRANDOM}"
        TRACE_FLAGS="01"
        export TRACEPARENT="00-${TRACE_ID}-${SPAN_ID}-${TRACE_FLAGS}"
    }
    export TRACE_ID SPAN_ID TRACE_FLAGS
}
_span_start() {
    local -r name="$1"
    _new_span
    _ts; local -r ts_full="${REPLY}"
    # BASH_MONOSECONDS captured at start — elapsed computed at span_end (see S7)
    local -r mono_start="${BASH_MONOSECONDS:-}"
    jq -nc --arg event "span.start" --arg name "${name}" \
        --arg trace_id "${TRACE_ID}" --arg span_id "${SPAN_ID}" \
        --arg parent_span_id "${PARENT_SPAN_ID:-}" --arg ts "${ts_full}" \
        '{event:$event,name:$name,trace_id:$trace_id,span_id:$span_id,parent_span_id:$parent_span_id,ts:$ts}' \
        >&"${_LOG_FD}"
    printf -v "_SPAN_MONO_${SPAN_ID//-/_}" '%s' "${mono_start}"
}
_span_end() {
    local -r name="$1" rc="${2:-0}"
    _ts; local -r ts_full="${REPLY}"
    local -r mono_var="_SPAN_MONO_${SPAN_ID//-/_}"
    local elapsed_ms=""
    [[ -n "${BASH_MONOSECONDS:-}" ]] && [[ -n "${!mono_var:-}" ]] && \
        elapsed_ms="$(( BASH_MONOSECONDS - ${!mono_var} ))"
    jq -nc --arg event "span.end" --arg name "${name}" \
        --arg trace_id "${TRACE_ID}" --arg span_id "${SPAN_ID}" \
        --argjson status "${rc}" --arg ts "${ts_full}" \
        --arg elapsed_ms "${elapsed_ms}" \
        '{event:$event,name:$name,trace_id:$trace_id,span_id:$span_id,status:$status,ts:$ts}
         | if $elapsed_ms != "" then . + {elapsed_ms:($elapsed_ms|tonumber)} else . end' \
        >&"${_LOG_FD}"
    unset "${mono_var}"
    SPAN_ID="${PARENT_SPAN_ID:-${SPAN_ID}}"
}
_with_span() {
    local -r name="$1"; shift
    _span_start "${name}"
    local -i rc=0; "$@" || rc=$?
    _span_end "${name}" "${rc}"
    return "${rc}"
}
# Usage: _with_span "deploy.build" make -j4 artifacts
# Nesting: _with_span "deploy" _with_span "deploy.build" make
```

`SRANDOM` provides unpredictable span IDs (version-features.md S4). `_with_span` composes with `_with_section` (S4). `BASH_MONOSECONDS` in `_span_end` is immune to NTP drift — `EPOCHREALTIME` arithmetic breaks on clock adjustment. OTLP export: `otel-cli exec -- cmd` (equinix-labs) or `opentelemetry-bash` (Thoth v3.43+, auto-instrumentation).

---
## [7][FORK_FREE_EMISSION]
>**Dictum:** *Every `$()` in a hot loop is a fork+exec. Bash 5.3 eliminates the fork; loadable builtins eliminate the exec.*

<br>

At 10K log lines, forking `date` per line (~3ms/fork on Linux) costs ~30s wall time. Three techniques eliminate this: `${ cmd; }` (5.3, no subshell), `BASH_MONOSECONDS` (monotonic elapsed timing), loadable `strftime` (fork-free formatting).

```bash
# Version-gated _ts: fork-free on 5.3+, subshell fallback on 5.2
# shellcheck disable=SC2083
(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] >= 503 )) && \
    _ts() { REPLY=${ printf '%(%FT%T%z)T' -1; }; } || \
    _ts() {
        local _s _u
        printf -v _s '%(%Y-%m-%dT%H:%M:%S)T' -1
        printf -v _u '%.6f' "${EPOCHREALTIME}"
        REPLY="${_s}.${_u#*.}$(printf '%(%z)T' -1)"
    }
# BASH_MONOSECONDS: monotonic ms clock — immune to NTP drift, only deltas meaningful
_perf_log() {
    local -r label="$1" start_mono="$2"
    _info "${label}: $(( BASH_MONOSECONDS - start_mono ))ms"
}
# Usage: local -ir t0="${BASH_MONOSECONDS}"; work; _perf_log "work" "${t0}"
# Loadable strftime: fork-free via enable -f, degrades gracefully
_init_strftime() {
    local -r loadable_dir="${BASH_LOADABLES_PATH:-/usr/lib/bash}"
    [[ -f "${loadable_dir}/strftime" ]] && enable -f "${loadable_dir}/strftime" strftime \
        && _ts() { strftime -v REPLY '%Y-%m-%dT%H:%M:%S%z' -1; } \
        && return 0
    return 1
}
# Precedence at startup: loadable strftime > ${ ; } (5.3) > $(printf) fallback
```

`${ cmd; }` requires space after `{` and `;` before `}` — omitting either is a parse error. ShellCheck 0.10.x does not parse this syntax. `_init_strftime` redefines `_ts` if the loadable is available — call at startup before first log emission.

---
## [RULES]

- JSON serialization: `jq -nc` with `--arg`/`--argjson` for all structured output — `printf`-based JSON only for fixed-schema, program-controlled values.
- `_LOG_FD` indirection for all emitters — enables coprocess, file, and dual-channel output without modifying callers. Stderr default because container runtimes capture stdout/stderr independently.
- Numeric level comparison via `(( ))` — NEVER string comparison for level gating.
- Output mode dispatch via function-reference table (`_LOG_EMIT`) — NEVER `case/esac` for format routing.
- Caller context via `FUNCNAME`/`BASH_LINENO` with frame offset (variable-features.md S1). NO_COLOR: `${NO_COLOR+set}` tests existence. FORCE_COLOR re-enables; `FORCE_COLOR=0` treated as NO_COLOR.
- CI platform detection once at startup via `_CI_PLATFORM` — NEVER per-call environment checks.
- `_with_section` for exception-safe section open/close — NEVER unmatched open/close pairs.
- Coprocess sinks for high-throughput logging — batch buffer with `read -t` timeout flush.
- `TRACEPARENT`/`CORRELATION_ID` propagation via `export` — child processes inherit through `exec`. `CORRELATION_ID` via `printf -v`, NEVER `$(printf ...)`.
- SIGUSR1 for log rotation — reopen FD after external tool moves the file, no process restart.
- Dual-channel (`_log_dual`): JSON to coprocess for aggregation, colored text to stderr for operator visibility.
- Fork-free timestamp via `_ts` helper — version-gated: loadable `strftime` > `${ ; }` (5.3+) > `printf -v` fallback. `${ cmd; }` requires space after `{` and `;` before `}`.
- `BASH_MONOSECONDS` for elapsed timing — NEVER `EPOCHREALTIME` arithmetic for duration measurement (NTP drift breaks deltas).
- Sibling file contracts: version-features.md references this file for TRACEPARENT generation and S7 for fork-free patterns; variable-features.md references S3 for terminal capability.
