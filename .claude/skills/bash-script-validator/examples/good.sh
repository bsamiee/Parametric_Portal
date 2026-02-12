#!/usr/bin/env bash
# Best practices: strict mode, printf, local -r, $(<file), associative array
# dispatch, trap cleanup, nameref, BASH_REMATCH, mapfile, set-via-assoc-array
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly LOG_FILE="/tmp/example.log"

# --- [LOGGING] ----------------------------------------------------------------
declare -Ar _LOG_FORMATS=([info]='[INFO] %s\n' [error]='[ERROR] %s\n' [warn]='[WARN] %s\n')

_log() {
    local -r level="$1"; shift
    # shellcheck disable=SC2059
    printf "${_LOG_FORMATS[${level}]:-[${level^^}] %s\n}" "$*" | tee -a "${LOG_FILE}"
}

log_info()  { _log info "$@"; }
log_error() { _log error "$@" >&2; }

# --- [CLEANUP] ----------------------------------------------------------------
trap 'log_info "Cleaning up..."; rm -f "${temp_file:-}"' EXIT

# --- [FUNCTIONS] --------------------------------------------------------------
process_file() {
    local -r file="$1"
    [[ -f "${file}" ]] || { log_error "File not found: ${file}"; return 1; }
    local -a lines
    mapfile -t lines < "${file}"
    log_info "Processing ${file} (${#lines[@]} lines)"

    local line
    for line in "${lines[@]}"; do
        [[ "${line}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]([A-Z]+) ]] || continue
        log_info "Date: ${BASH_REMATCH[1]}, Level: ${BASH_REMATCH[2]}"
    done
}

apply_to_files() {
    local -r func="$1"; local -n _files=$2
    local file
    for file in "${_files[@]}"; do
        "${func}" "${file}" || { log_error "Failed: ${file}"; return 1; }
    done
}

declare -Ar _VALID_EXTENSIONS=([txt]=1 [log]=1 [csv]=1 [tsv]=1)

validate_extension() {
    local -r file="$1" ext="${1##*.}"
    [[ -v _VALID_EXTENSIONS["${ext}"] ]] || { log_error "Unsupported extension: ${ext}"; return 1; }
}

main() {
    (( $# > 0 )) || { log_error "Usage: $0 <file1> [file2 ...]"; exit 1; }
    local temp_file; temp_file=$(mktemp)
    local ts; printf -v ts '%(%F %T)T' -1
    log_info "Started at ${ts}"
    local -a input_files=("$@")
    apply_to_files validate_extension input_files
    apply_to_files process_file input_files
    log_info "Done"
}
main "$@"

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
