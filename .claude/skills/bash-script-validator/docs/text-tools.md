# Text Tools — grep, sed, awk, regex

## BRE vs ERE Quick Reference

| Feature | BRE (grep, sed) | ERE (grep -E, sed -E, awk) |
|---------|-----------------|---------------------------|
| One or more | `\+` | `+` |
| Zero or one | `\?` | `?` |
| Alternation | `\|` | `|` |
| Grouping | `\(...\)` | `(...)` |
| Quantifiers | `\{m,n\}` | `{m,n}` |
| Both: `.` `*` `^` `$` `[...]` `[^...]` | same | same |

## POSIX Character Classes

```
[:alnum:] A-Za-z0-9    [:alpha:] A-Za-z      [:digit:] 0-9
[:lower:] a-z          [:upper:] A-Z          [:space:] whitespace
[:blank:] space+tab    [:punct:] punctuation   [:xdigit:] hex digits
```
Usage: `grep '[[:digit:]]' file`

## grep

```bash
grep [opts] PATTERN file           # BRE default
grep -E PATTERN file               # ERE
grep -F "literal" file             # Fixed string (fastest)
grep -P 'pcre' file                # Perl regex (lookahead/behind)

# Common flags
-i  case-insensitive    -v  invert match       -w  whole word
-c  count matches       -n  line numbers       -l  filenames only
-o  only matching part  -q  quiet (exit code)  -r  recursive
-A N  after context     -B N  before context   -C N  both context
--include="*.sh"        --exclude-dir=".git"
```

### Patterns

```bash
grep -E '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' file  # IP address
grep -E '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' file  # Email
grep -E 'https?://[^ ]+' file                     # URL
grep -E '[0-9]{3}-[0-9]{3}-[0-9]{4}' file         # Phone
grep -E '[0-9]{4}-[0-9]{2}-[0-9]{2}' file         # Date YYYY-MM-DD
grep -v '^#' file | grep -v '^$'                   # Uncommented non-empty
```

## sed

```bash
sed 's/old/new/' file              # Replace first per line
sed 's/old/new/g' file             # Replace all
sed 's|/old/path|/new/path|g' f    # Alt delimiter for paths
sed -i 's/old/new/g' file          # In-place edit
sed -i.bak 's/old/new/g' file      # In-place with backup
sed -n '5,10p' file                # Print lines 5-10
sed '5d' file                      # Delete line 5
sed '/pattern/d' file              # Delete matching lines
sed '/^$/d' file                   # Delete empty lines

# Backreferences
sed -E 's/([0-9]+)-([0-9]+)/\2-\1/' file  # Swap numbers
# Special replacement: & = matched text, \1-\9 = groups
```

### Flags: `g` all | `i`/`I` case-insensitive | `p` print | `w file` write

## awk

```bash
awk 'pattern { action }' file
awk -F',' '{print $1}' file.csv    # Custom separator

# Built-in variables
$0  entire line    $1..$NF  fields    NF  field count    NR  line number
FS  input sep      OFS  output sep    RS  record sep     FILENAME

# Common patterns
awk '{print $1, $3}' f                          # Print fields
awk '$3 > 100' f                                # Numeric filter
awk '/pattern/ {print $0}' f                    # Regex match
awk '{sum += $1} END {print sum}' f             # Sum column
awk '{count[$1]++} END {for (k in count) print k, count[k]}' f  # Count
awk '!seen[$0]++' f                             # Unique lines
awk 'NR > 1 {print $1}' f                       # Skip header
awk '{printf "%-20s %10s\n", $1, $2}' f         # Format output
```

### String functions: `length` `substr` `index` `split` `sub` `gsub` `tolower` `toupper` `match`

## Bash-Native Alternatives (No External Tools)

When processing variables or small data, prefer these bash builtins over forking grep/sed/awk:

| Need | External Tool | Bash-Native Alternative |
|------|---------------|------------------------|
| Extract fields from variable | `echo "$v" \| grep -oP 'pat'` | `[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}` |
| Split on delimiter | `echo "$v" \| cut -d, -f1` | `IFS=, read -ra parts <<< "$v"` |
| Trim whitespace | `echo "$v" \| xargs` | `v="${v#"${v%%[![:space:]]*}"}"` (leading) |
| Membership check | `echo "$v" \| grep -Fxq` | `declare -Ar SET=([k]=1); [[ -v SET["$v"] ]]` |
| Dispatch/routing | `case "$v" in a) ... ;; b) ... ;; esac` | `declare -Ar MAP=([a]=fn_a [b]=fn_b); "${MAP[$v]}"` |
| Array from command | `while read line; do arr+=("$line"); done < <(cmd)` | `mapfile -t arr < <(cmd)` |
| Strip quotes | `echo "$v" \| sed "s/['\"]//g"` | `v="${v//\"/}"; v="${v//\'/}"` |
| Deduplication | `sort -u` | `declare -A seen; [[ -v seen["$k"] ]] && continue; seen["$k"]=1` |

**Rule of thumb:** Use bash builtins for variables and small data; use grep/awk/sed for file processing and large streams.

## Common Pitfalls

| Tool | Mistake | Fix |
|------|---------|-----|
| grep | `grep 192.168.1.1` (. = any) | `grep -F '192.168.1.1'` or `grep '192\.168'` |
| grep | `grep $pattern` (unquoted) | `grep "$pattern"` |
| grep | `cat f \| grep p` (UUOC) | `grep p f` |
| grep | `if [ "$(grep p f)" ]` | `if grep -q p f; then` |
| bash | `$(cat file)` (fork + exec) | `$(<file)` (bash built-in, no subshell) |
| sed | `sed 's/old/new/'` with `/` in vars | Use `\|` delimiter: `sed "s\|$old\|$new\|g"` |
| sed | `-i` without backup | `sed -i.bak` |
| sed | BRE `([0-9]+)` (no escape) | `\([0-9]\+\)` or `sed -E` |
| awk | `awk {print $1}` (unquoted) | `awk '{print $1}'` |
| awk | `$1/$2` (div by zero) | `$2 != 0 ? $1/$2 : "N/A"` |
| regex | `<.*>` (greedy) | `<[^>]*>` (non-greedy workaround) |
