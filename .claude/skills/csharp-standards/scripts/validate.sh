#!/usr/bin/env bash
set -Eeuo pipefail

# --- [COLORS] -----------------------------------------------------------------
readonly RED='\033[0;31m' YELLOW='\033[0;33m' GREEN='\033[0;32m'
readonly RESET='\033[0m' BOLD='\033[1m'

# --- [SEARCH_CMD] -------------------------------------------------------------
if command -v rg &>/dev/null; then _SEARCH_CMD="rg"; else _SEARCH_CMD="grep"; fi
readonly _SEARCH_CMD

# --- [GLOBALS] ----------------------------------------------------------------
_high=0; _medium=0; _low=0
_TARGET_DIR="${1:-.}"; readonly _TARGET_DIR
readonly _CS_GLOB="*.cs"

# --- [UTILITIES] --------------------------------------------------------------
_search() {
    local pattern="$1"; shift
    if [[ "$_SEARCH_CMD" == "rg" ]]; then
        rg --glob="${_CS_GLOB}" --glob='!*Test*' --glob='!*Spec*' \
           --glob='!*Benchmark*' -n "$@" "$pattern" "$_TARGET_DIR" 2>/dev/null || true
    else
        grep -rn --include="${_CS_GLOB}" --exclude='*Test*' --exclude='*Spec*' \
             --exclude='*Benchmark*' "$@" "$pattern" "$_TARGET_DIR" 2>/dev/null || true
    fi
}

_report() {
    local severity="$1" label="$2" count="$3" color
    case "$severity" in
        HIGH) color="$RED" ;; MEDIUM) color="$YELLOW" ;; LOW) color="$GREEN" ;; *) color="$RESET" ;;
    esac
    if [[ "$count" -gt 0 ]]; then
        printf '%b[%s]%b %b%-30s %d match(es)%b\n' \
            "${BOLD}${color}" "$severity" "${RESET}" "${color}" "$label" "$count" "${RESET}"
    else printf '%b[PASS]%b %-30s 0 matches\n' "${GREEN}" "${RESET}" "$label"; fi
}

_tally() {
    case "$1" in
        HIGH) ((_high += $2)) || true ;; MEDIUM) ((_medium += $2)) || true ;;
        LOW) ((_low += $2)) || true ;;
    esac
}

_count() { printf '%s' "$1" | grep -c '.' || true; }

_run() {
    local severity="$1" label="$2" matches="$3"
    local c; c=$(_count "$matches"); _report "$severity" "$label" "$c"; _tally "$severity" "$c"
}

# --- [CHECK_6] INTERFACE_POLLUTION ---------------------------------------------
# NOTE: Best-effort heuristic; multi-file analysis has limitations
_check_interface_pollution() {
    local interfaces iface implementations count=0
    interfaces=$(_search '^\s*(public\s+)?interface\s+I[A-Z]' -E \
        | sed -E 's/.*interface\s+(I[A-Za-z0-9_]+).*/\1/' | sort -u || true)
    if [[ -n "$interfaces" ]]; then
        while IFS= read -r iface; do
            [[ -z "$iface" ]] && continue
            implementations=$(_search ":\s*${iface}\b" -E | grep -c '.' || true)
            [[ "$implementations" -eq 1 ]] && ((count++)) || true
        done <<< "$interfaces"
    fi
    _report "MEDIUM" "INTERFACE_POLLUTION" "$count"; _tally "MEDIUM" "$count"
}

# --- [CHECK_8] ARITY_SPAM -----------------------------------------------------
# NOTE: Best-effort heuristic; detects both smells from validation.md [5][9][8]:
#   OVERLOAD_SPAM    -- same method name with >=3 distinct generics-aware arities
#                       (fix: params ReadOnlySpan<T> + monoid constraint)
#   SURFACE_INFLATION -- >=3 distinct method names sharing the same leading camelCase
#                        word within one file (e.g. Get/GetMany/GetOrDefault)
#                       (fix: typed query algebra, one Execute<R>(Query) entry point)
# Scoped per-file to prevent cross-type false positives (e.g. CreateOrder vs CreateCustomer
# in separate domain modules). Generic method names (Foo<T>) are handled via optional
# <[^>]*> capture; deeply nested generics in params (<Dict<K,V>>) are best-effort.
_check_arity_spam() {
    local raw count=0
    raw=$(_search '^\s*(public|internal|protected)\s+.*\s+([A-Z][a-zA-Z0-9]+)(<[^>]*>)?\(' -E \
        | sed -E 's|^([^:]+):[0-9]+:.*[[:space:]]([A-Z][a-zA-Z0-9]+)(<[^>]*>)?\(([^)]*)\).*|\1\t\2\t\4|; /\t/!d' \
        || true)
    [[ -n "$raw" ]] && count=$(printf '%s\n' "$raw" | awk -F'\t' '
        NF < 2 { next }
        # count_params: arity ignoring commas nested inside <> (generics-aware)
        function count_params(params,    depth, i, ch, n) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", params)
            if (params == "") return 0
            depth = 0; n = 1
            for (i = 1; i <= length(params); i++) {
                ch = substr(params, i, 1)
                if      (ch == "<") depth++
                else if (ch == ">") depth--
                else if (ch == "," && depth == 0) n++
            }
            return n
        }
        # leading_word: first camelCase word -- GetById->Get, TryCreate->Try, Execute->Execute
        function leading_word(name,    i, ch) {
            for (i = 2; i <= length(name); i++) {
                ch = substr(name, i, 1)
                if (ch ~ /[A-Z]/) return substr(name, 1, i - 1)
            }
            return name
        }
        {
            file   = $1
            mname  = $2
            params = (NF >= 3) ? $3 : ""
            arity  = count_params(params)
            prefix = leading_word(mname)
            # OVERLOAD_SPAM: count distinct arities per (file, method_name)
            okey = file SUBSEP mname SUBSEP arity
            if (!(okey in o_seen)) { o_seen[okey] = 1; o_arities[file SUBSEP mname]++ }
            # SURFACE_INFLATION: count distinct method names per (file, leading_word)
            skey = file SUBSEP prefix SUBSEP mname
            if (!(skey in s_seen)) { s_seen[skey] = 1; s_names[file SUBSEP prefix]++ }
        }
        END {
            sum = 0
            for (k in o_arities) if (o_arities[k] >= 3) sum++
            for (k in s_names)   if (s_names[k]   >= 3) sum++
            print sum + 0
        }
    ' || true)
    _report "MEDIUM" "ARITY_SPAM" "$count"; _tally "MEDIUM" "$count"
}

# --- [CHECK_9] HELPER_SPAM ----------------------------------------------------
# NOTE: Best-effort heuristic; multi-file analysis has limitations.
# ref_count from _search includes the definition line itself, so a private
# method called once yields ref_count==2. The threshold ref_count<=2 therefore
# flags methods with 0 or 1 actual call sites, matching validation.md [9]:
# "private method with single call site" (HELPER_SPAM / CSP0005).
_check_helper_spam() {
    local privates name ref_count count=0
    privates=$(_search '^\s*private\s+.*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(' -E \
        | sed -E 's/.*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(.*/\1/' | sort -u || true)
    if [[ -n "$privates" ]]; then
        while IFS= read -r name; do
            [[ -z "$name" ]] && continue
            ref_count=$(_search "\b${name}\b" | grep -c '.' || true)
            [[ "$ref_count" -le 2 ]] && ((count++)) || true
        done <<< "$privates"
    fi
    _report "LOW" "HELPER_SPAM" "$count"; _tally "LOW" "$count"
}

# --- [SUMMARY] ----------------------------------------------------------------
_summary() {
    local total=$((_high + _medium + _low))
    printf '\n%b--- SUMMARY ---%b\n' "${BOLD}" "${RESET}"
    printf '%b  HIGH:   %d%b\n' "${RED}" "$_high" "${RESET}"
    printf '%b  MEDIUM: %d%b\n' "${YELLOW}" "$_medium" "${RESET}"
    printf '%b  LOW:    %d%b\n' "${GREEN}" "$_low" "${RESET}"
    printf "  TOTAL:  %d\n\n" "$total"
    if [[ "$_high" -gt 0 ]]; then
        printf '%b[FAIL] High-severity violations found.%b\n' "${RED}${BOLD}" "${RESET}"; return 2
    elif [[ "$_medium" -gt 0 ]]; then
        printf '%b[WARN] Medium-severity violations found.%b\n' "${YELLOW}${BOLD}" "${RESET}"; return 1
    else
        printf '%b[PASS] No violations detected.%b\n' "${GREEN}${BOLD}" "${RESET}"; return 0
    fi
}

# --- [MAIN] -------------------------------------------------------------------
printf '%bC# Standards Validator%b\n' "${BOLD}" "${RESET}"
printf "Target: %s\nSearch: %s\n\n" "$_TARGET_DIR" "$_SEARCH_CMD"

# [CHECK_1] VAR_INFERENCE
_run "HIGH" "VAR_INFERENCE" \
    "$(_search '\bvar ' | grep -i 'namespace.*Domain\|Domain[/\\]' || true)"
# [CHECK_2] EXCEPTION_CONTROL_FLOW
_run "HIGH" "EXCEPTION_CONTROL_FLOW" \
    "$(_search '\b(catch|throw)\b' -E | grep -i 'Domain[/\\]' || true)"
# [CHECK_3] IMPERATIVE_BRANCH
_run "HIGH" "IMPERATIVE_BRANCH" \
    "$(_search '\bif\s*\(|}\s*else\b' -E | grep -i 'Domain[/\\]' || true)"
# [CHECK_4] PREMATURE_MATCH_COLLAPSE
_run "MEDIUM" "PREMATURE_MATCH_COLLAPSE" \
    "$(_search '\.Match\(' | grep -v '^\s*return\b' | grep -v 'return.*\.Match(' || true)"
# [CHECK_5] ANEMIC_DOMAIN
_run "HIGH" "ANEMIC_DOMAIN" \
    "$(_search '\{\s*get;\s*set;\s*\}' -E | grep -i 'Domain[/\\]' || true)"
# [CHECK_6] INTERFACE_POLLUTION
_check_interface_pollution
# [CHECK_7] NULL_ARCHITECTURE
_run "MEDIUM" "NULL_ARCHITECTURE" \
    "$(_search '(==\s*null|!=\s*null)' -E | grep -i 'Domain[/\\]' || true)"
# [CHECK_8] ARITY_SPAM
_check_arity_spam
# [CHECK_9] HELPER_SPAM
_check_helper_spam
# [CHECK_10] CLOSURE_CAPTURE_HOT_PATH
_run "HIGH" "CLOSURE_CAPTURE_HOT_PATH" \
    "$(_search '=>' | grep -i 'Performance[/\\]' | grep -v 'static\s' || true)"
# [CHECK_11] MUTABLE_ACCUMULATOR
_run "HIGH" "MUTABLE_ACCUMULATOR" \
    "$(_search '\b(foreach|for)\s*\(' -E | grep -i 'Domain[/\\]' || true)"
# [CHECK_12] POSITIONAL_ARGS
_run "MEDIUM" "POSITIONAL_ARGS" \
    "$(_search '\(\s*[a-zA-Z0-9_."]+\s*,' -E \
        | grep -v ':\s' | grep -v '^\s*//' \
        | grep -v 'new\s\|=>\|using\|namespace\|class\s\|struct\s\|record\s\|enum\s\|interface\s' || true)"
# [CHECK_13] RUNTIME_REGEX_COMPILATION
_run "HIGH" "RUNTIME_REGEX_COMPILATION" "$(_search 'new\s+Regex\s*\(' -E)"

_summary
