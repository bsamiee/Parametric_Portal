#!/usr/bin/env bash
# GitHub Actions Validator - Workflow Validation Script
# Functional style: associative array dispatch, readonly constants, pure functions, pipeline composition
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
readonly TOOLS_DIR="${SCRIPT_DIR}/.tools"
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' NC='\033[0m'

# --- [DISPATCH_TABLES] -------------------------------------------------------
declare -Ar _ACTION_VERSIONS=(
    [actions/checkout]="v6:v4"
    [actions/setup-node]="v6:v4"
    [actions/setup-python]="v6:v5"
    [actions/setup-java]="v5:v4"
    [actions/setup-go]="v6:v5"
    [actions/cache]="v5:v4"
    [actions/upload-artifact]="v6:v4"
    [actions/download-artifact]="v7:v4"
    [actions/github-script]="v8:v7"
    [docker/setup-buildx-action]="v3:v3"
    [docker/login-action]="v3:v3"
    [docker/build-push-action]="v6:v5"
    [docker/metadata-action]="v5:v5"
    [aws-actions/configure-aws-credentials]="v6:v4"
    [sigstore/cosign-installer]="v4:v3"
    [actions/attest-build-provenance]="v3:v2"
    [actions/attest-sbom]="v3:v2"
    [actions/create-github-app-token]="v2:v1"
    [actions/publish-immutable-action]="v0:v0"
    [step-security/harden-runner]="v2:v2"
    [codecov/codecov-action]="v5:v4"
)

declare -Ar _RUNNER_REPLACEMENTS=(
    [ubuntu-18.04]="ubuntu-24.04"
    [ubuntu-20.04]="ubuntu-24.04"
    [macos-12]="macos-15"
    [macos-13]="macos-15"
    [windows-2019]="windows-2025"
)

# --- [LOGGING] ----------------------------------------------------------------
log_info()      { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
log_warn()      { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
log_error()     { printf "${RED}[ERROR]${NC} %s\n" "$1"; }
log_section()   { printf "\n${BLUE}=== %s ===${NC}\n\n" "$1"; }
log_reference() { printf "${CYAN}[REF]${NC} %s\n" "$1"; }

# --- [PURE_FUNCTIONS] ---------------------------------------------------------
extract_major_version() { local -r raw="${1#v}"; printf "%s" "${raw%%.*}"; }
is_sha_pinned() { [[ "$1" =~ ^[0-9a-f]{7,}$ ]]; }
strip_quotes() { local -r stripped="${1//\"/}"; printf "%s" "${stripped//\'/}"; }
_get_action_version_info() { [[ -v _ACTION_VERSIONS["$1"] ]] && printf "%s" "${_ACTION_VERSIONS[$1]}"; }
_get_runner_replacement() { [[ -v _RUNNER_REPLACEMENTS["$1"] ]] && printf "%s" "${_RUNNER_REPLACEMENTS[$1]}"; }

# --- [TOOL_RESOLUTION] --------------------------------------------------------
get_tool_path() {
    [[ -f "${TOOLS_DIR}/$1" ]] && { printf "%s" "${TOOLS_DIR}/$1"; return; }
    command -v "$1" &>/dev/null && { command -v "$1"; return; }
    log_error "$1 not found"; exit 1
}
check_tools() {
    local missing=0
    [[ ! -f "${TOOLS_DIR}/actionlint" ]] && ! command -v actionlint &>/dev/null && { log_error "actionlint not found. Run install_tools.sh"; missing=1; }
    [[ ! -f "${TOOLS_DIR}/act" ]] && ! command -v act &>/dev/null && { log_error "act not found. Run install_tools.sh"; missing=1; }
    (( missing == 1 )) && exit 1
}

check_docker() { docker info &>/dev/null; }

# --- [FILE_COLLECTION] --------------------------------------------------------
collect_workflow_files() {
    local -r workflow_path="$1"
    local -n _collected_files=$2

    [[ -f "${workflow_path}" ]] && { _collected_files+=("${workflow_path}"); return; }
    [[ -d "${workflow_path}" ]] || return 0

    local file
    while IFS= read -r -d '' file; do
        _collected_files+=("${file}")
    done < <(find "${workflow_path}" -maxdepth 1 -type f \( -name "*.yml" -o -name "*.yaml" \) -print0 2>/dev/null)
}

# --- [BEST_PRACTICE_CHECKS] --------------------------------------------------
check_deprecated_commands() {
    local -r content="$1" filepath="$2"
    grep -qE '::set-output |::save-state ' "${filepath}" 2>/dev/null || return 0
    printf "  ${RED}[DEPRECATED-CMD]${NC} Uses deprecated ::set-output or ::save-state\n"
    printf "  ${CYAN}Fix: Use \$GITHUB_OUTPUT / \$GITHUB_STATE environment files${NC}\n"
    return 1
}
check_permissions_block() {
    local -r content="$1"
    printf "%s" "${content}" | grep -qE '^permissions:' 2>/dev/null && return 0
    printf "  ${YELLOW}[PERMISSIONS]${NC} Missing top-level permissions: block (defaults to read-write)\n"
    printf "  ${CYAN}Fix: Add 'permissions: { contents: read }' for least privilege${NC}\n"
    return 0
}
check_unpinned_actions() {
    local -r content="$1"
    local line action version

    while IFS= read -r line; do
        [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
        [[ "${line}" =~ uses:[[:space:]]*([^@]+)@([^[:space:]#]+) ]] || continue

        action="${BASH_REMATCH[1]}"
        action="${action#"${action%%[![:space:]]*}"}"
        action="${action%"${action##*[![:space:]]}"}"
        action="${action//\"/}"; action="${action//\'/}"
        version="${BASH_REMATCH[2]}"
        [[ "${action}" == ./* || "${action}" == docker://* ]] && continue
        is_sha_pinned "${version}" && continue

        printf "  ${YELLOW}[UNPINNED]${NC} %s@%s -- not SHA-pinned\n" "${action}" "${version}"
    done <<< "${content}"
}
check_timeout_minutes() {
    local -r content="$1"
    local in_jobs=false current_job="" has_timeout=false line

    while IFS= read -r line; do
        [[ "${line}" =~ ^jobs: ]] && { in_jobs=true; continue; }
        [[ "${in_jobs}" == true ]] || continue

        [[ "${line}" =~ ^[[:space:]]{2}([a-zA-Z_][a-zA-Z0-9_-]*): && ! "${line}" =~ ^[[:space:]]{4} ]] && {
            [[ -n "${current_job}" && "${has_timeout}" == false ]] && \
                printf "  ${YELLOW}[TIMEOUT]${NC} Job '%s' missing timeout-minutes\n" "${current_job}"
            current_job="${BASH_REMATCH[1]}"
            has_timeout=false
        }
        [[ "${line}" =~ timeout-minutes ]] && has_timeout=true
    done <<< "${content}"
    [[ -n "${current_job}" && "${has_timeout}" == false ]] && \
        printf "  ${YELLOW}[TIMEOUT]${NC} Job '%s' missing timeout-minutes\n" "${current_job}"
}
check_deprecated_runners() {
    local -r content="$1"
    local line runner replacement has_issues=0

    while IFS= read -r line; do
        [[ "${line}" =~ runs-on:[[:space:]]*([^[:space:]#]+) ]] || continue
        runner="$(strip_quotes "${BASH_REMATCH[1]}")"
        replacement="$(_get_runner_replacement "${runner}" 2>/dev/null)" || continue
        printf "  ${RED}[RUNNER]${NC} '%s' is deprecated -- use '%s'\n" "${runner}" "${replacement}"
        has_issues=1
    done <<< "${content}"
    return "${has_issues}"
}
check_concurrency_group() {
    local -r content="$1"
    printf "%s" "${content}" | grep -qE '^concurrency:' 2>/dev/null && return 0
    printf "  ${YELLOW}[CONCURRENCY]${NC} No concurrency group -- redundant runs possible\n"
    return 0
}
check_cache_v5() {
    local -r filepath="$1"
    grep -qE 'uses:.*actions/cache@v4' "${filepath}" 2>/dev/null || return 0
    printf "  ${YELLOW}[CACHE-V5]${NC} actions/cache@v4 detected -- v5 available (Node 24 runtime, requires runner >= 2.327.1)\n"
    return 0
}
check_pat_usage() {
    local -r content="$1"
    printf "%s" "${content}" | grep -qE 'secrets\.(PAT|PERSONAL_ACCESS_TOKEN|GH_PAT|GITHUB_PAT)' 2>/dev/null || return 0
    printf "  ${YELLOW}[APP-TOKEN]${NC} PAT detected for cross-repo ops -- use actions/create-github-app-token instead\n"
    printf "  ${CYAN}Fix: Replace PAT with 'actions/create-github-app-token@v2' for short-lived, scoped tokens${NC}\n"
    return 0
}
check_harden_runner() {
    local -r content="$1"
    printf "%s" "${content}" | grep -qE 'step-security/harden-runner' 2>/dev/null && return 0
    printf "  ${YELLOW}[HARDEN]${NC} Missing step-security/harden-runner -- no egress monitoring or supply chain protection\n"
    printf "  ${CYAN}Fix: Add 'step-security/harden-runner@v2.12.0' as first step in security-sensitive jobs${NC}\n"
    return 0
}
check_immutable_actions() {
    local -r content="$1"
    printf "%s" "${content}" | grep -qE 'publish.*action|action\.yml' 2>/dev/null || return 0
    printf "%s" "${content}" | grep -qE 'publish-immutable-action' 2>/dev/null && return 0
    printf "  ${YELLOW}[IMMUTABLE]${NC} Action publishing detected without immutable OCI distribution\n"
    printf "  ${CYAN}Fix: Consider 'actions/publish-immutable-action@v0.0.4' for tamper-proof GHCR distribution${NC}\n"
    return 0
}
run_best_practice_checks() {
    local -r workflow_path="$1"
    log_section "Best Practice Checks"

    local files_to_check=()
    collect_workflow_files "${workflow_path}" files_to_check
    [[ ${#files_to_check[@]} -eq 0 ]] && { log_warn "No workflow files found"; return 0; }

    local has_issues=0 file content
    for file in "${files_to_check[@]}"; do
        log_info "Scanning: ${file}"
        content="$(<"${file}")"

        check_deprecated_commands "${content}" "${file}" || has_issues=1
        check_permissions_block "${content}"
        check_unpinned_actions "${content}"
        check_timeout_minutes "${content}"
        check_deprecated_runners "${content}" || has_issues=1
        check_concurrency_group "${content}"
        check_cache_v5 "${file}"
        check_pat_usage "${content}"
        check_harden_runner "${content}"
        check_immutable_actions "${content}"
    done

    return "${has_issues}"
}

# --- [VERSION_CHECK] ----------------------------------------------------------
classify_action_version() {
    local -r action="$1" used_major="$2"
    local -r version_info="$(_get_action_version_info "${action}")"
    local -r cur_raw="${version_info%%:*}" min_raw="${version_info##*:}"
    local -r current_major="${cur_raw#v}" minimum_major="${min_raw#v}"

    (( used_major < ${minimum_major%%.*} )) && { printf "deprecated"; return; }
    (( used_major < ${current_major%%.*} )) && { printf "outdated"; return; }
    printf "ok"
}
check_action_versions() {
    local -r workflow_path="$1"
    log_section "Action Version Check"

    local files_to_check=()
    collect_workflow_files "${workflow_path}" files_to_check
    [[ ${#files_to_check[@]} -eq 0 ]] && { log_warn "No workflow files found"; return 0; }

    local has_issues=0 outdated=0 deprecated=0 uptodate=0
    local file line action version used_major classification current_major version_info

    for file in "${files_to_check[@]}"; do
        log_info "Checking: ${file}"
        while IFS= read -r line; do
            [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
            [[ "${line}" =~ uses:[[:space:]]*([^@]+)@([^[:space:]#]+) ]] || continue

            action="${BASH_REMATCH[1]}"
            action="${action#"${action%%[![:space:]]*}"}"
            action="${action%"${action##*[![:space:]]}"}"
            action="${action//\"/}"; action="${action//\'/}"
            version="${BASH_REMATCH[2]}"

            version_info="$(_get_action_version_info "${action}" 2>/dev/null)" || continue
            current_major="$(extract_major_version "${version_info%%:*}")"

            is_sha_pinned "${version}" && {
                [[ "${line}" =~ v([0-9]+) ]] && used_major="${BASH_REMATCH[1]}" || { printf "  - %s@%s SHA pinned (version unknown)\n" "${action}" "${version:0:12}..."; continue; }
            } || {
                used_major="$(extract_major_version "${version}")"
            }
            [[ -z "${used_major}" || ! "${used_major}" =~ ^[0-9]+$ ]] && continue

            classification="$(classify_action_version "${action}" "${used_major}")"
            case "${classification}" in
                deprecated)
                    printf "  ${RED}[DEPRECATED]${NC} %s@%s (minimum: v%s, using: v%s)\n" "${action}" "${version}" "$(extract_major_version "${version_info##*:}")" "${used_major}"
                    ((deprecated++))
                    has_issues=1
                    ;;
                outdated)
                    printf "  ${YELLOW}[OUTDATED]${NC} %s@%s (current: v%s, using: v%s)\n" "${action}" "${version}" "${current_major}" "${used_major}"
                    ((outdated++))
                    ;;
                ok)
                    printf "  ${GREEN}[OK]${NC} %s@%s (current: v%s)\n" "${action}" "${version}" "${current_major}"
                    ((uptodate++))
                    ;;
            esac
        done < "${file}"
    done

    printf "\n"
    log_info "Up-to-date: ${uptodate} | Outdated: ${outdated} | Deprecated: ${deprecated}"
    [[ "${deprecated}" -gt 0 ]] && log_error "Update deprecated actions immediately"
    [[ "${outdated}" -gt 0 ]] && log_warn "Consider updating outdated actions"
    return "${has_issues}"
}

# --- [ACTIONLINT] -------------------------------------------------------------
validate_with_actionlint() {
    local -r workflow_path="$1"
    log_section "Running actionlint"
    local -r actionlint_path="$(get_tool_path "actionlint")"

    local workflow_files=()
    collect_workflow_files "${workflow_path}" workflow_files
    [[ ${#workflow_files[@]} -eq 0 ]] && { log_warn "No workflow files found"; return 0; }

    log_info "Validating: ${workflow_path} (${#workflow_files[@]} files)"
    "${actionlint_path}" "${workflow_files[@]}" 2>&1 && { log_info "actionlint passed"; return 0; } || { log_error "actionlint found issues"; return 1; }
}

# --- [ACT] --------------------------------------------------------------------
test_with_act() {
    local -r workflow_path="$1"
    log_section "Running act (validation)"
    check_docker || { log_error "Docker not running. Start Docker or use --lint-only"; return 1; }

    local -r act_path="$(get_tool_path "act")"
    local abs_path
    abs_path="$(cd "$(dirname "${workflow_path}")" 2>/dev/null && printf "%s/%s" "$(pwd)" "$(basename "${workflow_path}")")" || abs_path="${workflow_path}"

    # Find repo root by walking up directory tree
    local search_path="${abs_path}"
    [[ -f "${search_path}" ]] && search_path="$(dirname "${search_path}")"
    local current_dir="${search_path}"
    local repo_root=""
    while [[ "${current_dir}" != "/" ]]; do
        [[ -d "${current_dir}/.github/workflows" ]] && { repo_root="${current_dir}"; break; }
        [[ "${current_dir}" == *"/.github/workflows"* ]] && { repo_root="${current_dir%%/.github/workflows*}"; [[ -d "${repo_root}/.github/workflows" ]] && break; }
        current_dir="$(dirname "${current_dir}")"
    done
    [[ -z "${repo_root}" ]] && [[ -d "./.github/workflows" ]] && repo_root="$(pwd)"
    [[ -z "${repo_root}" ]] && { log_warn "No .github/workflows found, skipping act"; return 0; }

    local workflow_flag=""
    case "${abs_path}" in
        */.github/workflows/*) [[ -f "${abs_path}" ]] && workflow_flag="-W ${abs_path#${repo_root}/}" ;;
        */.github/workflows)   ;;
        *) log_warn "Path outside .github/workflows/, skipping act"; return 0 ;;
    esac

    local -r runner_images=("-P" "ubuntu-latest=catthehacker/ubuntu:act-latest" "-P" "ubuntu-22.04=catthehacker/ubuntu:act-22.04" "-P" "ubuntu-24.04=catthehacker/ubuntu:act-24.04")
    local -r original_dir="$(pwd)"
    cd "${repo_root}" || { log_error "Failed to cd to: ${repo_root}"; return 1; }

    log_info "Listing workflows..."
    eval "${act_path} --list ${workflow_flag} ${runner_images[*]}" 2>&1 | head -30 || log_warn "Could not list workflows"

    printf "\n"
    log_info "Dry-run validation..."
    local act_output act_exit=0
    act_output="$(eval "${act_path} --dryrun ${workflow_flag} --container-architecture linux/amd64 ${runner_images[*]}" 2>&1)" || act_exit=$?
    printf "%s\n" "${act_output}"

    cd "${original_dir}"
    [[ "${act_exit}" -eq 0 ]] && { log_info "act validation passed"; return 0; }

    printf "%s" "${act_output}" | grep -qi "unable to get git repo" && { log_warn "Not a git repo, act limited"; return 0; }
    log_error "act validation failed (exit: ${act_exit})"
    return 1
}

# --- [REFERENCE_HINTS] --------------------------------------------------------
readonly -a HINT_PATTERNS=(
    "syntax|yaml|unexpected:common_errors.md - Syntax Errors"
    'expression|\${{:common_errors.md - Expression Errors'
    "cron|schedule:common_errors.md - Schedule Errors"
    "runner|runs-on|ubuntu|macos|windows:runners.md"
    "action|uses::common_errors.md - Action Errors"
    "docker|container:act_usage.md - Troubleshooting"
    "needs:|dependency|job:common_errors.md - Job Configuration"
    "injection|security|secret|untrusted:common_errors.md - Security"
    "workflow_call|reusable|oidc|id-token|attestation:modern_features.md"
    "version|deprecated|outdated:action_versions.md"
    "permission:common_errors.md - Best Practices"
    "timeout:common_errors.md - Best Practices"
    "concurrency:modern_features.md - Concurrency Control"
    "set-output|save-state|GITHUB_OUTPUT:common_errors.md - Deprecated Commands"
    "harden-runner|egress|supply.chain:modern_features.md - Step Security Harden-Runner"
    "app.token|create-github-app-token|PAT|cross-repo:modern_features.md - GitHub App Token Authentication"
    "immutable|publish-immutable|OCI|GHCR.action:modern_features.md - Immutable Actions"
)

show_reference_hints() {
    local -r output="$1"
    log_section "Reference Documentation"

    local -A shown_refs=()
    local hint pattern ref
    for hint in "${HINT_PATTERNS[@]}"; do
        IFS=: read -r pattern ref <<< "${hint}"
        [[ -v shown_refs["${ref}"] ]] && continue
        grep -qiE "${pattern}" <<< "${output}" && { log_reference "See references/${ref}"; shown_refs["${ref}"]=1; }
    done
    (( ${#shown_refs[@]} == 0 )) && log_reference "See references/common_errors.md"
}

# --- [MAIN] -------------------------------------------------------------------
usage() {
    printf "Usage: %s [OPTIONS] <workflow-file-or-directory>\n" "$0"
    printf "Options: --lint-only  --test-only  --check-versions  --check-best-practices  --help\n"
    exit 0
}

main() {
    local workflow_path="" lint_only=false test_only=false check_versions=false check_bp=false docker_available=true

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --lint-only)            lint_only=true; shift ;;
            --test-only)            test_only=true; shift ;;
            --check-versions)       check_versions=true; shift ;;
            --check-best-practices) check_bp=true; shift ;;
            --help)                 usage ;;
            *)                      workflow_path="$1"; shift ;;
        esac
    done
    [[ -z "${workflow_path}" ]] && { log_error "No workflow path specified"; usage; }

    log_section "GitHub Actions Validator"
    log_info "Target: ${workflow_path}"
    check_tools

    [[ "${lint_only}" == false && "${check_versions}" == false && "${check_bp}" == false ]] && {
        check_docker || { log_warn "Docker not running, using lint-only mode"; docker_available=false; lint_only=true; }
    }

    local exit_code=0 validation_output=""

    [[ "${check_versions}" == true ]] && {
        check_action_versions "${workflow_path}" || exit_code=1
        [[ "${lint_only}" == false && "${test_only}" == false && "${check_bp}" == false ]] && exit "${exit_code}"
    }

    [[ "${check_bp}" == true ]] && {
        run_best_practice_checks "${workflow_path}" || exit_code=1
        [[ "${lint_only}" == false && "${test_only}" == false ]] && exit "${exit_code}"
    }

    [[ "${test_only}" == false ]] && {
        local acmd
        acmd="$(get_tool_path "actionlint")"
        validation_output="$("${acmd}" "${workflow_path}" 2>&1)" || true
        validate_with_actionlint "${workflow_path}" || exit_code=1
        run_best_practice_checks "${workflow_path}" || exit_code=1
    }

    [[ "${lint_only}" == false && "${docker_available}" == true ]] && {
        test_with_act "${workflow_path}" || exit_code=1
    }

    log_section "Validation Summary"
    [[ "${exit_code}" -eq 0 ]] && { log_info "All validations passed"; } || {
        log_error "Some validations failed"
        [[ -n "${validation_output}" ]] && show_reference_hints "${validation_output}"
        printf "\n"
        log_info "Flags: --lint-only  --check-versions  --check-best-practices  --test-only"
    }
    exit "${exit_code}"
}

main "$@"
