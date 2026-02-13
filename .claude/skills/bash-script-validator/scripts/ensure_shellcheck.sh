#!/usr/bin/env bash
# Ensure shellcheck is available, then exec it with all arguments.
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [ERRORS] -----------------------------------------------------------------

_err() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2; }

# --- [FUNCTIONS] --------------------------------------------------------------

_require() {
    command -v "$1" &>/dev/null && return 0
    apt-get install -y "$1" 2>/dev/null && return 0
    dnf install -y "$1" 2>/dev/null && return 0
    _err "$1 not found and could not be installed"
    exit 2
}

# --- [EXPORT] -----------------------------------------------------------------

_require shellcheck
exec shellcheck "$@"
