# ShellCheck Reference (v0.11.0)

## Usage

```bash
shellcheck script.sh                  # Default (tty output)
shellcheck -s bash script.sh          # Force shell dialect
shellcheck -f gcc script.sh           # GCC format (editors)
shellcheck -f json script.sh          # JSON output
shellcheck -S error script.sh         # Errors only
shellcheck -e SC2086,SC2046 script.sh # Exclude codes
```

## Severity: error > warning > info > style

## Common Codes

| Code | Severity | Issue | Fix |
|------|----------|-------|-----|
| SC2086 | info | Unquoted variable | `"$var"` |
| SC2046 | warning | Unquoted `$()` | `"$(cmd)"` or `for f in *.txt` |
| SC2006 | style | Backticks | `$(cmd)` |
| SC2155 | warning | `local v=$(cmd)` masks exit | `local v; v=$(cmd)` |
| SC2164 | warning | `cd` without guard | `cd dir \|\| exit 1` |
| SC2181 | style | `cmd; if [ $? ]` | `if cmd; then` |
| SC2068 | error | Unquoted `$@` | `"$@"` |
| SC2116 | style | `var=$(echo $v)` (useless echo) | `var=$v` |
| SC2162 | info | `read` without `-r` | `IFS= read -r line` |
| SC2005 | style | `echo "$(cmd)"` (useless echo) | Just `cmd` |
| SC3010 | warning | `[[ ]]` in sh (bashism) | `[ ]` |
| SC3030 | warning | Arrays in sh (bashism) | Positional params or bash shebang |
| SC3037 | warning | `echo` flags in sh (undefined) | `printf` instead |

## New in v0.11.0 (August 2025)

| Code | Severity | Issue | Fix |
|------|----------|-------|-----|
| SC2327 | warning | Capturing output of redirected command | Separate redirect from capture |
| SC2328 | warning | Related to SC2327 (combined redirect+capture) | Restructure command |
| SC2329 | warning | Non-escaping function never invoked | Remove unused function or call it |
| SC2330 | warning | Unsupported glob match with `[[ ]]` in BusyBox | Use `case` or `grep` |
| SC2331 | info | Suggest `-e` instead of unary `-a` in `test` | `[ -e file ]` not `[ -a file ]` |
| SC2332 | warning | `[ ! -o opt ]` unconditionally true in bash | Use `[[ ! -o opt ]]` or `shopt -q` |
| SC2335 | style | (optional) Negated conditional expression | Replace with positive equivalent |
| SC3062 | warning | Bashism: `[ -o opt ]` | Use bash `[[ ]]` or `shopt -q` |

**Note:** SC2002 (Useless Use of Cat) is now **disabled by default** in v0.11.0.

## Directives

```bash
# shellcheck disable=SC2086           # Disable for next line
# shellcheck disable=SC2086,SC2046    # Multiple codes
# shellcheck shell=bash               # Override shebang
# shellcheck source=./lib/common.sh   # Resolve source path
# shellcheck source=/dev/null         # Ignore dynamic source
# shellcheck enable=require-variable-braces  # Enable optional check
```

### Block disable

```bash
# shellcheck disable=SC2086
{
    var1=$unquoted1
    var2=$unquoted2
}
# shellcheck enable=SC2086
```

## .shellcheckrc

```bash
disable=SC2086,SC2046    # Global disables
shell=bash               # Default shell
enable=all               # Enable optional checks
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No issues |
| 1 | Issues found |
| 2 | Parse errors |
| 3 | Bad options/missing files |

## CI Integration

```yaml
# GitHub Actions
- uses: ludeeus/action-shellcheck@2.0.0
  with:
    severity: warning
    shellcheck_version: v0.11.0

# Pre-commit (official)
- repo: https://github.com/koalaman/shellcheck-precommit
  rev: v0.11.0
  hooks: [{ id: shellcheck }]

# Pre-commit (Python wrapper)
- repo: https://github.com/shellcheck-py/shellcheck-py
  rev: v0.11.0.1
  hooks: [{ id: shellcheck }]
```

## Data Structure Patterns That Avoid Common SC Warnings

| Pattern | Avoids | Replaces |
|---------|--------|----------|
| `mapfile -t arr < <(cmd)` | SC2207 (unquoted array from `$()`) | `arr=( $(cmd) )` |
| `readarray -d '' -t f < <(find -print0)` | SC2207, word splitting | `for f in $(find ...)` |
| `[[ -v MAP["$k"] ]]` | SC2086 (unquoted in `[ ]`) | `[ -n "${MAP[$k]:-}" ]` |
| `IFS=, read -ra parts <<< "$v"` | SC2086, SC2046 | `echo "$v" \| cut -d, -f1` |
| `[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}` | SC2046 (unquoted subshell) | `$(echo "$v" \| grep -oP ...)` |
| `printf -v ts '%(%F)T' -1` | SC2046 (unquoted `$(date)`) | `ts=$(date +%F)` |

## Install

```bash
brew install shellcheck       # macOS
apt-get install shellcheck    # Debian/Ubuntu
pip3 install shellcheck-py    # Python (cross-platform)
```
