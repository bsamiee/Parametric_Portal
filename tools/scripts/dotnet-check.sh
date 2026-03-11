#!/usr/bin/env bash
# --- dotnet-check.sh — Orchestrate .NET restore, build, and test via Nx ------
set -euo pipefail

readonly AFFECTED_FLAG="${1:-}"

declare NX_SHOW_ARGS
NX_SHOW_ARGS="show projects --withTarget=restore"
[[ -n "${AFFECTED_FLAG}" ]] && NX_SHOW_ARGS+=" --affected --base=origin/main"

declare PROJECT_LIST
PROJECT_LIST=$(
    # shellcheck disable=SC2086
    pnpm -s exec nx ${NX_SHOW_ARGS} 2>/dev/null \
        | rg --no-config --no-line-number --color=never '^[[:alnum:]@._/-]+$' \
        || true
)

declare PROJECTS
PROJECTS=$(
    printf '%s\n' "${PROJECT_LIST}" \
        | rg --no-config --no-line-number --color=never -v '^$' \
        | paste -sd, - \
        || true
)

[[ -z "${PROJECTS}" ]] && {
    echo "[dotnet] skipped (no .NET projects${AFFECTED_FLAG:+ affected})"
    exit 0
}

pnpm exec nx run-many -t restore,build --projects="${PROJECTS}" --parallel=4

declare TEST_PROJECT_LIST
TEST_PROJECT_LIST=$(
    pnpm -s exec nx show projects --withTarget=test \
        ${AFFECTED_FLAG:+--affected --base=origin/main} 2>/dev/null \
        | rg --no-config --no-line-number --color=never '^[[:alnum:]@._/-]+$' \
        || true
)

declare DOTNET_TMP
DOTNET_TMP=$(mktemp)
printf '%s\n' "${PROJECT_LIST}" > "${DOTNET_TMP}"

declare DOTNET_TEST_PROJECTS
DOTNET_TEST_PROJECTS=$(
    printf '%s\n' "${TEST_PROJECT_LIST}" \
        | rg --no-config --no-line-number --color=never -Ff "${DOTNET_TMP}" \
        | paste -sd, - \
        || true
)

rm -f "${DOTNET_TMP}"

[[ -z "${DOTNET_TEST_PROJECTS}" ]] && {
    echo "[dotnet] skipped .NET tests (no test targets${AFFECTED_FLAG:+ affected})"
    exit 0
}

pnpm exec nx run-many -t test --projects="${DOTNET_TEST_PROJECTS}" --parallel=4
