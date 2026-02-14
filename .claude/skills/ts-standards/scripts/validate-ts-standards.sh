#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'
readonly _SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
_PROJECT_DIR="$(cd "${BASH_SOURCE[0]%/*}/../../../.." && pwd)"
readonly _PROJECT_DIR
readonly _MODE_DEFAULT="check"
readonly _MAX_SKILL_LOC=275
readonly _SKILL_ROOT="${_PROJECT_DIR}/.claude/skills/ts-standards"
readonly _SERVER_PKG="${_PROJECT_DIR}/packages/server/package.json"
readonly _DATABASE_PKG="${_PROJECT_DIR}/packages/database/package.json"
readonly _REASON_HEADER="ts-standards validation failed"

readonly -a _SERVER_ALLOWED_EXPORTS=(
    "./api"
    "./runtime"
    "./errors"
    "./testing"
)

readonly -a _DATABASE_ALLOWED_EXPORTS=(
    "./runtime"
    "./models"
    "./migrator"
    "./testing"
)

readonly -a _SERVER_ALLOWED_IMPORTS=(
    "@parametric-portal/server/api"
    "@parametric-portal/server/runtime"
    "@parametric-portal/server/errors"
    "@parametric-portal/server/testing"
)

readonly -a _DATABASE_ALLOWED_IMPORTS=(
    "@parametric-portal/database/runtime"
    "@parametric-portal/database/models"
    "@parametric-portal/database/migrator"
    "@parametric-portal/database/testing"
)

declare -Ar _DISPATCH=(
    [check]="_run_check"
    [hook]="_run_hook"
)

_log() {
    local -r level="$1"
    shift
    local ts
    printf -v ts '%(%F %T)T' -1
    printf '[%-5s] %s %s\n' "${level}" "${ts}" "$*" >&2
}

_die() {
    _log ERROR "$*"
    exit 1
}

_parse_args() {
    local mode="${_MODE_DEFAULT}"
    while (($# > 0)); do
        case "$1" in
            --mode=*) mode="${1#*=}"; shift ;;
            --mode) mode="${2:-${_MODE_DEFAULT}}"; shift 2 ;;
            *) shift ;;
        esac
    done
    printf '%s\n' "${mode}"
}

_emit() {
    local -r code="$1"
    local -r location="$2"
    local -r message="$3"
    printf '%s|%s|%s\n' "${code}" "${location}" "${message}"
}
_emit_from_rg() {
    local -r code="$1"
    local -r file_path="$2"
    local -r message="$3"
    shift 3
    local -a entries=("$@")
    local entry line
    for entry in "${entries[@]}"; do
        [[ -n "${entry}" ]] || continue
        line="${entry%%:*}"
        _emit "${code}" "${file_path}:${line}" "${message}"
    done
}
_scan_exported_internal() {
    local -r file_path="$1"
    local -a rows=()
    mapfile -t rows < <(rg -n '^[[:space:]]*export[[:space:]]+\{[^}]*_[A-Za-z0-9]' "${file_path}" || true)
    _emit_from_rg "TS001" "${file_path}" "exported internal symbol (_prefixed)" "${rows[@]}"
}
_scan_inline_exports() {
    local -r file_path="$1"
    local -a rows=()
    mapfile -t rows < <(rg -n '^[[:space:]]*export[[:space:]]+(declare[[:space:]]+)?(abstract[[:space:]]+)?(async[[:space:]]+)?(class|const|function|interface|type|enum|namespace)\b' "${file_path}" || true)
    _emit_from_rg "TS002" "${file_path}" "inline export; move exports to final [EXPORT] section" "${rows[@]}"
}
_scan_default_exports() {
    local -r file_path="$1"
    case "${file_path}" in
        *.config.ts|*.config.js|*.config.mjs|*/migrations/*.ts) return 0 ;;
        *) ;;
    esac
    local -a rows=()
    mapfile -t rows < <(rg -n '^[[:space:]]*export[[:space:]]+default\b' "${file_path}" || true)
    _emit_from_rg "TS003" "${file_path}" "default export is not allowed" "${rows[@]}"
}
_scan_if_statements() {
    local -r file_path="$1"
    local -a rows_if=()
    local -a rows_effect_if=()
    mapfile -t rows_if < <(rg -n '\bif[[:space:]]*\(' "${file_path}" || true)
    mapfile -t rows_effect_if < <(rg -n '\bEffect\.if[[:space:]]*\(' "${file_path}" || true)
    _emit_from_rg "TS006" "${file_path}" "if(...) usage is disallowed" "${rows_if[@]}"
    _emit_from_rg "TS007" "${file_path}" "Effect.if(...) usage is disallowed" "${rows_effect_if[@]}"
}
_check_allowed_import() {
    local -r module="$1"
    local -a allowed=("${@:2}")
    local candidate
    for candidate in "${allowed[@]}"; do
        [[ "${module}" == "${candidate}" ]] && return 0
    done
    return 1
}
_scan_deep_imports() {
    local -r file_path="$1"
    local line module
    while IFS=':' read -r line module; do
        [[ -n "${line}" ]] || continue
        _check_allowed_import "${module}" "${_SERVER_ALLOWED_IMPORTS[@]}" || _emit "TS005" "${file_path}:${line}" "disallowed server import: ${module}"
    done < <(rg -n -o --no-heading '@parametric-portal/server/[A-Za-z0-9_./-]+' "${file_path}" || true)

    while IFS=':' read -r line module; do
        [[ -n "${line}" ]] || continue
        _check_allowed_import "${module}" "${_DATABASE_ALLOWED_IMPORTS[@]}" || _emit "TS005" "${file_path}:${line}" "disallowed database import: ${module}"
    done < <(rg -n -o --no-heading '@parametric-portal/database/[A-Za-z0-9_./-]+' "${file_path}" || true)
}
_scan_ts_file() {
    local -r file_path="$1"
    [[ -f "${file_path}" ]] || return 0
    case "${file_path}" in
        *.ts|*.tsx|*.mts|*.cts) ;;
        *) return 0 ;;
    esac
    _scan_exported_internal "${file_path}"
    _scan_inline_exports "${file_path}"
    _scan_default_exports "${file_path}"
    _scan_if_statements "${file_path}"
    _scan_deep_imports "${file_path}"
}
_compare_exports() {
    local -r package_file="$1"
    local -r package_name="$2"
    shift 2
    local -a expected=("$@")
    local -a actual=()
    local -a missing=()
    local -a extra=()
    mapfile -t actual < <(jq -r '.exports | keys[]?' "${package_file}" | sort -u)
    mapfile -t missing < <(comm -23 <(printf '%s\n' "${expected[@]}" | sort -u) <(printf '%s\n' "${actual[@]}" | sort -u))
    mapfile -t extra < <(comm -13 <(printf '%s\n' "${expected[@]}" | sort -u) <(printf '%s\n' "${actual[@]}" | sort -u))

    local item
    for item in "${missing[@]}"; do
        [[ -n "${item}" ]] || continue
        _emit "TS004" "${package_file}" "${package_name} missing allowed export key: ${item}"
    done
    for item in "${extra[@]}"; do
        [[ -n "${item}" ]] || continue
        _emit "TS004" "${package_file}" "${package_name} has disallowed export key: ${item}"
    done
}
_check_skill_loc() {
    local file_path lines
    while IFS= read -r file_path; do
        lines="$(wc -l < "${file_path}")"
        (( lines <= _MAX_SKILL_LOC )) && continue
        _emit "TS008" "${file_path}" "line count ${lines} exceeds ${_MAX_SKILL_LOC}"
    done < <(find "${_SKILL_ROOT}" -type f | sort)
}
_collect_all_ts_files() {
    rg --files "${_PROJECT_DIR}" -g '*.ts' -g '*.tsx' -g '*.mts' -g '*.cts' \
        -g '!**/node_modules/**' \
        -g '!**/dist/**' \
        -g '!**/.nx/**'
}
_render_reason() {
    local -a violations=("$@")
    printf '%s\n' "${_REASON_HEADER}"
    local entry
    for entry in "${violations[@]}"; do
        printf '%s\n' "${entry}"
    done
}
_print_check_report() {
    local -a violations=("$@")
    local entry
    for entry in "${violations[@]}"; do
        printf '%s\n' "${entry}"
    done
}
_run_hook() {
    local payload file_path
    payload="$(cat)"
    file_path="$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "${payload}")"
    case "${file_path}" in
        '') exit 0 ;;
        *) ;;
    esac

    local -a violations=()
    mapfile -t violations < <(
        _scan_ts_file "${file_path}"
        case "${file_path}" in
            *"/.claude/skills/ts-standards/"*) _check_skill_loc ;;
            *) ;;
        esac
    )

    ((${#violations[@]} == 0)) && exit 0

    local reason
    reason="$(_render_reason "${violations[@]}")"
    printf '{"decision":"block","reason":%s}\n' "$(jq -Rs '.' <<< "${reason}")"
}
_run_check() {
    local -a violations=()
    mapfile -t violations < <(
        local file_path
        while IFS= read -r file_path; do
            _scan_ts_file "${file_path}"
        done < <(_collect_all_ts_files)
        _compare_exports "${_SERVER_PKG}" "@parametric-portal/server" "${_SERVER_ALLOWED_EXPORTS[@]}"
        _compare_exports "${_DATABASE_PKG}" "@parametric-portal/database" "${_DATABASE_ALLOWED_EXPORTS[@]}"
        _check_skill_loc
    )

    ((${#violations[@]} == 0)) && {
        _log INFO "ts-standards check passed"
        exit 0
    }

    _print_check_report "${violations[@]}"
    exit 1
}

_main() {
    local -r mode="$(_parse_args "$@")"
    [[ -v _DISPATCH["${mode}"] ]] || _die "unsupported mode: ${mode}"
    "${_DISPATCH[${mode}]}"
}

_main "$@"
