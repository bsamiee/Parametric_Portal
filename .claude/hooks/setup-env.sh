#!/usr/bin/env bash
# SessionStart hook: Persist environment variables for sub-agents via CLAUDE_ENV_FILE.
set -Eeuo pipefail

# Source token cache if exists (populated by home-manager activation)
readonly TOKEN_CACHE="${HOME}/.config/hm-op-session.sh"
# shellcheck source=/dev/null
[[ -f "${TOKEN_CACHE}" ]] && source "${TOKEN_CACHE}"

# NOTE: ANTHROPIC_API_KEY intentionally excluded -- Claude Code uses OAuth
# Set membership via associative array -- O(1) key existence check via [[ -v ]]
declare -Ar _ENV_KEYS=(
    [EXA_API_KEY]=1 [PERPLEXITY_API_KEY]=1 [TAVILY_API_KEY]=1 [SONAR_TOKEN]=1
    [GH_TOKEN]=1 [GITHUB_TOKEN]=1 [GH_PROJECTS_TOKEN]=1
    [HOSTINGER_TOKEN]=1 [GREPTILE_TOKEN]=1 [CONTEXT7_API_KEY]=1
)

# Persist non-empty keys to CLAUDE_ENV_FILE for sub-agent inheritance
[[ -n "${CLAUDE_ENV_FILE:-}" ]] && {
    for key in "${!_ENV_KEYS[@]}"; do
        [[ -n "${!key:-}" ]] && printf 'export %s="%s"\n' "${key}" "${!key}"
    done >> "${CLAUDE_ENV_FILE}"
}

exit 0
