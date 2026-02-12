#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"

# --- [USAGE] ------------------------------------------------------------------
usage() { printf '%s\n' \
    "Usage: ${SCRIPT_NAME} [OPTIONS] LOG_FILE" \
    "Analyze log files and generate summary reports." \
    "Options:" \
    "    -h          Show help" \
    "    -t TYPE     Report type: errors|summary (default: summary)" \
    "    -o FILE     Output file (default: stdout)"; }

# --- [REPORT FUNCTIONS] -------------------------------------------------------
analyze_errors() {
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

generate_summary() {
    local -r log_file="$1"
    printf 'Log File Analysis Summary\n=========================\nFile: %s\nTotal lines: %d\n\nLog Levels:\n' \
        "${log_file}" "$(( $(wc -l < "${log_file}") ))"
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

# --- [REPORT_DISPATCH] -------------------------------------------------------
declare -Ar REPORT_DISPATCH=([errors]=analyze_errors [summary]=generate_summary)

# --- [MAIN] -------------------------------------------------------------------
main() {
    local report_type="summary" output_file="" log_file=""
    while getopts ":ht:o:" opt; do
        case ${opt} in
            h) usage; exit 0 ;;
            t) report_type="${OPTARG}" ;;
            o) output_file="${OPTARG}" ;;
            :) printf 'Option -%s requires argument\n' "${OPTARG}" >&2; exit 1 ;;
            \?) printf 'Invalid: -%s\n' "${OPTARG}" >&2; exit 1 ;;
        esac
    done
    shift $((OPTIND - 1))
    log_file="${1:?Error: LOG_FILE required}"
    [[ -f "${log_file}" ]] || { printf 'Error: Not found: %s\n' "${log_file}" >&2; exit 1; }

    local -r handler="${REPORT_DISPATCH[${report_type}]:-}"
    [[ -n "${handler}" ]] || { printf 'Invalid report type: %s\n' "${report_type}" >&2; exit 1; }

    [[ -n "${output_file}" ]] && { "${handler}" "${log_file}" > "${output_file}"; printf 'Saved: %s\n' "${output_file}"; return; }
    "${handler}" "${log_file}"
}

main "$@"
