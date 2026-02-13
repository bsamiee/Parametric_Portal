# [H1][BASH-SCRIPTING-GUIDE]
>**Dictum:** *Language mastery enables functional shell scripts.*

<br>

Bash 5.2+/5.3 language reference. Strict mode, parameter expansion, arrays, conditionals, functional iteration.

---
## [1][BASH_VS_POSIX]
>**Dictum:** *Feature awareness prevents portability regressions.*

<br>

| [INDEX] | [FEATURE]       | [BASH_5.2+/5.3]                                        | [POSIX_SH]             |
| :-----: | --------------- | ------------------------------------------------------ | ---------------------- |
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

---
## [2][BASH_5_3]
>**Dictum:** *New builtins eliminate subshell overhead.*

<br>

| [INDEX] | [FEATURE]             | [SYNTAX]                           | [PURPOSE]                                   |
| :-----: | --------------------- | ---------------------------------- | ------------------------------------------- |
|   [1]   | Current-shell cmd sub | `${ cmd; }`                        | Capture stdout without forking subshell     |
|   [2]   | REPLY cmd sub         | `${\| cmd; }`                      | Run in current shell, result via REPLY      |
|   [3]   | GLOBSORT              | `GLOBSORT=name`                    | Control glob sort order (name, size, mtime) |
|   [4]   | `source -p`           | `source -p /custom/path script.sh` | Custom PATH for sourcing                    |
|   [5]   | `read -E`             | `read -E -p "prompt: " var`        | Tab-completion via Readline during read     |
|   [6]   | `compgen -V`          | `compgen -V 'prefix'`              | List variables matching prefix              |

---
## [3][ITERATION_HIERARCHY]
>**Dictum:** *Declarative iteration outperforms imperative loops.*

<br>

| [INDEX] | [RANK]    | [PATTERN]                                             | [STYLE]                |
| :-----: | --------- | ----------------------------------------------------- | ---------------------- |
|   [1]   | BEST      | `mapfile -t arr < <(cmd)` + `for item in "${arr[@]}"` | Declarative collection |
|   [2]   | GOOD      | `for item in "${array[@]}"`                           | Declarative iteration  |
|   [3]   | GOOD      | `cmd1 \| cmd2 \| cmd3`                                | Stream pipeline        |
|   [4]   | OK        | `for i in {1..10}`                                    | Brace expansion range  |
|   [5]   | ELIMINATE | `while IFS= read -r line`                             | Replace with mapfile   |
|   [6]   | ELIMINATE | `for ((i=0; i<n; i++))`                               | Brace expansion        |

---
## [4][BRANCHING_HIERARCHY]
>**Dictum:** *Parameter expansion replaces conditional branching.*

<br>

| [INDEX] | [RANK]    | [PATTERN]                                         | [STYLE]             |
| :-----: | --------- | ------------------------------------------------- | ------------------- |
|   [1]   | BEST      | `${var:-default}`, `${var:+alt}`, `${var:?error}` | Parameter expansion |
|   [2]   | GOOD      | `(( count > 0 )) && action`                       | Arithmetic guard    |
|   [3]   | GOOD      | `[[ "$var" == pat ]] && action \|\| other`        | Pattern guard       |
|   [4]   | OK        | `case/esac`                                       | Multi-branch only   |
|   [5]   | ELIMINATE | `if/then/else/elif/fi`                            | Zero tolerance      |
|   [6]   | ELIMINATE | `[ ]` single brackets                             | Always `[[ ]]`      |

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
readarray -d '' -t files < <(fd -e txt --print0)            # Null-delimited safe
declare -A map=([k1]="v1" [k2]="v2")               # Associative array
${map[k1]} ${!map[@]} [[ -v map[k1] ]]              # Access, keys, existence check
```

---
## [7][DATA_STRUCTURES]
>**Dictum:** *Associative arrays enable O(1) dispatch and membership.*

<br>

```bash
# Dispatch table (O(1) lookup, replaces case/esac chains)
declare -Ar HANDLERS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
[[ -v HANDLERS["${cmd}"] ]] || die "Unknown: ${cmd}"
"${HANDLERS[${cmd}]}" "$@"

# Associative set (O(1) membership, replaces grep/fgrep)
declare -Ar VALID_EXTS=([txt]=1 [log]=1 [csv]=1)
[[ -v VALID_EXTS["${ext}"] ]] || die "Unsupported: ${ext}"

# Structured check definitions (data-driven validation)
declare -Ar CHECKS=([eval]='eval[[:space:]].*\$|injection risk|_warn')
for key in "${!CHECKS[@]}"; do IFS='|' read -r pat msg fn <<< "${CHECKS[${key}]}"; done

# BASH_REMATCH for inline parsing (replaces grep -oP / sed / awk subshells)
[[ "${line}" =~ ^([0-9-]+)[[:space:]]([A-Z]+) ]] && {
    local -r date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"
}

# IFS splitting (replaces cut / awk -F for simple delimiters)
IFS='|' read -r pattern msg level <<< "${check_def}"
IFS=, read -ra fields <<< "${csv_line}"

# Deduplication via associative set
declare -A seen=()
for item in "${items[@]}"; do
    [[ -v seen["${item}"] ]] && continue
    seen["${item}"]=1; process "${item}"
done
```

---
## [8][NAMEREF_IDIOMS]
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

# Constraint: array variables cannot BE namerefs, but namerefs CAN reference arrays
local -n arr_ref=my_array    # Valid: nameref pointing to array
# local -na bad_ref=$1       # Invalid: -n and -a cannot combine
```

---
## [9][COMMON_PITFALLS]
>**Dictum:** *Pattern recognition prevents recurring errors.*

<br>

| [INDEX] | [PITFALL]       | [BAD]                                         | [GOOD]                                  |
| :-----: | --------------- | --------------------------------------------- | --------------------------------------- |
|   [1]   | Word splitting  | `rm $file`                                    | `rm "${file}"`                          |
|   [2]   | UUOC            | `cat f \| grep p`                             | `rg p f`                                |
|   [3]   | Echo pipe       | `echo "$x" \| cmd`                            | `cmd <<< "${x}"`                        |
|   [4]   | Cat subshell    | `data=$(cat file)`                            | `data=$(<file)`                         |
|   [5]   | File spaces     | `for f in $(find ...)`                        | `readarray -d '' -t f < <(fd --print0)` |
|   [6]   | Eval injection  | `eval "${cmd}"`                               | Dispatch table or `case`                |
|   [7]   | set -e + &&     | `[[ cond ]] && action` (last in func)         | `[[ cond ]] && action \|\| true`        |
|   [8]   | Date subshell   | `ts=$(date '+%F %T')`                         | `printf -v ts '%(%F %T)T' -1`           |
|   [9]   | Test bracket    | `[ -f "$f" ]`                                 | `[[ -f "${f}" ]]`                       |
|  [10]   | Mutable counter | `count=0; for x in ...; do ((count++)); done` | `${#arr[@]}` or `rg -c pattern file`    |
