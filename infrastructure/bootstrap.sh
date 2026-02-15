#!/usr/bin/env bash
#
# bootstrap.sh -- Zero-to-ready Doppler + Pulumi bootstrap (idempotent)
# Usage: infrastructure/bootstrap.sh
#
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly SCRIPT_DIR
readonly PROJECT="parametric"
readonly STATE_DIR="${HOME}/.pulumi-state"
readonly SECRET_KEY="PULUMI_CONFIG_PASSPHRASE"
declare -Ar STACK_CONFIG=([dev]=dev [prod]=prd)

# --- [ERRORS] -----------------------------------------------------------------

_log() { printf '%-6s %s\n' "$1" "${*:2}" >&2; }
die() { _log "[FAIL]" "$@"; exit 1; }

# --- [FUNCTIONS] --------------------------------------------------------------

_require() { type -P "$1" &>/dev/null || die "$1 required; not installed"; }

_main() {
    # -- [PREREQUISITES] -------------------------------------------------------
    _require openssl
    type -P curl &>/dev/null || type -P wget &>/dev/null || die "curl or wget required"
    # -- [DOPPLER_CLI] ---------------------------------------------------------
    type -P doppler &>/dev/null && _log "[SKIP]" "doppler CLI (installed)" || {
        _log "[RUN]" "install doppler CLI"
        _require sudo
        { curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh \
            || wget -t 3 -qO- https://cli.doppler.com/install.sh; } | sudo sh
    }
    _log "[OK]" "doppler $(doppler --version 2>&1 | head -1)"
    # -- [DOPPLER_AUTH] --------------------------------------------------------
    doppler me &>/dev/null && _log "[SKIP]" "doppler auth (authenticated)" || {
        _log "[RUN]" "doppler login"
        doppler login
    }
    # -- [DOPPLER_PROJECT] -----------------------------------------------------
    doppler projects get "${PROJECT}" &>/dev/null && _log "[SKIP]" "project [${PROJECT}] (exists)" || {
        _log "[RUN]" "create project [${PROJECT}]"
        doppler projects create "${PROJECT}" \
            --description 'Parametric Portal infrastructure and runtime secrets'
    }
    # -- [DOPPLER_SECRETS] -----------------------------------------------------
    local stack config
    for stack in "${!STACK_CONFIG[@]}"; do
        config="${STACK_CONFIG[${stack}]}"
        doppler secrets get "${SECRET_KEY}" --project "${PROJECT}" --config "${config}" --plain &>/dev/null \
            && _log "[SKIP]" "${SECRET_KEY} [${config}] (exists)" || {
            _log "[RUN]" "${SECRET_KEY} [${config}]"
            doppler secrets set "${SECRET_KEY}=$(openssl rand -base64 32)" \
                --project "${PROJECT}" --config "${config}"
        }
    done
    # -- [SERVICE_TOKENS] ------------------------------------------------------
    local token_name existing_tokens
    for stack in "${!STACK_CONFIG[@]}"; do
        config="${STACK_CONFIG[${stack}]}"
        token_name="runtime-${config}"
        existing_tokens="$(doppler configs tokens --project "${PROJECT}" --config "${config}" --json 2>/dev/null || printf '[]')"
        printf '%s' "${existing_tokens}" | grep -q "\"name\":\"${token_name}\"" \
            && _log "[SKIP]" "service token [${token_name}] (exists)" || {
            _log "[RUN]" "create service token [${token_name}]"
            local svc_token
            svc_token="$(doppler configs tokens create \
                --project "${PROJECT}" --config "${config}" \
                --name "${token_name}" --plain 2>/dev/null)" \
                && _log "[OK]" "Set DOPPLER_TOKEN=${svc_token} in your .env.local or deployment config [${config}]" \
                || _log "[FAIL]" "could not create service token [${token_name}]"
        }
    done
    # -- [PULUMI_BACKEND] ------------------------------------------------------
    mkdir -p "${STATE_DIR}"
    _log "[RUN]" "pulumi login file://${STATE_DIR}"
    pulumi login "file://${STATE_DIR}"
    # -- [PULUMI_STACKS] -------------------------------------------------------
    for stack in "${!STACK_CONFIG[@]}"; do
        config="${STACK_CONFIG[${stack}]}"
        export PULUMI_CONFIG_PASSPHRASE
        PULUMI_CONFIG_PASSPHRASE="$(doppler secrets get "${SECRET_KEY}" \
            --project "${PROJECT}" --config "${config}" --plain)"
        _log "[RUN]" "pulumi stack select --create ${stack}"
        pulumi stack select --create "${stack}" \
            --secrets-provider passphrase --cwd "${SCRIPT_DIR}"
    done
    export PULUMI_CONFIG_PASSPHRASE
    PULUMI_CONFIG_PASSPHRASE="$(doppler secrets get "${SECRET_KEY}" \
        --project "${PROJECT}" --config "${STACK_CONFIG[dev]}" --plain)"
    pulumi stack select dev --cwd "${SCRIPT_DIR}"
    _log "[OK]" "active stack: dev"
    # -- [SUMMARY] -------------------------------------------------------------
    printf '\n' >&2
    _log "[OK]" "bootstrap complete"
    _log "[OK]" "  doppler project: ${PROJECT}"
    _log "[OK]" "  doppler configs: ${STACK_CONFIG[*]}"
    _log "[OK]" "  pulumi backend:  file://${STATE_DIR}"
    _log "[OK]" "  pulumi stacks:   ${!STACK_CONFIG[*]}"
    _log "[OK]" "  active stack:    dev"
}
_main "$@"
