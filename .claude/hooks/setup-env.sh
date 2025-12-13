#!/bin/bash
# SessionStart hook: Persist environment variables for sub-agents via CLAUDE_ENV_FILE.

set -e

# Source token cache if exists (populated by home-manager activation)
TOKEN_CACHE="$HOME/.config/hm-op-session.sh"
# shellcheck source=/dev/null
[[ -f "$TOKEN_CACHE" ]] && source "$TOKEN_CACHE"

# Persist to CLAUDE_ENV_FILE for sub-agent inheritance
[[ -n "$CLAUDE_ENV_FILE" ]] && {
    [[ -n "$EXA_API_KEY" ]] && echo "export EXA_API_KEY=\"$EXA_API_KEY\"" >> "$CLAUDE_ENV_FILE"
    [[ -n "$PERPLEXITY_API_KEY" ]] && echo "export PERPLEXITY_API_KEY=\"$PERPLEXITY_API_KEY\"" >> "$CLAUDE_ENV_FILE"
    [[ -n "$TAVILY_API_KEY" ]] && echo "export TAVILY_API_KEY=\"$TAVILY_API_KEY\"" >> "$CLAUDE_ENV_FILE"
    [[ -n "$SONAR_TOKEN" ]] && echo "export SONAR_TOKEN=\"$SONAR_TOKEN\"" >> "$CLAUDE_ENV_FILE"
    # gh CLI prefers GH_TOKEN; GITHUB_TOKEN for other tools (Actions, etc.)
    [[ -n "$GH_TOKEN" ]] && echo "export GH_TOKEN=\"$GH_TOKEN\"" >> "$CLAUDE_ENV_FILE"
    [[ -n "$GITHUB_TOKEN" ]] && echo "export GITHUB_TOKEN=\"$GITHUB_TOKEN\"" >> "$CLAUDE_ENV_FILE"
    [[ -n "$HOSTINGER_TOKEN" ]] && echo "export HOSTINGER_TOKEN=\"$HOSTINGER_TOKEN\"" >> "$CLAUDE_ENV_FILE"
}

exit 0
