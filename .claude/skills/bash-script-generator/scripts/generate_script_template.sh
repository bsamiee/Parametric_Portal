#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit

readonly SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly TEMPLATE="${SCRIPT_DIR}/../assets/templates/standard-template.sh"

usage() { printf 'Usage: %s OUTPUT_FILE\nGenerate bash script from standard template.\n' "${BASH_SOURCE[0]##*/}"; }

main() {
    case "${1:-}" in
        -h|--help) usage; exit 0 ;;
        "")        printf 'Error: OUTPUT_FILE required\n' >&2; usage; exit 1 ;;
    esac
    local -r output_file="$1"
    [[ -f "${TEMPLATE}" ]] || { printf 'Error: Template not found: %s\n' "${TEMPLATE}" >&2; exit 1; }
    cp "${TEMPLATE}" "${output_file}" && chmod +x "${output_file}"
    printf 'Created: %s\n' "${output_file}"
}

main "$@"
