#!/usr/bin/env bash
# ShellCheck Wrapper -- auto-installs shellcheck-py via cached venv if system binary missing
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly _GRN='\033[0;32m' _RED='\033[0;31m' _BLU='\033[0;34m' _NC='\033[0m'
readonly CACHE_DIR="${HOME}/.cache/bash-script-validator/shellcheck-venv"

# --- [STATE] ------------------------------------------------------------------
VENV_DIR="" CLEANUP=true

trap '[[ "${CLEANUP}" == "true" && -d "${VENV_DIR:-}" ]] && rm -rf "${VENV_DIR}"' EXIT

# --- [MAIN] -------------------------------------------------------------------
main() {
    (( $# > 0 )) || { printf 'Usage: %s [--cache|--no-cache|--clear-cache] [shellcheck-options] <script-file>\n' "$0"; exit 0; }
    local cache=false
    local -a args=()
    while (( $# > 0 )); do
        case "$1" in
            --cache) cache=true; shift ;;
            --no-cache) cache=false; shift ;;
            --clear-cache)
                [[ -d "${CACHE_DIR}" ]] \
                    && { rm -rf "${CACHE_DIR}"; printf "${_GRN}[INFO]${_NC} Cache cleared\n"; } \
                    || printf "${_BLU}[INFO]${_NC} No cache to clear\n"
                exit 0 ;;
            *) args+=("$1"); shift ;;
        esac
    done

    command -v shellcheck &>/dev/null && exec shellcheck "${args[@]}"
    command -v python3 &>/dev/null || { printf "${_RED}[ERROR]${_NC} python3 required\n" >&2; exit 1; }
    declare -Ar _VENV_STRATEGY=([true]="${CACHE_DIR}" [false]="")
    VENV_DIR="${_VENV_STRATEGY[${cache}]:-$(mktemp -d -t shellcheck-venv.XXXXXX)}"
    [[ "${cache}" == "true" ]] && { CLEANUP=false; [[ -d "${CACHE_DIR}" ]] || mkdir -p "${CACHE_DIR%/*}"; }
    [[ -d "${VENV_DIR}" ]] || python3 -m venv "${VENV_DIR}"

    local -r marker="${VENV_DIR}/.shellcheck_installed"
    [[ -f "${marker}" ]] || {
        printf "${_BLU}[INFO]${_NC} Installing shellcheck-py...\n" >&2
        "${VENV_DIR}/bin/pip3" install --quiet --upgrade pip \
            && "${VENV_DIR}/bin/pip3" install --quiet shellcheck-py \
            && touch "${marker}" \
            || { printf "${_RED}[ERROR]${_NC} Failed to install shellcheck-py\n" >&2; exit 1; }
    }

    [[ -f "${VENV_DIR}/bin/shellcheck" ]] || { printf "${_RED}[ERROR]${_NC} shellcheck binary not found\n" >&2; exit 1; }
    "${VENV_DIR}/bin/shellcheck" "${args[@]}"
}

main "$@"
