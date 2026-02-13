#!/usr/bin/env bash
# shellcheck disable=SC2059
# GitHub Actions Validator -- best practice checks (sourced by validate_workflow.sh)
# Parent sets: set -Eeuo pipefail, color vars, _err/_warn/_info/_section/_search/_collect_workflow_files

# --- [CONSTANTS] --------------------------------------------------------------

readonly _SHA_PATTERN='^[0-9a-f]{40}$'
readonly _SHA_PIN_FMT='owner/repo@<40-hex-sha> # vX.Y.Z'
readonly _HARDEN_RUNNER='step-security/harden-runner'
declare -Ar _RUNNER_REPLACEMENTS=(
    [ubuntu-18.04]="ubuntu-24.04" [ubuntu-20.04]="ubuntu-24.04"
    [macos-12]="macos-15" [macos-13]="macos-15" [windows-2019]="windows-2025"
)
declare -Ar _INJECTION_FIELDS=(
    [github.event.pull_request.title]=1
    [github.event.pull_request.body]=1
    [github.event.pull_request.head.ref]=1
    [github.event.comment.body]=1
    [github.event.head_commit.message]=1
    [github.event.head_commit.author.name]=1
    [github.event.head_commit.author.email]=1
    [github.event.discussion.title]=1
    [github.event.discussion.body]=1
)

# --- [FUNCTIONS] --------------------------------------------------------------

_strip_quotes() {
    local -r stripped="${1//\"/}"
    printf "%s" "${stripped//\'/}"
}
_trim() {
    local result="${1#"${1%%[![:space:]]*}"}"
    result="${result%"${result##*[![:space:]]}"}"
    printf "%s" "${result}"
}
_check_deprecated_commands() {
    local -r filepath="$1"
    _search '::set-output |::save-state |::set-env |::add-path' "${filepath}" || return 0
    printf "  ${RED}[DEPRECATED-CMD]${NC} Uses removed workflow commands (::set-output, ::save-state, ::set-env, or ::add-path)\n"
    printf "  ${CYAN}Fix: >> \$GITHUB_OUTPUT / >> \$GITHUB_STATE / >> \$GITHUB_ENV / >> \$GITHUB_PATH${NC}\n"
    return 1
}
_check_permissions_block() {
    local -r content="$1"
    printf "%s" "${content}" | _search '^permissions:' && return 0
    printf "  ${RED}[PERMISSIONS]${NC} Missing top-level permissions: block (defaults to read-write)\n"
    printf "  ${CYAN}Fix: Add 'permissions: {}' for deny-all default, then grant minimal per-job permissions${NC}\n"
    return 0
}
_check_unpinned_actions() {
    local -r content="$1"
    local -a lines=()
    mapfile -t lines <<< "${content}"
    local action version
    for line in "${lines[@]}"; do
        [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
        [[ "${line}" =~ uses:[[:space:]]*([^@]+)@([^[:space:]#]+) ]] || continue
        action="$(_trim "${BASH_REMATCH[1]}")"
        action="${action//\"/}"; action="${action//\'/}"
        version="${BASH_REMATCH[2]}"
        [[ "${action}" == ./* || "${action}" == docker://* ]] && continue
        [[ "${version}" =~ ${_SHA_PATTERN} ]] && {
            [[ "${line}" =~ \#[[:space:]]*v[0-9] ]] || \
                printf "  ${YELLOW}[SHA-NO-COMMENT]${NC} %s@%.12s... -- missing version comment\n    ${CYAN}Fix: Append '# vX.Y.Z' for Dependabot/Renovate compatibility${NC}\n" "${action}" "${version}"
            continue
        }
        # Abbreviated SHA (< 40 chars hex) -- not collision-resistant
        [[ "${version}" =~ ^[0-9a-f]+$ && ${#version} -lt 40 ]] && {
            printf "  ${RED}[UNPINNED]${NC} %s@%s -- abbreviated SHA is not collision-resistant\n    ${CYAN}Fix: Use full 40-char SHA: ${_SHA_PIN_FMT}${NC}\n" "${action}" "${version}"
            continue
        }
        # Mutable tag ref -- branch or version tag
        printf "  ${RED}[UNPINNED]${NC} %s@%s -- mutable tag is a supply chain risk (CVE-2025-30066)\n    ${CYAN}Fix: Pin to full SHA: ${_SHA_PIN_FMT}${NC}\n" "${action}" "${version}"
    done
}
_check_timeout_minutes() {
    local -r content="$1"
    local -a lines=()
    mapfile -t lines <<< "${content}"
    local in_jobs=0 current_job="" has_timeout=0 indent_len=0
    for line in "${lines[@]}"; do
        [[ "${line}" =~ ^jobs:[[:space:]]*$ ]] && { in_jobs=1; continue; }
        (( in_jobs == 0 )) && continue
        (( indent_len == 0 )) && [[ "${line}" =~ ^([[:space:]]+)[a-zA-Z_] ]] && indent_len=${#BASH_REMATCH[1]}
        (( indent_len == 0 )) && continue
        [[ "${line}" =~ ^[[:space:]]{${indent_len}}([a-zA-Z_][a-zA-Z0-9_-]*): ]] && \
            ! [[ "${line}" =~ ^[[:space:]]{$((indent_len * 2))} ]] && {
            [[ -n "${current_job}" && has_timeout -eq 0 ]] && \
                printf "  ${YELLOW}[TIMEOUT]${NC} Job '%s' missing timeout-minutes (default is 6 hours)\n    ${CYAN}Fix: Add timeout-minutes: <N> to prevent runaway billing${NC}\n" "${current_job}"
            current_job="${BASH_REMATCH[1]}"; has_timeout=0
        }
        [[ "${line}" =~ timeout-minutes ]] && has_timeout=1
    done
    [[ -n "${current_job}" && has_timeout -eq 0 ]] && \
        printf "  ${YELLOW}[TIMEOUT]${NC} Job '%s' missing timeout-minutes (default is 6 hours)\n    ${CYAN}Fix: Add timeout-minutes: <N> to prevent runaway billing${NC}\n" "${current_job}"
}
_check_deprecated_runners() {
    local -r content="$1"
    local -a lines=()
    mapfile -t lines <<< "${content}"
    local runner replacement
    for line in "${lines[@]}"; do
        [[ "${line}" =~ runs-on:[[:space:]]*([^[:space:]#]+) ]] || continue
        runner="$(_strip_quotes "${BASH_REMATCH[1]}")"
        [[ -v _RUNNER_REPLACEMENTS["${runner}"] ]] || continue
        replacement="${_RUNNER_REPLACEMENTS[${runner}]}"
        printf "  ${RED}[RUNNER]${NC} '%s' is deprecated -- use '%s'\n" "${runner}" "${replacement}"
    done
}
_check_concurrency_group() {
    local -r content="$1"
    printf "%s" "${content}" | _search '^concurrency:' || {
        printf "  ${YELLOW}[CONCURRENCY]${NC} No concurrency group -- redundant runs waste runner minutes\n"
        printf "  ${CYAN}Fix: Add concurrency group with cancel-in-progress for CI workflows${NC}\n"
        return 0
    }
    # Concurrency present -- check for cancel-in-progress key
    printf "%s" "${content}" | _search 'cancel-in-progress:' || \
        printf "  ${YELLOW}[CONCURRENCY]${NC} concurrency group missing cancel-in-progress key\n    ${CYAN}Fix: Add cancel-in-progress: true (CI) or false (deploys)${NC}\n"
    return 0
}
_check_pat_usage() {
    local -r content="$1"
    printf "%s" "${content}" | _search 'secrets\.(PAT|PERSONAL_ACCESS_TOKEN|GH_PAT|GITHUB_PAT)' || return 0
    printf "  ${YELLOW}[APP-TOKEN]${NC} PAT detected for cross-repo ops\n"
    printf "  ${CYAN}Fix: Use actions/create-github-app-token -- scoped, auditable, 1-hour TTL${NC}\n"
    return 0
}
_check_harden_runner() {
    local -r content="$1"
    printf "%s" "${content}" | _search "${_HARDEN_RUNNER}" || {
        printf "  ${RED}[HARDEN]${NC} Missing ${_HARDEN_RUNNER} -- detected tj-actions breach (CVE-2025-30066)\n"
        printf "  ${CYAN}Fix: Add as first step in every job, SHA-pinned${NC}\n"
        return 0
    }
    # Verify harden-runner is the first step in each job's steps: array
    local -a lines=()
    mapfile -t lines <<< "${content}"
    local in_steps=0 found_first_uses=0 current_job=""
    for line in "${lines[@]}"; do
        [[ "${line}" =~ ^[[:space:]]{2}([a-zA-Z_][a-zA-Z0-9_-]*):$ ]] && { current_job="${BASH_REMATCH[1]}"; in_steps=0; found_first_uses=0; continue; }
        [[ "${line}" =~ ^[[:space:]]+steps: ]] && { in_steps=1; found_first_uses=0; continue; }
        (( in_steps == 0 )) && continue
        [[ "${line}" =~ uses:[[:space:]]* ]] && (( found_first_uses == 0 )) && {
            found_first_uses=1
            [[ "${line}" =~ ${_HARDEN_RUNNER} ]] || \
                printf "  ${YELLOW}[HARDEN]${NC} Job '%s' -- harden-runner is not the first step\n    ${CYAN}Fix: Move ${_HARDEN_RUNNER} to be the first step in steps:${NC}\n" "${current_job}"
        }
    done
    return 0
}
_check_expression_injection() {
    local -r content="$1"
    local -a lines=()
    mapfile -t lines <<< "${content}"
    local in_run=0 field
    for line in "${lines[@]}"; do
        [[ "${line}" =~ ^[[:space:]]+-?[[:space:]]*run:[[:space:]]* ]] && { in_run=1; continue; }
        (( in_run )) && [[ "${line}" =~ ^[[:space:]]+- ]] && { in_run=0; continue; }
        (( in_run )) && [[ "${line}" =~ ^[[:space:]]+(uses|name|with|env|if): ]] && { in_run=0; continue; }
        (( in_run == 0 )) && continue
        for field in "${!_INJECTION_FIELDS[@]}"; do
            [[ "${line}" =~ \$\{\{.*${field} ]] && {
                printf "  ${RED}[INJECTION]${NC} Direct \${{ %s }} in run: block -- shell injection risk\n" "${field}"
                printf "    ${CYAN}Fix: Pass through env: variable indirection${NC}\n"
            }
        done
    done
}
_check_immutable_actions() {
    local -r content="$1"
    printf "%s" "${content}" | _search 'publish.*action|action\.yml' || return 0
    printf "%s" "${content}" | _search 'publish-immutable-action' && return 0
    printf "  ${YELLOW}[IMMUTABLE]${NC} Action publishing without immutable OCI distribution\n"
    printf "  ${CYAN}Note: OCI immutable publish is paused -- SHA pinning + Dependabot is recommended posture${NC}\n"
    return 0
}

# --- [EXPORT] -----------------------------------------------------------------

_run_best_practice_checks() {
    local -r workflow_path="$1"
    _section "Best Practice Checks"
    local -a files=()
    _collect_workflow_files "${workflow_path}" files
    [[ ${#files[@]} -eq 0 ]] && { _warn "No workflow files found"; return 0; }
    local has_issues=0 content
    for file in "${files[@]}"; do
        _info "Scanning: ${file}"
        content="$(<"${file}")"
        _check_deprecated_commands "${file}" || has_issues=1
        _check_permissions_block "${content}"
        _check_unpinned_actions "${content}"
        _check_timeout_minutes "${content}"
        _check_deprecated_runners "${content}"
        _check_concurrency_group "${content}"
        _check_pat_usage "${content}"
        _check_harden_runner "${content}"
        _check_expression_injection "${content}"
        _check_immutable_actions "${content}"
    done
    return "${has_issues}"
}
