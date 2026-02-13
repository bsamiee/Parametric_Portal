#!/usr/bin/env bash
#
# Script Name: SCRIPT_NAME
# Description: Brief description
# Usage: SCRIPT_NAME [OPTIONS] ARGUMENTS
#
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
# shellcheck disable=SC2034
readonly VERSION="1.0.0"
# shellcheck disable=SC2034
readonly SCRIPT_DIR
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
VERBOSE=false
DRY_RUN=false
LOG_LEVEL=1  # 0=DEBUG 1=INFO 2=WARN 3=ERROR

# --- [ERRORS] -----------------------------------------------------------------

declare -Ar _LOG_THRESHOLDS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_log() {
    local -r level="$1"; shift
    (( LOG_LEVEL <= ${_LOG_THRESHOLDS[${level}]:-3} )) || return 0
    local ts; printf -v ts '%(%F %T)T' -1
    printf '[%-5s] %s %s\n' "${level}" "${ts}" "$*" >&2
}
_info()  { _log INFO "$@"; }
_warn()  { _log WARN "$@"; }
_err()   { LOG_LEVEL=0 _log ERROR "$@"; }
_ok()    { _log INFO "$@"; }
die()    { _err "$@"; exit 1; }

# --- [FUNCTIONS] --------------------------------------------------------------

_cleanup() {
    local -r rc=$?
    [[ -d "${WORK_DIR:-}" ]] && rm -rf "${WORK_DIR}"
    exit "${rc}"
}
_usage() { printf '%s\n' \
    "Usage: ${SCRIPT_NAME} [OPTIONS] [ARGUMENTS]" \
    "Options:" \
    "    -h, --help      Show help" \
    "    -v, --verbose   Verbose output" \
    "    -d, --debug     Debug mode" \
    "    -n, --dry-run   Dry run" \
    "Examples:" \
    "    ${SCRIPT_NAME} -v file.txt" \
    "    ${SCRIPT_NAME} --dry-run input.txt output.txt"; }
_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)    _usage; exit 0 ;;
            -v|--verbose) VERBOSE=true; shift ;;
            -d|--debug)   LOG_LEVEL=0; VERBOSE=true; shift ;;
            -n|--dry-run) DRY_RUN=true; shift ;;
            -*)           die "Unknown option: $1" ;;
            *)            break ;;
        esac
    done
    # shellcheck disable=SC2034
    ARGS=("$@")
}

# --- [EXPORT] -----------------------------------------------------------------

trap _cleanup EXIT
_main() {
    _parse_args "$@"
    # shellcheck disable=SC2034
    readonly VERBOSE DRY_RUN LOG_LEVEL
    WORK_DIR="$(mktemp -d)"; readonly WORK_DIR
    _info "Starting ${SCRIPT_NAME}..."
    # --- Main logic goes here ---
    _info "Completed successfully"
}
_main "$@"
