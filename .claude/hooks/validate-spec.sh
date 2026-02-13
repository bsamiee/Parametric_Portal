#!/usr/bin/env bash
# validate-spec.sh -- PostToolUse hook: *.spec.ts quality gates.
# Stdin: JSON from Claude Code PostToolUse event.
# Exit 0 + JSON "block" => feedback to Claude. Exit 0 (no JSON) => pass.
#
# Single awk pass over the file; data-driven dispatch table for rules.
# Rules (13): any | let/var | for/while | try/catch | new Date() |
#   expr-form | import-order | line-count | forbidden-label |
#   custom-matcher | default-export | Object.freeze | if/else
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

FILE_PATH="$(jq -r '.tool_input.file_path // empty')"
readonly FILE_PATH
case "${FILE_PATH}" in
    *.spec.ts) ;;
    *) exit 0 ;;
esac
[[ -f "${FILE_PATH}" ]] || exit 0
LINE_COUNT=$(wc -l < "${FILE_PATH}")
readonly LINE_COUNT

# --- [FUNCTIONS] --------------------------------------------------------------

_build_errors() {
    local -r file_path="$1" line_count="$2"
    shift 2
    local -a errors=()
    local max_loc=175
    (( line_count > max_loc )) && errors+=("File has ${line_count} lines (max ${max_loc}). Split into focused spec files.")
    local entry lineno _rule msg
    for entry in "$@"; do
        [[ -n "${entry}" ]] || continue
        # shellcheck disable=SC2034  # _rule: discarded middle field of lineno/rule/msg triple
        IFS=$'\t' read -r lineno _rule msg <<< "${entry}"
        errors+=("Line ${lineno}: ${msg}")
    done
    (( ${#errors[@]} == 0 )) && return 1
    local reason
    printf -v reason 'Spec validation failed for %s:\n%s' "${file_path##*/}" "$(printf '%s\n' "${errors[@]}")"
    printf '{"decision":"block","reason":%s}' "$(jq -Rs '.' <<< "${reason}")"
}

# --- [EXPORT] -----------------------------------------------------------------

# Q="'" passed via -v: awk cannot embed literal single quotes inside /regex/.
# shellcheck disable=SC2016
mapfile -t AWK_ERRORS < <(awk -v Q="'" '
function emit(rule, msg) { printf "%d\t%s\t%s\n", NR, rule, msg }
BEGIN {
    in_block_comment = 0; last_import_group = 0; import_order_broken = 0
    # Import order group map
    grp["@effect/vitest"] = 1; grp["effect"] = 3; grp["vitest"] = 4
    # Data-driven rule dispatch: parallel arrays (pattern, rule, message)
    n = 0
    pat[++n] = "(:[[:space:]]*any([^[:alnum:]_]|$)|as[[:space:]]+any([^[:alnum:]_]|$)|<any>|,[[:space:]]*any[[:space:]]*[>)])"
    rul[n] = "any"; msg[n] = "Forbidden " Q "any" Q ". Use branded types via Schema."
    pat[++n] = "^(let|var)[[:space:]]"
    rul[n] = "let-var"; msg[n] = "Forbidden " Q "let" Q "/" Q "var" Q ". Use " Q "const" Q " only."
    pat[++n] = "^(for|while)[[:space:]]*\\("
    rul[n] = "loop"; msg[n] = "Forbidden " Q "for" Q "/" Q "while" Q " loop. Use .map, .filter, Effect.forEach."
    pat[++n] = "^(try[[:space:]]*\\{|\\}[[:space:]]*catch[[:space:]]*\\()"
    rul[n] = "try-catch"; msg[n] = "Forbidden " Q "try/catch" Q ". Use Effect error channel."
    pat[++n] = "new[[:space:]]+Date[[:space:]]*\\("
    rul[n] = "new-date"; msg[n] = "Forbidden " Q "new Date()" Q ". Use frozen constants or Effect clock."
    pat[++n] = "^(if[[:space:]]*\\(|\\}[[:space:]]*else[[:space:]])"
    rul[n] = "if-else"; msg[n] = "Forbidden " Q "if/else" Q ". Use ternary, fc.pre(), or Effect.fromNullable."
    pat[++n] = "\\.(toSucceed|toBeRight|toFail|toBeLeft)[[:space:]]*\\("
    rul[n] = "custom-matcher"; msg[n] = "Forbidden custom matcher. Use " Q "it.effect()" Q " + standard " Q "expect()" Q "."
    pat[++n] = "^export[[:space:]]+default[[:space:]]"
    rul[n] = "default-export"; msg[n] = "Forbidden " Q "export default" Q ". Use named exports only."
    pat[++n] = "Object\\.freeze[[:space:]]*\\("
    rul[n] = "object-freeze"; msg[n] = "Forbidden " Q "Object.freeze" Q ". Use " Q "as const" Q " for immutability."
    NRULES = n
}
{
    line = $0
    # Block comments
    if (in_block_comment) {
        if (match(line, /\*\//)) { line = substr(line, RSTART + RLENGTH); in_block_comment = 0 }
        else next
    }
    while (match(line, /\/\*/)) {
        before = substr(line, 1, RSTART - 1); rest = substr(line, RSTART)
        if (match(rest, /\*\//)) line = before substr(rest, RSTART + RLENGTH)
        else { line = before; in_block_comment = 1; break }
    }
    # Strip leading whitespace (all anchored patterns adjusted to match post-strip)
    gsub(/^[[:space:]]+/, "", line)
    # Forbidden section labels (checked before skipping comment lines)
    if (line ~ /^\/\/.*\[(HELPERS|HANDLERS|UTILS|CONFIG|DISPATCH_TABLES)\]/)
        emit("forbidden-label", "Forbidden section label. Use [CONSTANTS], [LAYER], [ALGEBRAIC], or [EDGE_CASES].")
    if (line ~ /^(\/\/|\*)/) next
    # Data-driven rule checks (dispatch table)
    for (i = 1; i <= NRULES; i++) if (match(line, pat[i])) emit(rul[i], msg[i])
    # Expression-form checks (Effect.sync/tap without block body)
    if (match(line, /Effect\.(sync|tap)\(/) && line ~ /=>[[:space:]]*expect/ && !(line ~ /=>[[:space:]]*\{/))
        emit("expr-form", "Expression-form. Use block: Effect.sync/tap(() => { expect(...); })")
    # Import order (4 groups: @effect/vitest -> @parametric-portal/* -> effect -> vitest)
    if (line ~ /^import[[:space:]]/ && match(line, /from[[:space:]]+/)) {
        tail = substr(line, RSTART + RLENGTH); qchar = substr(tail, 1, 1)
        if (qchar == "\"" || qchar == Q) {
            mod = substr(tail, 2); endq = index(mod, qchar)
            if (endq > 0) mod = substr(mod, 1, endq - 1)
            group = (mod in grp) ? grp[mod] : (mod ~ /^@parametric-portal\// ? 2 : 0)
            if (group > 0 && !import_order_broken) {
                if (group < last_import_group) { emit("import-order", "Import order violation. Expected: @effect/vitest -> @parametric-portal/* -> effect -> vitest."); import_order_broken = 1 }
                else last_import_group = group
            }
        }
    }
}
' "${FILE_PATH}" 2>/dev/null)

_build_errors "${FILE_PATH}" "${LINE_COUNT}" "${AWK_ERRORS[@]+"${AWK_ERRORS[@]}"}" || exit 0
exit 0
