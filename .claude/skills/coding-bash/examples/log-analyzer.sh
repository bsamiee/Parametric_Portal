#!/usr/bin/env bash
#
# Script Name: log-analyzer.sh
# Description: Analyze log files — error aggregation and level summary reports
# Usage: log-analyzer.sh [OPTIONS] LOG_FILE
#
set -Eeuo pipefail
shopt -s inherit_errexit
shopt -s nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly VERSION="1.0.0"
readonly EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
# Terminal colors — computed once at startup (ANSI via $'...' = zero forks)
_BOLD="" _DIM="" _RESET=""
[[ -t 2 ]] && (( $(tput colors 2>/dev/null || printf '0') >= 8 )) && {
    _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RESET=$'\033[0m'
}
readonly _BOLD _DIM _RESET
declare -Ar _REPORT_DISPATCH=([errors]=_analyze_errors [summary]=_generate_summary)
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"
    [t]="-t|--type|Report type: errors, summary|TYPE|summary"
    [o]="-o|--output|Output file (default: stdout)|FILE|"
    [v]="-v|--verbose|Show operational info||"
    [d]="-d|--debug|Debug mode||"
)
# Mutable state — frozen after argument parsing in _main
LOG_LEVEL=2  # 0=DEBUG 1=INFO 2=WARN 3=ERROR (default: quiet — report output only)
REPORT_TYPE="summary"
OUTPUT_FILE=""

# --- [LOGGING] ----------------------------------------------------------------

declare -Ar _LOG_LEVELS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-3} >= LOG_LEVEL )) || return 0
    local ts; printf -v ts '%(%F %T)T' -1
    printf '%-7s %s [%s:%d] %s\n' \
        "[${level}]" "${ts}" "${FUNCNAME[2]:-main}" "${BASH_LINENO[1]:-0}" "$*" >&2
}
_debug()    { _log DEBUG "$@"; }
_info()     { _log INFO "$@"; }
_warn()     { _log WARN "$@"; }
_err()      { _log ERROR "$@"; }
die()       { _err "$@"; exit "${EX_ERR}"; }
die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}"
    _err "Command failed (rc=${rc}): ${cmd}"
    _err "  at ${BASH_SOURCE[1]:-unknown}:${BASH_LINENO[0]:-?} in ${FUNCNAME[1]:-main}"
}
_cleanup() {
    local -r rc=$?
    exit "${rc}"
}
write_atomic() {
    local -r dest="$1"; shift
    local tmp
    tmp="$(mktemp "${dest}.tmp.XXXXXX")" || die "mktemp failed"
    "$@" > "${tmp}" || { rm -f "${tmp}"; return 1; }
    mv "${tmp}" "${dest}"
}
_analyze_errors() {
    local -r log_file="$1"
    awk '/ERROR/ {
        msg = $0; sub(/.*ERROR: /, "", msg); sub(/ -.*/, "", msg)
        counts[msg]++; total++
    } END {
        printf "Error Summary\n=============\n"
        for (msg in counts) printf "%6d  %s\n", counts[msg], msg | "sort -rn"
        close("sort -rn")
        printf "\nTotal errors: %d\n", total+0
    }' "${log_file}"
}
_generate_summary() {
    local -r log_file="$1"
    awk '
        /DEBUG/ {debug++} /INFO/ {info++} /WARN/ {warn++} /ERROR/ {error++} /FATAL/ {fatal++}
        END {
            printf "Log File Analysis Summary\n"
            printf "=========================\n"
            printf "File: %s\n", FILENAME
            printf "Total lines: %d\n\n", NR
            printf "Log Levels:\n"
            printf "  %-10s %6d\n", "DEBUG:", debug+0
            printf "  %-10s %6d\n", "INFO:", info+0
            printf "  %-10s %6d\n", "WARN:", warn+0
            printf "  %-10s %6d\n", "ERROR:", error+0
            printf "  %-10s %6d\n", "FATAL:", fatal+0
        }
    ' "${log_file}"
}
_usage() {
    local -r cols="$(tput cols 2>/dev/null || printf '80')"
    local -r pad=$(( cols > 100 ? 28 : 24 ))
    printf '%s%s v%s%s\n' "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}"
    printf '\nAnalyze log files and generate summary reports.\n'
    printf '\n%sUSAGE:%s\n' "${_BOLD}" "${_RESET}"
    printf '  %s [OPTIONS] LOG_FILE\n' "${SCRIPT_NAME}"
    printf '\n%sOPTIONS:%s\n' "${_BOLD}" "${_RESET}"
    local key short long desc value_name default flag
    for key in h t o v d; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}, ${long}"
        [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
    printf '\n%sEXAMPLES:%s\n' "${_BOLD}" "${_RESET}"
    printf '  %s access.log\n' "${SCRIPT_NAME}"
    printf '  %s -t errors app.log\n' "${SCRIPT_NAME}"
    printf '  %s --type summary --output report.txt app.log\n' "${SCRIPT_NAME}"
}
_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)      _usage; exit 0 ;;
            -t|--type)      REPORT_TYPE="${2:?--type requires argument}"; shift 2 ;;
            -o|--output)    OUTPUT_FILE="${2:?--output requires argument}"; shift 2 ;;
            -v|--verbose)   LOG_LEVEL=1; shift ;;
            -d|--debug)     LOG_LEVEL=0; shift ;;
            --self-test)    _self_test; exit 0 ;;
            --)             shift; break ;;
            -*)             die_usage "Unknown option: $1" ;;
            *)              break ;;
        esac
    done
    POSITIONAL_ARGS=("$@")
}

# --- [TESTING] ----------------------------------------------------------------

assert_eq() {
    [[ "$1" == "$2" ]] || die "ASSERT at ${FUNCNAME[1]}:${BASH_LINENO[0]}: expected '${2}' got '${1}'"
}
_self_test() {
    _info "Running self-tests..."
    assert_eq "${SCRIPT_NAME}" "log-analyzer.sh"
    [[ -v _REPORT_DISPATCH[summary] ]] || die "ASSERT: missing summary handler"
    [[ -v _REPORT_DISPATCH[errors] ]]  || die "ASSERT: missing errors handler"
    _info "All tests passed"
}

# --- [EXPORT] -----------------------------------------------------------------

trap _on_err ERR
trap _cleanup EXIT
_main() {
    _parse_args "$@"
    readonly LOG_LEVEL REPORT_TYPE OUTPUT_FILE POSITIONAL_ARGS
    local -r log_file="${POSITIONAL_ARGS[0]:?Error: LOG_FILE required. See --help}"
    [[ -f "${log_file}" ]] || die "Not found: ${log_file}"
    [[ -v _REPORT_DISPATCH["${REPORT_TYPE}"] ]] || die_usage "Invalid report type: ${REPORT_TYPE}. Valid: ${!_REPORT_DISPATCH[*]}"
    local -r handler="${_REPORT_DISPATCH[${REPORT_TYPE}]}"
    _info "Analyzing ${log_file} (type=${REPORT_TYPE})"
    [[ -n "${OUTPUT_FILE}" ]] && {
        write_atomic "${OUTPUT_FILE}" "${handler}" "${log_file}"
        _info "Saved: ${OUTPUT_FILE}"
        return
    }
    "${handler}" "${log_file}"
}
_main "$@"
