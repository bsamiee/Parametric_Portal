#!/usr/bin/env bash
# shellcheck disable=SC2059  # Color constants in printf format strings are intentional
# Dockerfile Validator -- 5-stage validation with auto-install/cleanup
# Usage: ./dockerfile-validate.sh [Dockerfile]
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [SOURCE] -----------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
source "${SCRIPT_DIR}/_checks.sh"

# --- [CONSTANTS] --------------------------------------------------------------

# shellcheck disable=SC2034
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' PURPLE='\033[0;35m'
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BOLD='\033[1m' NC='\033[0m'
readonly DOCKERFILE="${1:-Dockerfile}"
readonly VENV_BASE_DIR="${HOME}/.local/share/dockerfile-validator-temp"
readonly HADOLINT_VENV="${VENV_BASE_DIR}/hadolint-venv"
readonly CHECKOV_VENV="${VENV_BASE_DIR}/checkov-venv"
readonly FORCE_TEMP_INSTALL="${FORCE_TEMP_INSTALL:-false}"
declare -Ar _HEAVY_BASES=([ubuntu]=1 [debian]=1 [centos]=1 [fedora]=1)
declare -Ar _RESULT_FORMAT=(
    [PASS]="${GREEN}PASSED${NC}"
    [INFO]="${BLUE}INFORMATIONAL${NC}"
    [FAIL]="${RED}FAILED${NC}"
)
declare -Ar _SEC_LEVEL_PREFIX=(
    [err]="${RED}[ERROR] "
    [warn]="${YELLOW}[WARNING] "
)
readonly -a _STAGE_LABELS=(
    "Syntax (hadolint)"
    "Security (Checkov)"
    "Extended Security"
    "Best Practices"
    "Optimization"
)

# --- [ERRORS] -----------------------------------------------------------------

_err()  { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }
# shellcheck disable=SC2329
_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
# shellcheck disable=SC2329
_info() { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
# shellcheck disable=SC2329
_ok()   { printf "${GREEN}[OK]${NC} %s\n" "$1"; }

# --- [FUNCTIONS] --------------------------------------------------------------

# shellcheck disable=SC2329
_cleanup() {
    local -r exit_code=$?
    [[ "${_TEMP_INSTALL}" == "true" && -d "${VENV_BASE_DIR}" ]] && {
        printf "\n${YELLOW}Cleaning up temporary installation...${NC}\n"
        rm -rf "${VENV_BASE_DIR}"
        printf "${GREEN}Cleanup complete${NC}\n"
    }
    exit "${exit_code}"
}
_check_python() {
    local -r python_cmd="${1}"
    command -v "${python_cmd}" &>/dev/null || return 1
    local ver
    ver=$("${python_cmd}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local -r major="${ver%%.*}" minor="${ver##*.}"
    (( major >= 3 && minor >= 9 ))
}
_resolve_python() {
    _check_python "python3" && { printf '%s' "python3"; return; }
    _check_python "python" && { printf '%s' "python"; return; }
    _err "Python 3.9+ required"; exit 2
}
_check_tools() {
    [[ "${FORCE_TEMP_INSTALL}" == "true" ]] && return 1
    local hadolint_found=0 checkov_found=0
    command -v hadolint &>/dev/null && { _HADOLINT_CMD="hadolint"; hadolint_found=1; }
    (( hadolint_found == 0 )) && [[ -f "${HADOLINT_VENV}/bin/hadolint" ]] && { _HADOLINT_CMD="${HADOLINT_VENV}/bin/hadolint"; hadolint_found=1; }
    command -v checkov &>/dev/null && { _CHECKOV_CMD="checkov"; checkov_found=1; }
    (( checkov_found == 0 )) && [[ -f "${CHECKOV_VENV}/bin/checkov" ]] && { _CHECKOV_CMD="${CHECKOV_VENV}/bin/checkov"; checkov_found=1; }
    (( hadolint_found == 1 && checkov_found == 1 ))
}
_install_tool() {
    local -r name="$1" venv="$2" pkg="$3" bin="$4" python_cmd="$5"
    printf "${BLUE}Installing %s...${NC}\n" "${name}"
    mkdir -p "${venv}"
    "${python_cmd}" -m venv "${venv}" 2>&1 | rg -v "upgrade pip" || true
    "${venv}/bin/pip" install --quiet --upgrade pip
    "${venv}/bin/pip" install --quiet "${pkg}"
    "${venv}/bin/${bin}" --version &>/dev/null \
        && printf "${GREEN}%s installed: %s${NC}\n" "${name}" "$("${venv}/bin/${bin}" --version 2>&1 | head -n1)" \
        || { _err "${name} installation failed"; exit 2; }
}
_install_tools() {
    printf "${YELLOW}${BOLD}Installing validation tools...${NC}\n\n"
    _TEMP_INSTALL=true
    local -r python_cmd="$(_resolve_python)"
    _install_tool "hadolint" "${HADOLINT_VENV}" "hadolint-bin" "hadolint" "${python_cmd}"
    _HADOLINT_CMD="${HADOLINT_VENV}/bin/hadolint"
    _install_tool "Checkov" "${CHECKOV_VENV}" "checkov" "checkov" "${python_cmd}"
    _CHECKOV_CMD="${CHECKOV_VENV}/bin/checkov"
    printf '\n'
}
_normalize_dockerfile() {
    awk '/\\$/ { sub(/\\$/, ""); printf "%s", $0; next } { print }' "$1"
}
_run_hadolint() {
    printf "${CYAN}${BOLD}[1/5] Syntax Validation (hadolint)${NC}\n\n"
    "${_HADOLINT_CMD}" "${DOCKERFILE}" 2>&1 \
        && { printf "\n${GREEN}Syntax validation passed${NC}\n"; return 0; } \
        || { printf "\n${YELLOW}Syntax issues found${NC}\n"; return 1; }
}
_run_checkov() {
    printf "${CYAN}${BOLD}[2/5] Security Scan (Checkov)${NC}\n\n"
    "${_CHECKOV_CMD}" -f "${DOCKERFILE}" --framework dockerfile --compact 2>&1 \
        && { printf "\n${GREEN}Security scan passed${NC}\n"; return 0; } \
        || { printf "\n${YELLOW}Security issues found${NC}\n"; return 1; }
}

# --- [EXPORT] -----------------------------------------------------------------

_TEMP_INSTALL=false
_HADOLINT_CMD=""
_CHECKOV_CMD=""
trap _cleanup EXIT
case "${1:-}" in
    -h|--help)
        printf "Usage: %s [Dockerfile]\n" "${0##*/}"
        printf "Runs 5-stage validation: syntax, security (Checkov), extended security, best practices, optimization.\n"
        printf "Auto-installs tools if missing. Exit: 0=pass, 1=fail, 2=critical.\n"
        exit 0 ;;
esac
[[ ! -f "${DOCKERFILE}" ]] && { _err "Not found: ${DOCKERFILE}"; exit 2; }
_report_ts=""
printf -v _report_ts '%(%F %T)T' -1
printf "\n${CYAN}${BOLD}Dockerfile Validator${NC}\n"
printf "${BOLD}Target:${NC} %s  ${BOLD}Date:${NC} %s\n\n" "${DOCKERFILE}" "${_report_ts}"
_check_tools || _install_tools
_NORM_CONTENT=$(_normalize_dockerfile "${DOCKERFILE}")
readonly _NORM_CONTENT
_RAW_CONTENT=$(<"${DOCKERFILE}")
readonly _RAW_CONTENT
printf "${CYAN}${BOLD}Running Validations...${NC}\n\n"
_EXIT_CODE=0
_RESULTS=()
_run_hadolint && _RESULTS+=("PASS") || { _RESULTS+=("FAIL"); _EXIT_CODE=1; }; printf '\n'
_run_checkov && _RESULTS+=("PASS") || { _RESULTS+=("FAIL"); _EXIT_CODE=1; }; printf '\n'
_run_security_checks "${_NORM_CONTENT}" "${_RAW_CONTENT}" && _RESULTS+=("PASS") || { _RESULTS+=("FAIL"); _EXIT_CODE=1; }; printf '\n'
_run_best_practices "${_NORM_CONTENT}" "${_RAW_CONTENT}" && _RESULTS+=("PASS") || { _RESULTS+=("FAIL"); _EXIT_CODE=1; }; printf '\n'
_run_optimization "${_NORM_CONTENT}" && _RESULTS+=("INFO"); printf '\n'
printf "${CYAN}${BOLD}Summary${NC}\n"
for _sidx in "${!_STAGE_LABELS[@]}"; do
    # shellcheck disable=SC2059
    printf "  %s: ${_RESULT_FORMAT[${_RESULTS[${_sidx}]}]:-${_RESULTS[${_sidx}]}}\n" "${_STAGE_LABELS[${_sidx}]}"
done
printf '\n'
(( _EXIT_CODE == 0 )) && printf "${GREEN}${BOLD}Overall: PASSED${NC}\n" || printf "${RED}${BOLD}Overall: FAILED${NC}\n"
printf '\n'
exit "${_EXIT_CODE}"
