#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly RED='\033[0;31m' YEL='\033[0;33m' GRN='\033[0;32m'
readonly CYN='\033[0;36m' RST='\033[0m' BLD='\033[1m'
if command -v rg &>/dev/null; then _CMD="rg"; else _CMD="grep"; fi
readonly _CMD
_high=0; _medium=0; _low=0; _verbose=0; _include_tests=0; _min_sev="LOW"
_paths=()
readonly _GLOB="*.py"

# pattern|label|severity -- G18 pattern unused (cross-file handler)
declare -Ar _HEURISTICS=(
    [G1]='is None:|OPTIONAL_MASKING|MEDIUM'
    [G2]='^\s*except |EXCEPTION_CONTROL_FLOW|HIGH'
    [G3]='^\s*for |IMPERATIVE_ITERATION|HIGH'
    [G4]='isinstance\(|NOMINAL_DISPATCH|MEDIUM'
    [G5]='class.*ABC|from abc import|ABC_INTERFACE|MEDIUM'
    [G6]='Callable\[\.\.\.,'$'|SIGNATURE_ERASURE|MEDIUM'
    [G7]='class.*BaseModel|MUTABLE_DOMAIN_MODEL|MEDIUM'
    [G8]='-> list\[|-> dict\[|BARE_COLLECTION|MEDIUM'
    [G9]='asyncio\.create_task|asyncio\.gather|UNSTRUCTURED_CONCURRENCY|HIGH'
    [G10]='logging\.info\(f"|logger\.info\(f"|UNSTRUCTURED_LOGGING|LOW'
    [G11]='^[A-Z_]*: dict|= \[\]|= \{\}|GLOBAL_MUTABLE_STATE|MEDIUM'
    [G12]='def .*: str\) -> str:|BARE_PRIMITIVE_IO|LOW'
    [G13]='^db = |^conn = |^client = |IMPORT_TIME_IO|MEDIUM'
    [G14]='^\s*if |^\s*elif |IMPERATIVE_BRANCHING|HIGH'
    [G15]='hasattr\(|getattr\(|HASATTR_GETATTR|MEDIUM'
    [G16]='^\s*total\s*[+=]|^\s*count\s*[+=]|IMPERATIVE_ACCUMULATION|MEDIUM'
    [G17]='# TODO.*optim|# PERF|PREMATURE_OPTIMIZATION|LOW'
    [G18]='_CROSS_FILE_|MIXED_RESULT_LIBRARIES|MEDIUM'
)

# --- [FUNCTIONS] --------------------------------------------------------------
_search() {
    local mode="$1" pattern="$2" target="${_paths[0]:-.}"
    local -a flags=()
    case "$_CMD" in
        rg)
            flags+=( "--glob=${_GLOB}" )
            case "$_include_tests" in
                0) flags+=( '--glob=!*test*' '--glob=!*Test*' '--glob=!*spec*' '--glob=!*Spec*' ) ;;
            esac
            case "$mode" in
                lines) rg -n "${flags[@]}" "$pattern" "$target" 2>/dev/null || true ;;
                files) rg -l "${flags[@]}" "$pattern" "$target" 2>/dev/null || true ;;
            esac ;;
        grep)
            flags+=( "--include=${_GLOB}" )
            case "$_include_tests" in
                0) flags+=( '--exclude=*test*' '--exclude=*Test*' '--exclude=*spec*' '--exclude=*Spec*' ) ;;
            esac
            case "$mode" in
                lines) grep -rn -E "${flags[@]}" "$pattern" "$target" 2>/dev/null || true ;;
                files) grep -rl -E "${flags[@]}" "$pattern" "$target" 2>/dev/null || true ;;
            esac ;;
    esac
}

_count() {
    case "$1" in
        '') printf '0' ;;
        *)  printf '%s\n' "$1" | grep -c '.' 2>/dev/null || printf '0' ;;
    esac
}

_report() {
    local sev="$1" label="$2" count="$3" color
    case "$sev" in
        HIGH) color="$RED" ;; MEDIUM) color="$YEL" ;; LOW) color="$GRN" ;; *) color="$RST" ;;
    esac
    case "$count" in
        0) printf '%b[PASS]%b %-30s 0 matches\n' "$GRN" "$RST" "$label" ;;
        *) printf '%b[%s]%b %b%-30s %d match(es)%b\n' \
               "${BLD}${color}" "$sev" "$RST" "$color" "$label" "$count" "$RST" ;;
    esac
}

_tally() {
    case "$1" in
        HIGH) ((_high += $2)) || true ;; MEDIUM) ((_medium += $2)) || true ;; LOW) ((_low += $2)) || true ;;
    esac
}

_should_run() {
    local -Ar ranks=( [HIGH]=3 [MEDIUM]=2 [LOW]=1 )
    [[ "${ranks[$1]:-0}" -ge "${ranks[$_min_sev]:-0}" ]]
}

_run() {
    local sev="$1" label="$2" matches="$3" count
    _should_run "$sev" || return 0
    count=$(_count "$matches"); _report "$sev" "$label" "$count"; _tally "$sev" "$count"
    case "$_verbose" in
        1) [[ "$count" -gt 0 ]] && printf '%b%s%b\n' "$CYN" "$matches" "$RST" || true ;;
    esac
}

_run_all() {
    local gid entry pattern label sev rest
    for gid in G1 G2 G3 G4 G5 G6 G7 G8 G9 G10 G11 G12 G13 G14 G15 G16 G17; do
        entry="${_HEURISTICS[$gid]}"; sev="${entry##*|}"
        rest="${entry%|*}"; label="${rest##*|}"; pattern="${rest%|*}"
        _run "$sev" "$label" "$(_search lines "$pattern")"
    done
    _check_g18
}

# G18: Mixed Result libraries -- cross-file: files importing BOTH expression.Result and returns.Result
_check_g18() {
    _should_run "MEDIUM" || return 0
    local count=0 expr_files ret_files mixed
    expr_files=$(_search files 'from expression.*import.*Result|from expression\.core.*Result')
    ret_files=$(_search files 'from returns.*import.*Result|from returns\.result.*Result')
    case "${expr_files}${ret_files}" in
        '') ;;
        *)  mixed=$(comm -12 <(printf '%s\n' "$expr_files" | sort) \
                              <(printf '%s\n' "$ret_files" | sort) 2>/dev/null || true)
            count=$(_count "$mixed")
            case "$_verbose" in
                1) [[ "$count" -gt 0 ]] && printf '%b%s%b\n' "$CYN" "$mixed" "$RST" || true ;;
            esac ;;
    esac
    _report "MEDIUM" "MIXED_RESULT_LIBRARIES" "$count"; _tally "MEDIUM" "$count"
}

_summary() {
    local total=$((_high + _medium + _low))
    printf '\n%b--- SUMMARY ---%b\n' "$BLD" "$RST"
    printf '%b  HIGH:   %d%b\n' "$RED" "$_high" "$RST"
    printf '%b  MEDIUM: %d%b\n' "$YEL" "$_medium" "$RST"
    printf '%b  LOW:    %d%b\n' "$GRN" "$_low" "$RST"
    printf '  TOTAL:  %d\n\n' "$total"
    [[ "$_high" -gt 0 ]] && { printf '%b[FAIL] High-severity violations found.%b\n' "${RED}${BLD}" "$RST"; return 2; }
    [[ "$_medium" -gt 0 ]] && { printf '%b[WARN] Medium-severity violations found.%b\n' "${YEL}${BLD}" "$RST"; return 1; }
    printf '%b[PASS] No violations detected.%b\n' "${GRN}${BLD}" "$RST"; return 0
}

_usage() {
    cat <<'USAGE'
Usage: validate.sh [OPTIONS] [PATH...]

Python 3.14+ standards validator -- grep-based heuristic detection (G1-G18).

Options:
  -h, --help            Show this help message
  -v, --verbose         Print matching lines for each violation
  --include-tests       Include test/spec files in analysis
  --severity LEVEL      Minimum severity: HIGH, MEDIUM, LOW (default: LOW)

Severity tiers:
  HIGH   (exit 2): G2, G3, G9, G14
  MEDIUM (exit 1): G1, G4, G5, G6, G7, G8, G11, G13, G15, G16, G18
  LOW    (exit 0): G10, G12, G17
USAGE
}

# --- [EXPORT] -----------------------------------------------------------------
_parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)       _usage; exit 0 ;;
            -v|--verbose)    _verbose=1; shift ;;
            --include-tests) _include_tests=1; shift ;;
            --severity)
                case "${2:-}" in
                    HIGH|MEDIUM|LOW) _min_sev="$2"; shift 2 ;;
                    *) printf 'Error: --severity requires HIGH, MEDIUM, or LOW\n' >&2; exit 1 ;;
                esac ;;
            -*) printf 'Unknown option: %s\n' "$1" >&2; _usage >&2; exit 1 ;;
            *)  _paths+=("$1"); shift ;;
        esac
    done
    [[ ${#_paths[@]} -eq 0 ]] && _paths=(".")
    return 0
}

_main() {
    _parse_args "$@"
    printf '%bPython Standards Validator%b\n' "$BLD" "$RST"
    printf 'Target: %s\nSearch: %s\nSeverity: >= %s\n\n' "${_paths[*]}" "$_CMD" "$_min_sev"
    _run_all
    _summary
}

_main "$@"
