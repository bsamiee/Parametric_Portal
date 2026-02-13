# [H1][TEXT-PROCESSING-GUIDE]
>**Dictum:** *Tool selection determines pipeline efficiency.*

<br>

rg/awk/sd selection, BASH_REMATCH inline parsing, pipeline composition, performance optimization.

---
## [1][TOOL_SELECTION]
>**Dictum:** *Tool selection determines pipeline composition.*

<br>

| [INDEX] | [NEED]               | [TOOL]               | [NOTES]                                                                             |
| :-----: | -------------------- | -------------------- | ----------------------------------------------------------------------------------- |
|   [1]   | Pattern match/filter | `rg` (ripgrep)       | Filter lines, count matches, extract patterns. PCRE2, smart-case, .gitignore-aware. |
|   [2]   | Field/column data    | `awk`                | Splits, aggregates, conditionals. For simple field selection, prefer `choose`       |
|   [3]   | Find-replace/delete  | `sd`                 | Find and replace. PCRE2 syntax, no escape hell, in-place default.                   |
|   [4]   | Find files           | `fd`                 | Find files. .gitignore-aware, parallel `-x`                                         |
|   [5]   | Field selection      | `choose`             | Field selection. 0-indexed, replaces `cut`                                          |
|   [6]   | JSON explorer        | `jnv`                | Interactive JSON explorer. TUI with jaq engine                                      |
|   [7]   | Tabular alignment    | `column -t`          | Pipe output for pretty-printing                                                     |
|   [8]   | 1-3 fields from var  | `BASH_REMATCH`       | Zero forks, O(1)                                                                    |
|   [9]   | Simple delimiter     | `IFS=, read -ra`     | Zero forks                                                                          |
|  [10]   | Membership check     | `[[ -v SET[k] ]]`    | O(1) via associative array                                                          |
|  [11]   | Multi-pass/state     | awk (or Python/Perl) | State machines                                                                      |

---
## [2][RIPGREP]
>**Dictum:** *Flag awareness eliminates unnecessary pipelines.*

<br>

| [INDEX] | [FLAG]     | [PURPOSE]               | [EXAMPLE]                                          |
| :-----: | ---------- | ----------------------- | -------------------------------------------------- |
|   [1]   | `-i`       | Case insensitive        | `rg -i 'error'`                                    |
|   [2]   | `-F`       | Fixed string (literal)  | `rg -F '192.168.1.1'`                              |
|   [3]   | `-w`       | Whole word              | `rg -w 'main'`                                     |
|   [4]   | `-c`       | Count matches per file  | `rg -c 'TODO'`                                     |
|   [5]   | `-n`       | Line numbers            | `rg -n 'pattern'`                                  |
|   [6]   | `-l`       | Files with matches only | `rg -l 'import'`                                   |
|   [7]   | `-o`       | Only matching text      | `rg -o '\d+\.\d+'`                                 |
|   [8]   | `-q`       | Quiet (exit code only)  | `rg -q 'pattern' && echo found`                    |
|   [9]   | `-A/-B/-C` | Context lines           | `rg -C3 'error'`                                   |
|  [10]   | `-t`       | File type filter        | `rg -t ts 'interface'`                             |
|  [11]   | `-g`       | Glob filter             | `rg -g '*.json' 'key'`                             |
|  [12]   | `-m`       | Max matches per file    | `rg -m1 'first'`                                   |
|  [13]   | `--json`   | JSON output             | `rg --json 'pat'`                                  |
|  [14]   | `-U`       | Multiline               | `rg -U 'start.*\nend'`                             |
|  [15]   | `-S`       | Smart case              | `rg -S 'Error'` (case-sensitive because uppercase) |
|  [16]   | `-P`       | PCRE2 lookaround        | `rg -P '(?<=@)\w+'`                                |

---
## [3][AWK]
>**Dictum:** *awk handles multi-field aggregation and state machines.*

<br>

[PREFER] `choose` for simple field selection (e.g., `choose 0 2` for fields 1 and 3). awk remains right tool for multi-field aggregation, state machines, and formatted output.

```bash
awk '{print $1, $3}' file                          # Fields (space-delimited)
awk -F',' '{print $1, $3}' data.csv                # Custom delimiter
awk '$3 > 100' data.txt                            # Numeric filter
awk '{sum += $3} END {print sum}' f.txt            # Sum column
awk '{ip[$1]++} END {for(i in ip) print ip[i],i}' access.log | sort -rn  # Frequency
awk '!seen[$0]++' f.txt                            # Unique lines (dedup)
# Builtins: NF=fields NR=line# FNR=file-line# FS/OFS=separators FILENAME=current
```

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
## [5][BASH_NATIVE_ALTERNATIVES]
>**Dictum:** *Bash builtins eliminate fork overhead.*

<br>

| [INDEX] | [NEED]                  | [EXTERNAL]                     | [BASH_NATIVE]                                      |
| :-----: | ----------------------- | ------------------------------ | -------------------------------------------------- |
|   [1]   | Extract fields from var | `echo "$v" \| rg -oP 'pat'`    | `[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}`          |
|   [2]   | Split on delimiter      | `echo "$v" \| choose -f ',' 0` | `IFS=, read -ra parts <<< "$v"`                    |
|   [3]   | Trim whitespace         | `echo "$v" \| xargs`           | `v="${v#"${v%%[![:space:]]*}"}"`                   |
|   [4]   | Membership check        | `echo "$v" \| rg -Fxq`         | `declare -Ar SET=([k]=1); [[ -v SET["$v"] ]]`      |
|   [5]   | Dispatch/routing        | `case "$v" in a) ... ;; esac`  | `declare -Ar MAP=([a]=fn_a); "${MAP[$v]}"`         |
|   [6]   | Array from command      | `while read; do arr+=(); done` | `mapfile -t arr < <(cmd)`                          |
|   [7]   | Deduplication           | `sort -u`                      | `declare -A seen; [[ -v seen["$k"] ]] && continue` |

---
## [6][PIPELINE_PATTERNS]
>**Dictum:** *Composable pipelines maximize single-pass efficiency.*

<br>

```bash
rg 'ERROR' log.txt | awk '{print $1, $5}'                          # Filter then extract
sd '#.*' '' config.txt | awk -F'=' '{print $1}'                    # Clean then process
awk '{print $3}' data.txt | sort | uniq -c | sort -rn | column -t  # Frequency table
```

---
## [7][PERFORMANCE]
>**Dictum:** *Fewer forks yield faster scripts.*

<br>

| [INDEX] | [TECHNIQUE]   | [PATTERN]                                               |
| :-----: | ------------- | ------------------------------------------------------- |
|   [1]   | Fixed strings | `rg -F 'literal' large.txt`                             |
|   [2]   | Early exit    | `rg -m 10 'pat' large.txt`                              |
|   [3]   | Smart case    | `rg -S 'Error'` (avoids separate `-i` flag)             |
|   [4]   | Fast find     | `fd -e ext` over `find -name '*.ext'`                   |
|   [5]   | Single pass   | `awk '/ERR/{e++}/WARN/{w++} END{print e,w}' log.txt`    |
|   [6]   | No UUOC       | `rg p f.txt` not `cat f.txt \| rg p`                    |
|   [7]   | `$(<file)`    | `content="$(<file)"` (no fork)                          |
|   [8]   | `printf -v`   | `printf -v ts '%(%F)T' -1` (no fork)                    |
|   [9]   | Here-string   | `awk '{print $1}' <<< "${line}"` (no echo pipe)         |
|  [10]   | LC_ALL=C      | `LC_ALL=C rg 'pattern' f.txt` (bypass locale)           |
|  [11]   | BASH_REMATCH  | `[[ "$v" =~ pat ]]` + `${BASH_REMATCH[1]}` (no fork)    |
|  [12]   | mapfile       | `mapfile -t arr < <(cmd)` (3-5x faster than while-read) |

---
## [8][STRUCTURED_DATA]
>**Dictum:** *Use right tool for each data format.*

<br>

| [INDEX] | [TOOL]   | [DOMAIN]           | [WHEN_TO_USE]                                 |
| :-----: | -------- | ------------------ | --------------------------------------------- |
|   [1]   | `jq`     | JSON               | Filter, transform, extract — standard tool    |
|   [2]   | `yq-go`  | YAML/JSON/TOML     | Cross-format conversion, YAML mutation        |
|   [3]   | `miller` | CSV/TSV/JSON       | Tabular transforms -- verb chains             |
|   [4]   | `jnv`    | JSON (interactive) | TUI explorer -- develop queries interactively |

```bash
# --- jq: field extraction with fallback ---------------------------------------
jq -r '.tool_input.file_path // empty' <<< "${INPUT}"

# --- jq: safe JSON string encoding --------------------------------------------
printf '{"reason":%s}' "$(jq -Rs '.' <<< "${reason}")"

# --- yq: YAML to JSON conversion ----------------------------------------------
yq eval -o=json config.yaml | jq '.database'

# --- miller: CSV to JSON pipeline ---------------------------------------------
mlr --icsv --ojson filter '$revenue > 1000' then sort-by -nr revenue data.csv

# --- jnv: interactive exploration (REPL-first) --------------------------------
curl -s api.example.com/data | jnv  # explore, extract jq query for scripts
```
