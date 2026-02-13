#!/usr/bin/env bash
# Dockerfile validation checks -- sourced by dockerfile-validate.sh
# Extended security, best practices, and optimization analysis
# shellcheck disable=SC2034,SC2059,SC2178
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

# Security rules: "source~pattern~message~level"
declare -a _SEC_RULES=(
    "raw~^(ENV|ARG).*(PASSWORD|SECRET|API_KEY|TOKEN|PRIVATE_KEY|ACCESS_KEY).*=~Hardcoded secrets in ENV/ARG -- use --mount=type=secret~err"
    "norm~^RUN.*\bsudo\b~sudo in RUN -- run as root before USER, then drop privileges~err"
    "norm~curl.*(-k|--insecure)~curl with disabled cert validation -- remove -k/--insecure~err"
    "norm~wget.*--no-check-certificate~wget with disabled cert validation -- remove --no-check-certificate~err"
    "norm~pip.*--trusted-host~pip --trusted-host bypasses TLS validation~err"
    "raw~PYTHONHTTPSVERIFY.*=.*0~PYTHONHTTPSVERIFY=0 disables all Python TLS~err"
    "raw~NODE_TLS_REJECT_UNAUTHORIZED.*=.*0~NODE_TLS_REJECT_UNAUTHORIZED=0 disables Node.js TLS~err"
    "norm~apk.*--allow-untrusted~apk --allow-untrusted allows unverified packages~err"
    "norm~apt-get.*--allow-unauthenticated~apt-get --allow-unauthenticated skips signature checks~err"
    "norm~(dnf|yum|tdnf).*--nogpgcheck~--nogpgcheck disables RPM signature validation~err"
    "norm~apt-get.*--force-yes~--force-yes disables apt signature validation~err"
    "raw~NPM_CONFIG_STRICT_SSL.*=.*false~NPM_CONFIG_STRICT_SSL=false disables npm TLS~err"
    "norm~(npm|yarn).*config.*strict-ssl.*false~strict-ssl false disables npm/yarn TLS~err"
    "raw~GIT_SSL_NO_VERIFY~GIT_SSL_NO_VERIFY disables git TLS validation~err"
    "norm~\bchpasswd\b~chpasswd embeds passwords in image layer history~err"
    "norm~install.*(openssh-server|telnet|ftp|netcat|ncat)\b~Dangerous package installed (ssh/telnet/ftp/netcat)~warn"
    "raw~^EXPOSE.*(22|23|21)($|[^0-9])~Privileged service port exposed (SSH:22/telnet:23/FTP:21)~warn"
)
declare -a _BP_SIMPLE_RULES=(
    "file~^FROM[[:space:]]+[^[:space:]]+:latest~:latest tag -- pin version for reproducibility~warn"
    "file~^MAINTAINER~MAINTAINER deprecated -- use LABEL maintainer=...~warn"
    "file~^WORKDIR[[:space:]]+[^/]~Relative WORKDIR -- use absolute paths~err"
    "norm~^RUN[[:space:]].*\bapt\b[[:space:]]~Use apt-get, not apt -- apt is for interactive use~warn"
)
declare -a _PKG_HYGIENE_RULES=(
    "apt-get install~rm -rf /var/lib/apt/lists|mount=type=cache.*apt~apt-get cache not cleaned -- rm -rf /var/lib/apt/lists/* or cache mount"
    "apk add~apk add --no-cache|apk add.*--no-cache~apk add without --no-cache"
    "pip install~pip install.*--no-cache-dir|--mount=type=cache.*pip~pip install without --no-cache-dir or cache mount"
    "apt-get install~--no-install-recommends~apt-get install without --no-install-recommends"
)

# --- [PURE_FUNCTIONS] ---------------------------------------------------------

_dispatch_rules() {
    local -r norm="$1" raw="$2" file="$3"
    local -n _rules=$4 _errs_out=$5 _warns_out=$6
    local rule src pat msg lvl
    for rule in "${_rules[@]}"; do
        IFS='~' read -r src pat msg lvl <<< "${rule}"
        case "${src}" in
            raw)  rg -qi "${pat}" <<< "${raw}" || continue ;;
            norm) rg -qi "${pat}" <<< "${norm}" || continue ;;
            file) rg -qi "${pat}" "${file}" || continue ;;
        esac
        printf "${_SEC_LEVEL_PREFIX[${lvl}]:-[${lvl^^}] }%s${NC}\n" "${msg}"
        [[ "${lvl}" == "err" ]] && _errs_out+=("${msg}")
        [[ "${lvl}" == "warn" ]] && _warns_out+=("${msg}")
    done
}
_bp_check_user() {
    local -r file="$1"
    local -n _e=$2 _w=$3 _i=$4
    local -a user_lines=()
    mapfile -t user_lines < <(rg "^USER" "${file}" || true)
    (( ${#user_lines[@]} == 0 )) && { printf "${YELLOW}[WARNING] No USER directive -- container runs as root${NC}\n"; _w+=("no_user"); return 0; }
    [[ "${user_lines[-1]}" =~ ^USER[[:space:]]+([^[:space:]]+) ]] || return 0
    local -r last_user="${BASH_REMATCH[1]}"
    [[ "${last_user}" == "root" || "${last_user}" == "0" ]] && \
        { printf "${RED}[ERROR] Last USER is root -- drop privileges before CMD${NC}\n"; _e+=("root_user"); }
    return 0
}
_bp_check_healthcheck() {
    local -r file="$1"
    local -n _e=$2 _w=$3 _i=$4
    ! rg -q "^HEALTHCHECK" "${file}" && rg -q "^EXPOSE|CMD.*server|ENTRYPOINT.*server" "${file}" && \
        { printf "${PURPLE}[INFO] No HEALTHCHECK for service container${NC}\n"; _i+=("no_healthcheck"); }
    return 0
}
_bp_check_add() {
    local -r file="$1"
    local -n _e=$2 _w=$3 _i=$4
    rg -q "^ADD[[:space:]]" "${file}" && ! rg -q "^ADD.*https?://" "${file}" && \
        { printf "${YELLOW}[WARNING] Use COPY instead of ADD -- ADD has implicit extraction${NC}\n"; _w+=("add_not_copy"); }
    return 0
}
_bp_check_shell_form() {
    local -r file="$1"
    local -n _e=$2 _w=$3 _i=$4
    local -r last_cmd=$(rg "^(CMD|ENTRYPOINT)" "${file}" | tail -n1)
    [[ -n "${last_cmd}" ]] && ! rg -q '\[' <<< "${last_cmd}" && \
        { printf "${YELLOW}[WARNING] Shell form CMD/ENTRYPOINT -- use exec form [\"cmd\", \"arg\"]${NC}\n"; _w+=("shell_form"); }
    return 0
}
_bp_check_run_count() {
    local -r norm="$1"
    local -n _e=$2 _w=$3 _i=$4
    local run_count=""
    run_count=$(rg -c "^RUN" <<< "${norm}") || run_count="0"
    (( run_count > 5 )) && \
        { printf "${PURPLE}[INFO] %d RUN commands -- consider combining${NC}\n" "${run_count}"; _i+=("many_runs"); }
    return 0
}
_bp_check_pkg_hygiene() {
    local -r norm="$1"
    local -n _e=$2 _w=$3 _i=$4
    local rule trigger remedy msg
    for rule in "${_PKG_HYGIENE_RULES[@]}"; do
        IFS='~' read -r trigger remedy msg <<< "${rule}"
        rg -q "^RUN.*${trigger}" <<< "${norm}" && ! rg -q "${remedy}" <<< "${norm}" && \
            { printf "${YELLOW}[WARNING] %s${NC}\n" "${msg}"; _w+=("${trigger// /_}"); }
    done
    return 0
}
_bp_check_copy_order() {
    local -r norm="$1"
    local -n _e=$2 _w=$3 _i=$4
    local copy_match=""
    copy_match=$(rg -n "^COPY \. " <<< "${norm}" | head -1) || true
    [[ -z "${copy_match}" ]] && return 0
    local -r copy_line="${copy_match%%:*}"
    local -a run_lines=()
    mapfile -t run_lines < <(rg -n "^RUN" <<< "${norm}" || true)
    local run_entry
    for run_entry in "${run_lines[@]}"; do
        [[ "${run_entry}" =~ ^([0-9]+): ]] || continue
        (( BASH_REMATCH[1] > copy_line )) && \
            [[ "${run_entry}" =~ (pip|npm|yarn|go\ mod|apt-get|apk)[[:space:]]+(install|ci|add|mod) ]] && {
            printf "${YELLOW}[WARNING] COPY . before dependency install -- busts layer cache${NC}\n"; _w+=("copy_before_deps"); break; }
    done
    return 0
}
_bp_check_buildkit_syntax() {
    local -r norm="$1" file="$2"
    local -n _e=$3 _w=$4 _i=$5
    rg -q "\-\-mount=type=(cache|secret|ssh)|\-\-link" <<< "${norm}" || return 0
    local first_line=""
    { read -r first_line; } < "${file}"
    [[ "${first_line}" =~ ^#[[:space:]]*syntax= ]] || \
        { printf "${YELLOW}[WARNING] BuildKit features used without # syntax=docker/dockerfile:1${NC}\n"; _w+=("no_syntax_header"); }
    return 0
}

# --- [EXPORT] -----------------------------------------------------------------

_run_security_checks() {
    local -r content="$1" raw="$2"
    printf "${CYAN}${BOLD}[3/5] Extended Security Checks${NC}\n\n"
    local -a errors=() warnings=()
    _dispatch_rules "${content}" "${raw}" "${DOCKERFILE}" _SEC_RULES errors warnings
    printf "\nExtended Security: ${RED}%d errors${NC}, ${YELLOW}%d warnings${NC}\n" "${#errors[@]}" "${#warnings[@]}"
    (( ${#errors[@]} == 0 && ${#warnings[@]} == 0 )) && { printf "${GREEN}Extended security passed${NC}\n"; return 0; }
    (( ${#errors[@]} == 0 )) && { printf "${YELLOW}Completed with warnings${NC}\n"; return 0; }
    printf "${RED}Extended security failed${NC}\n"; return 1
}

_run_best_practices() {
    local -r content="$1" raw="$2"
    printf "${CYAN}${BOLD}[4/5] Best Practices Validation${NC}\n\n"
    local -a bp_errs=() bp_warns=() bp_info=()
    _dispatch_rules "${content}" "${raw}" "${DOCKERFILE}" _BP_SIMPLE_RULES bp_errs bp_warns
    _bp_check_user "${DOCKERFILE}" bp_errs bp_warns bp_info
    _bp_check_healthcheck "${DOCKERFILE}" bp_errs bp_warns bp_info
    _bp_check_add "${DOCKERFILE}" bp_errs bp_warns bp_info
    _bp_check_shell_form "${DOCKERFILE}" bp_errs bp_warns bp_info
    _bp_check_run_count "${content}" bp_errs bp_warns bp_info
    _bp_check_pkg_hygiene "${content}" bp_errs bp_warns bp_info
    _bp_check_copy_order "${content}" bp_errs bp_warns bp_info
    _bp_check_buildkit_syntax "${content}" "${DOCKERFILE}" bp_errs bp_warns bp_info
    printf "\nBest Practices: ${RED}%d errors${NC}, ${YELLOW}%d warnings${NC}, ${PURPLE}%d info${NC}\n" \
        "${#bp_errs[@]}" "${#bp_warns[@]}" "${#bp_info[@]}"
    (( ${#bp_errs[@]} == 0 && ${#bp_warns[@]} == 0 )) && { printf "${GREEN}Best practices passed${NC}\n"; return 0; }
    (( ${#bp_errs[@]} == 0 )) && { printf "${YELLOW}Completed with warnings${NC}\n"; return 0; }
    printf "${RED}Best practices failed${NC}\n"; return 1
}
_run_optimization() {
    local -r content="$1"
    printf "${CYAN}${BOLD}[5/5] Optimization Analysis${NC}\n\n"
    local -a from_lines=()
    mapfile -t from_lines < <(rg "^FROM" <<< "${content}" || true)
    local from_line image base_name from_count="${#from_lines[@]}" run_count=""
    printf "${BLUE}Base Image Analysis:${NC}\n"
    for from_line in "${from_lines[@]}"; do
        [[ "${from_line}" =~ ^FROM[[:space:]]+([^[:space:]]+) ]] || continue
        image="${BASH_REMATCH[1]}"
        base_name="${image##*/}"; base_name="${base_name%%:*}"
        [[ -v _HEAVY_BASES["${base_name}"] ]] && printf "  ${PURPLE}[OPT] Consider Alpine/slim for: %s${NC}\n" "${image}"
    done
    printf "\n${BLUE}Build Structure:${NC}\n"
    (( from_count == 1 )) && {
        { rg -q "apt-get install.*(gcc|make|build)" <<< "${content}" || rg -q "apk add.*(gcc|make|build)" <<< "${content}"; } && \
            printf "  ${PURPLE}[OPT] Build tools in single-stage -- use multi-stage${NC}\n"; }
    (( from_count > 1 )) && [[ "${from_lines[-1]}" =~ ^FROM[[:space:]]+([^[:space:]]+) ]] && {
        local -r final="${BASH_REMATCH[1]}"
        rg -qi "distroless|alpine|scratch|slim" <<< "${final}" \
            && printf "  ${GREEN}Minimal final stage: %s${NC}\n" "${final}" \
            || printf "  ${PURPLE}[OPT] Final stage could use smaller base (alpine/slim/distroless/scratch)${NC}\n"; }
    run_count=$(rg -c "^RUN" <<< "${content}") || run_count="0"
    printf "\n${BLUE}Layers:${NC} %d RUN commands\n" "${run_count}"
    (( run_count > 7 )) && printf "  ${PURPLE}[OPT] Combine RUN commands to reduce layers${NC}\n"
    printf "\n${BLUE}BuildKit Features:${NC}\n"
    rg -q "pip install|npm ci|npm install|go mod download|pnpm install" <<< "${content}" && \
        ! rg -q "\-\-mount=type=cache" <<< "${content}" && \
        printf "  ${PURPLE}[OPT] Use --mount=type=cache for package manager caches${NC}\n"
    rg -q "^COPY --from=" <<< "${content}" && ! rg -q "^COPY --link" <<< "${content}" && \
        printf "  ${PURPLE}[OPT] Use COPY --link for layer-independent copying${NC}\n"
    [[ ! -f "${DOCKERFILE%/*}/.dockerignore" ]] && \
        printf "\n${YELLOW}[INFO] No .dockerignore found -- build context includes everything${NC}\n"
    printf "\n${GREEN}Optimization analysis complete${NC}\n"
}
