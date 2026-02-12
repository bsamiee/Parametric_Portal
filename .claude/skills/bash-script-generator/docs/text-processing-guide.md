# Text Processing Guide

## Tool Selection

| Need                 | Tool                 | Notes                            |
| -------------------- | -------------------- | -------------------------------- |
| Pattern match/filter | grep                 | `-F` for literals, `-P` for PCRE |
| Field/column data    | awk                  | Splits, aggregates, conditionals |
| Find-replace/delete  | sed                  | Stream edits, in-place with `-i` |
| Tabular alignment    | `column -t`          | Pipe output for pretty-printing  |
| Complex processing   | awk (or Python/Perl) | Multi-pass, state machines       |

## grep

| Flag       | Purpose                 | Example                           |
| ---------- | ----------------------- | --------------------------------- |
| `-i`       | Case-insensitive        | `grep -i 'error' log.txt`         |
| `-v`       | Invert match            | `grep -v 'DEBUG' log.txt`         |
| `-c`       | Count matches           | `grep -c 'ERROR' log.txt`         |
| `-n`       | Line numbers            | `grep -n 'TODO' *.sh`             |
| `-E`       | Extended regex          | `grep -E '(error\|fail)' log.txt` |
| `-P`       | PCRE (lookahead, `\d`)  | `grep -P '\d{3}-\d{4}' file.txt`  |
| `-r`       | Recursive               | `grep -r 'fn_name' src/`          |
| `-l`       | Filenames only          | `grep -l 'pattern' *.txt`         |
| `-A/-B/-C` | Context lines           | `grep -C 2 'ERROR' log.txt`       |
| `-w`       | Whole word              | `grep -w 'test' file.txt`         |
| `-F`       | Fixed string (fastest)  | `grep -F 'a.b' file.txt`          |
| `-m N`     | Stop after N matches    | `grep -m 10 'pat' large.txt`      |
| `-o`       | Print only matched part | `grep -oP 'id=\K\d+' log.txt`     |

## awk

```bash
awk '{print $1, $3}' file.txt             # Fields (space-delimited)
awk -F',' '{print $1, $3}' data.csv       # Custom delimiter
awk '{print $NF}' file.txt                # Last field
awk '$3 > 100' data.txt                   # Filter by field value
awk '$2 ~ /error/' log.txt                # Field regex match
awk '{sum += $3} END {print sum}' f.txt   # Sum column
awk '{s+=$3; c++} END {print s/c}' f.txt  # Average
awk '{printf "%-20s %3d\n", $1, $2}' f    # Printf formatting
awk '{ip[$1]++} END {for(i in ip) print ip[i],i}' access.log | sort -rn  # Traffic by IP
# Builtins: NF=fields NR=line# FNR=file-line# FS/OFS=separators FILENAME=current
```

## sed

```bash
sed 's/old/new/' f.txt                     # First per line
sed 's/old/new/g' f.txt                    # Global
sed 's/old/new/gi' f.txt                   # Case-insensitive global
sed -i 's/old/new/g' f.txt                 # In-place (GNU); use -i '' on macOS
sed -i.bak 's/old/new/g' f.txt            # In-place with backup
sed '5s/old/new/' f.txt                    # Specific line
sed '/ERROR/s/old/new/g' f.txt             # On matching lines
sed 's|/usr/local|/opt|g' f.txt            # Alternate delimiter
sed -e 's/a/b/g' -e 's/c/d/g' f.txt       # Multiple substitutions (single invocation)
sed '5d' f.txt                             # Delete line 5
sed '/pattern/d' f.txt                     # Delete matching
sed '/^$/d' f.txt                          # Delete empty lines
sed -n '10,20p' f.txt                      # Print range
sed 's/^[[:space:]]*//' f.txt              # Strip leading whitespace
```

## Pipeline Patterns

```bash
grep 'ERROR' log.txt | awk '{print $1, $5}'                     # Filter then extract
sed 's/#.*//' config.txt | awk -F'=' '{print $1}'               # Clean then process
grep 'GET' access.log | grep -v 'robot' \
    | sed 's/.*HTTP\/[0-9.]*" //' \
    | awk '$1>=200 && $1<300{ok++} $1>=400{fail++} END{print "OK:",ok,"Fail:",fail}'
awk '{print $3}' data.txt | sort | uniq -c | sort -rn | column -t  # Frequency table
```

## BASH_REMATCH: Inline Parsing Without External Tools

For simple field extraction, `BASH_REMATCH` replaces `grep -oP` / `sed` / `awk` with zero forks:

```bash
# Extract date + level from log line (replaces: echo "$line" | grep -oP '...')
[[ "${line}" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]([A-Z]+) ]] && {
    local -r date="${BASH_REMATCH[1]}" level="${BASH_REMATCH[2]}"
}

# Extract action@version from YAML (replaces: sed + cut subshells)
[[ "${line}" =~ uses:[[:space:]]*([^@]+)@([^[:space:]#]+) ]] && {
    local -r action="${BASH_REMATCH[1]}" version="${BASH_REMATCH[2]}"
}

# Trim whitespace via parameter expansion (replaces: xargs / sed subshell)
var="${var#"${var%%[![:space:]]*}"}"   # strip leading
var="${var%"${var##*[![:space:]]}"}"   # strip trailing
```

**When to use BASH_REMATCH vs external tools:**

| Scenario | Use | Reason |
| -------- | --- | ------ |
| Extract 1-3 fields from a variable | `BASH_REMATCH` | Zero forks, O(1) |
| Filter/count across large files | `grep` / `awk` | Optimized C code |
| Multi-field structured data | `awk` | Built-in field splitting |
| Simple delimiter split | `IFS=, read -ra` | Zero forks |

## Performance

| Technique     | Example                                                          |
| ------------- | ---------------------------------------------------------------- |
| Fixed strings | `grep -F 'literal' large.txt`                                    |
| Early exit    | `grep -m 10 'pat' large.txt`                                     |
| Single pass   | `awk '/ERR/{e++}/WARN/{w++} END{print e,w}' log.txt`             |
| No UUOC       | `grep p f.txt` not `cat f.txt \| grep p`                         |
| `$(<file)`    | `content="$(<file)"` not `content="$(cat file)"` (no fork)       |
| `printf -v`   | `printf -v ts '%(%F)T' -1` not `ts=$(date +%F)` (no fork)        |
| Batch sed     | `sed -e 's/a/b/g' -e 's/c/d/g'` (one invocation)                 |
| Here-string   | `awk '{print $1}' <<< "${line}"` not `echo "${line}" \| awk ...` |
| LC_ALL=C      | `LC_ALL=C grep 'pattern' f.txt` (bypass locale for speed)        |
| BASH_REMATCH  | `[[ "$v" =~ pat ]]` + `${BASH_REMATCH[1]}` (no grep/sed fork)    |
| IFS splitting | `IFS=, read -ra parts <<< "$csv"` (no cut/awk fork)              |
| Assoc set     | `[[ -v SET["$k"] ]]` for O(1) membership (no grep/fgrep)         |
| mapfile       | `mapfile -t arr < <(cmd)` replaces `while read` loops            |
