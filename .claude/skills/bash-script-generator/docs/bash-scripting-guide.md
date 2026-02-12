# Bash Scripting Guide (5.2+ / 5.3)

## Bash vs POSIX sh

| Feature         | Bash 5.2+/5.3                                          | POSIX sh               |
| --------------- | ------------------------------------------------------ | ---------------------- |
| Arrays          | `arr=(one two three)`                                  | `set -- one two three` |
| Assoc arrays    | `declare -A map=([k]=v)`                               | N/A                    |
| Conditionals    | `[[ ... ]]` (regex, pattern, short-circuit)            | `[ ... ]`              |
| Param expansion | `${var//pat/rep}`, `${var^^}`, `${var@Q}`              | Basic only             |
| Process subst   | `<(command)`                                           | N/A                    |
| Globbing        | `**` with `shopt -s globstar`                          | N/A                    |
| Nameref         | `local -n ref=$1`                                      | N/A                    |
| Readarray       | `readarray -d '' -t arr`                               | N/A                    |
| Coproc          | `coproc NAME { cmd; }`                                 | N/A                    |
| Timestamps      | `printf '%(%F %T)T' -1` (builtin, no fork)             | `date '+%F %T'`        |
| EPOCHREALTIME   | `${EPOCHREALTIME}` (microsecond)                       | N/A                    |
| Shell quoting   | `${var@Q}` (quote for re-eval)                         | N/A                    |
| Attributes      | `${var@a}` (inspect declare flags)                     | N/A                    |
| Case transform  | `${var@U}` upper, `${var@u}` ucfirst, `${var@L}` lower | N/A                    |

**Bash 5.2+/5.3** for modern Linux/macOS with full feature set. **POSIX sh** only for max portability or minimal containers.

## Bash 5.3 New Features (July 2025)

| Feature                   | Syntax                             | Purpose                                                    |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Current-shell command sub | `${ cmd; }`                        | Capture stdout without forking a subshell                  |
| REPLY command sub         | `${                                | cmd; }`                                                    | Run in current shell, result via `REPLY` variable |
| GLOBSORT variable         | `GLOBSORT=name`                    | Control pathname-completion sort order (name, size, mtime) |
| `source -p PATH`          | `source -p /custom/path script.sh` | Use custom PATH instead of `$PATH` for sourcing            |
| `read -E`                 | `read -E -p "prompt: " var`        | Tab-completion via Readline during `read`                  |

## Strict Mode

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'
```

| Flag              | Effect                                         |
| ----------------- | ---------------------------------------------- |
| `-e`              | Exit on non-zero status                        |
| `-u`              | Error on unset variables                       |
| `-o pipefail`     | Pipeline fails if any command fails            |
| `-E`              | ERR trap inherits into functions and subshells |
| `inherit_errexit` | Command substitutions inherit errexit          |
| `IFS=$'\n\t'`     | Prevent word splitting on spaces               |

Disable temporarily: `if ! output=$(cmd 2>&1); then handle_error "${output}"; fi`

## Error Handling + Signals

```bash
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
check_command() { command -v "$1" &>/dev/null || die "Required: $1"; }
validate_file() { [[ -f "$1" ]] || die "Not found: $1"; [[ -r "$1" ]] || die "Not readable: $1"; }
readonly WORK_DIR="$(mktemp -d)"
cleanup() { local -r rc=$?; rm -rf "${WORK_DIR}"; exit "${rc}"; }
trap cleanup EXIT    # EXIT fires on normal exit + signals; one trap is sufficient
```

## Parameter Expansion

```bash
${var:-default}              # Default if unset/empty
${var:=default}              # Assign default if unset/empty
${var:?error}                # Exit with error if unset/empty
${var:+alt}                  # Use alt if set and non-empty
${var#pat}  ${var##pat}      # Remove prefix (shortest/longest)
${var%pat}  ${var%%pat}      # Remove suffix (shortest/longest)
${var/pat/rep}               # Replace first
${var//pat/rep}              # Replace all
${var^^}  ${var,,}           # Uppercase/lowercase all
${var^}   ${var,}            # Uppercase/lowercase first char
${#var}                      # Length
${var:off:len}               # Substring
${var@Q}                     # Shell-quoted for re-use as input
${var@A}                     # Assignment form (declare statement)
${var@a}                     # Attribute flags (e.g., "r" for readonly)
${var@U}                     # Uppercase all (bash 5.2+)
${var@u}                     # Uppercase first char (bash 5.2+)
${var@L}                     # Lowercase all (bash 5.2+)

# file="/path/to/file.txt"
${file##*/}    # file.txt    ${file%.*}     # /path/to/file
${file##*.}    # txt         ${file%/*}     # /path/to
```

## Variables + Functions

```bash
readonly MAX=3                                      # Constants: UPPER, readonly
export LOG_LEVEL="INFO"                             # Env vars: UPPER, export
local count=0                                       # Local: lowercase, in functions
local -r base_dir="/opt"                            # Readonly local (immutable in scope)
local -n ref=$1                                     # Nameref: alias to caller's variable
fn_name() { local -r input="$1"; }                  # POSIX-style declaration (portable)
printf -v timestamp '%(%F %T)T' -1                  # Assign timestamp without subshell
get_data() { local -n out=$1; out="computed"; }     # Return via nameref (no subshell)
```

Always quote: `"${var}"`. Use `$()` over backticks. Use `printf -v` over `var=$(printf ...)`.

## Arrays

```bash
arr=(one two three); arr+=("four")
${arr[0]} ${arr[@]} ${#arr[@]} ${!arr[@]}
readarray -t lines < file.txt                       # File into array (replaces while-read loop)
readarray -d '' -t files < <(find . -name "*.txt" -print0)  # Null-delimited safe

declare -A map=([k1]="v1" [k2]="v2")               # Associative array
${map[k1]} ${!map[@]} [[ -v map[k1] ]]              # Access, keys, existence check
```

## Conditionals + Pattern Matching

```bash
[[ -e f ]] # exists   [[ -f f ]] # file     [[ -d f ]] # dir
[[ -r f ]] # readable [[ -w f ]] # writable [[ -x f ]] # exec
[[ -s f ]] # non-empty [[ -L f ]] # symlink
# String: -z (empty) -n (non-empty) == != =~ (regex) == pattern* (glob)
# Numeric: -eq -ne -lt -le -gt -ge

# Prefer case (pattern matching) over if/elif chains
case "${file}" in *.txt) printf "text" ;; *.jpg|*.png) printf "image" ;; *) printf "other" ;; esac

# Dispatch table via associative array (functional alternative to case)
declare -A -r HANDLERS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
[[ -v HANDLERS[${command}] ]] && "${HANDLERS[${command}]}" "$@" || die "Unknown: ${command}"
```

## BASH_REMATCH for Parsing (replaces grep -oP / sed / awk)

```bash
# Extract fields via regex capture groups -- no external process
[[ "${line}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]([A-Z]+) ]] && {
    local date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"
}

# Parse "action@version" from YAML -- replaces sed + cut subshells
[[ "${line}" =~ uses:[[:space:]]*([^@]+)@([^[:space:]#]+) ]] && {
    local action="${BASH_REMATCH[1]}" version="${BASH_REMATCH[2]}"
}

# Trim whitespace via parameter expansion (replaces xargs/sed)
var="${var#"${var%%[![:space:]]*}"}"   # strip leading
var="${var%"${var##*[![:space:]]}"}"   # strip trailing
```

## Associative Array as Set (O(1) membership check)

```bash
# Declare set via associative array -- key existence is O(1) via [[ -v ]]
declare -Ar VALID_EXTS=([txt]=1 [log]=1 [csv]=1)
[[ -v VALID_EXTS["${ext}"] ]] || die "Unsupported: ${ext}"

# Deduplicate results via associative array as set
declare -A seen=()
for item in "${items[@]}"; do
    [[ -v seen["${item}"] ]] && continue
    seen["${item}"]=1
    process "${item}"
done
```

## IFS Manipulation for Splitting

```bash
# Split CSV fields -- no awk/cut needed
IFS=, read -ra parts <<< "${csv_line}"
printf 'Field 1: %s, Field 2: %s\n' "${parts[0]}" "${parts[1]}"

# Split delimited data (pipe, colon, tab)
IFS='|' read -r pattern msg level <<< "${check_def}"
IFS=/ read -ra segments <<< "${file_path}"
```

## Functional Array Processing

```bash
# Prefer readarray + awk/grep pipelines over while-read loops

# Populate array from command output
readarray -t errors < <(grep -c 'ERROR' "${log_files[@]}")

# Transform array via printf + process substitution
readarray -t upper < <(printf '%s\n' "${items[@]}" | awk '{print toupper($0)}')

# Filter array via grep
readarray -t matches < <(printf '%s\n' "${items[@]}" | grep -E '^prefix')

# Count without mutable counter
readonly total=$(printf '%s\n' "${items[@]}" | wc -l)
```

## Process Substitution + Here-strings

```bash
diff <(sort file_a.txt) <(sort file_b.txt)                   # Compare sorted outputs
comm -13 <(sort known.txt) <(sort found.txt)                  # Set difference
while IFS= read -r line; do process "${line}"; done < <(cmd)  # Feed command output as stdin
grep -c 'ERROR' <<< "${log_contents}"                         # Here-string: no echo pipe
```

## Higher-Order Functions + Nameref

```bash
# Pass function name as argument + array via nameref
apply_to_each() {
    local -r func="$1"; local -n _items=$2
    local item
    for item in "${_items[@]}"; do "${func}" "${item}"; done
}
process() { printf 'Processing: %s\n' "$1"; }
local -a files=("a.txt" "b.txt")
apply_to_each process files

# Unified pattern checker: source text + pattern + message + callback
check_pattern() {
    local -r source="$1" pattern="$2" msg="$3" callback="$4"
    grep -qE "${pattern}" <<< "${source}" && "${callback}" "${msg}"
}
```

## Inline Trivial Functions

```bash
# BAD: single-use 2-line function called once
run_section() { printf '## %s ##\n' "$1"; eval "$2" || true; }
for entry in "${SECTIONS[@]}"; do run_section "${entry%%:*}" "${entry#*:}"; done

# GOOD: inline at call site (eliminates function overhead)
for entry in "${SECTIONS[@]}"; do
    printf '## %s ##\n' "${entry%%:*}"
    eval "${entry#*:}" || true
done
```

## Compound Command Grouping

```bash
# Brace grouping (current shell, no subshell overhead):
{ cmd1; cmd2; cmd3; } > output.txt

# Subshell (forked process, variable changes lost):
( cmd1; cmd2; cmd3 ) > output.txt

# Redirect once for multiple writes (no repeated file open):
{
    printf 'export %s="%s"\n' "KEY1" "val1"
    printf 'export %s="%s"\n' "KEY2" "val2"
} >> "${ENV_FILE}"
```

## Common Pitfalls

| Pitfall         | Bad                                           | Good                                          |
| --------------- | --------------------------------------------- | --------------------------------------------- |
| Word splitting  | `rm $file`                                    | `rm "${file}"`                                |
| UUOC            | `cat f \| grep p`                             | `grep p f`                                    |
| Echo pipe       | `echo "$x" \| cmd`                            | `cmd <<< "${x}"`                              |
| Cat subshell    | `data=$(cat file)`                            | `data=$(<file)`                               |
| File spaces     | `for f in $(find ...)`                        | `readarray -d '' -t f < <(find -print0)`      |
| Eval user input | `eval "${cmd}"`                               | `case "${cmd}" in start) ...`                 |
| Validate paths  | (none)                                        | `[[ -f "${file}" ]] \|\| die "Not found"`     |
| set -e + &&     | `[[ cond ]] && action`                        | `if [[ cond ]]; then action; fi`              |
| echo unsafe     | `echo "${var}"`                               | `printf '%s\n' "${var}"`                      |
| Date subshell   | `ts=$(date '+%F %T')`                         | `printf -v ts '%(%F %T)T' -1`                 |
| Test bracket    | `[ -f "$f" ]`                                 | `[[ -f "${f}" ]]`                             |
| Mutable counter | `count=0; for x in ...; do ((count++)); done` | `count=$(printf '%s\n' "${arr[@]}" \| wc -l)` |
