#!/usr/bin/env bash
# cli-tool.sh — Resource manager CLI with two-dimensional verb:resource dispatch
# Usage: resmgr <verb> <resource> [ARGS] [OPTIONS]
# shellcheck disable=SC2329  # Functions called via dispatch tables (dynamic)
# shellcheck disable=SC2034  # Metadata arrays read dynamically by _dispatch_help
set -Eeuo pipefail
shopt -s inherit_errexit nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------
readonly VERSION="1.0.0" EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
readonly _BASH_V=$(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] ))
readonly _MIN_BASH_V=502 _HAS_INSITU=$(( _BASH_V >= 503 ))
readonly DATA_DIR="${RESMGR_DIR:-${HOME}/.resmgr}"
_BOLD="" _DIM="" _RESET=""
# NO_COLOR compliance (https://no-color.org) — existence disables color
[[ -z "${NO_COLOR+set}" ]] && [[ -t 2 ]] \
    && (( $(tput colors 2>/dev/null || printf '0') >= 8 )) && {
    _BOLD=$'\033[1m'; _DIM=$'\033[2m'; _RESET=$'\033[0m'
}
readonly _BOLD _DIM _RESET
(( _BASH_V >= 503 )) && shopt -s array_expand_once
declare -i LOG_LEVEL=2 _CLEANING=0 _JSON_LOG=0
declare -a _CLEANUP_STACK=()

# --- [DISPATCH] ---------------------------------------------------------------
# Two-dimensional verb:resource keyed dispatch with parallel metadata arrays
declare -Ar _DISPATCH=(
    [get:project]=_handle_get_project        [get:env]=_handle_get_env
    [create:project]=_handle_create_proj     [create:env]=_handle_create_env
    [delete:project]=_handle_delete_proj     [delete:env]=_handle_delete_env)
declare -Ar _USAGE=(
    [get:project]="get project <slug>"       [get:env]="get env <slug> <key>"
    [create:project]="create project <slug>" [create:env]="create env <slug> <key> <value>"
    [delete:project]="delete project <slug>" [delete:env]="delete env <slug> <key>")
declare -Ar _REQUIRED_ARGS=(
    [get:project]=1 [get:env]=2              [create:project]=1
    [create:env]=3  [delete:project]=1       [delete:env]=2)
declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"              [V]="-V|--version|Show version||"
    [v]="-v|--verbose|Verbose output||"      [q]="-q|--quiet|Suppress non-error output||"
    [j]="-j|--json|JSON log output||")
readonly _OPT_DISPLAY_ORDER="h V v q j"

# --- [LOGGING] ----------------------------------------------------------------
# _LOG_EMIT: polymorphic emitter — JSON-ND when piped/flagged, text when terminal
_LOG_EMIT() {
    local -r level="$1" ts="$2" func="$3" line="$4" msg="$5"
    (( _JSON_LOG )) && {
        printf '{"level":"%s","ts":"%s","caller":"%s:%s","msg":"%s"}\n' \
            "${level}" "${ts}" "${func}" "${line}" "${msg}" >&2; return; }
    printf '%-7s %s [%s:%s] %s\n' "[${level}]" "${ts}" "${func}" "${line}" "${msg}" >&2
}
declare -Ar _LOG_LEVELS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-3} >= LOG_LEVEL )) || return 0
    local ts; printf -v ts '%(%F %T)T' -1
    _LOG_EMIT "${level}" "${ts}" "${FUNCNAME[2]:-main}" "${BASH_LINENO[1]:-0}" "$*"
}
_debug()     { _log DEBUG "$@"; }; _info() { _log INFO "$@";  }
_warn()      { _log WARN "$@";  }; _err()  { _log ERROR "$@"; }
_die()       { _err "$@"; exit "${EX_ERR}"; }
_die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }

# --- [CLEANUP] ----------------------------------------------------------------
_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"
    printf '\n[ERROR] exit %d: %s\n[STACK]\n' "${rc}" "${cmd}" >&2
    local i; for (( i = 1; i < depth; i++ )); do
        printf '  %d) %s:%d in %s()\n' "${i}" \
            "${BASH_SOURCE[i]:-unknown}" "${BASH_LINENO[i-1]:-?}" "${FUNCNAME[i]:-main}" >&2
    done
}
_register_cleanup() { _CLEANUP_STACK+=("$1"); }
# _CLEANING guard prevents re-entrant execution on cascading signals
_run_cleanups() {
    (( _CLEANING )) && return; _CLEANING=1
    local i; for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[i]}" 2>/dev/null || true; done
}

# --- [FUNCTIONS] --------------------------------------------------------------
# shellcheck disable=SC2086  # eval template — word splitting is intentional
# Version-gated capture: fork-free ${ } on 5.3, subshell $() fallback on 5.2
# shellcheck disable=SC2015
_capture() {
    (( _HAS_INSITU )) && eval "$1=\${ $2; }" || eval "$1=\$($2)"
}
# Populate caller variable via nameref — zero subshell forks
_read_field() {
    local -r file="$1" key="$2"; local -n __out=$3
    [[ -f "${file}" ]] || { __out=""; return 1; }
    local -a lines; mapfile -t lines < "${file}"
    local line k v; for line in "${lines[@]}"; do
        IFS='=' read -r k v <<< "${line}"
        k="${k%%+([[:space:]])}"; v="${v##+([[:space:]])}"
        [[ "${k}" == "${key}" ]] && { __out="${v}"; return 0; }
    done; __out=""; return 1
}
# Multi-return: populate name + timestamp via two namerefs
_project_meta() {
    local -r slug="$1"; local -n __name=$2 __created=$3
    local -r meta="${DATA_DIR}/projects/${slug}/meta"
    _read_field "${meta}" "name" __name || __name="${slug}"
    _read_field "${meta}" "created" __created || __created="unknown"
}
_write_atomic() {
    local -r dest="$1" content="$2"; local tmp
    tmp="$(mktemp "${dest}.tmp.XXXXXX")" || _die "mktemp failed"
    _register_cleanup "rm -f -- $(printf '%q' "${tmp}")"
    printf '%s\n' "${content}" > "${tmp}"; mv "${tmp}" "${dest}"
}
_handle_get_project() {
    local -r slug="$1" dir="${DATA_DIR}/projects/${1}"
    [[ -d "${dir}" ]] || _die "Not found: ${slug}"
    local name created; _project_meta "${slug}" name created
    printf '%sProject:%s %s\n%sCreated:%s %s\n' \
        "${_BOLD}" "${_RESET}" "${name}" "${_DIM}" "${_RESET}" "${created}"
}
_handle_get_env() {
    local -r slug="$1" key="$2" file="${DATA_DIR}/projects/${1}/env"
    local value; _read_field "${file}" "${key}" value || _die "Key not found: ${key}"
    printf '%s\n' "${value}"
}
_handle_create_proj() {
    local -r slug="$1" dir="${DATA_DIR}/projects/${1}"
    [[ -d "${dir}" ]] && { _info "Exists: ${slug}"; return 0; }
    mkdir -p "${dir}"; local ts; printf -v ts '%(%F %T)T' -1
    _write_atomic "${dir}/meta" "name=${slug}
created=${ts}"
    _write_atomic "${dir}/env" ""; _info "Created: ${slug}"
}
_handle_create_env() {
    local -r slug="$1" key="$2" value="$3" file="${DATA_DIR}/projects/${1}/env"
    [[ -d "${DATA_DIR}/projects/${slug}" ]] || _die "Not found: ${slug}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z_.0-9]*$ ]] || _die "Invalid key: ${key}"
    local existing; _read_field "${file}" "${key}" existing && _die "Key exists: ${key}"
    local current; current="$(<"${file}")"
    local updated; printf -v updated '%s\n%s=%s' "${current}" "${key}" "${value}"
    _write_atomic "${file}" "${updated}"; _info "Set ${slug}/${key}"
}
_handle_delete_proj() {
    local -r slug="$1" dir="${DATA_DIR}/projects/${1}"
    [[ -d "${dir}" ]] || _die "Not found: ${slug}"
    rm -rf -- "${dir}"; _info "Deleted: ${slug}"
}
_handle_delete_env() {
    local -r slug="$1" key="$2" file="${DATA_DIR}/projects/${1}/env"
    [[ -f "${file}" ]] || _die "No env: ${slug}"
    local -a lines output=(); mapfile -t lines < "${file}"
    local -i found=0; local line k v; for line in "${lines[@]}"; do
        IFS='=' read -r k v <<< "${line}"; k="${k%%+([[:space:]])}"
        [[ "${k}" == "${key}" ]] && { found=1; continue; }
        [[ -n "${k}" ]] && output+=("${line}")
    done; (( found )) || _die "Key not found: ${key}"
    local content; printf -v content '%s\n' "${output[@]+"${output[@]}"}"
    _write_atomic "${file}" "${content%$'\n'}"; _info "Deleted ${slug}/${key}"
}
_dispatch() {
    local -r key="${1:?verb required}:${2:?resource required}"; shift 2
    [[ -v _DISPATCH["${key}"] ]] || {
        _err "Unknown route: ${key}"; _dispatch_help; exit "${EX_USAGE}"; }
    (( $# >= _REQUIRED_ARGS[${key}] )) || _die_usage "Usage: ${_USAGE[${key}]}"
    "${_DISPATCH[${key}]}" "$@"
}
# Self-documenting help — auto-derived from dispatch registry metadata
_dispatch_help() {
    printf '\n%sROUTES:%s\n' "${_BOLD}" "${_RESET}" >&2
    local k; for k in $(printf '%s\n' "${!_USAGE[@]}" | sort); do
        printf '  %-30s %s\n' "${k}" "${_USAGE[${k}]}" >&2; done
}
_usage() {
    local -r pad=$(( $(tput cols 2>/dev/null || printf '80') > 100 ? 28 : 24 ))
    printf '%s%s v%s%s — resource manager\n\n%sUSAGE:%s  %s <verb> <resource> [ARGS] [OPTIONS]\n' \
        "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}" \
        "${_BOLD}" "${_RESET}" "${SCRIPT_NAME}"
    _dispatch_help
    printf '\n%sOPTIONS:%s\n' "${_BOLD}" "${_RESET}"
    local key short long desc value_name default flag
    for key in ${_OPT_DISPLAY_ORDER}; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}, ${long}"; [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-*s %s' "${pad}" "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
}

# --- [PARSER] -----------------------------------------------------------------
_parse_flags() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)    _usage; exit 0 ;;
            -V|--version) printf '%s v%s (bash %s)\n' \
                              "${SCRIPT_NAME}" "${VERSION}" "${BASH_VERSION}"; exit 0 ;;
            -v|--verbose) LOG_LEVEL=1; shift ;; -q|--quiet) LOG_LEVEL=3; shift ;;
            -j|--json)    _JSON_LOG=1; shift ;; --self-test) _self_test; exit 0 ;;
            --)           shift; break ;; -*) _die_usage "Unknown: $1" ;; *) break ;;
        esac
    done
    (( $# >= 2 )) || { _usage; exit "${EX_USAGE}"; }
    readonly LOG_LEVEL _JSON_LOG; _dispatch "$@"
}

# --- [TESTING] ----------------------------------------------------------------
_self_test() {
    _info "Running self-tests..."
    [[ "${SCRIPT_NAME}" == "cli-tool.sh" ]] || _die "ASSERT: script name"
    [[ -v _DISPATCH["get:project"] && -v _DISPATCH["create:env"] ]] || _die "ASSERT: dispatch"
    (( _REQUIRED_ARGS["create:env"] == 3 )) || _die "ASSERT: required args"
    (( _BASH_V >= _MIN_BASH_V )) || _die "ASSERT: version gate"
    local val; _capture val "printf '%s' 'test-capture'"
    [[ "${val}" == "test-capture" ]] || _die "ASSERT: _capture '${val}'"
    local field; _read_field /dev/null "x" field && _die "ASSERT: read nonexistent"
    _info "All tests passed (bash ${BASH_VERSION}, insitu=${_HAS_INSITU})"
}

# --- [EXPORT] -----------------------------------------------------------------
trap '_on_err' ERR
trap '_run_cleanups' EXIT
_main() { _parse_flags "$@"; }
_main "$@"
