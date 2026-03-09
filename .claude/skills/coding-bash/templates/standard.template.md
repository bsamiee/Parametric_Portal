# Standard Foundation Template

Universal chassis for all Bash scripts. Provides strict mode, version gating, color initialization, structured logging with polymorphic emitters, LIFO cleanup registry, ERR/signal traps, metadata-driven usage generation, flag parsing, atomic writes, nameref return stubs, assertion helpers, and self-test mode. Archetype-specific concerns (dispatch tables, verb:resource routing, domain logic) belong in application code, not here.

```bash
#!/usr/bin/env bash
# script-name — Brief purpose description
# Usage: script-name [OPTIONS] [ARGUMENTS]
# shellcheck disable=SC2329  # Functions called via dispatch tables
# shellcheck disable=SC2034  # Convention constants and nameref targets
set -Eeuo pipefail
shopt -s inherit_errexit nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------
readonly VERSION="1.0.0" EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
readonly _BASH_V=$(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] ))
readonly _MIN_BASH_V=502
(( _BASH_V >= _MIN_BASH_V )) || {
    printf 'Bash %d.%d+ required (found %s)\n' \
        "$((_MIN_BASH_V / 100))" "$((_MIN_BASH_V % 100))" "${BASH_VERSION}" >&2
    exit 1
}
(( _BASH_V >= 503 )) && shopt -s array_expand_once
declare -a _CLEANUP_STACK=() POSITIONAL_ARGS=()
declare -i _CLEANING=0 LOG_LEVEL=2

# --- [LOGGING] ----------------------------------------------------------------
_init_color() {
    local -r _nc="${NO_COLOR+set}" _ci="${CI:-}${GITHUB_ACTIONS:-}${GITLAB_CI:-}"
    local -r _tty="$([[ -t 2 ]] && printf '1' || printf '0')"
    local -i _depth=0
    (( _tty )) && _depth="$(tput colors 2>/dev/null || printf '0')"
    local _on=0
    [[ -z "${_nc}" ]] && { (( _tty )) || [[ -n "${_ci}" ]]; } \
        && (( _depth >= 8 || ${#_ci} > 0 )) && _on=1
    [[ -n "${FORCE_COLOR:-}" ]] && [[ "${FORCE_COLOR}" != "0" ]] && _on=1
    local _b="" _d="" _r=""
    (( _on )) && { _b=$'\033[1m'; _d=$'\033[2m'; _r=$'\033[0m'; }
    readonly _C_BOLD="${_b}" _C_DIM="${_d}" _C_RESET="${_r}"
}
_init_color

# shellcheck disable=SC2083
(( _BASH_V >= 503 )) \
    && eval '_ts() { REPLY=${ printf "%(%FT%T%z)T" -1; }; }' \
    || _ts() { printf -v REPLY '%(%FT%T)T' -1; }
[[ -f "${BASH_LOADABLES_PATH:-/usr/lib/bash}/strftime" ]] \
    && enable -f "${BASH_LOADABLES_PATH:-/usr/lib/bash}/strftime" strftime 2>/dev/null \
    && _ts() { strftime -v REPLY '%Y-%m-%dT%H:%M:%S%z' -1; }

declare -Ar _LOG_LEVELS=([TRACE]=0 [DEBUG]=1 [INFO]=2 [WARN]=3 [ERROR]=4 [FATAL]=5)
_log_text_emit() {
    local -r level="$1"; shift; _ts
    printf '%-7s %s [%s:%d] %s\n' \
        "[${level}]" "${REPLY}" "${FUNCNAME[3]:-main}" "${BASH_LINENO[2]:-0}" "$*" >&2
}
_log_json_emit() {
    local -r level="$1"; shift; _ts
    jq -nc --arg ts "${REPLY}" --arg level "${level}" \
        --arg fn "${FUNCNAME[3]:-main}" --argjson line "${BASH_LINENO[2]:-0}" \
        --arg msg "$*" '{ts:$ts,level:$level,fn:$fn,line:$line,msg:$msg}' >&2
}
declare -Ar _LOG_EMIT=([text]=_log_text_emit [json]=_log_json_emit)
readonly _LOG_EMITTER="${_LOG_EMIT[${LOG_FORMAT:-text}]:-_log_text_emit}"
_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-4} >= LOG_LEVEL )) || return 0
    "${_LOG_EMITTER}" "${level}" "$@"
}
_trace() { _log TRACE "$@"; }; _debug() { _log DEBUG "$@"; }
_info()  { _log INFO "$@";  }; _warn()  { _log WARN "$@";  }
_err()   { _log ERROR "$@"; }; _fatal() { _log FATAL "$@"; exit 1; }
_die()       { _err "$@"; exit "${EX_ERR}"; }
_die_usage() { _err "$@"; printf '  See: %s --help\n' "${SCRIPT_NAME}" >&2; exit "${EX_USAGE}"; }

# --- [FUNCTIONS] --------------------------------------------------------------
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"
    printf '\n[ERROR] exit %d: %s\n[STACK]\n' "${rc}" "${cmd}" >&2
    local i; for (( i = 1; i < depth; i++ )); do
        printf '  %d) %s:%d in %s()\n' "${i}" \
            "${BASH_SOURCE[i]:-unknown}" "${BASH_LINENO[i-1]:-?}" "${FUNCNAME[i]:-main}" >&2
    done
}
_register_cleanup() { _CLEANUP_STACK+=("$1"); }
_run_cleanups() {
    (( _CLEANING )) && return; _CLEANING=1
    local i; for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[i]}" 2>/dev/null || true
    done
}
trap '_on_err' ERR
trap '_run_cleanups' EXIT
# Signal handling: BASH_TRAPSIG dispatch on 5.3, per-signal on 5.2
# shellcheck disable=SC2015
(( _BASH_V >= 503 )) && {
    _signal_dispatch() {
        local -Ar _SIG_EXIT=([2]=130 [15]=143 [1]=0)
        _info "Signal ${BASH_TRAPSIG} received"
        exit "${_SIG_EXIT[${BASH_TRAPSIG}]:-1}"
    }
    trap '_signal_dispatch' INT TERM HUP
} || {
    trap 'exit 130' INT
    trap 'exit 143' TERM
}

_write_atomic() {
    local -r dest="$1"; shift
    local -r dir="${dest%/*}"
    local saved_umask; saved_umask="$(umask)"; umask 077
    local tmp; tmp="$(mktemp "${dir:-.}/.tmp.XXXXXX")" || _die "mktemp failed"
    umask "${saved_umask}"
    _register_cleanup "rm -f '${tmp}'"
    "$@" > "${tmp}" || { rm -f "${tmp}"; return 1; }
    mv -f "${tmp}" "${dest}"
}
_nameref_stub() {
    local -n __result=$1
    __result="placeholder"
}
_require() {
    local tool; for tool in "$@"; do
        command -v "${tool}" >/dev/null 2>&1 || _die "Missing dependency: ${tool}"
    done
}

# --- [OPTIONS] ----------------------------------------------------------------
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"         [V]="-V|--version|Show version||"
    [v]="-v|--verbose|Verbose output||" [d]="-d|--debug|Debug mode||"
    [t]="|--self-test|Run smoke tests||"
)
readonly -a _OPT_DISPLAY_ORDER=(h V v d t)
_usage() {
    local -r pad=$(( $(tput cols 2>/dev/null || printf '80') > 100 ? 28 : 24 ))
    printf '%s%s v%s%s\n\n%sUSAGE:%s\n  %s [OPTIONS] [ARGUMENTS]\n\n%sOPTIONS:%s\n' \
        "${_C_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_C_RESET}" \
        "${_C_BOLD}" "${_C_RESET}" "${SCRIPT_NAME}" "${_C_BOLD}" "${_C_RESET}"
    local key short long desc value_name default flag
    for key in "${_OPT_DISPLAY_ORDER[@]}"; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short:+${short}, }${long}"; [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_C_DIM}" "${default}" "${_C_RESET}"
        printf '\n'
    done
}

# --- [PARSER] -----------------------------------------------------------------
_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)    _usage; exit 0 ;;
            -V|--version) printf '%s v%s (bash %s)\n' \
                              "${SCRIPT_NAME}" "${VERSION}" "${BASH_VERSION}"; exit 0 ;;
            -v|--verbose) LOG_LEVEL=1; shift ;;
            -d|--debug)   LOG_LEVEL=0; shift ;;
            --self-test)  _self_test; exit 0 ;;
            --)           shift; break ;;
            -*)           _die_usage "Unknown option: $1" ;;
            *)            break ;;
        esac
    done
    POSITIONAL_ARGS=("$@")
}

# --- [TESTING] ----------------------------------------------------------------
_assert_eq()  { [[ "$1" == "$2" ]] || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${1}' != '${2}'"; }
_assert_set() { [[ -n "$1" ]]     || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: empty ${2:-value}"; }
_self_test() {
    _info "Running self-tests..."
    _assert_set "${SCRIPT_NAME}" "SCRIPT_NAME"
    _assert_eq "${EX_OK}" "0"
    _assert_eq "$(( _BASH_V >= _MIN_BASH_V ))" "1"
    _ts; _assert_set "${REPLY}" "timestamp"
    local val; _nameref_stub val; _assert_eq "${val}" "placeholder"
    local tmp_dir; tmp_dir="$(mktemp -d)"; _register_cleanup "rm -rf '${tmp_dir}'"
    _write_atomic "${tmp_dir}/test.txt" printf '%s' "atomic"
    _assert_eq "$(<"${tmp_dir}/test.txt")" "atomic"
    _info "All tests passed (bash ${BASH_VERSION}, v=${_BASH_V})"
}

# --- [EXPORT] -----------------------------------------------------------------
_main() {
    _parse_args "$@"
    readonly LOG_LEVEL POSITIONAL_ARGS
    umask 077
    _info "${SCRIPT_NAME} v${VERSION} started"
}
_main "$@"
```

## Customization

- **Add domain flags**: one entry in `_OPT_META` + one `case` branch in `_parse_args` per flag. Extend `_OPT_DISPLAY_ORDER` to control help ordering.
- **Dispatch tables**: for CLI tools, add `declare -Ar _DISPATCH`, `_USAGE_MAP`, `_REQUIRED_ARGS` after `[OPTIONS]` and wire `_dispatch()` from `_main`. See `examples/cli-tool.sh` for the two-dimensional verb:resource pattern.
- **Signal forwarding**: for container entrypoints, replace `_signal_dispatch` with a drain + child-forwarding handler. See `examples/service-wrapper.sh` for `BASH_TRAPSIG` dispatch with `_CHILD_PID` tracking.
- **Env contracts**: add `declare -Ar _ENV_CONTRACT=([VAR]='^regex$')` with `_validate_env` in `_main` before core logic. See `SKILL.md` Resources section.
- **Dependency gating**: call `_require jq rg fd` early in `_main` to fail fast on missing tools. Extend with `_TOOL_FALLBACKS` dispatch for graceful degradation.
