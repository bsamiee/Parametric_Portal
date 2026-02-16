# [H1][TEXT-TOOLS]
>**Dictum:** *Correct tool selection prevents validation false positives.*

<br>

BRE/ERE regex, rg/sd/awk reference, bash-native alternatives, common pitfalls.

---
## [1][BRE_VS_ERE]
>**Dictum:** *Regex dialect awareness prevents matching failures.*

<br>

[ALWAYS] Use PCRE2 with `rg` and `sd` — BRE/ERE distinctions apply only to legacy `grep`/`sed`.

| [INDEX] | [FEATURE]       | [BRE]                  | [ERE]   |
| :-----: | --------------- | ---------------------- | ------- |
|   [1]   | **One or more** | `\+`                   | `+`     |
|   [2]   | **Zero or one** | `\?`                   | `?`     |
|   [3]   | **Alternation** | `\|`                   | `\|`    |
|   [4]   | **Grouping**    | `\(...\)`              | `(...)` |
|   [5]   | **Quantifiers** | `\{m,n\}`              | `{m,n}` |
|   [6]   | **Common**      | `. * ^ $ [...] [^...]` | Same    |

`[BRE]`: `grep`, `sed`. `[ERE]`: `grep -E`, `sed -E`, `awk`.

---
## [2][POSIX_CLASSES]
>**Dictum:** *POSIX character classes enable locale-safe matching.*

<br>

```
[:alnum:] A-Za-z0-9    [:alpha:] A-Za-z      [:digit:] 0-9
[:lower:] a-z          [:upper:] A-Z          [:space:] whitespace
[:blank:] space+tab    [:punct:] punctuation   [:xdigit:] hex digits
```
**Usage:** `rg '[[:digit:]]' file`.

---
## [3][RIPGREP]
>**Dictum:** *Flag mastery eliminates unnecessary pipelines.*

<br>

| [INDEX] | [FLAG]         | [PURPOSE]               | [EXAMPLE]                                          |
| :-----: | -------------- | ----------------------- | -------------------------------------------------- |
|   [1]   | **`-i`**       | Case insensitive        | `rg -i 'error'`                                    |
|   [2]   | **`-F`**       | Fixed string (literal)  | `rg -F '192.168.1.1'`                              |
|   [3]   | **`-w`**       | Whole word              | `rg -w 'main'`                                     |
|   [4]   | **`-c`**       | Count matches per file  | `rg -c 'TODO'`                                     |
|   [5]   | **`-n`**       | Line numbers            | `rg -n 'pattern'`                                  |
|   [6]   | **`-l`**       | Files with matches only | `rg -l 'import'`                                   |
|   [7]   | **`-o`**       | Only matching text      | `rg -o '\d+\.\d+'`                                 |
|   [8]   | **`-q`**       | Quiet (exit code only)  | `rg -q 'pattern' && echo found`                    |
|   [9]   | **`-A/-B/-C`** | Context lines           | `rg -C3 'error'`                                   |
|  [10]   | **`-t`**       | File type filter        | `rg -t ts 'interface'`                             |
|  [11]   | **`-g`**       | Glob filter             | `rg -g '*.json' 'key'`                             |
|  [12]   | **`-m`**       | Max matches per file    | `rg -m1 'first'`                                   |
|  [13]   | **`--json`**   | JSON output             | `rg --json 'pat'`                                  |
|  [14]   | **`-U`**       | Multiline               | `rg -U 'start.*\nend'`                             |
|  [15]   | **`-S`**       | Smart case              | `rg -S 'Error'` (case-sensitive because uppercase) |
|  [16]   | **`-P`**       | PCRE2 lookaround        | `rg -P '(?<=@)\w+'`                                |

---
## [4][SD]
>**Dictum:** *sd eliminates regex escape complexity.*

<br>

```bash
# Basic replace (all occurrences — sd replaces globally by default)
sd 'pattern' 'replacement' file.txt

# Fixed string mode (no regex)
sd -s 'literal.string' 'replacement' file.txt

# PCRE2 captures
sd '(\w+)@(\w+)' '$1 AT $2' emails.txt

# Delete lines matching pattern (replace with empty)
sd 'pattern.*\n' '' file.txt

# Pipe mode (stdin -> stdout, no file arg)
command | sd 'old' 'new'

# In-place is default (no -i flag needed)
sd 'old' 'new' file.txt    # modifies file in-place
```

---
## [5][AWK]
>**Dictum:** *awk handles multi-field aggregation and state machines.*

<br>

[PREFER] `choose` for simple field selection (e.g., `choose 0 2` for fields 1 and 3). awk remains right tool for multi-field aggregation, state machines, and formatted output.

```bash
awk 'pattern { action }' file
awk -F',' '{print $1}' file.csv    # Custom separator

# Built-in variables
$0  entire line    $1..$NF  fields    NF  field count    NR  line number
FS  input sep      OFS  output sep    RS  record sep     FILENAME

# Patterns
awk '{print $1, $3}' f                          # Print fields
awk '$3 > 100' f                                # Numeric filter
awk '{sum += $1} END {print sum}' f             # Sum column
awk '{count[$1]++} END {for (k in count) print k, count[k]}' f  # Frequency
awk '!seen[$0]++' f                             # Unique lines (dedup)
awk '{printf "%-20s %10s\n", $1, $2}' f         # Format output
```

**String functions:** `length` `substr` `index` `split` `sub` `gsub` `tolower` `toupper` `match`.

---
## [6][BASH_NATIVE_ALTERNATIVES]
>**Dictum:** *Bash builtins eliminate fork overhead.*

<br>

| [INDEX] | [NEED]                      | [EXTERNAL]                     | [BASH_NATIVE]                                      |
| :-----: | --------------------------- | ------------------------------ | -------------------------------------------------- |
|   [1]   | **Extract fields from var** | `echo "$v" \| rg -oP 'pat'`    | `[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}`          |
|   [2]   | **Split on delimiter**      | `echo "$v" \| choose -f ',' 0` | `IFS=, read -ra parts <<< "$v"`                    |
|   [3]   | **Trim whitespace**         | `echo "$v" \| xargs`           | `v="${v#"${v%%[![:space:]]*}"}"`                   |
|   [4]   | **Membership check**        | `echo "$v" \| rg -Fxq`         | `declare -Ar SET=([k]=1); [[ -v SET["$v"] ]]`      |
|   [5]   | **Dispatch/routing**        | `case "$v" in a) ... ;; esac`  | `declare -Ar MAP=([a]=fn_a); "${MAP[$v]}"`         |
|   [6]   | **Array from command**      | `while read; do arr+=(); done` | `mapfile -t arr < <(cmd)`                          |
|   [7]   | **Deduplication**           | `sort -u`                      | `declare -A seen; [[ -v seen["$k"] ]] && continue` |

---
## [7][COMMON_PITFALLS]
>**Dictum:** *Pitfall awareness prevents debugging cycles.*

<br>

| [INDEX] | [TOOL]      | [MISTAKE]                            | [FIX]                                           |
| :-----: | ----------- | ------------------------------------ | ----------------------------------------------- |
|   [1]   | **`rg`**    | `rg 192.168.1.1` (. = any)           | `rg -F '192.168.1.1'`                           |
|   [2]   | **`rg`**    | `rg $pattern` (unquoted)             | `rg "${pattern}"`                               |
|   [3]   | **`rg`**    | `cat f \| rg p` (UUOC)               | `rg p f`                                        |
|   [4]   | **`rg`**    | `if [ "$(rg p f)" ]`                 | `rg -q p f && action`                           |
|   [5]   | **`bash`**  | `$(cat file)` (fork)                 | `$(<file)` (bash built-in)                      |
|   [6]   | **`sd`**    | Forgetting sd is in-place by default | Use pipe mode (no file arg) for non-destructive |
|   [7]   | **`sd`**    | Using sed escape syntax `\1`         | Use PCRE2 capture syntax `$1`                   |
|   [8]   | **`awk`**   | `awk {print $1}` (unquoted)          | `awk '{print $1}'`                              |
|   [9]   | **`awk`**   | `$1/$2` (div by zero)                | `$2 != 0 ? $1/$2 : "N/A"`                       |
|  [10]   | **`regex`** | `<.*>` (greedy)                      | `<[^>]*>` (non-greedy workaround)               |
