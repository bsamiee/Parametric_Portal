#!/usr/bin/env bash
# Bash/Shell Script Validator -- syntax, shellcheck, security, portability
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly _RED='\033[0;31m' _YEL='\033[1;33m' _GRN='\033[0;32m' _BLU='\033[0;34m' _NC='\033[0m'
readonly _DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"

# --- [COUNTERS] ---------------------------------------------------------------
_ERR_COUNT=0 _WARN_COUNT=0 _INFO_COUNT=0

# --- [OUTPUT] -----------------------------------------------------------------
_header()  { printf "${_BLU}========================================\n%s\n========================================${_NC}\n" "$1"; }
_section() { printf "\n${_BLU}[%s]${_NC}\n" "$1"; }
_err()     { printf "${_RED}x %s${_NC}\n" "$1"; ((_ERR_COUNT++)); }
_warn()    { printf "${_YEL}! %s${_NC}\n" "$1"; ((_WARN_COUNT++)); }
_info()    { printf "${_BLU}i %s${_NC}\n" "$1"; ((_INFO_COUNT++)); }
_ok()      { printf "${_GRN}v %s${_NC}\n" "$1"; }

# --- [SHELL_DISPATCH] --------------------------------------------------------
declare -Ar _SYNTAX_CHECKER=([sh]=sh [dash]=sh [bash]=bash)
declare -Ar _SHELLCHECK_DIALECT=([bash]="-s bash" [sh]="-s sh" [dash]="-s sh" [zsh]="-s zsh" [ksh]="-s ksh")
declare -Ar _SHEBANG_SHELLS=([bash]=bash [sh]=sh [zsh]=zsh [ksh]=ksh [dash]=dash)
_detect_shell() {
    local -r file="$1"
    local shebang
    IFS= read -r shebang < "${file}" || true
    [[ ! "${shebang}" =~ ^#! ]] && { printf "bash:no-shebang"; return; }
    # Extract shell name via BASH_REMATCH -- single regex, then fallback via case
    [[ "${shebang}" =~ (bash|zsh|ksh|dash) ]] && { printf "%s" "${_SHEBANG_SHELLS[${BASH_REMATCH[1]}]}"; return; }
    case "${shebang}" in
        '#!/bin/sh'*|'#!/usr/bin/sh'*|*/env\ sh*) printf "sh" ;;
        *) printf "bash:unknown-shebang:%s" "${shebang}" ;;
    esac
}

# --- [SYNTAX] -----------------------------------------------------------------
_validate_syntax() {
    local -r file="$1" shell="$2"
    _section "SYNTAX CHECK"
    local -r checker="${_SYNTAX_CHECKER[${shell}]:-}"
    [[ -z "${checker}" ]] && { _info "Syntax check skipped for: ${shell}"; return 0; }
    "${checker}" -n "${file}" 2>/dev/null && { _ok "No syntax errors (${checker} -n)"; return 0; }
    _err "Syntax errors found:"
    "${checker}" -n "${file}" 2>&1 | sed 's/^/  /'
    return 1
}

# --- [SHELLCHECK] -------------------------------------------------------------
_run_shellcheck() {
    local -r file="$1" shell="$2"
    local shellcheck_cmd=""
    _section "SHELLCHECK"
    local -r shell_arg="${_SHELLCHECK_DIALECT[${shell}]:-}"

    command -v shellcheck &>/dev/null && shellcheck_cmd="shellcheck"
    [[ -z "${shellcheck_cmd}" && -x "${_DIR}/shellcheck_wrapper.sh" ]] && shellcheck_cmd="${_DIR}/shellcheck_wrapper.sh --cache"
    [[ -z "${shellcheck_cmd}" ]] && { _warn "ShellCheck not installed (brew install shellcheck / apt-get install shellcheck)"; return 0; }

    local output
    # shellcheck disable=SC2086
    output=$("${shellcheck_cmd}" ${shell_arg} -f gcc "${file}" 2>&1) && { _ok "No ShellCheck issues"; return 0; }

    local counts_line
    counts_line=$(awk -F': ' '{ for(i=1;i<=NF;i++) if($i ~ /^(error|warning|note|style)$/) c[$i]++ } END { printf "%d %d %d %d", c["error"]+0, c["warning"]+0, c["note"]+0, c["style"]+0 }' <<< "${output}")
    local sc_err sc_warn sc_note sc_style
    read -r sc_err sc_warn sc_note sc_style <<< "${counts_line}"

    printf '%s\n' "${output}"
    printf '\n  ShellCheck: %d error(s), %d warning(s), %d note(s), %d style\n' \
        "${sc_err}" "${sc_warn}" "${sc_note}" "${sc_style}"

    ((_ERR_COUNT += sc_err))
    ((_WARN_COUNT += sc_warn))
    ((_INFO_COUNT += sc_note + sc_style))
    printf "  ${_BLU}i See https://www.shellcheck.net/wiki/ for details${_NC}\n"
    return 1
}

# --- [CUSTOM CHECKS] ----------------------------------------------------------
_check_pattern() {
    local -r file="$1" pattern="$2" msg="$3" level="$4"
    local matches
    matches=$(grep -E -n "${pattern}" "${file}" 2>/dev/null) || return 1
    "${level}" "${msg}"
    printf '  Line %s\n' "${matches}"
}

declare -Ar _SECURITY_CHECKS=(
    [eval]='eval[[:space:]]+.*\$|Potential command injection: eval with variable|_warn'
    [rm_rf]='(rm -(rf|fr)[[:space:]].*\$|rm -(rf|fr)[[:space:]]/)|Dangerous rm -rf with variable or root path|_warn'
    [pipe_shell]='(curl|wget)[[:space:]].*\|[[:space:]]*(bash|sh|sudo)|Pipe-to-shell: remote code execution risk|_warn'
    [dyn_source]='(source|\.[[:space:]]).*\$|Dynamic source/include with variable (injection risk)|_warn'
)
declare -Ar _PERF_CHECKS=(
    [uuoc]='cat[[:space:]]+[^|]+[[:space:]]*\|[[:space:]]*(grep|awk|sed)|Useless use of cat (use redirection)|_info'
    [cat_sub]='\\$\\(cat[[:space:]]|Use $(<file) instead of $(cat file) (no fork)|_info'
)
declare -Ar _SH_BASHISM_CHECKS=(
    [dbl_bracket]='\[\[|Bashism: [[ ]] in sh script (use [ ])|_err'
    [arrays]='(declare[[:space:]]+-a|[a-zA-Z_][a-zA-Z0-9_]*=\()|Bashism: arrays in sh script|_err'
    [func_kw]='^function[[:space:]]|Bashism: function keyword in sh|_warn'
    [source_kw]='^source[[:space:]]|Bashism: source in sh (use .)|_warn'
)
declare -Ar _PRACTICE_CHECKS=(
    [unquoted_redir]='\$[A-Za-z_][A-Za-z0-9_]*[[:space:]]*>{1,2}|Unquoted variable in redirection|_warn'
    [read_no_r]='while[[:space:]].*read[[:space:]][^;]*[^-]r|Missing -r flag on read (backslash interpretation)|_info'
)

_run_check_set() {
    local -n _checks=$1
    local -r file="$2"
    local found_ref=0 key pattern msg level
    for key in "${!_checks[@]}"; do
        IFS='|' read -r pattern msg level <<< "${_checks[${key}]}"
        _check_pattern "${file}" "${pattern}" "${msg}" "${level}" && found_ref=1
    done
    return $(( found_ref == 0 ))
}

_run_custom_checks() {
    local -r file="$1" shell="$2"
    local found=0
    _section "CUSTOM CHECKS"

    _run_check_set _SECURITY_CHECKS "${file}" && found=1
    _run_check_set _PERF_CHECKS "${file}" && found=1
    [[ "${shell}" == "sh" ]] && { _run_check_set _SH_BASHISM_CHECKS "${file}" && found=1; }
    grep -E -q '(set -e|set -o errexit)' "${file}" || grep -E -q 'trap.*ERR' "${file}" || { _info "Consider adding error handling (set -e or trap)"; found=1; }
    _run_check_set _PRACTICE_CHECKS "${file}" && found=1

    (( found == 0 )) && _ok "No custom issues found"
    return 0
}

# --- [SUMMARY] ----------------------------------------------------------------
_print_summary() {
    local -r file="$1" shell="$2"
    printf '\n'
    _header "VALIDATION SUMMARY"
    printf "File: %s  Shell: %s\n" "${file}" "${shell}"
    ((_ERR_COUNT == 0 && _WARN_COUNT == 0)) \
        && _ok "All checks passed!" \
        || printf "${_RED}Errors:${_NC}   %d\n${_YEL}Warnings:${_NC} %d\n${_BLU}Info:${_NC}     %d\n" \
            "${_ERR_COUNT}" "${_WARN_COUNT}" "${_INFO_COUNT}"
    printf '\n'
}

# --- [MAIN] -------------------------------------------------------------------
_validate() {
    local -r file="$1"
    [[ -f "${file}" ]] || { printf "Error: File '%s' not found\n" "${file}"; exit 1; }
    [[ -r "${file}" && -s "${file}" ]] || { printf "Error: File '%s' not readable or empty\n" "${file}"; exit 1; }
    command -v file &>/dev/null \
        && [[ "$(file -b --mime-encoding "${file}")" == "binary" ]] \
        && { printf "Error: '%s' is binary\n" "${file}"; exit 1; }
    local -r raw=$(_detect_shell "${file}")
    local -r shell="${raw%%:*}" status="${raw#*:}"
    _header "BASH/SHELL SCRIPT VALIDATOR"
    printf "File: %s\nDetected Shell: %s\n" "${file}" "${shell}"
    [[ "${status}" == "no-shebang" ]] && _warn "No shebang found. Defaulting to bash."
    [[ "${status}" =~ ^unknown-shebang ]] && _warn "Unknown shebang: ${status#unknown-shebang:}. Defaulting to bash."
    printf '\n'
    _validate_syntax "${file}" "${shell}" || true
    _run_shellcheck "${file}" "${shell}" || true
    _run_custom_checks "${file}" "${shell}" || true
    _print_summary "${file}" "${shell}"
    ((_ERR_COUNT > 0)) && exit 2; ((_WARN_COUNT > 0)) && exit 1; exit 0
}

case "${1:-}" in
    -h|--help) printf "Usage: %s <script-file>  -- Validates bash/shell scripts for syntax, security, performance, portability\n" "$0"; exit 0 ;;
    "") printf "Usage: %s <script-file>\n" "$0"; exit 0 ;;
    *) _validate "$1" ;;
esac
