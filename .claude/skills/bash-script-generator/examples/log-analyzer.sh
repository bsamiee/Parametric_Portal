#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
declare -Ar _REPORT_DISPATCH=([errors]=_analyze_errors [summary]=_generate_summary)

# --- [ERRORS] -----------------------------------------------------------------

_err()  { printf '[ERROR] %s\n' "$1" >&2; }
_info() { printf '[INFO] %s\n' "$1" >&2; }

# --- [FUNCTIONS] --------------------------------------------------------------

_usage() { printf '%s\n' \
    "Usage: ${SCRIPT_NAME} [OPTIONS] LOG_FILE" \
    "Analyze log files and generate summary reports." \
    "Options:" \
    "    -h          Show help" \
    "    -t TYPE     Report type: errors|summary (default: summary)" \
    "    -o FILE     Output file (default: stdout)"; }
_analyze_errors() {
    local -r log_file="$1"
    printf 'Error Summary\n=============\n'
    awk '/ERROR/ {
        msg = $0; sub(/.*ERROR: /, "", msg); sub(/ -.*/, "", msg)
        counts[msg]++; total++
    } END {
        PROCINFO["sorted_in"] = "@val_num_desc"
        for (msg in counts) printf "  %-40s %6d\n", msg, counts[msg]
        printf "\nTotal errors: %d\n", total+0
    }' "${log_file}" 2>/dev/null || printf '\nTotal errors: 0\n'
}
_generate_summary() {
    local -r log_file="$1"
    local -a _summary_lines; mapfile -t _summary_lines < "${log_file}"
    printf 'Log File Analysis Summary\n=========================\nFile: %s\nTotal lines: %d\n\nLog Levels:\n' \
        "${log_file}" "${#_summary_lines[@]}"
    awk '
        /DEBUG/ {d++} /INFO/ {i++} /WARN/ {w++} /ERROR/ {e++} /FATAL/ {f++}
        END {
            printf "  %-10s %6d\n", "DEBUG:", d+0
            printf "  %-10s %6d\n", "INFO:", i+0
            printf "  %-10s %6d\n", "WARN:", w+0
            printf "  %-10s %6d\n", "ERROR:", e+0
            printf "  %-10s %6d\n", "FATAL:", f+0
        }
    ' "${log_file}"
}

# --- [EXPORT] -----------------------------------------------------------------

_main() {
    local report_type="summary" output_file="" log_file=""
    while getopts ":ht:o:" opt; do
        case ${opt} in
            h) _usage; exit 0 ;;
            t) report_type="${OPTARG}" ;;
            o) output_file="${OPTARG}" ;;
            :) printf 'Option -%s requires argument\n' "${OPTARG}" >&2; exit 1 ;;
            \?) printf 'Invalid: -%s\n' "${OPTARG}" >&2; exit 1 ;;
        esac
    done
    shift $((OPTIND - 1))
    log_file="${1:?Error: LOG_FILE required}"
    [[ -f "${log_file}" ]] || { printf 'Error: Not found: %s\n' "${log_file}" >&2; exit 1; }
    local -r handler="${_REPORT_DISPATCH[${report_type}]:-}"
    [[ -n "${handler}" ]] || { printf 'Invalid report type: %s\n' "${report_type}" >&2; exit 1; }
    [[ -n "${output_file}" ]] && { "${handler}" "${log_file}" > "${output_file}"; printf 'Saved: %s\n' "${output_file}"; return; }
    "${handler}" "${log_file}"
}
_main "$@"
