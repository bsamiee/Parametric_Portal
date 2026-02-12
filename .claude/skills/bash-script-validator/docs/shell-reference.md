# Shell Reference — Bash vs POSIX sh

## Bash-Only Features (NOT in POSIX sh)

| Feature | Bash | POSIX sh Alternative |
|---------|------|---------------------|
| Arrays | `array=(a b c); ${array[0]}` | `set -- a b c; echo "$1"` |
| Test construct | `[[ "$v" == pat* ]]` | `[ "$v" = "exact" ]` |
| Process substitution | `diff <(ls d1) <(ls d2)` | Use temp files |
| Brace expansion | `echo {1..10}` | Use seq or loop |
| Function keyword | `function f { ... }` | `f() { ... }` |
| Local variables | `local var="val"` | Name-prefix convention |
| Source command | `source script.sh` | `. script.sh` |
| String equality | `[ "$a" == "$b" ]` | `[ "$a" = "$b" ]` |
| Case conversion | `${var,,}` / `${var^^}` / `${var@U}` / `${var@L}` | `tr '[:upper:]' '[:lower:]'` |
| Pattern replace | `${var//pat/repl}` | `sed` / `expr` |
| Extended globbing | `shopt -s extglob` | N/A |
| Built-in vars | `$RANDOM $SECONDS $BASH_SOURCE` | N/A |

## Parameter Expansion (POSIX)

```bash
${var:-default}     # Use default if unset/null
${var:=default}     # Assign default if unset/null
${var:?error}       # Error if unset/null
${var:+alternate}   # Use alternate if set
${#var}             # Length
${var#pattern}      # Remove shortest prefix match
${var##pattern}     # Remove longest prefix match
${var%pattern}      # Remove shortest suffix match
${var%%pattern}     # Remove longest suffix match
```

### Bash-Only Extensions

```bash
${var:offset:length}           # Substring
${var/pattern/replacement}     # Replace first
${var//pattern/replacement}    # Replace all
${var^} / ${var^^}             # Uppercase first/all
${var,} / ${var,,}             # Lowercase first/all
```

### Bash 5.2+ Transformation Operators

```bash
${var@U}                       # Uppercase entire value
${var@u}                       # Uppercase first character
${var@L}                       # Lowercase entire value
${var@Q}                       # Quoted for re-input
${var@a}                       # Attribute flags (r=readonly, x=exported, a=array, A=assoc)
${var@A}                       # Assignment statement to recreate variable
```

### Bash 5.3 Features (July 2025)

```bash
${ cmd; }                      # Current-shell command substitution (no subshell fork)
${| cmd; }                     # REPLY command substitution (cmd sets REPLY, value returned)
GLOBSORT=nosort                # Control glob result ordering (nosort, name, size, mtime)
source -p PATH script.sh       # Source from explicit search PATH
read -E                        # Use readline for read input
```

## Special Variables

```bash
$0      # Script name           $#      # Arg count
$1-$9   # Positional params     ${10}   # 10+ (braces required)
$*      # All args (single)     $@      # All args (separate)
$$      # Shell PID             $!      # Last background PID
$?      # Last exit status      $_      # Last arg of prev cmd
```

## Control Structures

```bash
# if/elif/else           # case
if [ cond ]; then        case "$var" in
    ...                      pat1) ... ;;
elif [ cond ]; then          pat2|pat3) ... ;;
    ...                      *) ... ;;
else                     esac
    ...
fi

# for                    # while/until
for item in list; do     while [ cond ]; do ... done
    ...                  until [ cond ]; do ... done
done
```

## Error Handling

```bash
set -Eeuo pipefail                   # Strict mode (-E propagates traps to functions)
shopt -s inherit_errexit             # Subshells inherit -e (bash 4.4+)
trap 'printf "Error line %d\n" "$LINENO"' ERR # Trap errors (bash)
trap cleanup EXIT INT TERM           # Cleanup on exit
command || { printf "Failed\n" >&2; exit 1; }  # Inline guard
```

## Quoting Rules

```bash
"$var"   # Expands variables, preserves spaces (ALWAYS use for vars)
'$var'   # Literal string, no expansion
$()      # Command substitution (preferred over backticks)
$(())    # Arithmetic expansion
```

## Common Mistakes

| # | Mistake | Fix |
|---|---------|-----|
| 1 | `cat $file` (unquoted var) | `cat "$file"` |
| 2 | `cd dir; rm -rf *` (no guard) | `cd dir \|\| exit 1` |
| 3 | `` result=`cmd` `` (backticks) | `result=$(cmd)` |
| 4 | `cat f \| grep p` (UUOC) | `grep p f` |
| 5 | `while read line` (no -r) | `while IFS= read -r line` |
| 6 | `cmd1; cmd2; if [ $? ]` (stale) | `if cmd1; then` |
| 7 | Arrays in `#!/bin/sh` | Use `set --` or bash shebang |
| 8 | Function called before defined | Define functions before main |
| 9 | `eval $user_input` (injection) | Use `${!var}` indirect expansion |
| 10 | Missing `set -u` (typo silent) | Add `set -u` / `set -eu` |
| 11 | `[ "$v" == "x" ]` in sh | Use `=` not `==` in `[ ]` |
| 12 | `for f in $(ls *.txt)` (spaces) | `for f in *.txt` |
| 13 | `rm -rf "/$1"` (empty arg) | Validate `$1` first |
| 14 | `for f in *` (no nullglob) | `shopt -s nullglob` (bash) or `[ -e "$f" ] \|\| continue` |
| 15 | `-a`/`-o` in `[ ]` (deprecated) | `[ c1 ] && [ c2 ]` or `[[ c1 && c2 ]]` |
| 16 | `echo -e` (non-portable flags) | `printf '%s\n' "$msg"` |
| 17 | `$(cat file)` (fork + exec) | `$(<file)` (bash built-in, no subshell) |
| 18 | `$(date +%F)` (fork) | `printf -v var '%(%F)T' -1` (bash built-in) |

## Data Structure Patterns (Bash 4.0+)

```bash
# Associative array as dispatch table (O(1) lookup, replaces case/esac chains)
declare -Ar HANDLERS=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
[[ -v HANDLERS["${cmd}"] ]] && "${HANDLERS[${cmd}]}" "$@"

# Associative array as set (O(1) membership, replaces grep/fgrep)
declare -Ar VALID=([txt]=1 [log]=1 [csv]=1)
[[ -v VALID["${ext}"] ]] || die "Unsupported: ${ext}"

# Structured check definitions (data-driven validation)
declare -Ar CHECKS=([eval]='eval[[:space:]].*\$|injection risk|_warn')
for key in "${!CHECKS[@]}"; do IFS='|' read -r pat msg fn <<< "${CHECKS[${key}]}"; done

# Deduplication set (track seen items in O(1))
declare -A seen=(); for item in "${items[@]}"; do [[ -v seen["${item}"] ]] && continue; seen["${item}"]=1; done

# BASH_REMATCH for inline parsing (replaces grep -oP / sed / awk subshells)
[[ "${line}" =~ ^([0-9-]+)[[:space:]]([A-Z]+) ]] && local -r date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"

# IFS splitting (replaces cut / awk -F for simple delimiters)
IFS='|' read -r pattern msg level <<< "${check_def}"
IFS=, read -ra fields <<< "${csv_line}"

# mapfile replaces while-read loops
mapfile -t lines < <(grep 'ERROR' "${log_file}")
readarray -d '' -t files < <(find . -name "*.txt" -print0)
```

## Best Practices Checklist

```
[ ] Shebang: #!/usr/bin/env bash  OR  #!/bin/sh
[ ] Strict mode: set -Eeuo pipefail + shopt -s inherit_errexit (bash) / set -eu (sh)
[ ] All variables quoted: "$var"
[ ] $() not backticks; $(<file) not $(cat file)
[ ] printf not echo (portable, no flag ambiguity)
[ ] local -r for immutable locals inside functions
[ ] Functions defined before use
[ ] Error handling: || exit, trap, set -e
[ ] Input validation before dangerous ops
[ ] ShellCheck v0.11.0+ passes
[ ] POSIX sh: no [[ ]], arrays, function keyword, source, ==
[ ] Associative arrays for dispatch/lookup over case chains (bash)
[ ] BASH_REMATCH for simple field extraction over grep/sed subshells (bash)
[ ] mapfile/readarray over while-read loops for array population (bash)
[ ] IFS splitting over cut/awk for simple delimiters (bash)
```
