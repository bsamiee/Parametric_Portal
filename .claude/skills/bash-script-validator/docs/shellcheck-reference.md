# [H1][SHELLCHECK-REFERENCE]
>**Dictum:** *Static analysis catches defects that syntax validation misses.*

<br>

ShellCheck 0.11.0+ usage, common codes, v0.11.0 additions, directives, `.shellcheckrc`, CI integration.

---
## [1][USAGE]
>**Dictum:** *Flag selection controls analysis scope.*

<br>

```bash
shellcheck script.sh                  # Default (tty output)
shellcheck -s bash script.sh          # Force shell dialect
shellcheck -f gcc script.sh           # GCC format (editors)
shellcheck -f json script.sh          # JSON output
shellcheck -S error script.sh         # Errors only
shellcheck -e SC2086,SC2046 script.sh # Exclude codes
```

Severity hierarchy: error > warning > info > style.

---
## [2][COMMON_CODES]
>**Dictum:** *Code familiarity accelerates fix identification.*

<br>

| [INDEX] | [CODE]     | [SEV]   | [ISSUE]                         | [FIX]                             |
| :-----: | ---------- | ------- | ------------------------------- | --------------------------------- |
|   [1]   | **SC2086** | info    | Unquoted variable               | `"$var"`                          |
|   [2]   | **SC2046** | warning | Unquoted `$()`                  | `"$(cmd)"` or `for f in *.txt`    |
|   [3]   | **SC2006** | style   | Backticks                       | `$(cmd)`                          |
|   [4]   | **SC2155** | warning | `local v=$(cmd)` masks exit     | `local v; v=$(cmd)`               |
|   [5]   | **SC2164** | warning | `cd` without guard              | `cd dir \|\| exit 1`              |
|   [6]   | **SC2181** | style   | `cmd; if [ $? ]`                | `cmd && action \|\| handle_error` |
|   [7]   | **SC2068** | error   | Unquoted `$@`                   | `"$@"`                            |
|   [8]   | **SC2116** | style   | `var=$(echo $v)` (useless echo) | `var=$v`                          |
|   [9]   | **SC2162** | info    | `read` without `-r`             | `IFS= read -r line`               |
|  [10]   | **SC3010** | warning | `[[ ]]` in sh (bashism)         | `[ ]`                             |
|  [11]   | **SC3030** | warning | Arrays in sh (bashism)          | Positional params or bash shebang |
|  [12]   | **SC3037** | warning | `echo` flags in sh (undefined)  | `printf` instead                  |

---
## [3][V0_11_0_ADDITIONS]
>**Dictum:** *v0.11.0 codes target redirect and glob edge cases.*

<br>

| [INDEX] | [CODE]     | [SEV]   | [ISSUE]                                         | [FIX]                             |
| :-----: | ---------- | ------- | ----------------------------------------------- | --------------------------------- |
|   [1]   | **SC2327** | warning | Capturing output of redirected command          | Separate redirect from capture    |
|   [2]   | **SC2328** | warning | Redirect takes output from command substitution | Restructure command               |
|   [3]   | **SC2329** | warning | Non-escaping function never invoked             | Remove unused function or call it |
|   [4]   | **SC2330** | warning | Unsupported glob match in BusyBox `[[ ]]`       | Use `case` or `grep`              |
|   [5]   | **SC2331** | info    | Suggest `-e` instead of unary `-a` in `test`    | `[ -e file ]` not `[ -a file ]`   |
|   [6]   | **SC2332** | warning | `[ ! -o opt ]` unconditionally true in bash     | `[[ ! -o opt ]]` or `shopt -q`    |
|   [7]   | **SC2335** | style   | Negated conditional expression                  | Replace with positive equivalent  |
|   [8]   | **SC3062** | warning | Bashism: `[ -o opt ]`                           | `[[ ]]` or `shopt -q`             |

SC2002 (Useless Use of Cat) disabled by default in v0.11.0.

---
## [4][DIRECTIVES]
>**Dictum:** *Directives scope suppressions to minimal ranges.*

<br>

```bash
# shellcheck disable=SC2086           # Disable for next line
# shellcheck disable=SC2086,SC2046    # Multiple codes
# shellcheck shell=bash               # Override shebang
# shellcheck source=./lib/common.sh   # Resolve source path
# shellcheck source=/dev/null         # Ignore dynamic source
# shellcheck enable=require-variable-braces  # Enable optional check

# Block disable
# shellcheck disable=SC2086
{
    var1=$unquoted1
    var2=$unquoted2
}
# shellcheck enable=SC2086
```

---
## [5][SHELLCHECKRC]
>**Dictum:** *Project-level config eliminates repeated directives.*

<br>

```bash
disable=SC2086,SC2046    # Global disables
shell=bash               # Default shell
enable=all               # Enable optional checks
```

---
## [6][SC_AVOIDING_PATTERNS]
>**Dictum:** *Idiomatic patterns eliminate SC warnings at source.*

<br>

| [INDEX] | [PATTERN]                                     | [AVOIDS]                           | [REPLACES]                 |
| :-----: | --------------------------------------------- | ---------------------------------- | -------------------------- |
|   [1]   | **`mapfile -t arr < <(cmd)`**                 | SC2207 (unquoted array from `$()`) | `arr=( $(cmd) )`           |
|   [2]   | **`readarray -d '' -t f < <(fd --print0)`**   | SC2207, word splitting             | `for f in $(find ...)`     |
|   [3]   | **`[[ -v MAP["$k"] ]]`**                      | SC2086 (unquoted in `[ ]`)         | `[ -n "${MAP[$k]:-}" ]`    |
|   [4]   | **`IFS=, read -ra parts <<< "$v"`**           | SC2086, SC2046                     | `echo "$v" \| choose -f 0` |
|   [5]   | **`[[ "$v" =~ pat ]] && ${BASH_REMATCH[1]}`** | SC2046 (unquoted subshell)         | `$(echo "$v" \| rg -oP .)` |
|   [6]   | **`printf -v ts '%(%F)T' -1`**                | SC2046 (unquoted `$(date)`)        | `ts=$(date +%F)`           |

---
## [7][CI_AND_INSTALL]
>**Dictum:** *Automated analysis gates prevent unchecked merges.*

<br>

```yaml
# GitHub Actions
- uses: ludeeus/action-shellcheck@2.0.0
  with:
    severity: warning
    shellcheck_version: v0.11.0

# Pre-commit
- repo: https://github.com/shellcheck-py/shellcheck-py
  rev: v0.11.0.1
  hooks: [{ id: shellcheck }]
```

Nix-provided on dev machines. VPS/CI: `bash .claude/scripts/bootstrap-cli-tools.sh`. Fallback: `apt-get install shellcheck` or `dnf install shellcheck` (shellcheck is in all major distro repos).

| [INDEX] | [CODE] | [MEANING]                 |
| :-----: | :----: | ------------------------- |
|   [1]   | **0**  | No issues                 |
|   [2]   | **1**  | Issues found              |
|   [3]   | **2**  | Parse errors              |
|   [4]   | **3**  | Bad options/missing files |
