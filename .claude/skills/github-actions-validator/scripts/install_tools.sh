#!/usr/bin/env bash
# GitHub Actions Validator - Tool Installation
# Pure functions: input via arguments, output via stdout, no global mutation
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly TOOLS_DIR="${SCRIPT_DIR}/.tools"
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' NC='\033[0m'

# --- [LOGGING] ----------------------------------------------------------------
log_info()  { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
log_warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$1"; }

# --- [TOOL_DEFINITIONS] ------------------------------------------------------
# Associative array dispatch table: tool_name -> install_command
declare -Ar INSTALL_COMMANDS=(
    [act]='curl --proto "=https" --tlsv1.2 -sSf https://raw.githubusercontent.com/nektos/act/master/install.sh | bash -s -- -b "."'
    [actionlint]='bash <(curl https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)'
)

# --- [FUNCTIONS] --------------------------------------------------------------
install_single_tool() {
    local -r name="$1" install_cmd="$2"
    log_info "Installing ${name}..."
    rm -f "${TOOLS_DIR}/${name}"

    # Resolve source: system binary via symlink, otherwise download
    command -v "${name}" &>/dev/null \
        && { log_info "${name} found in PATH, creating symlink..."; ln -sf "$(command -v "${name}")" "${TOOLS_DIR}/${name}"; } \
        || { log_info "Downloading ${name}..."; (cd "${TOOLS_DIR}" && eval "${install_cmd}"); }

    [[ -f "${TOOLS_DIR}/${name}" ]] || { log_error "Failed to install ${name}"; return 1; }
    log_info "${name} installed: ${TOOLS_DIR}/${name}"
    "${TOOLS_DIR}/${name}" --version
}

# --- [MAIN] -------------------------------------------------------------------
main() {
    mkdir -p "${TOOLS_DIR}"
    log_info "=== GitHub Actions Validator - Tool Installation ==="
    local exit_code=0 tool
    for tool in "${!INSTALL_COMMANDS[@]}"; do
        install_single_tool "${tool}" "${INSTALL_COMMANDS[${tool}]}" || exit_code=1
        printf '\n'
    done
    log_info "=== Installation Complete: ${TOOLS_DIR} ==="
    return "${exit_code}"
}

main "$@"
