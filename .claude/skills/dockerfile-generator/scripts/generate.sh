#!/usr/bin/env bash
# Unified Dockerfile/dockerignore generator -- pnpm monorepo aware
# BuildKit heredoc + secret env mount + STOPSIGNAL + Pulumi-injectable ARGs
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [SOURCE] -----------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_nodejs.sh"
source "${SCRIPT_DIR}/_python.sh"
source "${SCRIPT_DIR}/_golang.sh"
source "${SCRIPT_DIR}/_java.sh"

# --- [CONSTANTS] --------------------------------------------------------------

declare -Ar _DEFAULTS=(
    [nodejs_version]=24     [nodejs_port]=3000   [nodejs_entry]=dist/main.js
    [python_version]=3.14   [python_port]=8000   [python_entry]=app.py
    [golang_version]=1.26   [golang_port]=8080   [golang_binary]=app     [golang_base]=distroless
    [java_version]=21       [java_port]=8080     [java_tool]=maven
)
declare -Ar _DOCKERIGNORE_PATTERNS=(
    [nodejs]="node_modules/ .npm .yarn .pnp.* .pnpm-store dist/ build/ npm-debug.log* pnpm-debug.log* yarn-debug.log* yarn-error.log*"
    [python]="__pycache__/ *.py[cod] *\$py.class *.so .Python venv/ .venv/ .pytest_cache/ .tox/ *.egg-info/ dist/ build/ .mypy_cache/ .ruff_cache/"
    [golang]="vendor/ *.exe *.test *.out go.work go.work.sum"
    [java]="target/ *.class *.jar *.war *.ear .gradle/ build/ .mvn/ !.mvn/wrapper/maven-wrapper.jar"
    [generic]="dist/ build/ target/ out/"
)
declare -Ar _JAR_PATHS=(
    [maven]="target/app.jar"
    [gradle]="build/libs/app.jar"
)

# --- [FUNCTIONS] --------------------------------------------------------------

_dockerignore() {
    local -r lang="${1:-generic}"
    cat <<'BASE'
# Version control
.git
.gitignore
.gitattributes
.gitmodules
# CI/CD
.github
.gitlab-ci.yml
.circleci
Jenkinsfile
# Documentation
*.md
docs/
LICENSE
# Docker (prevent recursive context)
Dockerfile*
.dockerignore
docker-compose*.yml
docker-bake.hcl
# Environment / Secrets
.env
.env.*
*.local
.envrc
*.pem
*.key
*.crt
credentials.json
# Logs
logs/
*.log
# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store
# Testing
coverage/
.coverage
test-results/
.pytest_cache/
.tox/
playwright-report/
stryker.config.*
# Build artifacts
*.tsbuildinfo
# Monorepo tooling
.nx/cache
.nx/workspace-data
.vite
.turbo/
# Infrastructure / AI tooling
infrastructure/
pulumi/
.pulumi/
.claude/
.planning/
CLAUDE.md
BASE
    local -r patterns="${_DOCKERIGNORE_PATTERNS[${lang}]:-}"
    [[ -n "${patterns}" ]] && printf '\n# %s\n%s\n' "${lang}" "${patterns}"
}
_usage() {
    printf '%s\n' \
        "Usage: $0 <language> [OPTIONS]" \
        "Languages: nodejs, python, golang, java, dockerignore" \
        "Options: -v VERSION  -p PORT  -o OUTPUT  -e ENTRY  -s SCOPE (monorepo)" \
        "         -t TOOL (maven|gradle)  --distroless|--scratch|--alpine (Go)" \
        "         --standalone (Node.js without monorepo)  -l LANG (dockerignore)"
    exit "${1:-0}"
}
declare -Ar _LANG_GENERATORS=(
    [nodejs]=_nodejs_dockerfile
    [python]=_python_dockerfile
    [golang]=_golang_dockerfile
    [java]=_java_dockerfile
)

# --- [EXPORT] -----------------------------------------------------------------
main() {
    [[ $# -lt 1 ]] && _usage 1
    local lang="$1"; shift
    local version="" port="" output="Dockerfile" entry="" scope="" tool="" base="" monorepo="true"
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)    version="$2"; shift 2 ;;
            -p|--port)       port="$2"; shift 2 ;;
            -o|--output)     output="$2"; shift 2 ;;
            -e|--entry)      entry="$2"; shift 2 ;;
            -s|--scope)      scope="$2"; shift 2 ;;
            -t|--tool)       tool="$2"; shift 2 ;;
            -l|--language)   lang="$2"; shift 2 ;;
            --distroless)    base="distroless"; shift ;;
            --scratch)       base="scratch"; shift ;;
            --alpine)        base="alpine"; shift ;;
            --standalone)    monorepo="false"; shift ;;
            -h|--help)       _usage 0 ;;
            *)               printf 'Unknown: %s\n' "$1"; _usage 1 ;;
        esac
    done
    case "${lang}" in
        dockerignore)
            output="${output:-.dockerignore}"; _dockerignore "${entry:-generic}" > "${output}"
            printf '[OK] Generated: %s (%s)\n' "${output}" "${lang}"; return ;;
    esac
    local -r generator="${_LANG_GENERATORS[${lang}]:-}"
    [[ -n "${generator}" ]] || { printf 'Unknown language: %s\n' "${lang}"; _usage 1; }
    case "${lang}" in
        nodejs)
            "${generator}" \
                "${version:-${_DEFAULTS[nodejs_version]}}" \
                "${port:-${_DEFAULTS[nodejs_port]}}" \
                "${entry:-${_DEFAULTS[nodejs_entry]}}" \
                "${scope:-@scope/app}" \
                "${monorepo}" > "${output}" ;;
        python)
            "${generator}" \
                "${version:-${_DEFAULTS[python_version]}}" \
                "${port:-${_DEFAULTS[python_port]}}" \
                "${entry:-${_DEFAULTS[python_entry]}}" > "${output}" ;;
        golang)
            "${generator}" \
                "${version:-${_DEFAULTS[golang_version]}}" \
                "${port:-${_DEFAULTS[golang_port]}}" \
                "${entry:-${_DEFAULTS[golang_binary]}}" \
                "${base:-${_DEFAULTS[golang_base]}}" > "${output}" ;;
        java)
            "${generator}" \
                "${version:-${_DEFAULTS[java_version]}}" \
                "${port:-${_DEFAULTS[java_port]}}" \
                "${tool:-${_DEFAULTS[java_tool]}}" > "${output}" ;;
    esac
    printf '[OK] Generated: %s (%s)\n' "${output}" "${lang}"
}
main "$@"
