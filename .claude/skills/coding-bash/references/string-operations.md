# [H1][STRING-TRANSFORMS]
>**Dictum:** *Parameter expansion chains compose string transforms without forks — each `${}` operator is a pure function over the variable's value.*

<br>

Multi-stage transform pipelines, regex extraction with BASH_REMATCH, codec patterns (URL/hex/base64), printf formatting, and template expansion. Single-operator PE reference in [bash-scripting-guide.md S5](./bash-scripting-guide.md).

| [IDX] | [PATTERN]          |  [S]  | [USE_WHEN]                                    |
| :---: | :----------------- | :---: | :-------------------------------------------- |
|  [1]  | Transform pipeline |  S1   | Multi-stage string reshape via chained PE     |
|  [2]  | Regex extraction   |  S2   | Structured parsing via BASH_REMATCH captures  |
|  [3]  | Printf formatting  |  S3   | `%q`, `%(%T)T`, `printf -v` fork-free capture |
|  [4]  | Codec patterns     |  S4   | URL encode, hex, base64, JSON escape          |
|  [5]  | Template expansion |  S5   | Heredocs, format strings, envsubst            |

---
## [1][TRANSFORM_PIPELINES]
>**Dictum:** *Chained parameter expansion composes transforms left-to-right — each operation's output is the next operation's input.*

<br>

Each `${}` produces a new string without mutating the variable — reassignment is explicit. In a loop processing N strings with M transforms, chained PE costs 0 forks vs `sed`/`awk` costing N*M process spawns. The `${var,,}` / `${var^^}` case transforms are locale-dependent — under `LC_CTYPE=tr_TR.UTF-8`, `${var^^}` maps `i` to `I` (dotless), not `İ`. Pin `LC_ALL=C` when ASCII-only case folding is required.

```bash
# Multi-stage path normalization: 5 transforms, 0 forks
_normalize_url() {
    local -r raw="$1"
    local result="${raw}"
    result="${result#http://}"; result="${result#https://}"  # Strip protocol
    result="${result%%\?*}"                                  # Strip query string
    result="${result%%#*}"                                   # Strip fragment
    result="${result%/}"                                     # Strip trailing slash
    result="${result,,}"                                     # Lowercase
    printf '%s' "${result}"
}
# Slug generation: 6 chained PEs, extglob for run-length collapse
_slugify() {
    local -r input="$1"
    local result="${input,,}"                  # Lowercase
    result="${result//[^a-z0-9 -]/-}"          # Non-alnum → hyphen
    result="${result//+( )/-}"                 # Spaces → single hyphen (extglob)
    result="${result//+(-)/-}"                 # Collapse consecutive hyphens
    result="${result#-}"; result="${result%-}" # Trim leading/trailing hyphens
    printf '%s' "${result}"
}
# Whitespace trim + collapse via controlled word splitting
_normalize_ws() {
    local result="$1"
    result="${result#"${result%%[![:space:]]*}"}"   # Trim leading
    result="${result%"${result##*[![:space:]]}"}"   # Trim trailing
    local IFS=' '
    # shellcheck disable=SC2086
    set -- ${result}                                # Intentional split
    printf '%s' "$*"
}
# Composed: sanitize user input for filename
_safe_filename() {
    local -r input="$1" max_len="${2:-64}"
    local result
    result="$(_slugify "${input}")"
    result="${result:0:${max_len}}"        # Truncate
    result="${result%-}"                   # Clean truncation artifact
    printf '%s' "${result}"
}
# Bash 5.3+: ${ cmd; } eliminates fork in composition calls
# Side effects propagate — _slugify's shopt/LC_ALL changes persist
_safe_filename_53() {
    local -r input="$1" max_len="${2:-64}"
    local result="${ _slugify "${input}"; }"   # Current-shell capture
    result="${result:0:${max_len}}"
    result="${result%-}"
    printf '%s' "${result}"
}
```

`+( )` and `+(-)` require `shopt -s extglob` (set in strict mode header). `set -- ${result}` without quotes splits on IFS, then `"$*"` rejoins with the first character of IFS. `${ cmd; }` (Bash 5.3+) runs in current shell — side effects propagate; see [version-features.md S1](./version-features.md) for semantics and perf benchmarks.

**Edge cases**: `${var:-default}` substitutes when var is unset OR empty; `${var-default}` substitutes only when unset. `${var:+alt}` substitutes when var is set AND non-empty; `${var+alt}` substitutes when set (even if empty). Critical distinction for optional parameter pipelines.

---
## [2][REGEX_EXTRACTION]
>**Dictum:** *BASH_REMATCH capture groups replace awk/sed field extraction with zero-fork structured parsing.*

<br>

`[[ str =~ regex ]]` populates `BASH_REMATCH` — index 0 is the full match, indices 1+ are capture groups. ERE only (no PCRE) — no lookahead, no `\d`/`\w`, use `[0-9]` and `[[:alpha:]]`. Bash does NOT support named capture groups (`(?P<name>...)`) — use positional indices only. Each `=~` match is O(1) process cost vs `grep -oP` spawning a subprocess per invocation.

```bash
# Structured log parsing: 3 captures in one match, 0 forks
_parse_log() {
    local -r line="$1"
    [[ "${line}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+)[[:space:]]+\[([A-Z]+)\][[:space:]]+(.*) ]] || return 1
    local -n _ts=$2 _level=$3 _msg=$4
    _ts="${BASH_REMATCH[1]}"
    _level="${BASH_REMATCH[2]}"
    _msg="${BASH_REMATCH[3]}"
}
# Semantic version: index 5 is inner capture of optional outer group at 4
_parse_semver() {
    local -r version="$1"
    [[ "${version}" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9.]+))? ]] || return 1
    local -n _major=$2 _minor=$3 _patch=$4 _pre=$5
    _major="${BASH_REMATCH[1]}"
    _minor="${BASH_REMATCH[2]}"
    _patch="${BASH_REMATCH[3]}"
    _pre="${BASH_REMATCH[5]}"
}
# Multi-match: advance remaining by stripping matched prefix (no global flag)
_extract_pairs() {
    local remaining="$1"; local -n _pairs=$2
    local -r pattern='([a-zA-Z_][a-zA-Z_0-9]*)=("([^"]*)"|([^ ]*))'
    while [[ "${remaining}" =~ ${pattern} ]]; do
        local key="${BASH_REMATCH[1]}"
        local value="${BASH_REMATCH[3]:-${BASH_REMATCH[4]}}"
        _pairs["${key}"]="${value}"
        remaining="${remaining#*"${BASH_REMATCH[0]}"}"
    done
}
# Validate + extract + dispatch via lookup table in single operation
_parse_duration() {
    local -r input="$1"
    [[ "${input}" =~ ^([0-9]+)(s|m|h|d)$ ]] || {
        printf 'Invalid duration: %s\n' "${input}" >&2; return 1
    }
    local -r value="${BASH_REMATCH[1]}" unit="${BASH_REMATCH[2]}"
    declare -Ar _MULTIPLIER=([s]=1 [m]=60 [h]=3600 [d]=86400)
    printf '%d' "$(( value * _MULTIPLIER[${unit}] ))"
}
```

Regex pattern must be unquoted on RHS of `=~` — quoting forces literal string match. BASH_REMATCH indexing follows group nesting depth: outer groups get lower indices. `_extract_pairs` uses `local` (not `local -r`) inside the loop — `local -r` would fail on second iteration with a redeclaration error. See service-wrapper.sh `_parse_traceparent` for a production example: `[[ "${tp}" =~ ^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$ ]]` validates W3C trace context and extracts trace/span/flags in a single match.

---
## [3][PRINTF_FORMATTING]
>**Dictum:** *`printf -v` captures formatted output into a variable without forking — the only fork-free alternative to command substitution.*

<br>

`printf -v var` assigns directly to the named variable — no subshell, no `$()`, O(0) fork cost. In a loop of 10,000 iterations, `printf -v ts '%(%F %T)T' -1` vs `ts=$(date +"%F %T")` is ~50x faster (builtin vs fork+exec+wait per iteration). `%q` produces shell-quoted output safe for `eval`-free reuse. `%(%T)T` (Bash 5.0+) formats epoch timestamps without `$(date)`.

```bash
# Fork-free timestamp capture: 0 forks vs $(date) spawning /usr/bin/date
_timestamp() {
    local -n _out=$1
    printf -v _out '%(%FT%T%z)T' -1      # Current time, ISO 8601
}
# Epoch to formatted: printf -v avoids $() subshell
_format_epoch() {
    local -n _out=$1; local -r epoch="$2"
    printf -v _out '%(%F %T)T' "${epoch}"
}
# Shell-safe quoting: %q escapes for reuse in shell context
_shell_quote() {
    local -n _out=$1; shift
    printf -v _out '%q ' "$@"              # Each arg individually quoted
    _out="${_out% }"                       # Strip trailing space
}
# Parameter transformation operators (Bash 5.2+)
# ${var@Q} — shell-quoted (equivalent to printf %q)
# ${var@E} — backslash escapes interpreted (like $'...')
# ${var@A} — declare statement that recreates the variable
# ${var@a} — attribute flags (r=readonly, a=array, A=assoc, i=integer)
_inspect() {
    local -r var_name="$1"
    local -n _ref="${var_name}"
    printf 'value: %s\n' "${_ref}"
    printf 'quoted: %s\n' "${_ref@Q}"
    printf 'attrs: %s\n' "${_ref@a}"
    printf 'decl: %s\n' "${_ref@A}"
}
# Composing printf -v with PE: build, then transform
_build_key() {
    local -n _out=$1
    local -r prefix="$2" name="$3" suffix="$4"
    printf -v _out '%s:%s:%s' "${prefix}" "${name}" "${suffix}"
    _out="${_out,,}"                       # Lowercase after assembly
}
```

`printf -v` writes to the variable in the CURRENT scope — not a subshell. This means `local -n` namerefs compose with `printf -v` for zero-allocation output. `${var@Q}` is the PE equivalent of `printf '%q'` — use PE form in expansion contexts, `printf -v` form when building into a separate variable. Bash 5.3+ `${ cmd; }` is the third fork-free capture mechanism — use when the producer is a function (not a format string), since `printf -v` cannot capture another function's stdout; see [version-features.md S1](./version-features.md) for benchmarks. See service-wrapper.sh `_init_trace` for a production pattern: `printf -v TRACE_ID '%08x%08x%08x%08x' "${SRANDOM}" "${SRANDOM}" "${SRANDOM}" "${SRANDOM}"` generates 128-bit hex identifiers from CSPRNG without forking `uuidgen` or reading `/dev/urandom`.

---
## [4][CODEC_PATTERNS]
>**Dictum:** *Encoding transforms map between domains — URL-safe, hex, base64 — using expansion and printf format specifiers.*

<br>

Bidirectional encoding projections: unsafe-in-context to safe-representation and back. `_urlencode` is byte-level via `printf '%%%02X'` with the `'` prefix (POSIX numeric extraction). `_urldecode` is fork-free: single PE replaces `%` with `\x`, then `printf '%b'` interprets the escapes. Hex/base64 require external tools (no pure-bash byte-level I/O for arbitrary binary).

```bash
# URL encode: RFC 3986 unreserved pass through, rest → %XX
# Note: for(()) loop is unavoidable — PE cannot iterate bytes
_urlencode() {
    local -r input="$1" len="${#1}"
    local i char
    for (( i = 0; i < len; i++ )); do
        char="${input:i:1}"
        [[ "${char}" =~ [a-zA-Z0-9.~_-] ]] \
            && printf '%s' "${char}" \
            || printf '%%%02X' "'${char}"
    done
}
# URL decode: fork-free — single PE + printf %b
_urldecode() {
    local -r input="${1//+/ }"
    printf '%b' "${input//%/\\x}"
}
# Hex encode/decode: requires xxd (no pure-bash equivalent for binary)
_hex_encode() { printf '%s' "$1" | xxd -p | tr -d '\n'; }
_hex_decode() { printf '%s' "$1" | xxd -r -p; }
# Base64 with URL-safe variant (no padding, +/ → -_)
_b64_encode() { printf '%s' "$1" | base64 | tr -d '\n'; }
_b64_decode() { printf '%s' "$1" | base64 -d 2>/dev/null; }
_b64url_encode() { _b64_encode "$1" | tr '+/' '-_' | tr -d '='; }
_b64url_decode() {
    local -r input="$1"
    local padded="${input}"
    local -r mod=$(( ${#input} % 4 ))
    (( mod == 2 )) && padded+="=="
    (( mod == 3 )) && padded+="="
    printf '%s' "${padded}" | tr '-_' '+/' | base64 -d 2>/dev/null
}
# JSON escape: 5 chained PEs, 0 forks. Backslash FIRST — prevents
# double-escaping from subsequent replacement passes.
_json_escape() {
    local result="$1"
    result="${result//\\/\\\\}"    # Backslash first
    result="${result//\"/\\\"}"    # Double quote
    result="${result//$'\n'/\\n}"  # Newline
    result="${result//$'\t'/\\t}"  # Tab
    result="${result//$'\r'/\\r}"  # Carriage return
    printf '%s' "${result}"
}
```

`printf '%%%02X' "'${char}"` — the `'` prefix extracts the character's numeric value (POSIX `printf` extension). `${input//%/\\x}` converts all `%` to `\x` in a single expansion, then `printf '%b'` interprets `\xNN` sequences — the entire decode is one PE + one builtin. `_b64url_decode` padding restoration: base64 requires length divisible by 4; modular arithmetic restores the stripped `=` characters.

---
## [5][TEMPLATE_EXPANSION]
>**Dictum:** *Heredocs with selective quoting control expansion scope — `<<'EOF'` suppresses, `<<EOF` enables.*

<br>

Two expansion levels: parameter expansion inside unquoted heredocs (shell-level), and `envsubst` for external template files (environment-level). `<<'EOF'` (quoted delimiter) suppresses ALL expansion — the most common heredoc bug is mixing quoted/unquoted delimiters.

```bash
# Heredoc template: variables expand inline
# Note: $(printf ...) inside heredoc forks a subshell — use printf -v
# before the heredoc to capture the timestamp fork-free
_render_config() {
    local -r host="$1" port="$2" name="$3"
    local ts; printf -v ts '%(%FT%T%z)T' -1
    cat <<EOF
{
    "server": {
        "host": "${host}",
        "port": ${port},
        "name": "${name}",
        "started": "${ts}"
    }
}
EOF
}
# Suppressed heredoc: emit template source code literally
_emit_template() {
    cat <<'EOF'
#!/usr/bin/env bash
printf 'Host: %s\n' "${HOST}"
printf 'Port: %d\n' "${PORT}"
EOF
}
# envsubst with explicit variable list — without list, ALL env vars expand
_render_from_file() {
    local -r template="$1"; shift
    local var; for var in "$@"; do export "${var}"; done
    envsubst "$(printf '${%s} ' "$@")" < "${template}"
    for var in "$@"; do unset "${var}"; done
}
# Printf format strings are injection-safe: %s cannot execute code
_render_row() {
    printf '| %-20s | %8d | %6.1f%% |\n' "$1" "$2" "$3"
}
```

`envsubst` explicit variable list prevents unintended expansion of `$PATH`, `$HOME`, etc. `_render_from_file` exports then unexports to avoid polluting the environment. `printf` format strings over `eval`-based templates — format specifiers cannot execute code.

---
## [RULES]

- Chain PEs left-to-right with explicit reassignment — each `${}` is pure, 0 forks per transform.
- `printf -v var` over `var=$(printf ...)` — eliminates subshell fork for variable capture.
- `printf '%q'` or `${var@Q}` for shell-safe quoting — never `eval` with unquoted strings.
- `printf '%(%F %T)T' -1` over `$(date)` — builtin timestamp, no fork.
- `${var@Q}` / `${var@E}` / `${var@A}` / `${var@a}` — Bash 5.2+ parameter transformation operators.
- `${var,,}` / `${var^^}` are locale-dependent — pin `LC_ALL=C` for ASCII-only case folding.
- `${var:-default}` (unset OR empty) vs `${var-default}` (unset only) — know the distinction.
- BASH_REMATCH indices follow group nesting depth — no named capture groups in bash.
- ERE syntax only in `=~` — no `\d`, `\w`, `\b`; use `[0-9]`, `[[:alpha:]]`, anchors.
- Regex pattern unquoted on RHS of `=~` — quoting forces literal match.
- `local` (not `local -r`) for variables reassigned inside loops — `local -r` redeclaration fails.
- `printf '%%%02X' "'${char}"` for byte-to-hex — `'` prefix is POSIX numeric extraction.
- `printf '%b'` + `${//%/\\x}` for fork-free URL decode in single expansion.
- JSON escape: backslash FIRST — prevents double-escaping from subsequent passes.
- `<<'EOF'` suppresses expansion; `<<EOF` enables — mixing is the most common heredoc bug.
- `envsubst` with explicit variable list — without it, all env vars expand (security risk).
- `printf -v var '%08x' "${SRANDOM}"` for fork-free hex ID generation from kernel CSPRNG — replaces `uuidgen`/`od -x` forks.
- `${k%%+([[:space:]])}` / `${v##+([[:space:]])}` for extglob whitespace trim in config parsing (cli-tool.sh pattern).
- Bash 5.3+ `${ cmd; }` for fork-free function capture — use when producer is a function, not a format string (`printf -v` cannot capture another function's stdout).
