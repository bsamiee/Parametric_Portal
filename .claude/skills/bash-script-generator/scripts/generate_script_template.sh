#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly SCRIPT_DIR
readonly TEMPLATE="${SCRIPT_DIR}/../assets/templates/standard-template.sh"

# --- [FUNCTIONS] --------------------------------------------------------------

_usage() { printf 'Usage: %s OUTPUT_FILE\nGenerate bash script from standard template.\n' "${BASH_SOURCE[0]##*/}"; }

# --- [EXPORT] -----------------------------------------------------------------

_main() {
    case "${1:-}" in
        -h|--help) _usage; exit 0 ;;
        "")        printf 'Error: OUTPUT_FILE required\n' >&2; _usage; exit 1 ;;
    esac
    local -r output_file="$1"
    [[ -f "${TEMPLATE}" ]] || { printf 'Error: Template not found: %s\n' "${TEMPLATE}" >&2; exit 2; }
    cp "${TEMPLATE}" "${output_file}" && chmod +x "${output_file}"
    printf 'Created: %s\n' "${output_file}"
}
_main "$@"
