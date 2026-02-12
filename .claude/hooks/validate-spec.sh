#!/usr/bin/env bash
# validate-spec.sh -- PostToolUse hook for *.spec.ts quality gates.
# Validates AI-generated test files against project testing standards.
# Stdin: JSON from Claude Code PostToolUse event.
# Exit 0 + JSON decision "block" => feedback to Claude for correction.
# Exit 0 (no JSON) => pass, file is compliant.
#
# Architecture: single awk pass replaces three while-read loops + hundreds
# of printf|grep subshells. All pattern checks run inside awk native
# regex engine at C speed -- zero forks per line.
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [INPUT] ------------------------------------------------------------------

# Read all of stdin (JSON from Claude Code PostToolUse event).
readonly INPUT="$(< /dev/stdin)"
readonly FILE_PATH="$(jq -r '.tool_input.file_path // empty' <<< "${INPUT}")"

# Only validate *.spec.ts files.
case "${FILE_PATH}" in
    *.spec.ts) ;;
    *) exit 0 ;;
esac

# Bail if the file does not exist (e.g. deleted).
[[ -f "${FILE_PATH}" ]] || exit 0

# --- [VALIDATION] -------------------------------------------------------------

# Line count via arithmetic -- strips macOS wc padding implicitly.
readonly LINE_COUNT=$(( $(wc -l < "${FILE_PATH}") ))

# Single awk pass: checks anti-patterns, expression-form, and import order.
# Emits structured lines: "LINENO<TAB>RULE_ID<TAB>MESSAGE" per violation.
#
# The awk program is passed via -v Q="'" for single-quote embedding in
# awk regex character classes (awk cannot represent literal single quotes
# inside /regex/ syntax, so we build patterns dynamically with match()).
#
# shellcheck disable=SC2016
mapfile -t AWK_ERRORS < <(awk -v Q="'" '
BEGIN {
    last_import_group = 0
    import_order_broken = 0
    in_block_comment = 0
}
{
    line = $0

    # --- Block comment tracking (/* ... */) ---
    if (in_block_comment) {
        if (match(line, /\*\//)) {
            line = substr(line, RSTART + RLENGTH)
            in_block_comment = 0
        } else {
            next
        }
    }
    if (match(line, /\/\*/)) {
        before = substr(line, 1, RSTART - 1)
        rest = substr(line, RSTART)
        if (match(rest, /\*\//)) {
            line = before substr(rest, RSTART + RLENGTH)
        } else {
            line = before
            in_block_comment = 1
        }
    }

    # --- Skip single-line comment lines (// and leading * in JSDoc) ---
    stripped = line
    gsub(/^[[:space:]]+/, "", stripped)
    if (substr(stripped, 1, 2) == "//") next
    if (substr(stripped, 1, 1) == "*") next

    # --- [CHECK: anti-patterns] ---

    # [2a] Forbidden "any" type: `: any`, `as any`, `<any>`.
    # Word boundary: non-alphanumeric/underscore after "any" or end-of-line.
    if (match(line, /:[[:space:]]*any([^[:alnum:]_]|$)/) ||
        match(line, /as[[:space:]]+any([^[:alnum:]_]|$)/) ||
        match(line, /<any>/)) {
        printf "%d\tany\tForbidden " Q "any" Q " type. Use branded types via Schema.\n", NR
    }

    # [2b] let/var declarations at statement level.
    if (match(line, /^[[:space:]]*(let|var)[[:space:]]/)) {
        printf "%d\tlet-var\tForbidden " Q "let" Q "/" Q "var" Q ". Use " Q "const" Q " only.\n", NR
    }

    # [2c] for/while loops.
    if (match(line, /^[[:space:]]*(for|while)[[:space:]]*\(/)) {
        printf "%d\tloop\tForbidden " Q "for" Q "/" Q "while" Q " loop. Use .map, .filter, Effect.forEach.\n", NR
    }

    # [2d] try/catch blocks.
    if (match(line, /^[[:space:]]*try[[:space:]]*\{/)) {
        printf "%d\ttry-catch\tForbidden " Q "try/catch" Q ". Use Effect error channel.\n", NR
    }
    if (match(line, /^[[:space:]]*\}[[:space:]]*catch[[:space:]]*\(/)) {
        printf "%d\ttry-catch\tForbidden " Q "try/catch" Q ". Use Effect error channel.\n", NR
    }

    # [2e] new Date() in tests.
    if (match(line, /new[[:space:]]+Date[[:space:]]*\(/)) {
        printf "%d\tnew-date\tForbidden " Q "new Date()" Q ". Use frozen constants or Effect clock.\n", NR
    }

    # --- [CHECK: expression-form assertions] ---

    # Effect.sync(() => expect(...)) without block wrapper { }.
    if (match(line, /Effect\.sync\(\(\)[[:space:]]*=>[[:space:]]*expect/)) {
        if (!match(line, /Effect\.sync\(\(\)[[:space:]]*=>[[:space:]]*\{/)) {
            printf "%d\texpr-form\tExpression-form assertion in Effect.sync. Use block syntax: Effect.sync(() => { expect(...); })\n", NR
        }
    }

    # Effect.tap((v) => expect(...)) without block wrapper { }.
    if (match(line, /Effect\.tap\([^)]*\)[[:space:]]*=>[[:space:]]*expect/) ||
        match(line, /Effect\.tap\(\([^)]*\)[[:space:]]*=>[[:space:]]*expect/)) {
        if (!match(line, /Effect\.tap\([^)]*=>[[:space:]]*\{/)) {
            printf "%d\texpr-form\tExpression-form assertion in Effect.tap. Use block syntax: Effect.tap((v) => { expect(...); })\n", NR
        }
    }

    # --- [CHECK: import order] ---
    # Groups: 1=@effect/vitest  2=@parametric-portal/*  3=effect  4=vitest
    # Build quote-class pattern dynamically: ["'"'"'] cannot appear in /regex/.
    # Instead, use index() to find "from" + quote, then check the module name.

    if (match(line, /^[[:space:]]*import[[:space:]]/)) {
        group = 0
        # Extract module specifier after "from" keyword.
        # Match: from <quote><module><quote>
        if (match(line, /from[[:space:]]+/)) {
            tail = substr(line, RSTART + RLENGTH)
            # First char should be a quote (" or '"'"').
            qchar = substr(tail, 1, 1)
            if (qchar == "\"" || qchar == Q) {
                # Extract module name between quotes.
                mod = substr(tail, 2)
                endq = index(mod, qchar)
                if (endq > 0) mod = substr(mod, 1, endq - 1)

                if (mod == "@effect/vitest")                         group = 1
                else if (substr(mod, 1, 20) == "@parametric-portal/") group = 2
                else if (mod == "effect")                            group = 3
                else if (mod == "vitest")                            group = 4
            }
        }

        if (group > 0 && !import_order_broken) {
            if (group < last_import_group) {
                printf "%d\timport-order\tImport order violation. Expected: @effect/vitest -> @parametric-portal/* -> effect -> vitest.\n", NR
                # Only report the first violation; stop checking.
                import_order_broken = 1
            } else {
                last_import_group = group
            }
        }
    }
}
' "${FILE_PATH}" 2>/dev/null)

# --- [RESULT] -----------------------------------------------------------------

# Build error list: LOC error (no line number) + awk errors (with line numbers).
declare -a ERRORS=()

(( LINE_COUNT > 125 )) && ERRORS+=("File has ${LINE_COUNT} lines (max 125). Split into focused spec files.")

# Parse awk output: "LINENO<TAB>RULE_ID<TAB>MESSAGE" -> "Line N: MESSAGE" via parameter expansion.
# Direct array iteration with empty-guard -- no while-read loop needed.
for entry in "${AWK_ERRORS[@]+"${AWK_ERRORS[@]}"}"; do
    [[ -n "${entry}" ]] || continue
    # Extract fields via IFS-split: LINENO<TAB>RULE_ID<TAB>MESSAGE
    IFS=$'\t' read -r lineno _ msg <<< "${entry}"
    ERRORS+=("Line ${lineno}: ${msg}")
done

(( ${#ERRORS[@]} == 0 )) && exit 0

# Assemble reason string + JSON-encode via jq (handles all escaping).
printf -v REASON 'Spec validation failed for %s:\n%s' "${FILE_PATH##*/}" "$(printf '%s\n' "${ERRORS[@]}")"
printf '{"decision":"block","reason":%s}' "$(jq -Rs '.' <<< "${REASON}")"
exit 0
