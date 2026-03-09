# [H1][TEXT-PROCESSING-GUIDE]
>**Dictum:** *Tool selection determines pipeline efficiency.*

<br>

External tool reference: rg, awk, sd, fd, choose, jq, yq, mlr, jnv. Pipeline composition, capability probing, macOS caveats.

---
## [1][TOOL_SELECTION]
>**Dictum:** *Match tool to data shape — WHY matters more than WHAT.*

<br>

| [INDEX] | [NEED]         | [TOOL]   | [VER] | [WHY]                                                        |
| :-----: | :------------- | :------- | :---: | :----------------------------------------------------------- |
|   [1]   | Pattern/filter | `rg`     |  15+  | PCRE2, parallel, .gitignore-aware; no `grep -P` on macOS     |
|   [2]   | Field/column   | `awk`    | 5.3+  | Replaces `grep\|sed\|cut` chains; `--csv` native CSV (5.3+)  |
|   [3]   | Find-replace   | `sd`     |  1+   | PCRE2 captures, no escape hell; no `sed -i` portability bug  |
|   [4]   | Find files     | `fd`     |  10+  | .gitignore-aware, `--format` templates, `--exec-batch` bulk  |
|   [5]   | Field select   | `choose` | 1.3+  | 0-indexed ranges; `cut -d` breaks on multi-char delimiters   |
|   [6]   | JSON           | `jq`     | 1.8+  | Structural parsing; `skip/2`+`limit/2`, `trim/0`, `add/1`    |
|   [7]   | YAML/JSON/TOML | `yq`     | 4.46+ | Universal codec: YAML/JSON/TOML/INI/XML/HCL/CSV              |
|   [8]   | CSV/TSV/JSON   | `mlr`    |  6+   | `-c`/`-j` shorthands, `--gzin` auto-decompress, regex fields |
|   [9]   | JSON (TUI)     | `jnv`    |   -   | Interactive jq query dev — paste into scripts                |
|  [10]   | Tabular align  | `column` |   -   | `-t` pretty-prints; display only                             |

**Capability probing** — always gate on availability:
```bash
_require_tool() {
    command -v "${1}" >/dev/null 2>&1 || {
        printf '[WARN] %s unavailable — falling back to %s\n' "${1}" "${2}" >&2
        return 1
    }
}
# Dispatch: preferred → fallback
_require_tool rg grep && _search() { rg "$@"; } || _search() { grep -rn "$@"; }
_require_tool fd find && _find() { fd "$@"; } || _find() { find "$@"; }
```

**macOS (Darwin) caveats** — this repo always targets Darwin:

| [INDEX] | [ISSUE]         | [CONSEQUENCE]                  | [FIX]                     |
| :-----: | :-------------- | :----------------------------- | :------------------------ |
|   [1]   | No `grep -P`    | No PCRE2 lookaround via grep   | `rg -P`                   |
|   [2]   | `sed -i` compat | Needs `sed -i '' ...` on macOS | `sd` eliminates entirely  |
|   [3]   | BSD `date`      | `date -d` unavailable          | `printf '%(%F)T'`         |
|   [4]   | BSD `stat`      | `stat -c` unavailable          | `wc -c < f` or `[[ -f ]]` |

---
## [2][REGEX_DIALECTS]
>**Dictum:** *PCRE2 is the primary dialect — BRE/ERE knowledge for legacy triage only.*

<br>

`rg` and `sd` use PCRE2 natively. BRE/ERE awareness needed only when reading existing `grep`/`sed` in legacy scripts.

| [INDEX] | [FEATURE]     | [PCRE2] (`rg`/`sd`) | [BRE] (`grep`/`sed`) | [ERE] (`grep -E`/`awk`) |
| :-----: | ------------- | :------------------ | :------------------- | :---------------------- |
|   [1]   | One or more   | `+`                 | `\+`                 | `+`                     |
|   [2]   | Zero or one   | `?`                 | `\?`                 | `?`                     |
|   [3]   | Alternation   | `                   | `                    | `\|`                    |
|   [4]   | Grouping      | `(...)`             | `\(...\)`            | `(...)`                 |
|   [5]   | Lookahead     | `(?=…)` / `(?!…)`   | -                    | -                       |
|   [6]   | Lookbehind    | `(?<=…)` / `(?<!…)` | -                    | -                       |
|   [7]   | Named capture | `(?P<name>…)`       | -                    | -                       |
|   [8]   | Non-greedy    | `*?`, `+?`, `??`    | -                    | -                       |

**POSIX classes** (locale-safe, inside `[[:class:]]`):

```text
[:alnum:] A-Za-z0-9    [:alpha:] A-Za-z      [:digit:] 0-9
[:lower:] a-z          [:upper:] A-Z          [:space:] whitespace
```

---
## [3][RIPGREP]
>**Dictum:** *rg replaces grep entirely — exploit the full surface.*

<br>

| [INDEX] | [FLAG]               | [PURPOSE]              | [EXAMPLE]                                 |
| :-----: | :------------------- | :--------------------- | :---------------------------------------- |
|   [1]   | `-i`                 | Case insensitive       | `rg -i 'error'`                           |
|   [2]   | `-F`                 | Fixed string (literal) | `rg -F '192.168.1.1' access.log`          |
|   [3]   | `-w`                 | Whole word boundary    | `rg -w 'main'`                            |
|   [4]   | `-c`                 | Count per file         | `rg -c 'TODO' src/`                       |
|   [5]   | `-l`                 | Files-with-matches     | `rg -l 'import' --type ts`                |
|   [6]   | `-o`                 | Only matching text     | `rg -o '\d+\.\d+\.\d+' CHANGELOG.md`      |
|   [7]   | `-q`                 | Quiet (exit code)      | `rg -q 'BREAKING' && printf 'found\n'`    |
|   [8]   | `-A/-B/-C`           | Context lines          | `rg -C3 'FATAL' app.log`                  |
|   [9]   | `-t`                 | Type filter            | `rg -t ts 'Effect\.gen'`                  |
|  [10]   | `-g`                 | Glob filter            | `rg -g '!*.test.*' 'export'`              |
|  [11]   | `-m`                 | Max matches/file       | `rg -m1 'TODO' --sort path`               |
|  [12]   | `--json`             | Structured JSON output | `rg --json 'ERROR' app.log \| jq …`       |
|  [13]   | `-U`                 | Multiline              | `rg -U 'fn\s+\w+\(.*\n.*\{' src/`         |
|  [14]   | `-S`                 | Smart case             | `rg -S 'Error'` (caps = case-sensitive)   |
|  [15]   | `-P`                 | PCRE2 lookaround       | `rg -P '(?<=version": ")\d+\.\d+'`        |
|  [16]   | `--stats`            | Match/file statistics  | `rg --stats 'TODO' src/`                  |
|  [17]   | `--count-matches`    | Total match count      | `rg --count-matches 'fixme' src/`         |
|  [18]   | `--sort`             | Sort results           | `rg --sort modified 'HACK'`               |
|  [19]   | `-.`                 | Search hidden files    | `rg -. 'SECRET' .env*` (short `--hidden`) |
|  [20]   | `--hyperlink-format` | OSC 8 terminal links   | `rg --hyperlink-format vscode 'TODO'`     |

**rg + jq composition** — structured search results:
```bash
# Extract matched lines as clean JSON array
rg --json 'ERROR' app.log \
    | jq -s '[.[] | select(.type == "match") | .data.lines.text]'
# Count errors per file as JSON object
rg --json 'ERROR' logs/ \
    | jq -s 'map(select(.type == "match")) | group_by(.data.path.text)
             | map({(.[0].data.path.text): length}) | add'
```

---
## [4][AWK]
>**Dictum:** *Single awk program over piped grep|sed|cut chains.*

<br>

Prefer `choose` for simple field selection. Prefer `mlr` for CSV/TSV (header-aware, typed). awk for: aggregation, state machines, multi-field formatting on unstructured text. Use gawk 5.3+ `--csv` for CSV with quoted fields — eliminates `-F','` breakage on embedded commas.

```bash
# Frequency table — single program, no pipe chain
awk '{ip[$1]++} END {for (i in ip) printf "%6d %s\n", ip[i], i}' access.log | sort -rn
# Multi-counter in single pass
awk '/ERROR/{e++} /WARN/{w++} /FATAL/{f++} END {printf "E=%d W=%d F=%d\n",e,w,f}' app.log
# Native CSV parsing (gawk 5.3+) — handles quoted fields, embedded commas
gawk --csv '{revenue[$1] += $3} END {for (k in revenue) printf "%s: %.2f\n", k, revenue[k]}' sales.csv
# State machine: extract blocks between markers
awk '/^BEGIN/{capture=1; next} /^END/{capture=0} capture{print}' structured.log
# Dedup preserving order
awk '!seen[$0]++' file.txt
# JSON-aware boolean output (gawk 5.2+)
gawk 'BEGIN {print mkbool(1), mkbool(0)}' # true false (typed, not 1/0)
```

Builtins: `NF` (fields), `NR` (line#), `FNR` (file-line#), `FS`/`OFS` (separators), `FILENAME`. gawk 5.4: MinRX engine (POSIX-compliant default), `\uHHHH` Unicode escapes, `@nsinclude` for namespace-preserving includes.

**Zero-fork alternative for simple field ops**: when extracting/transforming bash variables, prefer `local -n` nameref + `printf -v` over spawning awk/sed subshells. Reserve awk for multi-line aggregation and state machines where bash builtins cannot compete.

---
## [5][SD]
>**Dictum:** *sd eliminates sed's escape complexity and macOS incompatibility.*

<br>

sd uses PCRE2 natively, writes in-place by default (no `-i` flag), and requires no backslash escaping for capture groups. On macOS, `sed -i` requires an empty string argument (`sed -i '' ...`) — sd avoids this entirely.

```bash
sd 'pattern' 'replacement' file.txt       # In-place, global (all occurrences)
sd -s 'literal.string' 'replacement' f    # Fixed string mode (no regex)
sd '(\w+)@(\w+)' '$1 AT $2' emails.txt    # PCRE2 captures — $ not \
sd 'pattern.*\n' '' file.txt              # Delete lines matching pattern
command | sd 'old' 'new'                  # Pipe mode (stdin → stdout)
```

---
## [6][PIPELINE_PATTERNS]
>**Dictum:** *Composable pipelines — composition over sequential commands.*

<br>

**Tool composition patterns**:
```bash
# rg → awk: filter then extract fields from unstructured log
rg 'ERROR' app.log | awk '{print $1, $2, $NF}'
# rg --json → jq: structured search with typed output
rg --json 'timeout' app.log \
    | jq -r 'select(.type == "match") | .data.lines.text' \
    | sort | uniq -c | sort -rn
# fd --format: template output without spawning (10.1+)
fd -e ts --format '{/}: {//}'
# fd → xargs batch: bulk operations (fewer forks than -x per-file)
fd -e json --exec-batch jq -r '.version' {}
# fd → rg: find then search within results (--hyperlink for clickable paths)
fd -e yaml --hyperlink | xargs rg 'replicas:'
# fd --strip-cwd-prefix: control path prefix display
fd -e log --strip-cwd-prefix=always
# yq → jq: cross-format pipeline (any source format, JSON processing)
yq eval -o=json config.yaml | jq '.database.connections'
yq eval -p=toml -o=json Cargo.toml | jq '.dependencies'
# sd + fd: bulk find-replace across files
fd -e ts --exec-batch sd 'oldFunction' 'newFunction' {}
# mlr format conversion → jq post-processing (-c/-j shorthands)
mlr -c -j filter '$revenue > 1000' then sort-by -nr revenue data.csv \
    | jq '[.[].email]'
```

**Decision dispatch** — tool selection by data shape:

| [INDEX] | [DATA_SHAPE]      | [PRIMARY]    | [COMPOSITION]                   |
| :-----: | :---------------- | :----------- | :------------------------------ |
|   [1]   | Unstructured      | `rg` → `awk` | filter then field-extract       |
|   [2]   | JSON              | `jq`         | `rg --json \| jq` search+parse  |
|   [3]   | YAML/TOML/INI/HCL | `yq eval`    | `yq -o=json \| jq` complex ops  |
|   [4]   | CSV/TSV           | `mlr`        | `mlr --ojson \| jq` post-proc   |
|   [5]   | File paths        | `fd`         | `fd --exec-batch` bulk actions  |
|   [6]   | Substitution      | `sd`         | `fd --exec-batch sd` bulk edits |

---
## [7][PERFORMANCE]
>**Dictum:** *Fewer forks yield faster pipelines.*

<br>

| [INDEX] | [TECHNIQUE]    | [PATTERN]                                                |
| :-----: | :------------- | :------------------------------------------------------- |
|   [1]   | Fixed strings  | `rg -F 'literal'` — skip regex compilation               |
|   [2]   | Early exit     | `rg -m 10` — stop after N matches/file                   |
|   [3]   | Smart case     | `rg -S 'Error'` — auto case-sensitivity                  |
|   [4]   | Batch exec     | `fd --exec-batch` — one process vs `-x` per-file         |
|   [5]   | Single awk     | `awk '/ERR/{e++} /WARN/{w++} END{print e,w}'` — no chain |
|   [6]   | No UUOC        | `rg p f.txt` not `cat f.txt \| rg p`                     |
|   [7]   | Locale bypass  | `LC_ALL=C rg 'pat'` — 2-5x faster on ASCII               |
|   [8]   | Atomic output  | `mktemp` + `mv` — never partial writes                   |
|   [9]   | Null-delimited | `jq --raw-output0` + `xargs -0` — special-char safe      |
|  [10]   | Thread control | `rg --threads 4` — bound parallelism in constrained envs |

---
## [8][STRUCTURED_DATA]
>**Dictum:** *Structured data demands structural tools — regex is a category error.*

<br>

### jq 1.8+ — JSON processing

```bash
# Field extraction with fallback (// = alternative operator)
jq -r '.tool_input.file_path // empty' <<< "${INPUT}"
# try-catch (1.7+): graceful handling of malformed input
jq 'try .data.items[] catch "parse_error"' response.json
# Null-safe pipeline with --raw-output0 for xargs
jq --raw-output0 '.items[].path' manifest.json | xargs -0 rg 'TODO'
# Object construction from filtered array
jq '[.[] | select(.status == "active") | {name, id}]' users.json
# Safe JSON string encoding for embedding
printf '{"reason":%s}' "$(jq -Rs '.' <<< "${reason}")"
# jq -nc --arg: injection-safe JSON construction from bash variables
jq -nc --arg ts "${ts}" --arg level "${level}" \
    --arg fn "${FUNCNAME[2]:-main}" --argjson line "${BASH_LINENO[1]:-0}" \
    --arg msg "$*" '{ts:$ts,level:$level,fn:$fn,line:$line,msg:$msg}'
# trim/ltrim/rtrim (1.8+): whitespace stripping without gsub
jq -r '[.[] | .name | trim] | join(",")' records.json
# trimstr (1.8+): strip known prefix/suffix from both ends
jq -r '.path | trimstr("/")' config.json
# add/1 (1.8+): safe aggregation with initial value — prevents null on empty arrays
jq '[.items[].score] | add(0)' metrics.json
# skip/2 + limit/2: lazy pagination without materializing full array
jq '[limit(10; skip(20; .[]))]' results.json
# toboolean (1.8+): coerce string flags to native JSON boolean
jq '.flags | to_entries | map(.value |= toboolean)' settings.json
# $ENV: access shell env vars inside jq without --arg
jq -r '$ENV.HOME + "/.config/" + .name' packages.json
```

### yq 4.46+ — universal config codec (YAML/JSON/TOML/INI/XML/HCL/CSV)

```bash
# YAML → JSON conversion for jq pipeline
yq eval -o=json config.yaml | jq '.database'
# In-place YAML mutation
yq eval -i '.spec.replicas = 3' deployment.yaml
# Multi-document YAML: select by field
yq eval 'select(.kind == "Deployment")' manifests.yaml
# INI → JSON (4.46+): parse legacy config into structured format
yq eval -p=ini -o=json config.ini
# TOML write (4.48+): full round-trip — was read-only before 4.48
yq eval -i -p=toml -o=toml '.database.pool_size = 20' config.toml
# HCL read (4.50+): extract from Terraform files
yq eval -p=hcl -o=yaml '.resource.aws_instance' main.tf
```

### mlr 6+ — CSV/TSV/JSON format conversion

```bash
# CSV → JSON with filter and sort (-c = --csv, -j = --json shorthands)
mlr -c -j filter '$revenue > 1000' then sort-by -nr revenue data.csv
# CSV stats: group-by aggregation
mlr -c stats1 -a mean,count -f revenue -g region sales.csv
# Regex field selection: cut fields matching pattern
mlr -c cut -c -f '/^metric_/' telemetry.csv
# Auto-decompress: transparent .gz/.bz2/.zst handling
mlr -c --gzin filter '$status != "ok"' compressed_logs.csv.gz
# Cross-format: JSON array → CSV
mlr --ijson --ocsv cat api_response.json
# REPL mode: interactive exploration for query development
# mlr repl  (then type verbs interactively against piped data)
```

### jnv — interactive JSON exploration

```bash
# Develop jq queries interactively, then embed in scripts
curl -s api.example.com/data | jnv
```
