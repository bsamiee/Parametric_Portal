#!/usr/bin/env bash
#
# service-wrapper.sh — Container entrypoint: BASH_TRAPSIG dispatch, monotonic health, coproc monitor
# Usage: service-wrapper.sh [--self-test] [--drain-sec N] [--pid-file PATH] -- COMMAND [ARGS...]
#
set -Eeuo pipefail
shopt -s inherit_errexit nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

# shellcheck disable=SC2034
readonly VERSION="2.0.0" EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}" _LOG_FD="${_LOG_FD:-2}"
readonly _BASH_V=$(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] ))
(( _BASH_V >= 503 )) || { printf 'Requires bash 5.3+, found %s\n' "${BASH_VERSION}" >&2; exit 1; }
declare _HAS_SLEEP_BUILTIN
_HAS_SLEEP_BUILTIN="$(enable -f "${BASH_LOADABLES_PATH:-/usr/lib/bash}/sleep" sleep 2>/dev/null \
    && printf '1' || printf '0')"
readonly _HAS_SLEEP_BUILTIN
declare -Ar _ENV_CONTRACT=([SERVICE_NAME]='^[a-zA-Z][a-zA-Z0-9_-]+$')
declare -Ar _LOG_LEVELS=([TRACE]=0 [DEBUG]=1 [INFO]=2 [WARN]=3 [ERROR]=4 [FATAL]=5)
DRAIN_SEC=30 PID_FILE="" SERVICE_ARGS=() LOG_LEVEL=2 _CHILD_PID=0
declare -a _CLEANUP_STACK=()
declare -i _CLEANING=0 _DRAINING=0
TRACE_ID="" SPAN_ID="" TRACE_FLAGS=""

# --- [LOGGING] ----------------------------------------------------------------

# shellcheck disable=SC2083
_ts() { REPLY=${ printf '%(%FT%T%z)T' -1; }; }
readonly _LOG_MODE="${LOG_FORMAT:-json}"
_json_emit() {
    local -r level="$1" code="$2"; shift 2; _ts
    jq -nc --arg ts "${REPLY}" --arg level "${level}" --argjson code "${code}" \
        --arg fn "${FUNCNAME[2]:-main}" --argjson line "${BASH_LINENO[1]:-0}" \
        --arg msg "$*" --arg tid "${TRACE_ID:-}" --arg sid "${SPAN_ID:-}" \
        '{ts:$ts,level:$level,code:$code,fn:$fn,line:$line,msg:$msg}
         | if $tid != "" then . + {trace_id:$tid,span_id:$sid} else . end' >&"${_LOG_FD}"
}
_text_emit() {
    local -r level="$1"; shift; _ts
    printf '%-7s %s [%s:%d] %s\n' "[${level}]" "${REPLY}" \
        "${FUNCNAME[3]:-main}" "${BASH_LINENO[2]:-0}" "$*" >&2
}
declare -Ar _LOG_EMIT=([json]=_json_emit [text]=_text_emit)
readonly _LOG_EMITTER="${_LOG_EMIT[${_LOG_MODE}]:-_text_emit}"
_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-4} >= LOG_LEVEL )) || return 0
    "${_LOG_EMITTER}" "${level}" "${_LOG_LEVELS[${level}]}" "$@"
}
_debug() { _log DEBUG "$@"; }; _info()  { _log INFO "$@";  }
_warn()  { _log WARN "$@";  }; _err()   { _log ERROR "$@"; }
_fatal() { _log FATAL "$@"; exit "${EX_ERR}"; }; _die() { _err "$@"; exit "${EX_ERR}"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_register_cleanup() { _CLEANUP_STACK+=("$1"); }
_run_cleanups() {
    (( _CLEANING )) && return; _CLEANING=1; local -i i
    # Paradigm exception: LIFO traversal — bash lacks higher-order array iteration
    for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[i]}" 2>/dev/null || true; done
}
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"; local -i i
    _err "Command failed (rc=${rc}): ${cmd}"
    for (( i = 1; i < depth; i++ )); do
        _err "  at ${BASH_SOURCE[${i}]:-?}:${BASH_LINENO[i-1]:-?} in ${FUNCNAME[${i}]:-main}"; done
}
_init_trace() {
    [[ "${TRACEPARENT:-}" =~ ^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$ ]] && {
        TRACE_ID="${BASH_REMATCH[2]}"; SPAN_ID="${BASH_REMATCH[3]}"
        TRACE_FLAGS="${BASH_REMATCH[4]}"; return 0; }
    printf -v TRACE_ID '%08x%08x%08x%08x' "${SRANDOM}" "${SRANDOM}" "${SRANDOM}" "${SRANDOM}"
    printf -v SPAN_ID '%08x%08x' "${SRANDOM}" "${SRANDOM}"
    TRACE_FLAGS="01"; export TRACEPARENT="00-${TRACE_ID}-${SPAN_ID}-${TRACE_FLAGS}"
    export TRACE_ID SPAN_ID TRACE_FLAGS; }
_validate_env() {
    local var pattern
    # Paradigm exception: bash lacks higher-order array iteration primitives
    for var in "${!_ENV_CONTRACT[@]}"; do
        pattern="${_ENV_CONTRACT[${var}]}"
        [[ -v "${var}" ]] || _die "Missing required env: ${var}"
        [[ "${!var}" =~ ${pattern} ]] || _die "Invalid ${var}='${!var}' (expected: ${pattern})"
    done; _info "Env contract validated"; }
_acquire_pidfile() {
    [[ -z "$1" ]] && return 0; local -r path="$1"
    exec {_LOCK_FD}>"${path}"
    flock -n "${_LOCK_FD}" || _die "Already running (pidfile: ${path})"
    printf '%d\n' "$$" >&"${_LOCK_FD}"
    _register_cleanup "exec ${_LOCK_FD}>&-; rm -f '${path}'"
    _info "PID file acquired: ${path} (pid=$$)"; }
# Coproc: persistent health-check subprocess — monotonic uptime via BASH_MONOSECONDS
_start_health_coproc() {
    # shellcheck disable=SC2034
    coproc HEALTH {
        local -r boot="${BASH_MONOSECONDS}"
        # NOTE: while-read is intentional — streaming consumer, not collection
        while IFS= read -r _; do
            printf '{"status":"healthy","pid":%d,"uptime_s":%d}\n' \
                "$$" "$(( BASH_MONOSECONDS - boot ))"; done
    }
    _register_cleanup "kill ${HEALTH_PID} 2>/dev/null || true"
    _info "Health coproc started (pid=${HEALTH_PID})"; }
_health_query() {
    local -r t0="${BASH_MONOSECONDS}"; printf 'ping\n' >&"${HEALTH[1]}"
    local reply=""; IFS= read -r -t 2 reply <&"${HEALTH[0]}" || {
        _warn "Health coproc stalled ($(( BASH_MONOSECONDS - t0 ))s)"; return 1; }
    printf '%s\n' "${reply}"
}
# BASH_TRAPSIG dispatch — single handler, signal-number differentiated actions
# SIGTERM(15)→drain, SIGHUP(1)→reload, SIGINT(2)→fast-exit, SIGUSR1(10)→status
declare -Ar _SIG_ACTIONS=([15]=_drain [1]=_reload [2]=_fast_exit [10]=_status_dump)
declare -Ar _SIG_NAMES=([15]=TERM [1]=HUP [2]=INT [10]=USR1)
declare -Ar _SIG_EXITS=([15]=143 [1]=0 [2]=130 [10]=0)
_drain() {
    (( _DRAINING )) && return; _DRAINING=1
    local -r deadline=$(( BASH_MONOSECONDS + DRAIN_SEC ))
    _info "Draining (grace=${DRAIN_SEC}s, mono_deadline=${deadline})"
    (( _CHILD_PID > 0 )) && kill -TERM "${_CHILD_PID}" 2>/dev/null || true
    # Loadable sleep avoids fork per poll; falls back to external sleep
    local -r slp="$( (( _HAS_SLEEP_BUILTIN )) && printf 'sleep' || printf 'command sleep' )"
    # Paradigm exception: polling requires mutable iteration
    while (( _CHILD_PID > 0 && BASH_MONOSECONDS < deadline )); do
        kill -0 "${_CHILD_PID}" 2>/dev/null || { _CHILD_PID=0; break; }
        ${slp} 0.5; done
    (( _CHILD_PID > 0 )) && {
        _warn "Drain timeout — SIGKILL"; kill -KILL "${_CHILD_PID}" 2>/dev/null || true; }
}
_reload()      { _info "Reload — re-validating env"; _validate_env; }
_fast_exit()   { (( _CHILD_PID > 0 )) && kill -TERM "${_CHILD_PID}" 2>/dev/null || true; }
_status_dump() { _health_query 2>/dev/null || _warn "Health query failed"; }
# Unified signal handler — dispatches on BASH_TRAPSIG (5.3)
_on_signal() {
    local -r sig="${BASH_TRAPSIG}"
    _info "Signal ${sig} (${_SIG_NAMES[${sig}]:-?}) received"
    "${_SIG_ACTIONS[${sig}]:-_drain}"
    # Non-fatal signals (HUP=1, USR1=10) return without exit
    [[ "${_SIG_EXITS[${sig}]:-}" == "0" ]] && [[ "${sig}" != "2" ]] && return 0
    exit "${_SIG_EXITS[${sig}]:-1}"
}
# Two-phase EXIT: signal handler runs first, then EXIT trap fires _run_cleanups
trap '_on_signal' TERM INT HUP USR1
trap '_run_cleanups' EXIT
trap '_on_err' ERR
# SIGCHLD coalescing — multiple child exits may deliver one signal; drain loop reaps all
trap 'while wait -n 2>/dev/null; do :; done' CHLD
_run_service() {
    "${SERVICE_ARGS[@]}" & _CHILD_PID=$!
    _info "Service started (pid=${_CHILD_PID})"
    _register_cleanup "kill -TERM ${_CHILD_PID} 2>/dev/null || true"
    wait "${_CHILD_PID}" || true; local -r rc=$?; _CHILD_PID=0; return "${rc}"
}

# --- [PARSER] -----------------------------------------------------------------

_usage() {
    printf '%s v%s — Container entrypoint: BASH_TRAPSIG dispatch + monotonic health\n' \
        "${SCRIPT_NAME}" "${VERSION}"
    printf '\nUSAGE: %s [OPTIONS] -- COMMAND [ARGS...]\n\nOPTIONS:\n' "${SCRIPT_NAME}"
    printf '  %-24s %s\n' "--drain-sec N" "Grace period (default: 30)" \
        "--pid-file PATH" "PID file with advisory lock" "--self-test" "Run smoke tests" \
        "-v, --verbose" "Debug logging" "-h, --help" "Show this help"
}
_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)     _usage; exit 0 ;;
            --drain-sec)   DRAIN_SEC="${2:?--drain-sec requires integer}"; shift 2 ;;
            --pid-file)    PID_FILE="${2:?--pid-file requires path}"; shift 2 ;;
            --self-test)   _self_test; exit 0 ;;
            -v|--verbose)  LOG_LEVEL=1; shift ;;
            --)            shift; break ;;
            -*)            _err "Unknown: $1"; exit "${EX_USAGE}" ;;
            *)             break ;;
        esac
    done; SERVICE_ARGS=("$@")
}

# --- [TESTING] ----------------------------------------------------------------

_assert_eq()    { [[ "$1" == "$2" ]] || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${1}' != '${2}'"; }
_assert_match() { [[ "$1" =~ $2 ]]  || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${1}' !~ '${2}'"; }
_assert_set()   { [[ -n "$1" ]]     || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: empty ${2:-var}"; }
_self_test() {
    _info "Running self-tests..."; local -r t0="${BASH_MONOSECONDS}"
    local tp_trace tp_span
    printf -v tp_trace '%032d' 1; printf -v tp_span '%016d' 2
    TRACEPARENT="00-${tp_trace}-${tp_span}-01"; _init_trace
    _assert_eq "${TRACE_ID}" "${tp_trace}"; _assert_eq "${SPAN_ID}" "${tp_span}"
    unset TRACEPARENT TRACE_ID SPAN_ID TRACE_FLAGS; _init_trace
    _assert_set "${TRACE_ID}" "TRACE_ID"; _assert_match "${TRACE_ID}" '^[0-9a-f]{32}$'
    _assert_match "${SPAN_ID}" '^[0-9a-f]{16}$'
    _ts; _assert_set "${REPLY}" "timestamp"; _assert_match "${REPLY}" '^[0-9]{4}-'
    _assert_set "${BASH_MONOSECONDS}" "BASH_MONOSECONDS"
    _assert_set "${BASH_TRAPSIG+defined}" "BASH_TRAPSIG available"
    SERVICE_NAME="test-svc" _validate_env
    _info "All self-tests passed ($(( BASH_MONOSECONDS - t0 ))s monotonic)"
}

# --- [EXPORT] -----------------------------------------------------------------

_main() {
    _init_trace; _parse_args "$@"; readonly LOG_LEVEL DRAIN_SEC PID_FILE
    (( ${#SERVICE_ARGS[@]} > 0 )) || SERVICE_ARGS=("${SERVICE_CMD:?No command. Use -- CMD or set SERVICE_CMD}")
    readonly SERVICE_ARGS; _validate_env; _acquire_pidfile "${PID_FILE}"; _start_health_coproc
    _info "Ready (drain=${DRAIN_SEC}s, bash=${BASH_VERSION}, mono=${BASH_MONOSECONDS})"
    local -i rc=0; _run_service || rc=$?
    (( rc == 0 )) || _fatal "Service exited rc=${rc}"
}
_main "$@"
