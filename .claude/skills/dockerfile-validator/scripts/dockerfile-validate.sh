#!/usr/bin/env bash
# Dockerfile Validator -- 5-stage validation with auto-install/cleanup
# Usage: ./dockerfile-validate.sh [Dockerfile]
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' PURPLE='\033[0;35m'
readonly BOLD='\033[1m' NC='\033[0m'
readonly DOCKERFILE="${1:-Dockerfile}"
readonly VENV_BASE_DIR="${HOME}/.local/share/dockerfile-validator-temp"
readonly HADOLINT_VENV="${VENV_BASE_DIR}/hadolint-venv"
readonly CHECKOV_VENV="${VENV_BASE_DIR}/checkov-venv"
readonly FORCE_TEMP_INSTALL="${FORCE_TEMP_INSTALL:-false}"

declare -Ar _RESULT_FORMAT=(
    [PASS]="${GREEN}PASSED${NC}"
    [INFO]="${BLUE}INFORMATIONAL${NC}"
    [FAIL]="${RED}FAILED${NC}"
)

TEMP_INSTALL=false
EXIT_CODE=0
BP_ERRORS=0 BP_WARNINGS=0 BP_INFO=0
SEC_ERRORS=0 SEC_WARNINGS=0
HADOLINT_CMD="" CHECKOV_CMD="" PYTHON_CMD=""

# --- [CLEANUP] ----------------------------------------------------------------
cleanup() {
    local -r exit_code=$?
    [[ "${TEMP_INSTALL}" == "true" && -d "${VENV_BASE_DIR}" ]] && {
        printf "\n${YELLOW}Cleaning up temporary installation...${NC}\n"
        rm -rf "${VENV_BASE_DIR}"
        printf "${GREEN}Cleanup complete${NC}\n"
    }
    exit "${exit_code}"
}
trap cleanup EXIT

# --- [TOOL_MANAGEMENT] --------------------------------------------------------
check_python() {
    command -v python3 &>/dev/null && { PYTHON_CMD="python3"; true; } \
        || command -v python &>/dev/null && { PYTHON_CMD="python"; true; } \
        || { printf "${RED}ERROR: Python 3 required${NC}\n" >&2; exit 2; }
    local ver
    ver=$("${PYTHON_CMD}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local -r major="${ver%%.*}" minor="${ver##*.}"
    (( major >= 3 && minor >= 9 )) || { printf "${RED}ERROR: Python 3.9+ required (found %s)${NC}\n" "${ver}" >&2; exit 2; }
}

check_tools() {
    [[ "${FORCE_TEMP_INSTALL}" == "true" ]] && return 1
    local hadolint_found=false checkov_found=false
    command -v hadolint &>/dev/null && { HADOLINT_CMD="hadolint"; hadolint_found=true; }
    [[ "${hadolint_found}" == "false" && -f "${HADOLINT_VENV}/bin/hadolint" ]] && { HADOLINT_CMD="${HADOLINT_VENV}/bin/hadolint"; hadolint_found=true; }
    command -v checkov &>/dev/null && { CHECKOV_CMD="checkov"; checkov_found=true; }
    [[ "${checkov_found}" == "false" && -f "${CHECKOV_VENV}/bin/checkov" ]] && { CHECKOV_CMD="${CHECKOV_VENV}/bin/checkov"; checkov_found=true; }
    [[ "${hadolint_found}" == "true" && "${checkov_found}" == "true" ]]
}

install_tool() {
    local -r name="$1" venv="$2" pkg="$3" bin="$4"
    printf "${BLUE}Installing %s...${NC}\n" "${name}"
    mkdir -p "${venv}"
    "${PYTHON_CMD}" -m venv "${venv}" 2>&1 | grep -v "upgrade pip" || true
    "${venv}/bin/pip" install --quiet --upgrade pip
    "${venv}/bin/pip" install --quiet "${pkg}"
    "${venv}/bin/${bin}" --version &>/dev/null \
        && printf "${GREEN}%s installed: %s${NC}\n" "${name}" "$("${venv}/bin/${bin}" --version 2>&1 | head -n1)" \
        || { printf "${RED}%s installation failed${NC}\n" "${name}" >&2; exit 2; }
}

install_tools() {
    printf "${YELLOW}${BOLD}Installing validation tools...${NC}\n\n"
    TEMP_INSTALL=true
    check_python
    install_tool "hadolint" "${HADOLINT_VENV}" "hadolint-bin" "hadolint"; HADOLINT_CMD="${HADOLINT_VENV}/bin/hadolint"
    install_tool "Checkov" "${CHECKOV_VENV}" "checkov" "checkov"; CHECKOV_CMD="${CHECKOV_VENV}/bin/checkov"
    printf '\n'
}

# --- [PREPROCESSING] ----------------------------------------------------------
normalize_dockerfile() {
    awk '/\\$/ { sub(/\\$/, ""); printf "%s", $0; next } { print }' "$1"
}

# --- [STAGE 1: SYNTAX] -------------------------------------------------------
run_hadolint() {
    printf "${CYAN}${BOLD}[1/5] Syntax Validation (hadolint)${NC}\n\n"
    "${HADOLINT_CMD}" "${DOCKERFILE}" 2>&1 \
        && printf "\n${GREEN}Syntax validation passed${NC}\n" \
        || { printf "\n${YELLOW}Syntax issues found${NC}\n"; EXIT_CODE=1; }
}

# --- [STAGE 2: SECURITY SCAN] ------------------------------------------------
run_checkov() {
    printf "${CYAN}${BOLD}[2/5] Security Scan (Checkov)${NC}\n\n"
    "${CHECKOV_CMD}" -f "${DOCKERFILE}" --framework dockerfile --compact 2>&1 \
        && printf "\n${GREEN}Security scan passed${NC}\n" \
        || { printf "\n${YELLOW}Security issues found${NC}\n"; EXIT_CODE=1; }
}

# --- [STAGE 3: EXTENDED SECURITY] --------------------------------------------
declare -Ar _SEC_LEVEL_PREFIX=([err]="${RED}[ERROR] " [warn]="${YELLOW}[WARNING] ")

_sec_check() {
    local -r source="$1" pattern="$2" msg="$3" level="$4"
    grep -qiE "${pattern}" <<< "${source}" || return 1
    printf "${_SEC_LEVEL_PREFIX[${level}]:-${level}}%s${NC}\n" "${msg}"
    [[ "${level}" == "err" ]] && { ((SEC_ERRORS++)); EXIT_CODE=1; }
    [[ "${level}" == "warn" ]] && ((SEC_WARNINGS++))
}

run_security_checks() {
    printf "${CYAN}${BOLD}[3/5] Extended Security Checks${NC}\n\n"
    SEC_ERRORS=0 SEC_WARNINGS=0
    local -r content=$(normalize_dockerfile "${DOCKERFILE}")
    local -r raw=$(<"${DOCKERFILE}")

    _sec_check "${raw}" "^(ENV|ARG).*(PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY|ACCESS_KEY).*=" \
        "Hardcoded secrets in ENV/ARG -- use --mount=type=secret" "err" || true

    _sec_check "${content}" "^RUN.*\bsudo\b" "sudo in RUN -- run as root before USER, then drop privileges" "err" || true
    _sec_check "${content}" "curl.*(-k|--insecure)" "curl with disabled cert validation -- remove -k/--insecure" "err" || true
    _sec_check "${content}" "wget.*--no-check-certificate" "wget with disabled cert validation -- remove --no-check-certificate" "err" || true
    _sec_check "${content}" "pip.*--trusted-host" "pip --trusted-host bypasses TLS validation" "err" || true
    _sec_check "${raw}" "PYTHONHTTPSVERIFY.*=.*0" "PYTHONHTTPSVERIFY=0 disables all Python TLS" "err" || true
    _sec_check "${raw}" "NODE_TLS_REJECT_UNAUTHORIZED.*=.*0" "NODE_TLS_REJECT_UNAUTHORIZED=0 disables Node.js TLS" "err" || true
    _sec_check "${content}" "apk.*--allow-untrusted" "apk --allow-untrusted allows unverified packages" "err" || true
    _sec_check "${content}" "apt-get.*--allow-unauthenticated" "apt-get --allow-unauthenticated skips signature checks" "err" || true
    _sec_check "${content}" "(dnf|yum|tdnf).*--nogpgcheck" "--nogpgcheck disables RPM signature validation" "err" || true
    _sec_check "${content}" "apt-get.*--force-yes" "--force-yes disables apt signature validation" "err" || true
    _sec_check "${raw}" "NPM_CONFIG_STRICT_SSL.*=.*false" "NPM_CONFIG_STRICT_SSL=false disables npm TLS" "err" || true
    _sec_check "${content}" "(npm|yarn).*config.*strict-ssl.*false" "strict-ssl false disables npm/yarn TLS" "err" || true
    _sec_check "${raw}" "GIT_SSL_NO_VERIFY" "GIT_SSL_NO_VERIFY disables git TLS validation" "err" || true
    _sec_check "${content}" "\bchpasswd\b" "chpasswd embeds passwords in image layer history" "err" || true

    _sec_check "${content}" "install.*(openssh-server|telnet|ftp|netcat|ncat)\b" \
        "Dangerous package installed (ssh/telnet/ftp/netcat)" "warn" || true
    _sec_check "${raw}" "^EXPOSE.*(22|23|21)($|[^0-9])" \
        "Privileged service port exposed (SSH:22/telnet:23/FTP:21)" "warn" || true

    printf "\nExtended Security: ${RED}%d errors${NC}, ${YELLOW}%d warnings${NC}\n" "${SEC_ERRORS}" "${SEC_WARNINGS}"
    [[ ${SEC_ERRORS} -eq 0 && ${SEC_WARNINGS} -eq 0 ]] && { printf "${GREEN}Extended security passed${NC}\n"; return 0; }
    [[ ${SEC_ERRORS} -eq 0 ]] && { printf "${YELLOW}Completed with warnings${NC}\n"; return 0; }
    printf "${RED}Extended security failed${NC}\n"; return 1
}

# --- [STAGE 4: BEST PRACTICES] -----------------------------------------------
run_best_practices() {
    printf "${CYAN}${BOLD}[4/5] Best Practices Validation${NC}\n\n"
    BP_ERRORS=0 BP_WARNINGS=0 BP_INFO=0
    local -r content=$(normalize_dockerfile "${DOCKERFILE}")

    # :latest tag
    grep -qE "^FROM[[:space:]]+[^[:space:]]+:latest" "${DOCKERFILE}" && {
        printf "${YELLOW}[WARNING] :latest tag -- pin version for reproducibility${NC}\n"; ((BP_WARNINGS++)); }

    local -r has_user=$(grep -c "^USER" "${DOCKERFILE}" || printf '0')
    (( has_user == 0 )) && {
        printf "${YELLOW}[WARNING] No USER directive -- container runs as root${NC}\n"; ((BP_WARNINGS++)); }
    (( has_user > 0 )) && {
        local -r last_user=$(grep "^USER" "${DOCKERFILE}" | tail -n1 | awk '{print $2}')
        [[ "${last_user}" == "root" || "${last_user}" == "0" ]] && {
            printf "${RED}[ERROR] Last USER is root -- drop privileges before CMD${NC}\n"; ((BP_ERRORS++)); EXIT_CODE=1; }
    }

    # HEALTHCHECK
    ! grep -q "^HEALTHCHECK" "${DOCKERFILE}" && grep -qE "^EXPOSE|CMD.*server|ENTRYPOINT.*server" "${DOCKERFILE}" && {
        printf "${PURPLE}[INFO] No HEALTHCHECK for service container${NC}\n"; ((BP_INFO++)); }

    # MAINTAINER deprecated
    grep -q "^MAINTAINER" "${DOCKERFILE}" && {
        printf "${YELLOW}[WARNING] MAINTAINER deprecated -- use LABEL maintainer=...${NC}\n"; ((BP_WARNINGS++)); }

    # ADD vs COPY
    grep -qE "^ADD[[:space:]]" "${DOCKERFILE}" && ! grep -qE "^ADD.*https?://" "${DOCKERFILE}" && {
        printf "${YELLOW}[WARNING] Use COPY instead of ADD -- ADD has implicit extraction${NC}\n"; ((BP_WARNINGS++)); }

    # apt vs apt-get
    grep -qE "^RUN[[:space:]].*\bapt\b[[:space:]]" <<< "${content}" && {
        printf "${YELLOW}[WARNING] Use apt-get, not apt -- apt is for interactive use${NC}\n"; ((BP_WARNINGS++)); }

    # Relative WORKDIR
    grep -qE "^WORKDIR[[:space:]]+[^/]" "${DOCKERFILE}" && {
        printf "${RED}[ERROR] Relative WORKDIR -- use absolute paths${NC}\n"; ((BP_ERRORS++)); EXIT_CODE=1; }

    # Shell form CMD/ENTRYPOINT
    local -r last_cmd=$(grep -E "^(CMD|ENTRYPOINT)" "${DOCKERFILE}" | tail -n1)
    [[ -n "${last_cmd}" ]] && ! grep -qE '\[' <<< "${last_cmd}" && {
        printf "${YELLOW}[WARNING] Shell form CMD/ENTRYPOINT -- use exec form [\"cmd\", \"arg\"]${NC}\n"; ((BP_WARNINGS++)); }

    # RUN count
    local -r run_count=$(grep -c "^RUN" <<< "${content}" || printf '0')
    (( run_count > 5 )) && {
        printf "${PURPLE}[INFO] %d RUN commands -- consider combining${NC}\n" "${run_count}"; ((BP_INFO++)); }

    # apt cache cleanup (skip if using cache mounts)
    grep -q "^RUN.*apt-get install" <<< "${content}" && \
        ! grep -q "rm -rf /var/lib/apt/lists" <<< "${content}" && \
        ! grep -q "mount=type=cache.*apt" <<< "${content}" && {
        printf "${YELLOW}[WARNING] apt-get cache not cleaned -- rm -rf /var/lib/apt/lists/* (or use cache mount)${NC}\n"; ((BP_WARNINGS++)); }

    # apk --no-cache
    grep -q "^RUN.*apk add" <<< "${content}" && \
        ! grep -qE "apk add --no-cache|apk add.*--no-cache" <<< "${content}" && {
        printf "${YELLOW}[WARNING] apk add without --no-cache${NC}\n"; ((BP_WARNINGS++)); }

    # pip --no-cache-dir or cache mount
    grep -qE "^RUN.*pip install" <<< "${content}" && \
        ! grep -qE "pip install.*--no-cache-dir|--mount=type=cache.*pip" <<< "${content}" && {
        printf "${YELLOW}[WARNING] pip install without --no-cache-dir or cache mount${NC}\n"; ((BP_WARNINGS++)); }

    # --no-install-recommends
    grep -qE "^RUN.*apt-get install" <<< "${content}" && \
        ! grep -q "\-\-no-install-recommends" <<< "${content}" && {
        printf "${YELLOW}[WARNING] apt-get install without --no-install-recommends${NC}\n"; ((BP_WARNINGS++)); }

    local copy_all_match
    copy_all_match=$(grep -n "^COPY \. " <<< "${content}" | head -1) || true
    [[ -n "${copy_all_match}" ]] && {
        local -r copy_all_line="${copy_all_match%%:*}"
        local -a run_lines
        mapfile -t run_lines < <(grep -n "^RUN" <<< "${content}")
        local run_entry
        for run_entry in "${run_lines[@]}"; do
            [[ "${run_entry}" =~ ^([0-9]+): ]] || continue
            (( BASH_REMATCH[1] > copy_all_line )) && \
                [[ "${run_entry}" =~ (pip|npm|yarn|go\ mod|apt-get|apk)[[:space:]]+(install|ci|add|mod) ]] && {
                printf "${YELLOW}[WARNING] COPY . before dependency install -- busts layer cache${NC}\n"; ((BP_WARNINGS++)); break; }
        done
    }

    # syntax directive
    grep -qE "\-\-mount=type=(cache|secret|ssh)|\-\-link" <<< "${content}" && {
        head -n1 "${DOCKERFILE}" | grep -qE "^#[[:space:]]*syntax=" || {
            printf "${YELLOW}[WARNING] BuildKit features used without # syntax=docker/dockerfile:1${NC}\n"; ((BP_WARNINGS++)); }
    }

    printf "\nBest Practices: ${RED}%d errors${NC}, ${YELLOW}%d warnings${NC}, ${PURPLE}%d info${NC}\n" "${BP_ERRORS}" "${BP_WARNINGS}" "${BP_INFO}"
    [[ ${BP_ERRORS} -eq 0 && ${BP_WARNINGS} -eq 0 ]] && { printf "${GREEN}Best practices passed${NC}\n"; return 0; }
    [[ ${BP_ERRORS} -eq 0 ]] && { printf "${YELLOW}Completed with warnings${NC}\n"; return 0; }
    printf "${RED}Best practices failed${NC}\n"; return 1
}

# --- [STAGE 5: OPTIMIZATION] -------------------------------------------------
run_optimization() {
    printf "${CYAN}${BOLD}[5/5] Optimization Analysis${NC}\n\n"
    local -r content=$(normalize_dockerfile "${DOCKERFILE}")

    declare -Ar _HEAVY_BASES=([ubuntu]=1 [debian]=1 [centos]=1 [fedora]=1)
    printf "${BLUE}Base Image Analysis:${NC}\n"
    local -a from_lines
    mapfile -t from_lines < <(grep "^FROM" "${DOCKERFILE}")
    local from_line image base_name
    for from_line in "${from_lines[@]}"; do
        [[ "${from_line}" =~ ^FROM[[:space:]]+([^[:space:]]+) ]] || continue
        image="${BASH_REMATCH[1]}"
        image="${image%%[[:space:]]*}"
        base_name="${image%%:*}"; base_name="${base_name##*/}"
        [[ -v _HEAVY_BASES["${base_name}"] ]] && \
            printf "  ${PURPLE}[OPT] Consider Alpine/slim for: %s${NC}\n" "${image}"
    done

    local -r from_count=$(grep -c "^FROM" <<< "${content}" || printf '0')
    printf "\n${BLUE}Build Structure:${NC}\n"
    (( from_count == 1 )) && {
        (grep -qE "apt-get install.*(gcc|make|build)" <<< "${content}" || \
         grep -qE "apk add.*(gcc|make|build)" <<< "${content}") && \
            printf "  ${PURPLE}[OPT] Build tools in single-stage -- use multi-stage to exclude from runtime${NC}\n"
    }
    (( from_count > 1 )) && {
        local -r final=$(grep "^FROM" <<< "${content}" | tail -n1 | awk '{print $2}')
        grep -qiE "distroless|alpine|scratch|slim" <<< "${final}" \
            && printf "  ${GREEN}Minimal final stage: %s${NC}\n" "${final}" \
            || printf "  ${PURPLE}[OPT] Final stage could use smaller base (alpine/slim/distroless/scratch)${NC}\n"
    }

    local -r run_count=$(grep -c "^RUN" <<< "${content}" || printf '0')
    printf "\n${BLUE}Layers:${NC} %d RUN commands\n" "${run_count}"
    (( run_count > 7 )) && printf "  ${PURPLE}[OPT] Combine RUN commands to reduce layers${NC}\n"

    # BuildKit optimization opportunities
    printf "\n${BLUE}BuildKit Features:${NC}\n"
    grep -qE "pip install|npm ci|npm install|go mod download|pnpm install" <<< "${content}" && \
        ! grep -qE "\-\-mount=type=cache" <<< "${content}" && \
        printf "  ${PURPLE}[OPT] Use --mount=type=cache for package manager caches${NC}\n"
    grep -qE "^COPY --from=" <<< "${content}" && \
        ! grep -qE "^COPY --link" <<< "${content}" && \
        printf "  ${PURPLE}[OPT] Use COPY --link for layer-independent copying (better caching)${NC}\n"

    [[ ! -f "${DOCKERFILE%/*}/.dockerignore" ]] && \
        printf "\n${YELLOW}[INFO] No .dockerignore found -- build context includes everything${NC}\n"

    printf "\n${GREEN}Optimization analysis complete${NC}\n"
}

# --- [MAIN] -------------------------------------------------------------------
case "${1:-}" in
    -h|--help)
        printf "Usage: %s [Dockerfile]\n" "${0##*/}"
        printf "Runs 5-stage validation: syntax, security (Checkov), extended security, best practices, optimization.\n"
        printf "Auto-installs tools if missing. Exit: 0=pass, 1=fail, 2=critical.\n"
        exit 0 ;;
esac

[[ ! -f "${DOCKERFILE}" ]] && { printf "${RED}ERROR: Not found: %s${NC}\n" "${DOCKERFILE}" >&2; exit 2; }
local_ts=""
printf -v local_ts '%(%F %T)T' -1
printf "\n${CYAN}${BOLD}Dockerfile Validator${NC}\n"
printf "${BOLD}Target:${NC} %s  ${BOLD}Date:${NC} %s\n\n" "${DOCKERFILE}" "${local_ts}"

check_tools || install_tools

printf "${CYAN}${BOLD}Running Validations...${NC}\n\n"

RESULTS=()
run_hadolint && RESULTS+=("PASS") || RESULTS+=("FAIL"); printf '\n'
run_checkov && RESULTS+=("PASS") || RESULTS+=("FAIL"); printf '\n'
run_security_checks && RESULTS+=("PASS") || RESULTS+=("FAIL"); printf '\n'
run_best_practices && RESULTS+=("PASS") || RESULTS+=("FAIL"); printf '\n'
run_optimization && RESULTS+=("INFO"); printf '\n'

readonly -a LABELS=("Syntax (hadolint)" "Security (Checkov)" "Extended Security" "Best Practices" "Optimization")
printf "${CYAN}${BOLD}Summary${NC}\n"
paste <(printf '%s\n' "${LABELS[@]}") <(printf '%s\n' "${RESULTS[@]}") \
    | while IFS=$'\t' read -r label result; do
        # shellcheck disable=SC2059
        printf "  %s: ${_RESULT_FORMAT[${result}]:-${result}}\n" "${label}"
    done

printf '\n'
[[ ${EXIT_CODE} -eq 0 ]] && printf "${GREEN}${BOLD}Overall: PASSED${NC}\n" || printf "${RED}${BOLD}Overall: FAILED${NC}\n"
printf '\n'
exit "${EXIT_CODE}"
