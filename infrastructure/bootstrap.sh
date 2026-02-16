#!/usr/bin/env bash
# bootstrap.sh -- Zero-to-ready Doppler + Pulumi bootstrap (idempotent)
set -Eeuo pipefail
shopt -s inherit_errexit
shopt -s nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"; readonly SCRIPT_DIR
readonly VERSION="2.0.0"
readonly EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
readonly SECRET_KEY="PULUMI_CONFIG_PASSPHRASE"
readonly DEFAULT_PROJECT="parametric"
readonly DEFAULT_STACK_MAP="dev=dev,prod=prod"
readonly DEFAULT_ACTIVE_STACK="dev"
readonly DEFAULT_BACKEND_URL="file://${HOME}/.pulumi-state"
readonly DEFAULT_LOCK_FILE="${HOME}/.cache/parametric-bootstrap.lock"
readonly RETRY_ATTEMPTS=4
readonly RETRY_BASE_MS=250
_BOLD="" _DIM="" _RESET=""
[[ -t 2 ]] && (( $(tput colors 2>/dev/null || printf '0') >= 8 )) && { _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RESET=$'\033[0m'; }
readonly _BOLD _DIM _RESET
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"
    [V]="-V|--version|Show version||"
    [v]="-v|--verbose|Verbose output||"
    [d]="-d|--debug|Debug mode (implies verbose)||"
    [n]="-n|--dry-run|Preview changes only||"
    [p]="|--project|Doppler project slug|PROJECT|${DEFAULT_PROJECT}"
    [b]="|--backend-url|Pulumi backend URL|URL|${DEFAULT_BACKEND_URL}"
    [m]="|--stack-map|Stack to config map|CSV|${DEFAULT_STACK_MAP}"
    [a]="|--active-stack|Stack to select at end|STACK|${DEFAULT_ACTIVE_STACK}"
    [l]="|--lock-file|Lock file path|PATH|${DEFAULT_LOCK_FILE}"
)
declare -Ar _LOG_LEVELS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
DRY_RUN=false
LOG_LEVEL=1
PROJECT="${DEFAULT_PROJECT}"
BACKEND_URL="${DEFAULT_BACKEND_URL}"
STACK_MAP="${DEFAULT_STACK_MAP}"
ACTIVE_STACK="${DEFAULT_ACTIVE_STACK}"
LOCK_FILE="${DEFAULT_LOCK_FILE}"
declare -A STACK_CONFIG=()
declare -a STACK_ORDER=()

# --- [LOGGING] ----------------------------------------------------------------

_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-3} >= LOG_LEVEL )) || return 0
    local ts; printf -v ts '%(%F %T)T' -1
    printf '%-7s %s [%s:%d] %s\n' "[${level}]" "${ts}" "${FUNCNAME[2]:-main}" "${BASH_LINENO[1]:-0}" "$*" >&2
}
_info()     { _log INFO "$@"; }
_warn()     { _log WARN "$@"; }
_err()      { _log ERROR "$@"; }
die()       { _err "$@"; exit "${EX_ERR}"; }
die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_cleanup() { [[ -n "${LOCK_FD:-}" ]] && exec {LOCK_FD}>&- || true; }
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}"
    _err "Command failed (rc=${rc}): ${cmd}"
    _err "  at ${BASH_SOURCE[1]:-unknown}:${BASH_LINENO[0]:-?} in ${FUNCNAME[1]:-main}"
}
_require_cmd() {
    local -r cmd="$1" hint="$2"
    command -v "${cmd}" >/dev/null 2>&1 || die "Missing '${cmd}'. ${hint}"
}
_usage() {
    local -r cols="$(tput cols 2>/dev/null || printf '80')"
    local -r pad=$(( cols > 100 ? 34 : 30 ))
    printf '%s%s v%s%s\n\n' "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}"
    printf '%sUSAGE:%s\n  %s [OPTIONS]\n\n' "${_BOLD}" "${_RESET}" "${SCRIPT_NAME}"
    printf '%sOPTIONS:%s\n' "${_BOLD}" "${_RESET}"
    local key short long desc value_name default flag
    for key in h V v d n p b m a l; do
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}${short:+, }${long}"; [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
    printf '\n%sEXAMPLES:%s\n' "${_BOLD}" "${_RESET}"
    printf '  %s --dry-run\n' "${SCRIPT_NAME}"
    printf '  %s --stack-map dev=dev,prod=prod --active-stack dev\n' "${SCRIPT_NAME}"
}
_parse_stack_map() {
    local -r raw="$1"
    STACK_CONFIG=(); STACK_ORDER=()
    local -a pairs=(); IFS=, read -ra pairs <<< "${raw}"
    local pair stack config
    for pair in "${pairs[@]}"; do
        [[ "${pair}" =~ ^([A-Za-z0-9_-]+)=([A-Za-z0-9_-]+)$ ]] || die_usage "Invalid --stack-map entry: ${pair}"
        stack="${BASH_REMATCH[1]}"; config="${BASH_REMATCH[2]}"
        STACK_CONFIG["${stack}"]="${config}"; STACK_ORDER+=("${stack}")
    done
    (( ${#STACK_ORDER[@]} > 0 )) || die_usage "--stack-map must contain at least one mapping"
    [[ -v STACK_CONFIG["${ACTIVE_STACK}"] ]] || die_usage "--active-stack '${ACTIVE_STACK}' not present in --stack-map"
}
_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help) _usage; exit 0 ;;
            -V|--version) printf '%s %s\n' "${SCRIPT_NAME}" "${VERSION}"; exit 0 ;;
            -v|--verbose|-d|--debug) LOG_LEVEL=0; shift ;;
            -n|--dry-run) DRY_RUN=true; shift ;;
            --project) PROJECT="${2:?--project requires value}"; shift 2 ;;
            --backend-url) BACKEND_URL="${2:?--backend-url requires value}"; shift 2 ;;
            --stack-map) STACK_MAP="${2:?--stack-map requires value}"; shift 2 ;;
            --active-stack) ACTIVE_STACK="${2:?--active-stack requires value}"; shift 2 ;;
            --lock-file) LOCK_FILE="${2:?--lock-file requires value}"; shift 2 ;;
            --self-test) _self_test; exit 0 ;;
            --) shift; break ;;
            -*) die_usage "Unknown option: $1" ;;
            *) die_usage "Unexpected positional argument: $1" ;;
        esac
    done
}
_retry() {
    local -r attempts="$1" base_ms="$2"; shift 2
    local -i attempt=1 sleep_ms
    local sleep_s
    until "$@"; do
        (( attempt >= attempts )) && return 1
        sleep_ms=$(( base_ms * (2 ** (attempt - 1)) + RANDOM % 200 ))
        printf -v sleep_s '%d.%03d' "$((sleep_ms / 1000))" "$((sleep_ms % 1000))"
        _warn "Retry ${attempt}/${attempts}: $*"
        sleep "${sleep_s}"
        ((attempt += 1))
    done
}
_run_mutating() {
    local -r label="$1"; shift
    [[ "${DRY_RUN}" == "true" ]] && { _info "[DRY-RUN] ${label}: $*"; return 0; }
    _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" "$@" || die "${label} failed"
}
_acquire_lock() {
    mkdir -p "$(dirname "${LOCK_FILE}")"
    exec {LOCK_FD}>"${LOCK_FILE}" || die "Cannot open lock file: ${LOCK_FILE}"
    flock -n "${LOCK_FD}" || die "Another bootstrap is running (lock: ${LOCK_FILE})"
}
_validate_prerequisites() {
    _require_cmd doppler "Install Doppler CLI: https://docs.doppler.com/docs/cli"
    _require_cmd pulumi "Install Pulumi CLI: https://www.pulumi.com/docs/install/"
    _require_cmd jq "Install jq: https://jqlang.org/download/"
    _require_cmd openssl "Install OpenSSL for passphrase generation"
    _require_cmd curl "Install curl for health checks"
    _require_cmd flock "Install util-linux for file locking support"
    _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler me --json >/dev/null 2>&1 || die "Doppler auth required. Run: doppler login"
}
_ensure_project() {
    _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler projects get "${PROJECT}" >/dev/null 2>&1 && { _info "[SKIP] doppler project '${PROJECT}'"; return 0; }
    _run_mutating "Create Doppler project" doppler projects create "${PROJECT}" --description "Parametric Portal infrastructure and runtime secrets"
}
_ensure_passphrase_secret() {
    local -r config="$1"
    _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler secrets get "${SECRET_KEY}" --project "${PROJECT}" --config "${config}" --plain >/dev/null 2>&1 && { _info "[SKIP] ${SECRET_KEY} exists in ${config}"; return 0; }
    [[ "${DRY_RUN}" == "true" ]] && { _info "[DRY-RUN] Set ${SECRET_KEY} for ${config}"; return 0; }
    local -r passphrase="$(openssl rand -base64 32)"
    _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler secrets set "${SECRET_KEY}=${passphrase}" --project "${PROJECT}" --config "${config}" --silent >/dev/null
    _info "[OK] ${SECRET_KEY} set for ${config}"
}
_ensure_service_token() {
    local -r config="$1"
    local -r token_name="runtime-${config}"
    local tokens_json
    tokens_json="$(_retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler configs tokens --project "${PROJECT}" --config "${config}" --json 2>/dev/null || printf '{"tokens":[]}')"
    jq -e --arg name "${token_name}" '(.tokens // .api_tokens // []) | any(.name == $name)' <<< "${tokens_json}" >/dev/null 2>&1 && { _info "[SKIP] service token '${token_name}' exists in ${config}"; return 0; }
    [[ "${DRY_RUN}" == "true" ]] && { _info "[DRY-RUN] Create service token '${token_name}' in ${config}"; return 0; }
    local created_token
    created_token="$(_retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler configs tokens create --project "${PROJECT}" --config "${config}" "${token_name}" --plain 2>/dev/null)" || die "Failed to create service token '${token_name}'"
    _info "[OK] service token '${token_name}' created (${#created_token} chars, value masked)"
}
_select_stack() {
    local -r stack="$1" config="$2"
    local passphrase
    passphrase="$(_retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" doppler secrets get "${SECRET_KEY}" --project "${PROJECT}" --config "${config}" --plain)" || die "Missing ${SECRET_KEY} in ${config}"
    [[ "${DRY_RUN}" == "true" ]] && { _info "[DRY-RUN] pulumi stack select --create ${stack}"; return 0; }
    PULUMI_CONFIG_PASSPHRASE="${passphrase}" _retry "${RETRY_ATTEMPTS}" "${RETRY_BASE_MS}" pulumi stack select --create "${stack}" --secrets-provider passphrase --cwd "${SCRIPT_DIR}" || die "Pulumi stack select failed for ${stack}"
}
_bootstrap() {
    local -r active_config="${STACK_CONFIG[${ACTIVE_STACK}]}"
    _ensure_project
    local stack
    for stack in "${STACK_ORDER[@]}"; do _ensure_passphrase_secret "${STACK_CONFIG[${stack}]}"; _ensure_service_token "${STACK_CONFIG[${stack}]}"; done
    _run_mutating "Pulumi login" pulumi login "${BACKEND_URL}"
    for stack in "${STACK_ORDER[@]}"; do _select_stack "${stack}" "${STACK_CONFIG[${stack}]}"; done
    _select_stack "${ACTIVE_STACK}" "${active_config}"
    _run_mutating "Doppler setup" doppler setup --project "${PROJECT}" --config "${active_config}" --scope "${SCRIPT_DIR}" --no-interactive
    _info "[OK] Active stack: ${ACTIVE_STACK}"; _info "[OK] Stack map: ${STACK_MAP}"; _info "[OK] Backend: ${BACKEND_URL}"
}

# --- [TESTING] ----------------------------------------------------------------

_self_test() {
    _parse_stack_map "dev=dev,prod=prod"
    [[ "${STACK_CONFIG[dev]}" == "dev" ]] && [[ "${STACK_CONFIG[prod]}" == "prod" ]] || die "self-test failed"
    _info "Self-test passed"
}

# --- [EXPORT] -----------------------------------------------------------------

trap _on_err ERR
trap _cleanup EXIT
_main() {
    _parse_args "$@"
    _parse_stack_map "${STACK_MAP}"
    readonly DRY_RUN LOG_LEVEL PROJECT BACKEND_URL STACK_MAP ACTIVE_STACK LOCK_FILE STACK_CONFIG STACK_ORDER
    umask 077
    export HISTIGNORE='*doppler*:*PULUMI_CONFIG_PASSPHRASE*:*DOPPLER_TOKEN*'
    _acquire_lock
    _validate_prerequisites
    _bootstrap
    _info "Bootstrap complete"
    return "${EX_OK}"
}
_main "$@"
