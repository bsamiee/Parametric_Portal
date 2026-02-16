# [H1][BASH-SCRIPTING-GUIDE]
>**Dictum:** *Language mastery enables functional shell scripts.*

<br>

Bash 5.2+/5.3 language reference. Strict mode, shopt options, parameter expansion, arrays, data structures, namerefs, builtin performance, timing.

---
## [1][BASH_VS_POSIX]
>**Dictum:** *Feature awareness prevents portability regressions.*

<br>

| [INDEX] | [FEATURE]       | [BASH_5_2]                                             | [POSIX_SH]             |
| :-----: | :-------------- | :----------------------------------------------------- | :--------------------- |
|   [1]   | Arrays          | `arr=(one two three)`                                  | `set -- one two three` |
|   [2]   | Assoc arrays    | `declare -A map=([k]=v)`                               | N/A                    |
|   [3]   | Conditionals    | `[[ ... ]]` (regex, pattern, short-circuit)            | `[ ... ]`              |
|   [4]   | Param expansion | `${var//pat/rep}`, `${var^^}`, `${var@Q}`              | Basic only             |
|   [5]   | Process subst   | `<(command)`                                           | N/A                    |
|   [6]   | Globbing        | `**` with `shopt -s globstar`                          | N/A                    |
|   [7]   | Nameref         | `local -n ref=$1`                                      | N/A                    |
|   [8]   | Readarray       | `readarray -d '' -t arr`                               | N/A                    |
|   [9]   | Timestamps      | `printf '%(%F %T)T' -1` (builtin, no fork)             | `date '+%F %T'`        |
|  [10]   | EPOCHREALTIME   | `${EPOCHREALTIME}` (microsecond precision)             | N/A                    |
|  [11]   | Case transform  | `${var@U}` upper, `${var@u}` ucfirst, `${var@L}` lower | N/A                    |
|  [12]   | Nullglob        | `shopt -s nullglob` (empty glob → nothing)             | N/A                    |
|  [13]   | Extglob         | `+(pat)`, `?(pat)`, `!(pat)`, `@(pat)`                 | N/A                    |
|  [14]   | Failglob        | `shopt -s failglob` (empty glob → error)               | N/A                    |
|  [15]   | Dynamic FDs     | `exec {fd}>file` (auto-allocated descriptor)           | N/A                    |
|  [16]   | `wait -f`       | `wait -f PID` (wait even without job control) (5.2+)   | N/A                    |

---
## [2][BASH_5_3]
>**Dictum:** *New builtins eliminate subshell overhead.*

<br>

| [INDEX] | [FEATURE]             | [SYNTAX]                           | [PURPOSE]                                    |
| :-----: | :-------------------- | :--------------------------------- | :------------------------------------------- |
|   [1]   | Current-shell cmd sub | `${ cmd; }`                        | Capture stdout without forking subshell      |
|   [2]   | REPLY cmd sub         | `${\| cmd; }`                      | Run in current shell, result via REPLY       |
|   [3]   | GLOBSORT              | `GLOBSORT=name`                    | Control glob sort order (name, size, mtime)  |
|   [4]   | `source -p`           | `source -p /custom/path script.sh` | Custom PATH for sourcing                     |
|   [5]   | `read -E`             | `read -E -p "prompt: " var`        | Tab-completion via Readline during read      |
|   [6]   | `compgen -V`          | `compgen -V 'prefix'`              | List variables matching prefix               |
|   [7]   | lastpipe              | `shopt -s lastpipe`                | Pipeline-final command runs in current shell |

```bash
# Current-shell command substitution (bash 5.3 — zero fork)
name=${ printf '%s-%s' "${prefix}" "${suffix}"; }

# REPLY command substitution (bash 5.3 — result via REPLY variable)
${\| printf '%s-%s' "${prefix}" "${suffix}"; }
printf '%s\n' "${REPLY}"

# lastpipe: pipeline results available in calling scope (non-interactive default)
shopt -s lastpipe
command | mapfile -t arr       # arr is in calling scope
command | read -r first_line   # first_line is in calling scope
```

---
## [3][ITERATION]
>**Dictum:** *Declarative iteration outperforms imperative loops.*

<br>

| [INDEX] | [PATTERN]                                             | [STYLE]                                              |
| :-----: | :---------------------------------------------------- | :--------------------------------------------------- |
|   [1]   | `mapfile -t arr < <(cmd)` + `for item in "${arr[@]}"` | Declarative collection (3-5x faster than while-read) |
|   [2]   | `for item in "${array[@]}"`                           | Declarative iteration                                |
|   [3]   | `cmd1 \| cmd2 \| cmd3`                                | Stream pipeline                                      |
|   [4]   | `for i in {1..10}`                                    | Brace expansion range                                |

---
## [4][BRANCHING]
>**Dictum:** *Parameter expansion replaces conditional branching.*

<br>

| [INDEX] | [PATTERN]                                         | [STYLE]                            |
| :-----: | :------------------------------------------------ | :--------------------------------- |
|   [1]   | `${var:-default}`, `${var:+alt}`, `${var:?error}` | Parameter expansion                |
|   [2]   | `(( count > 0 )) && action`                       | Arithmetic guard                   |
|   [3]   | `[[ "$var" == pat ]] && action \|\| other`        | Pattern guard                      |
|   [4]   | `case/esac`                                       | Multi-branch pattern matching only |

---
## [5][PARAMETER_EXPANSION]
>**Dictum:** *Expansion operators replace external commands.*

<br>

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
${var@Q}                     # Shell-quoted for re-use
${var@A}                     # Assignment form (declare statement)
${var@a}                     # Attribute flags (r=readonly, a=array, A=assoc)
${var@U}  ${var@L}           # Uppercase/lowercase all (5.2+)

# file="/path/to/file.txt"
${file##*/}    # file.txt    ${file%.*}     # /path/to/file
${file##*.}    # txt         ${file%/*}     # /path/to
```

---
## [6][VARIABLES_AND_ARRAYS]
>**Dictum:** *Readonly declarations enforce immutability.*

<br>

```bash
readonly MAX=3                                      # Constants: UPPER, readonly
local -r base_dir="/opt"                            # Readonly local (immutable in scope)
local -n ref=$1                                     # Nameref: alias to caller's variable
printf -v timestamp '%(%F %T)T' -1                  # Assign timestamp without subshell
get_data() { local -n out=$1; out="computed"; }     # Return via nameref (no subshell)

arr=(one two three); arr+=("four")
${arr[0]} ${arr[@]} ${#arr[@]} ${!arr[@]}
readarray -t lines < file.txt                       # File into array (replaces while-read)
readarray -d '' -t files < <(fd -e txt --print0)    # Null-delimited safe
declare -A map=([k1]="v1" [k2]="v2")                # Associative array
${map[k1]} ${!map[@]} [[ -v map[k1] ]]              # Access, keys, existence check

# Bulk array transforms (no loops)
"${arr[@]/#/prefix-}"                                # Prefix every element
"${arr[@]/%/.log}"                                   # Suffix every element

# Compound arithmetic (multi-assignment in one expression)
(( total += count, errors += rc > 0 ))

# Variable introspection
declare -p arr map 2>/dev/null                       # Debug dump any variable
"${!APP_@}"                                          # List all vars starting with APP_

# Non-blocking stdin detection
read -t 0 && read -r piped_input                     # Check if stdin has data

# Dynamic file descriptor allocation (safe — no hardcoded numbers)
exec {fd}>"${lock_file}"                             # Kernel assigns next free FD
flock -n "${fd}" || die "Already running"
exec {fd}>&-                                         # Release FD
```

**Controlled global mutation** — `declare -g` inside functions is the single legitimate
escape hatch from immutability. Use exclusively for configuration loading (external state
into the program's constant namespace). Idiom: `declare -g "${key}=${value}"` after
validating the key name against `^[A-Za-z_][A-Za-z_0-9]*$`.

Production config loader with comment handling and whitespace trimming:
see [script-patterns.md §3](script-patterns.md).

---
## [7][DATA_STRUCTURES]
>**Dictum:** *Associative arrays enable O(1) dispatch and membership.*

<br>

```bash
# Dispatch table (O(1) lookup, replaces case/esac chains)
declare -Ar HANDLERS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
[[ -v HANDLERS["${cmd}"] ]] || die "Unknown: ${cmd}"
"${HANDLERS[${cmd}]}" "$@"

# Associative set (O(1) membership)
declare -Ar VALID_EXTS=([txt]=1 [log]=1 [csv]=1)
[[ -v VALID_EXTS["${ext}"] ]] || die "Unsupported: ${ext}"

# BASH_REMATCH for inline parsing (zero forks, replaces rg -oP / sd / awk)
[[ "${line}" =~ ^([0-9-]+)[[:space:]]([A-Z]+) ]] && {
    local -r date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"
}

# IFS splitting (zero forks, replaces cut / awk -F for simple delimiters)
IFS='|' read -r pattern msg level <<< "${check_def}"
IFS=, read -ra fields <<< "${csv_line}"

# Deduplication via associative set
declare -A seen=()
for item in "${items[@]}"; do
    [[ -v seen["${item}"] ]] && continue
    seen["${item}"]=1; process "${item}"
done

# Stack (LIFO) — array-based, O(1) push/pop
declare -a stack=()
stack+=("value")                                     # Push
local -r top="${stack[-1]}"; unset 'stack[-1]'       # Pop

# Queue (FIFO) — index-based, O(1) enqueue/dequeue
declare -a queue=(); declare -i q_head=0
queue+=("value")                                     # Enqueue
local -r front="${queue[q_head]}"; (( q_head++ ))    # Dequeue

# Binary search on sorted array — O(log n)
bsearch() {
    local -r target="$1"; shift; local -a arr=("$@")
    local lo=0 hi=$(( ${#arr[@]} - 1 )) mid
    while (( lo <= hi )); do
        mid=$(( (lo + hi) / 2 ))
        (( arr[mid] == target )) && { printf '%d' "${mid}"; return 0; }
        (( arr[mid] < target )) && lo=$(( mid + 1 )) || hi=$(( mid - 1 ))
    done
    return 1
}
```

---
## [8][NAMEREFS]
>**Dictum:** *Namerefs enable pure function return values.*

<br>

```bash
# Higher-order: pass function name + array via nameref
apply_to_each() {
    local -r func="$1"; local -n _items=$2
    local item; for item in "${_items[@]}"; do "${func}" "${item}"; done
}

# Return via nameref (no subshell capture)
compute() { local -n _result=$1; _result="$(expensive_operation)"; }
```

**Constraint:** Array variables cannot BE namerefs, but namerefs CAN reference arrays.
`local -n arr_ref=my_array` is valid; `local -na` is not.

---
## [9][BUILTIN_PERFORMANCE]
>**Dictum:** *Fewer forks yield faster scripts.*

<br>

| [INDEX] | [NEED]                  | [EXTERNAL]                     | [BASH_NATIVE]                                      |
| :-----: | :---------------------- | :----------------------------- | :------------------------------------------------- |
|   [1]   | Extract fields from var | `echo "$v" \| rg -oP 'pat'`    | `[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}`          |
|   [2]   | Split on delimiter      | `echo "$v" \| cut -d, -f1`     | `IFS=, read -ra parts <<< "$v"`                    |
|   [3]   | Membership check        | `echo "$v" \| rg -Fxq`         | `declare -Ar SET=([k]=1); [[ -v SET["$v"] ]]`      |
|   [4]   | Dispatch/routing        | case chain                     | `declare -Ar MAP=([a]=fn_a); "${MAP[$v]}"`         |
|   [5]   | Array from command      | `while read; do arr+=(); done` | `mapfile -t arr < <(cmd)`                          |
|   [6]   | Deduplication           | `sort -u`                      | `declare -A seen; [[ -v seen["$k"] ]] && continue` |
|   [7]   | Timestamp               | `ts=$(date '+%F %T')`          | `printf -v ts '%(%F %T)T' -1`                      |
|   [8]   | File read               | `data=$(cat file)`             | `data=$(<file)`                                    |
|   [9]   | Pipe avoidance          | `echo "$x" \| cmd`             | `cmd <<< "${x}"`                                   |
|  [10]   | Locale bypass           | —                              | `LC_ALL=C rg 'pattern' file`                       |
|  [11]   | Elapsed time            | `date +%s` before/after        | `${EPOCHREALTIME}` diff via `bc` (microsecond)     |
|  [12]   | Epoch seconds           | `date +%s`                     | `${EPOCHSECONDS}` (integer, no fork)               |
|  [13]   | Wait for job            | `wait $pid`                    | `wait -f $pid` (robust, even without job control)  |
|  [14]   | Debug dump              | manual echo                    | `declare -p var` (structured, type-aware)          |
