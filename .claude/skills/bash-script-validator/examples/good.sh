#!/usr/bin/env bash
# Best practices: strict mode, printf, local -r, $(<file), associative array
# dispatch, trap cleanup, nameref, BASH_REMATCH, mapfile, set-via-assoc-array
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly SCRIPT_DIR
export SCRIPT_DIR
readonly LOG_FILE="${TMPDIR:-/tmp}/good-example-$$.log"

# --- [ERRORS] -----------------------------------------------------------------

declare -Ar _LOG_FORMATS=([info]='[INFO] %s\n' [error]='[ERROR] %s\n' [warn]='[WARN] %s\n')
_log() {
    local -r level="$1"; shift
    # shellcheck disable=SC2059
    printf "${_LOG_FORMATS[${level}]:-[${level^^}] %s\n}" "$*" | tee -a "${LOG_FILE}"
}
_info()  { _log info "$@"; }
_err()   { _log error "$@" >&2; }
_warn()  { _log warn "$@"; }
_ok()    { printf '[OK] %s\n' "$*" | tee -a "${LOG_FILE}"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_cleanup() {
    local -r rc=$?
    _info "Cleaning up..."
    rm -f "${_TEMP_FILE:-}"
    exit "${rc}"
}
_process_file() {
    local -r file="$1"
    [[ -f "${file}" ]] || { _err "File not found: ${file}"; return 1; }
    local -a lines
    mapfile -t lines < "${file}"
    _info "Processing ${file} (${#lines[@]} lines)"
    local line
    for line in "${lines[@]}"; do
        [[ "${line}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]([A-Z]+) ]] || continue
        _info "Date: ${BASH_REMATCH[1]}, Level: ${BASH_REMATCH[2]}"
    done
}
_apply_to_files() {
    local -r func="$1"; local -n _files=$2
    local file
    for file in "${_files[@]}"; do
        "${func}" "${file}" || { _err "Failed: ${file}"; return 1; }
    done
}
declare -Ar _VALID_EXTENSIONS=([txt]=1 [log]=1 [csv]=1 [tsv]=1)
_validate_extension() {
    local -r file="$1" ext="${1##*.}"
    [[ -v _VALID_EXTENSIONS["${ext}"] ]] || { _err "Unsupported extension: ${ext}"; return 1; }
}

# --- [EXPORT] -----------------------------------------------------------------

_TEMP_FILE=""
trap _cleanup EXIT
_main() {
    (( $# > 0 )) || { _err "Usage: $0 <file1> [file2 ...]"; exit 1; }
    _TEMP_FILE=$(mktemp)
    local ts; printf -v ts '%(%F %T)T' -1
    _info "Started at ${ts}"
    # shellcheck disable=SC2034
    local -a input_files=("$@")
    _apply_to_files _validate_extension input_files
    _apply_to_files _process_file input_files
    _info "Done"
}
_main "$@"

# --- POSIX sh equivalent (portable: [ ], printf, no local, . not source) -----
# #!/bin/sh
# set -eu
# readonly SCRIPT_NAME="${0##*/}" LOG_FILE="/tmp/example.log"
# log_info()  { printf '[INFO] %s\n' "$*" | tee -a "$LOG_FILE"; }
# log_error() { printf '[ERROR] %s\n' "$*" >&2; }
# trap 'log_info "Cleaning up..."; rm -f "$temp_file"' EXIT INT TERM
# process_file() {
#     file="$1"
#     [ ! -f "$file" ] && { log_error "File not found: $file"; return 1; }
#     log_info "File has $(wc -l < "$file") lines"
# }
# main() {
#     [ $# -eq 0 ] && { log_error "Usage: $SCRIPT_NAME <file>"; exit 1; }
#     temp_file=$(mktemp)
#     for file in "$@"; do
#         process_file "$file" || { log_error "Failed: $file"; exit 1; }
#     done
#     log_info "Done"
# }
# main "$@"
