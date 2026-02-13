#!/usr/bin/env bash
# shellcheck disable=SC2059
# GitHub Actions Validator -- orchestration pipeline (lint, best practices, act dry-run)
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly SCRIPT_DIR
readonly TOOLS_DIR="${SCRIPT_DIR}/.tools"
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' NC='\033[0m'
# shellcheck disable=SC2016
readonly -a _HINT_PATTERNS=(
    "syntax|yaml|unexpected:common_errors.md - Syntax Errors"
    'expression|\${{:common_errors.md - Expression Errors'
    "cron|schedule:common_errors.md - Schedule Errors"
    "runner|runs-on|ubuntu|macos|windows:runners.md"
    "action|uses::common_errors.md - Action Errors"
    "docker|container:act_usage.md - Troubleshooting"
    "needs:|dependency|job:common_errors.md - Job Configuration"
    "injection|security|secret|untrusted:common_errors.md - Security"
    "workflow_call|reusable:modern_features.md"
    "oidc|id-token|attestation|slsa|cosign|sbom:supply_chain.md"
    "harden-runner|egress|supply.chain:supply_chain.md"
    "app.token|create-github-app-token|PAT|cross-repo:supply_chain.md"
    "immutable|publish-immutable|OCI|GHCR.action:supply_chain.md"
    "permission:common_errors.md - Best Practices"
    "timeout:common_errors.md - Best Practices"
    "concurrency:modern_features.md - Concurrency Control"
    "set-output|save-state|GITHUB_OUTPUT:common_errors.md - Deprecated Commands"
    "version|deprecated|outdated|node20|node24:modern_features.md - Node.js Runtime"
)

# --- [FUNCTIONS] --------------------------------------------------------------

_err()     { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; }
_warn()    { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
_info()    { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
_ok()      { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
_section() { printf "\n${BLUE}=== %s ===${NC}\n\n" "$1"; }
_ref()     { printf "${CYAN}[REF]${NC} %s\n" "$1"; }
_search() {
    local -r pattern="$1"; shift
    command -v rg &>/dev/null \
        && { rg -q "${pattern}" "$@" 2>/dev/null; return; }
    grep -Eq "${pattern}" "$@" 2>/dev/null
}
_get_tool_path() {
    [[ -f "${TOOLS_DIR}/$1" ]] && { printf "%s" "${TOOLS_DIR}/$1"; return; }
    command -v "$1" &>/dev/null && { command -v "$1"; return; }
    _err "$1 not found -- run install_tools.sh"; exit 2
}
_check_tools() {
    local missing=0
    [[ -f "${TOOLS_DIR}/actionlint" ]] || command -v actionlint &>/dev/null || { _err "actionlint not found"; missing=1; }
    [[ -f "${TOOLS_DIR}/act" ]] || command -v act &>/dev/null || { _err "act not found"; missing=1; }
    (( missing )) && { _err "Run install_tools.sh first"; exit 2; }
    return 0
}
_check_docker() { docker info &>/dev/null; }
_collect_workflow_files() {
    local -r workflow_path="$1"; local -n _collected=$2
    [[ -f "${workflow_path}" ]] && { _collected+=("${workflow_path}"); return; }
    [[ -d "${workflow_path}" ]] || return 0
    local -a found=()
    local has_fd=0
    command -v fd &>/dev/null && has_fd=1
    case "${has_fd}" in
        1) mapfile -d '' -t found < <(fd -e yml -e yaml --max-depth 1 --print0 . "${workflow_path}" 2>/dev/null) ;;
        *) mapfile -t found < <(find "${workflow_path}" -maxdepth 1 \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null) ;;
    esac
    _collected+=("${found[@]}")
}
_validate_with_actionlint() {
    local -r workflow_path="$1"
    _section "Running actionlint"
    local -r tool_path="$(_get_tool_path "actionlint")"
    local -a files=()
    _collect_workflow_files "${workflow_path}" files
    [[ ${#files[@]} -eq 0 ]] && { _warn "No workflow files found"; return 0; }
    _info "Validating: ${workflow_path} (${#files[@]} files)"
    local output exit_code=0
    output="$("${tool_path}" "${files[@]}" 2>&1)" || exit_code=$?
    [[ -n "${output}" ]] && printf "%s\n" "${output}"
    (( exit_code == 0 )) && { _info "actionlint passed"; return 0; }
    _err "actionlint found issues"
    printf "%s" "${output}"
    return 1
}
_find_repo_root() {
    local -r search_path="$1"
    local root=""
    root="$(cd "${search_path}" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" && { printf "%s" "${root}"; return; }
    local dir="${search_path}"
    [[ -f "${dir}" ]] && dir="${dir%/*}"
    while [[ "${dir}" != "/" ]]; do
        [[ -d "${dir}/.github/workflows" ]] && { printf "%s" "${dir}"; return; }
        dir="${dir%/*}"; [[ -z "${dir}" ]] && dir="/"
    done
    [[ -d "./.github/workflows" ]] && printf "%s" "${PWD}"
}
_test_with_act() {
    local -r workflow_path="$1"
    _section "Running act (validation)"
    _check_docker || { _err "Docker not running -- use --lint-only"; return 1; }
    local -r act_path="$(_get_tool_path "act")"
    local abs_path
    abs_path="$(cd "${workflow_path%/*}" 2>/dev/null && printf "%s/%s" "${PWD}" "${workflow_path##*/}")" || abs_path="${workflow_path}"
    local search_dir="${abs_path}"
    [[ -f "${search_dir}" ]] && search_dir="${search_dir%/*}"
    local repo_root
    repo_root="$(_find_repo_root "${search_dir}")"
    [[ -z "${repo_root}" ]] && { _warn "No .github/workflows found, skipping act"; return 0; }
    local wf_flag=""
    case "${abs_path}" in
        */.github/workflows/*) [[ -f "${abs_path}" ]] && wf_flag="${abs_path#"${repo_root}"/}" ;;
        */.github/workflows) ;;
        *) _warn "Path outside .github/workflows/, skipping act"; return 0 ;;
    esac
    local -ra imgs=(
        "-P" "ubuntu-latest=catthehacker/ubuntu:act-latest"
        "-P" "ubuntu-22.04=catthehacker/ubuntu:act-22.04"
        "-P" "ubuntu-24.04=catthehacker/ubuntu:act-24.04"
    )
    local -a list_cmd=("${act_path}" "--list")
    local -a dry_cmd=("${act_path}" "--dryrun")
    [[ -n "${wf_flag}" ]] && { list_cmd+=(-W "${wf_flag}"); dry_cmd+=(-W "${wf_flag}"); }
    list_cmd+=("${imgs[@]}")
    dry_cmd+=("--container-architecture" "linux/amd64" "${imgs[@]}")
    local -r original_dir="${PWD}"
    cd "${repo_root}" || { _err "Failed to cd to: ${repo_root}"; return 1; }
    trap 'cd "${original_dir}"' RETURN
    _info "Listing workflows..."
    "${list_cmd[@]}" 2>&1 | head -30 || _warn "Could not list workflows"
    printf "\n"
    _info "Dry-run validation..."
    local act_output act_exit=0
    act_output="$("${dry_cmd[@]}" 2>&1)" || act_exit=$?
    printf "%s\n" "${act_output}"
    (( act_exit == 0 )) && { _info "act validation passed"; return 0; }
    printf "%s" "${act_output}" | _search "unable to get git repo" && { _warn "Not a git repo, act limited"; return 0; }
    _err "act validation failed (exit: ${act_exit})"
    return 1
}
_show_reference_hints() {
    local -r output="$1"
    _section "Reference Documentation"
    local -A shown=()
    local pattern ref
    for hint in "${_HINT_PATTERNS[@]}"; do
        IFS=: read -r pattern ref <<< "${hint}"
        [[ -v shown["${ref}"] ]] && continue
        printf "%s" "${output}" | _search "${pattern}" && { _ref "See references/${ref}"; shown["${ref}"]=1; }
    done
    (( ${#shown[@]} == 0 )) && _ref "See references/common_errors.md"
}
_usage() {
    printf "Usage: %s [OPTIONS] <workflow-file-or-directory>\n\n" "$0"
    printf "Options:\n"
    printf "  --lint-only              Run actionlint only (no act, no best practices)\n"
    printf "  --test-only              Run act dry-run only\n"
    printf "  --check-best-practices   Run best practice checks only\n"
    printf "  --help                   Show this help\n\n"
    printf "Exit codes: 0 = pass, 1 = fail, 2 = tool missing\n\n"
    printf "Examples:\n"
    printf "  %s .github/workflows/ci.yml\n" "$0"
    printf "  %s --lint-only .github/workflows/\n" "$0"
    printf "  %s --check-best-practices examples/valid-ci.yml\n" "$0"
    exit 0
}

# --- [SOURCE] -----------------------------------------------------------------
# Source best_practice_checks.sh AFTER constants/functions (it depends on color
# vars, _err, _warn, _info, _section, _search, _collect_workflow_files).

# shellcheck source=best_practice_checks.sh
source "${SCRIPT_DIR}/best_practice_checks.sh"

# --- [EXPORT] -----------------------------------------------------------------

main() {
    local workflow_path="" lint_only=0 test_only=0 check_bp=0 docker_available=1
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --lint-only) lint_only=1; shift ;;
            --test-only) test_only=1; shift ;;
            --check-best-practices) check_bp=1; shift ;;
            --help) _usage ;;
            *) workflow_path="$1"; shift ;;
        esac
    done
    [[ -z "${workflow_path}" ]] && { _err "No workflow path specified"; _usage; }
    _section "GitHub Actions Validator"
    _info "Target: ${workflow_path}"
    _check_tools
    [[ lint_only -eq 0 && check_bp -eq 0 ]] && {
        _check_docker || { _warn "Docker not running, using lint-only mode"; docker_available=0; lint_only=1; }
    }
    local exit_code=0 lint_output=""

    # Mode: best-practices only
    [[ check_bp -eq 1 ]] && {
        _run_best_practice_checks "${workflow_path}" || exit_code=1
        [[ lint_only -eq 0 && test_only -eq 0 ]] && exit "${exit_code}"
    }

    # Stage 1: actionlint (static analysis)
    [[ test_only -eq 0 ]] && {
        lint_output="$(_validate_with_actionlint "${workflow_path}" 2>&1)" || exit_code=1
        printf "%s\n" "${lint_output}"
        _run_best_practice_checks "${workflow_path}" || exit_code=1
    }

    # Stage 2: act dry-run (requires Docker)
    [[ lint_only -eq 0 && docker_available -eq 1 ]] && { _test_with_act "${workflow_path}" || exit_code=1; }

    # Summary
    _section "Validation Summary"
    case "${exit_code}" in
        0) _ok "All validations passed" ;;
        *) _err "Some validations failed"
            [[ -n "${lint_output}" ]] && _show_reference_hints "${lint_output}"
            printf "\n"
            _info "Flags: --lint-only  --check-best-practices  --test-only" ;;
    esac
    exit "${exit_code}"
}
main "$@"
