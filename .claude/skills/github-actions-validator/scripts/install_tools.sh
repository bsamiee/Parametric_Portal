#!/usr/bin/env bash
# GitHub Actions Validator -- tool installer (act, actionlint)
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly SCRIPT_DIR
readonly TOOLS_DIR="${SCRIPT_DIR}/.tools"
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' NC='\033[0m'
# Minimum versions aligned with github-actions-validator references/modern_features.md
readonly MIN_ACTIONLINT='1.7.10'
readonly MIN_ACT='0.2.84'

# --- [FUNCTIONS] --------------------------------------------------------------

# shellcheck disable=SC2059
_err()  { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }
_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
_info() { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
_ok()   { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
_fetch_installer() {
    local -r url="$1" dest="$2"
    curl --proto "=https" --tlsv1.2 -sSf "${url}" -o "${dest}"
}
_version_ge() {
    # Returns 0 when $1 >= $2 via sort -V comparison
    [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$2" ]]
}
_check_version() {
    local -r name="$1" min_version="$2" binary="$3"
    local raw_version=""
    raw_version="$("${binary}" --version 2>&1 | head -1)" || return 1
    # Extract version number (handles "actionlint 1.7.10" and "act version 0.2.84")
    local version=""
    [[ "${raw_version}" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]] && version="${BASH_REMATCH[1]}"
    [[ -z "${version}" ]] && { _warn "Could not parse ${name} version from: ${raw_version}"; return 0; }
    _version_ge "${version}" "${min_version}" && { _ok "${name} ${version} >= ${min_version}"; return 0; }
    _warn "${name} ${version} is below minimum ${min_version} -- upgrading"
    return 1
}
_install_act() {
    local -r dest="$1" tmp="/tmp/act-install-$$.sh"
    _fetch_installer "https://raw.githubusercontent.com/nektos/act/master/install.sh" "${tmp}"
    bash "${tmp}" -b "${dest}"; rm -f "${tmp}"
}
_install_actionlint() {
    local -r dest="$1" tmp="/tmp/actionlint-install-$$.sh"
    _fetch_installer "https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash" "${tmp}"
    bash "${tmp}" "${dest}"; rm -f "${tmp}"
}
declare -Ar _TOOL_INSTALLERS=([act]=_install_act [actionlint]=_install_actionlint)
declare -Ar _MIN_VERSIONS=([act]="${MIN_ACT}" [actionlint]="${MIN_ACTIONLINT}")
_install_single_tool() {
    local -r name="$1"
    local -r installer="${_TOOL_INSTALLERS[${name}]:-}"
    local -r min_version="${_MIN_VERSIONS[${name}]:-}"
    [[ -n "${installer}" ]] || { _err "No installer for ${name}"; return 1; }
    _info "Installing ${name} (minimum: ${min_version})..."
    # Check system binary first
    local system_path=""
    system_path="$(command -v "${name}" 2>/dev/null)" || true
    case "${system_path}" in
        "")
            _info "Downloading ${name}..."
            "${installer}" "${TOOLS_DIR}"
            ;;
        *)
            # System binary exists -- check version meets minimum
            _check_version "${name}" "${min_version}" "${system_path}" && {
                ln -sf "${system_path}" "${TOOLS_DIR}/${name}"
                _ok "${name} linked: ${TOOLS_DIR}/${name}"
                return 0
            }
            # Version too old -- download fresh
            _info "Downloading ${name} (system version below ${min_version})..."
            "${installer}" "${TOOLS_DIR}"
            ;;
    esac
    [[ -f "${TOOLS_DIR}/${name}" ]] || { _err "Failed to install ${name}"; return 1; }
    _ok "${name} installed: ${TOOLS_DIR}/${name}"
    "${TOOLS_DIR}/${name}" --version
}

# --- [EXPORT] -----------------------------------------------------------------

main() {
    mkdir -p "${TOOLS_DIR}"
    _info "=== GitHub Actions Validator - Tool Installation ==="
    _info "Required: actionlint >= ${MIN_ACTIONLINT}, act >= ${MIN_ACT}"
    local exit_code=0
    for tool in "${!_TOOL_INSTALLERS[@]}"; do
        _install_single_tool "${tool}" || exit_code=1
        printf '\n'
    done
    _ok "=== Installation Complete: ${TOOLS_DIR} ==="
    return "${exit_code}"
}
main "$@"
