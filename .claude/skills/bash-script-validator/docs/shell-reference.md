# [H1][SHELL-REFERENCE]
>**Dictum:** *Bash/POSIX distinctions prevent portability defects.*

<br>

Bash 5.2+/5.3 vs POSIX sh feature matrix, parameter expansion, FP control flow, data structures, common mistakes.

---
## [1][BASH_ONLY_FEATURES]
>**Dictum:** *Feature awareness prevents portability defects.*

<br>

| [INDEX] | [FEATURE]                | [BASH]                                            | [POSIX_SH]                         |
| :-----: | ------------------------ | ------------------------------------------------- | ---------------------------------- |
|   [1]   | **Arrays**               | `array=(a b c); ${array[0]}`                      | `set -- a b c; printf '%s\n' "$1"` |
|   [2]   | **Test construct**       | `[[ "$v" == pat* ]]`                              | `[ "$v" = "exact" ]`               |
|   [3]   | **Process substitution** | `diff <(ls d1) <(ls d2)`                          | Temp files                         |
|   [4]   | **Brace expansion**      | `printf '%s\n' {1..10}`                           | `seq` or loop                      |
|   [5]   | **Local variables**      | `local var="val"`                                 | Name-prefix convention             |
|   [6]   | **Source command**       | `source script.sh`                                | `. script.sh`                      |
|   [7]   | **Case conversion**      | `${var,,}` / `${var^^}` / `${var@U}` / `${var@L}` | `tr '[:upper:]' '[:lower:]'`       |
|   [8]   | **Pattern replace**      | `${var//pat/repl}`                                | `sed` / `expr`                     |
|   [9]   | **Extended globbing**    | `shopt -s extglob`                                | N/A                                |
|  [10]   | **Built-in vars**        | `$RANDOM $SECONDS $BASH_SOURCE`                   | N/A                                |

---
## [2][PARAMETER_EXPANSION]
>**Dictum:** *Expansion operators replace external commands.*

<br>

```bash
# POSIX (portable)
${var:-default}     ${var:=default}     ${var:?error}       ${var:+alternate}
${#var}             ${var#pattern}      ${var##pattern}     ${var%pattern}     ${var%%pattern}

# Bash-only extensions
${var:offset:length}            # Substring
${var/pattern/replacement}      # Replace first
${var//pattern/replacement}     # Replace all
${var^} / ${var^^}              # Uppercase first/all
${var,} / ${var,,}              # Lowercase first/all

# Bash 5.2+ transformation operators
${var@U}  ${var@L}              # Uppercase/lowercase all
${var@u}                        # Uppercase first char
${var@Q}                        # Quoted for re-input
${var@a}                        # Attribute flags (r=readonly, x=exported, a=array, A=assoc)
${var@A}                        # Assignment statement to recreate variable
```

---
## [3][BASH_5_3]
>**Dictum:** *New builtins eliminate subshell overhead.*

<br>

```bash
${ cmd; }                      # Current-shell command substitution (no subshell fork)
${| cmd; }                     # REPLY command substitution (cmd sets REPLY, value returned)
GLOBSORT=nosort                # Control glob result ordering (nosort, name, size, mtime)
source -p PATH script.sh       # Source from explicit search PATH
read -E                        # Use readline for read input
compgen -V 'prefix'            # List variables matching prefix
```

---
## [4][FP_CONTROL_FLOW]
>**Dictum:** *Guards and dispatch tables replace branching.*

<br>

```bash
# Conditional guards (A && B || C only safe when B cannot fail)
[[ -f "${file}" ]] || die "Not found: ${file}"
(( count > 0 )) && printf 'Items: %d\n' "${count}"
: "${REQUIRED_VAR:?Must be set}"

# Dispatch table (replace if/elif chains)
declare -Ar HANDLERS=([start]=cmd_start [stop]=cmd_stop)
[[ -v HANDLERS["${cmd}"] ]] && "${HANDLERS[${cmd}]}" "$@"

# Declarative iteration
mapfile -t lines < <(rg 'pat' file.txt)
for line in "${lines[@]}"; do handle "${line}"; done
```

---
## [5][DATA_STRUCTURES]
>**Dictum:** *Associative arrays enable O(1) dispatch and membership.*

<br>

```bash
# Dispatch table: declare -Ar must assign on declaration line
declare -Ar HANDLERS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
[[ -v HANDLERS["${cmd}"] ]] && "${HANDLERS[${cmd}]}" "$@"

# Associative set (O(1) membership)
declare -Ar VALID=([txt]=1 [log]=1 [csv]=1)
[[ -v VALID["${ext}"] ]] || die "Unsupported: ${ext}"

# Structured check definitions (data-driven validation)
declare -Ar CHECKS=([eval]='eval[[:space:]].*\$|injection risk|_warn')
for key in "${!CHECKS[@]}"; do IFS='|' read -r pat msg fn <<< "${CHECKS[${key}]}"; done

# BASH_REMATCH (replaces rg -oP / sed / awk subshells)
[[ "${line}" =~ ^([0-9-]+)[[:space:]]([A-Z]+) ]] && local -r date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"

# IFS splitting (replaces cut / choose / awk -F)
IFS='|' read -r pattern msg level <<< "${check_def}"
IFS=, read -ra fields <<< "${csv_line}"

# mapfile (3-5x faster than while-read)
mapfile -t lines < <(rg 'ERROR' "${log_file}")
readarray -d '' -t files < <(fd -e txt --print0)

# Nameref: array vars cannot BE namerefs, but namerefs CAN reference arrays
apply_to_each() { local -r func="$1"; local -n _items=$2; for item in "${_items[@]}"; do "${func}" "${item}"; done; }
```

---
## [6][COMMON_MISTAKES]
>**Dictum:** *Pattern recognition prevents recurring errors.*

<br>

| [INDEX] | [MISTAKE]                           | [FIX]                                                 |
| :-----: | ----------------------------------- | ----------------------------------------------------- |
|   [1]   | **`cat $file` (unquoted var)**      | `cat "${file}"`                                       |
|   [2]   | **`cd dir; rm -rf *` (no guard)**   | `cd dir \|\| exit 1`                                  |
|   [3]   | **`` result=`cmd` `` (backticks)**  | `result=$(cmd)`                                       |
|   [4]   | **`cat f \| grep p` (UUOC)**        | `rg p f`                                              |
|   [5]   | **`while read line` (no -r)**       | `mapfile -t lines < file`                             |
|   [6]   | **Arrays in `#!/bin/sh`**           | Use `set --` or bash shebang                          |
|   [7]   | **`eval $user_input` (injection)**  | `${!var}` indirect expansion or dispatch table        |
|   [8]   | **`[ "$v" == "x" ]` in sh**         | `[[ "${v}" == "x" ]]` (bash) or `[ "$v" = "x" ]` (sh) |
|   [9]   | **`for f in $(ls *.txt)` (spaces)** | `for f in *.txt`                                      |
|  [10]   | **`-a`/`-o` in `[ ]` (deprecated)** | `[[ c1 && c2 ]]`                                      |
|  [11]   | **`echo -e` (non-portable)**        | `printf '%s\n' "$msg"`                                |
|  [12]   | **`$(cat file)` (fork)**            | `$(<file)` (bash built-in)                            |
|  [13]   | **`$(date +%F)` (fork)**            | `printf -v var '%(%F)T' -1` (bash built-in)           |

---
## [7][ERROR_HANDLING]
>**Dictum:** *Strict mode and traps prevent silent failures.*

<br>

```bash
set -Eeuo pipefail                   # Strict mode (-E propagates ERR trap to functions)
shopt -s inherit_errexit             # Command substitutions inherit -e (bash 4.4+)
trap 'printf "Error line %d\n" "$LINENO"' ERR
trap cleanup EXIT                    # EXIT fires on normal exit + signals
command || { printf "Failed\n" >&2; exit 1; }
```
