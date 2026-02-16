# [H1][TEXT-PROCESSING-GUIDE]
>**Dictum:** *Tool selection determines pipeline efficiency.*

<br>

External tool reference: rg, awk, sd, fd, choose, jq, yq, mlr, jnv. Pipeline composition and performance.

---
## [1][TOOL_SELECTION]
>**Dictum:** *Match tool to data shape.*

<br>

| [INDEX] | [NEED]               | [TOOL]         | [NOTES]                                 |
| :-----: | :------------------- | :------------- | :-------------------------------------- |
|   [1]   | Pattern match/filter | `rg` (ripgrep) | PCRE2, smart-case, .gitignore-aware     |
|   [2]   | Field/column data    | `awk`          | Splits, aggregates, state machines      |
|   [3]   | Find-replace/delete  | `sd`           | PCRE2, no escape hell, in-place default |
|   [4]   | Find files           | `fd`           | .gitignore-aware, parallel `-x`         |
|   [5]   | Field selection      | `choose`       | 0-indexed, replaces `cut`               |
|   [6]   | JSON                 | `jq`           | Filter, transform, extract              |
|   [7]   | YAML/JSON/TOML       | `yq-go`        | Cross-format conversion                 |
|   [8]   | CSV/TSV/JSON         | `miller` (mlr) | Tabular transforms, verb chains         |
|   [9]   | JSON (interactive)   | `jnv`          | TUI explorer with jaq engine            |
|  [10]   | Tabular alignment    | `column -t`    | Pretty-print pipe output                |

For bash-native alternatives (BASH_REMATCH, IFS splitting, associative sets, mapfile),
see [bash-scripting-guide.md §7, §9, and §6](bash-scripting-guide.md).

---
## [2][RIPGREP]
>**Dictum:** *Flag awareness eliminates unnecessary pipelines.*

<br>

| [INDEX] | [FLAG]     | [PURPOSE]               | [EXAMPLE]                                         |
| :-----: | :--------- | :---------------------- | :------------------------------------------------ |
|   [1]   | `-i`       | Case insensitive        | `rg -i 'error'`                                   |
|   [2]   | `-F`       | Fixed string (literal)  | `rg -F '192.168.1.1'`                             |
|   [3]   | `-w`       | Whole word              | `rg -w 'main'`                                    |
|   [4]   | `-c`       | Count matches per file  | `rg -c 'TODO'`                                    |
|   [5]   | `-n`       | Line numbers            | `rg -n 'pattern'`                                 |
|   [6]   | `-l`       | Files with matches only | `rg -l 'import'`                                  |
|   [7]   | `-o`       | Only matching text      | `rg -o '\d+\.\d+'`                                |
|   [8]   | `-q`       | Quiet (exit code only)  | `rg -q 'pattern' && echo found`                   |
|   [9]   | `-A/-B/-C` | Context lines           | `rg -C3 'error'`                                  |
|  [10]   | `-t`       | File type filter        | `rg -t ts 'interface'`                            |
|  [11]   | `-g`       | Glob filter             | `rg -g '*.json' 'key'`                            |
|  [12]   | `-m`       | Max matches per file    | `rg -m1 'first'`                                  |
|  [13]   | `--json`   | JSON output             | `rg --json 'pat'`                                 |
|  [14]   | `-U`       | Multiline               | `rg -U 'start.*\nend'`                            |
|  [15]   | `-S`       | Smart case              | `rg -S 'Error'` (case-sensitive due to uppercase) |
|  [16]   | `-P`       | PCRE2 lookaround        | `rg -P '(?<=@)\w+'`                               |

---
## [3][AWK]
>**Dictum:** *awk handles multi-field aggregation and state machines.*

<br>

Prefer `choose` for simple field selection (e.g., `choose 0 2`). awk for aggregation,
state machines, and formatted output.

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
sd 'pattern' 'replacement' file.txt       # Replace all (global by default)
sd -s 'literal.string' 'replacement' f    # Fixed string mode (no regex)
sd '(\w+)@(\w+)' '$1 AT $2' emails.txt    # PCRE2 captures
sd 'pattern.*\n' '' file.txt              # Delete lines matching pattern
command | sd 'old' 'new'                  # Pipe mode (stdin -> stdout)
# In-place is default (no -i flag needed)
```

---
## [5][PIPELINE_PATTERNS]
>**Dictum:** *Composable pipelines maximize single-pass efficiency.*

<br>

```bash
rg 'ERROR' log.txt | awk '{print $1, $5}'                          # Filter then extract
sd '#.*' '' config.txt | awk -F'=' '{print $1}'                    # Clean then process
awk '{print $3}' data.txt | sort | uniq -c | sort -rn | column -t  # Frequency table

# rg + jq: extract from structured log
rg --json 'ERROR' app.log | jq -r '.data.lines.text'

# fd + jq: process all JSON files
fd -e json -x jq -r '.name' {}

# yq + rg: search YAML values
yq eval -o=json config.yaml | rg -i 'database'

# miller + jq: CSV transform with post-processing
mlr --icsv --ojson head -n 100 data.csv | jq -r '.[].email'
```

---
## [6][PERFORMANCE]
>**Dictum:** *Fewer forks yield faster pipelines.*

<br>

| [INDEX] | [TECHNIQUE]   | [PATTERN]                                            |
| :-----: | :------------ | :--------------------------------------------------- |
|   [1]   | Fixed strings | `rg -F 'literal' large.txt`                          |
|   [2]   | Early exit    | `rg -m 10 'pat' large.txt`                           |
|   [3]   | Smart case    | `rg -S 'Error'` (avoids separate `-i` flag)          |
|   [4]   | Fast find     | `fd -e ext` over `find -name '*.ext'`                |
|   [5]   | Single pass   | `awk '/ERR/{e++}/WARN/{w++} END{print e,w}' log.txt` |
|   [6]   | No UUOC       | `rg p f.txt` not `cat f.txt \| rg p`                 |
|   [7]   | Locale bypass | `LC_ALL=C rg 'pattern' f.txt`                        |
|   [8]   | Atomic output | Pipeline to `mktemp` + `mv` (see script-patterns §9) |

For bash-native performance (printf -v, $(<file), mapfile, BASH_REMATCH, here-strings),
see [bash-scripting-guide.md §9](bash-scripting-guide.md).

---
## [7][STRUCTURED_DATA]
>**Dictum:** *Match tool to data format.*

<br>

| [INDEX] | [TOOL]   | [DOMAIN]           | [WHEN_TO_USE]                                |
| :-----: | :------- | :----------------- | :------------------------------------------- |
|   [1]   | `jq`     | JSON               | Filter, transform, extract — standard tool   |
|   [2]   | `yq-go`  | YAML/JSON/TOML     | Cross-format conversion, YAML mutation       |
|   [3]   | `miller` | CSV/TSV/JSON       | Tabular transforms — verb chains             |
|   [4]   | `jnv`    | JSON (interactive) | TUI explorer — develop queries interactively |

```bash
# jq: field extraction with fallback
jq -r '.tool_input.file_path // empty' <<< "${INPUT}"

# jq: safe JSON string encoding
printf '{"reason":%s}' "$(jq -Rs '.' <<< "${reason}")"

# yq: YAML to JSON conversion
yq eval -o=json config.yaml | jq '.database'

# miller: CSV to JSON pipeline
mlr --icsv --ojson filter '$revenue > 1000' then sort-by -nr revenue data.csv

# jnv: interactive exploration (REPL-first)
curl -s api.example.com/data | jnv  # explore, extract jq query for scripts
```
