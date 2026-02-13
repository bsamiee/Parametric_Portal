#!/usr/bin/env bash
# SessionStart hook: Persist environment variables for sub-agents via CLAUDE_ENV_FILE.
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly TOKEN_CACHE="${HOME}/.config/hm-op-session.sh"
declare -ra _ENV_KEYS=(EXA_API_KEY PERPLEXITY_API_KEY TAVILY_API_KEY SONAR_TOKEN
    GH_TOKEN GITHUB_TOKEN GH_PROJECTS_TOKEN
    HOSTINGER_TOKEN GREPTILE_TOKEN CONTEXT7_API_KEY)

# --- [EXPORT] -----------------------------------------------------------------

[[ -f "${TOKEN_CACHE}" && "${TOKEN_CACHE}" == "${HOME}/.config/"* ]] \
    || { printf '[ERROR] Invalid token cache path\n' >&2; exit 2; }
# shellcheck source=/dev/null  # Path validated above via glob guard
source "${TOKEN_CACHE}"
[[ -n "${CLAUDE_ENV_FILE:-}" ]] || exit 0
readonly _ENV_TMP="${CLAUDE_ENV_FILE}.tmp$$"
trap 'rm -f "${_ENV_TMP}"' EXIT
{
    for key in "${_ENV_KEYS[@]}"; do
        [[ -n "${!key:-}" ]] && printf 'export %s=%q\n' "${key}" "${!key}"
    done
    # shellcheck disable=SC2016  # Single quotes intentional -- expand at runtime
    printf 'export PATH="%s:${PATH}"\n' "${HOME}/.cargo/bin"
} > "${_ENV_TMP}" && mv "${_ENV_TMP}" "${CLAUDE_ENV_FILE}"
