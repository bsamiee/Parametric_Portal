#!/usr/bin/env bash
# --- python-check.sh — Run ruff linting and ty type-checking -----------------
set -euo pipefail

declare HAS_PYTHON
HAS_PYTHON=$(
    fd -HI -e py . \
        --exclude .claude --exclude .cache --exclude .git --exclude .nx \
        --exclude .venv --exclude _TMP --exclude node_modules --exclude dist \
        --exclude build --exclude coverage --exclude test-results \
        | head -1 \
        || true
)

[[ -z "${HAS_PYTHON}" ]] && {
    echo "[python] skipped (no Python files in workspace scope)"
    exit 0
}

uv run ruff check . --config pyproject.toml
uv run ty check --project . --respect-ignore-files --force-exclude --error-on-warning --no-progress
