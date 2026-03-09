# [H1][VALIDATION]
>**Dictum:** *Static analysis catches defects that syntax validation misses.*

---
## [1][VALIDATION_PIPELINE]
>**Dictum:** *Each layer targets a distinct defect class; execute in order.*

Validation is sequential — each gate must pass before the next runs. `bash -n` catches unclosed quotes, missing `done`/`fi`, and heredoc mismatches, but CANNOT detect unquoted expansions, unused variables, or unreachable code. ShellCheck fills the semantic gap. Tests prove runtime behavior. Coverage quantifies untested surface.

| [INDEX] | [GATE]           | [COMMAND]                                     | [CATCHES]                          | [MISSES]                  |
| :-----: | :--------------- | :-------------------------------------------- | :--------------------------------- | :------------------------ |
|   [1]   | **Syntax**       | `bash -n script.sh`                           | Parse err, unclosed blocks         | Semantic+runtime defects  |
|   [2]   | **Static: err**  | `shellcheck -S error -s bash script.sh`       | Unquoted `$@`, parse-adjacent      | Style/info-level patterns |
|   [3]   | **Static: full** | `shellcheck -s bash script.sh`                | All 4 severity levels              | Runtime/integration bugs  |
|   [4]   | **Unit tests**   | `bats tests/`                                 | Functional regressions, edge cases | Untested paths            |
|   [5]   | **Coverage**     | `kcov --include-path=. coverage/ bats tests/` | Dead code, untested branches       | Semantic correctness      |
|   [6]   | **Quality gate** | Exit 1 on coverage < threshold                | Enforcement                        | -                         |

---
## [2][CRITICAL_SC_CODES]
>**Dictum:** *Understanding WHY a code matters drives correct remediation.*

**SC2086 — Unquoted variable (info severity, security-critical impact)**
Unquoted `$var` undergoes word splitting AND pathname globbing. An input containing `* /etc/passwd` expands to every file in CWD plus `/etc/passwd`. Under `rm`, this is arbitrary file deletion. SC2086 is classified "info" because quoting is occasionally intentionally omitted (arithmetic contexts, `[[ ]]` RHS patterns) — the severity does NOT reflect the risk. Treat every SC2086 as a potential injection vector until proven safe.

**SC2155 — Declare and assign in one statement (warning)**
`local v=$(cmd)` masks the exit code of `cmd`. Under `set -e`, a failing command inside the subshell is silently swallowed because `local` itself returns 0. The fix — `local v; v=$(cmd)` — exposes the real exit code to `errexit`. This interaction between `set -Eeuo pipefail` and declare-assign is the most common source of silent failures in strict-mode scripts.

**SC2329 — Unused function never called (warning)**
Functions defined but never invoked in the file. Dispatch-table patterns legitimately define functions referenced via `"${_DISPATCH[$cmd]}"` — ShellCheck cannot trace this indirection. Suppress with `# shellcheck disable=SC2329` on dispatch-target functions, with a justification comment referencing the dispatch table.

**SC2330 — Unsupported glob in BusyBox `[[ ]]` (warning)**
BusyBox `sh` implements `[[ ]]` but omits glob pattern matching on the RHS. `[[ $1 == https:* ]]` silently fails or behaves unpredictably. Use `case` for portable glob matching.

**SC2331 — Legacy `-a` file test; prefer `-e` (warning)**
`[ -a file ]` is ambiguous: unary `-a` tests existence, but binary `-a` is logical AND (`[ expr1 -a expr2 ]`). `-e` is the unambiguous POSIX existence test. Replace all unary `-a` with `-e`.

**SC2332 — `[ ! -o opt ]` always true due to OR precedence (error)**
`[ ! -o braceexpand ]` parses as `[ "!" ] -o [ "braceexpand" ]` — two non-empty strings OR'd, always true. Fix with `[[ ! -o opt ]]` (where `-o` is a unary option test) or `! [ -o opt ]` (external negation).

**SC2164 — `cd` without error handling (warning)**
`cd dir` silently continues in the original directory when `dir` is missing. Under `set -e`, `cd` failure DOES trigger `errexit` — but compound commands (`cd dir && do_work`) mask this. Always use `cd dir || exit 1` for explicit intent, or `cd dir || die "..."` with the project's fatal-error function.

**SC2046 — Unquoted command substitution (warning)**
`$(cmd)` without quotes undergoes word splitting and globbing — same injection class as SC2086 but with the added risk that `cmd`'s output is attacker-influenced. Filenames with spaces, glob characters, or IFS-matching bytes cause silent data corruption.

---
## [3][SC_CODE_REFERENCE]
>**Dictum:** *Code familiarity accelerates fix identification.*

| [INDEX] | [CODE]     | [SEV] | [ISSUE]                          | [FIX]                                      |
| :-----: | ---------- | :---- | :------------------------------- | :----------------------------------------- |
|   [1]   | **SC2086** | info  | Unquoted variable                | `"${var}"`                                 |
|   [2]   | **SC2046** | warn  | Unquoted `$()`                   | `"$(cmd)"` or `mapfile -t arr < <(cmd)`    |
|   [3]   | **SC2155** | warn  | `local v=$(cmd)` masks `$?`      | `local v; v=$(cmd)`                        |
|   [4]   | **SC2164** | warn  | `cd` without guard               | `cd dir \|\| exit 1`                       |
|   [5]   | **SC2068** | error | Unquoted `$@`                    | `"$@"`                                     |
|   [6]   | **SC2329** | warn  | Unused function                  | Remove, call, or disable (dispatch-table)  |
|   [7]   | **SC2006** | style | Backticks                        | `$(cmd)`                                   |
|   [8]   | **SC2116** | style | Useless echo `$(echo $v)`        | `$v` directly                              |
|   [9]   | **SC2162** | info  | `read` without `-r`              | `IFS= read -r line`                        |
|  [10]   | **SC2181** | style | `cmd; if [ $? ]`                 | `cmd && action \|\| handle_error`          |
|  [11]   | **SC2327** | warn  | Capture + redirect clash         | Separate redirect from capture             |
|  [12]   | **SC2328** | warn  | Redirect steals from `$()`       | Restructure command                        |
|  [13]   | **SC2330** | warn  | BusyBox `[[ ]]` glob unsupported | `case "$v" in pat) ... esac`               |
|  [14]   | **SC2331** | warn  | Ambiguous `-a` file test         | `-e` (unambiguous existence)               |
|  [15]   | **SC2332** | error | `[ ! -o opt ]` always true       | `[[ ! -o opt ]]` or `! [ -o opt ]`         |
|  [16]   | **SC3010** | warn  | `[[ ]]` in sh script             | `[ ]` or fix shebang to `bash`             |
|  [17]   | **SC3030** | warn  | Arrays in sh script              | Fix shebang to `bash`                      |
|  [18]   | **SC3037** | warn  | `echo` flags in sh               | `printf` — paradigm requires it regardless |

---
## [4][SHELLCHECKRC]
>**Dictum:** *Project-level config enforces paradigm without per-file directives.*

```bash
# .shellcheckrc — paradigm-aligned defaults
shell=bash
# Enable optional checks that align with immutability/safety paradigm
enable=require-variable-braces
enable=add-default-case
enable=check-unassigned-uppercase
enable=avoid-nullary-conditions
# SC2329: dispatch-table functions are called via associative-array indirection;
# ShellCheck cannot trace "${_DISPATCH[$cmd]}" — suppress project-wide
disable=SC2329
```

**shellcheck.yml** (for CI matrix configuration):

```yaml
# .github/linters/.shellcheck.yml (alternative to .shellcheckrc for CI)
shell: bash
enable:
  - require-variable-braces
  - add-default-case
  - check-unassigned-uppercase
disable:
  - SC2329
severity: style
```

---
## [5][DIRECTIVES]
>**Dictum:** *Inline suppression requires justification — naked disables are defects.*

```bash
# Correct: justification explains WHY suppression is safe
# shellcheck disable=SC2086  # $flags intentionally word-split for multi-flag expansion
printf '%s\n' $flags
# Correct: dispatch-table function called via "${_DISPATCH[cmd]}"
# shellcheck disable=SC2329
_cmd_deploy() { ... }
# Correct: source path resolved at runtime from config
# shellcheck source=/dev/null
source "${_PLUGIN_DIR}/${plugin}.sh"
# Block suppression for controlled scope
# shellcheck disable=SC2086
{
    cmd $flag1 $flag2 $flag3
}
```

Directive reference:

| [DIRECTIVE]                                   | [PURPOSE]                    |
| :-------------------------------------------- | :--------------------------- |
| `# shellcheck disable=SC2086`                 | Suppress next command        |
| `# shellcheck disable=SC2086,SC2046`          | Multi-code, single directive |
| `# shellcheck shell=bash`                     | Override shebang detection   |
| `# shellcheck source=./lib.sh`                | Resolve dynamic source       |
| `# shellcheck source=/dev/null`               | Skip unresolvable source     |
| `# shellcheck enable=require-variable-braces` | Enable optional check inline |

---
## [6][IDIOMATIC_PATTERNS]
>**Dictum:** *Idiomatic patterns eliminate SC warnings at source.*

| [INDEX] | [PATTERN]                               | [ELIMINATES]           | [REPLACES]                 |
| :-----: | :-------------------------------------- | :--------------------- | :------------------------- |
|   [1]   | `mapfile -t arr < <(cmd)`               | SC2207 (unquoted arr)  | `arr=( $(cmd) )`           |
|   [2]   | `readarray -d '' -t f < <(fd --print0)` | SC2207, word splitting | `for f in $(find …)`       |
|   [3]   | `[[ -v MAP["$k"] ]]`                    | SC2086 in `[ ]`        | `[ -n "${MAP[$k]:-}" ]`    |
|   [4]   | `printf -v ts '%(%F)T' -1`              | SC2046 from `$(date)`  | `ts=$(date +%F)`           |
|   [5]   | `local v; v=$(cmd)`                     | SC2155 masked exit     | `local v=$(cmd)`           |
|   [6]   | `[[ "$v" =~ pat ]] && BASH_REMATCH[1]`  | SC2046 from grep       | `$(echo "$v" \| rg -oP …)` |

**Env contract validation** — declare-once, validate-all pattern from container entrypoints:

```bash
declare -Ar _ENV_CONTRACT=([SERVICE_NAME]='^[a-zA-Z][a-zA-Z0-9_-]+$' [SERVICE_CMD]='.+')
_validate_env() {
    local var pattern; for var in "${!_ENV_CONTRACT[@]}"; do
        pattern="${_ENV_CONTRACT[${var}]}"
        [[ -v "${var}" ]] || _die "Missing required env: ${var}"
        [[ "${!var}" =~ ${pattern} ]] || _die "Invalid ${var}='${!var}' (expected: ${pattern})"
    done
}
```
Eliminates per-variable `[[ -z ]]` chains. Contract is data (the map), not code. `${!var}` indirect expansion reads the variable named by `$var`. Regex in `_ENV_CONTRACT` values validates shape at the boundary.

**Embedded `--self-test` gate** — assert helpers for dispatch-table scripts:

```bash
_assert_eq()    { [[ "$1" == "$2" ]] || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${1}' != '${2}'"; }
_assert_match() { [[ "$1" =~ $2 ]]  || _die "ASSERT ${FUNCNAME[1]}:${BASH_LINENO[0]}: '${1}' !~ '${2}'"; }
```

Inline assertions with automatic caller location via `FUNCNAME[1]`/`BASH_LINENO[0]`. Use in `_self_test()` to validate dispatch table integrity, nameref output functions, and env contract parsing without external test frameworks.

---
## [7][STRICT_MODE_INTERACTIONS]
>**Dictum:** *Strict mode changes ShellCheck semantics — understand the interactions.*

`set -Eeuo pipefail` + `shopt -s inherit_errexit` creates constraints that ShellCheck assumes may not be active:

| [INTERACTION]            | [STRICT_MODE_BEHAVIOR]                          | [SC_IMPLICATION]                         |
| :----------------------- | :---------------------------------------------- | :--------------------------------------- |
| `local v=$(failing_cmd)` | `local` returns 0, masks failure — no `errexit` | SC2155 = silent-failure bug, not style   |
| `cd dir` no guard        | `errexit` fires in simple cmd; compound masks   | SC2164 still warranted                   |
| `cmd1 \| cmd2`           | `pipefail` exposes `cmd1` failure               | SC2312 (subshell exit) becomes relevant  |
| `$(cmd)` in `[[ ]]`      | `inherit_errexit` propagates into cmd sub       | Failures inside `[[ $(cmd) ]]` now fatal |
| `$@` unquoted + `set -u` | `set -u` catches unset but NOT empty `$@`       | SC2068 still required — `"$@"` always    |

---
## [8][CI_INTEGRATION]
>**Dictum:** *Automated gates prevent unchecked merges.*

```yaml
# .github/workflows/shell-quality.yml
name: Shell Quality Gate
on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Syntax check
        run: |
          find . -name '*.sh' -print0 | xargs -0 -n1 bash -n
      - uses: ludeeus/action-shellcheck@2.0.0
        with:
          severity: style
          shellcheck_version: v0.11.0
          scandir: '.'
          additional_files: '*.bash'
      - name: Install bats + kcov
        run: |
          sudo apt-get install -y kcov
          npm install -g bats bats-support bats-assert
      - name: Unit tests with coverage
        run: |
          kcov --include-path=. coverage/ bats tests/
      - name: Coverage gate
        run: |
          pct="$(jq -r '.percent_covered' coverage/bats/coverage.json)"
          awk -v p="${pct}" 'BEGIN { exit (p < 80) ? 1 : 0 }' || {
            printf 'Coverage %s%% below 80%% threshold\n' "${pct}" >&2
            exit 1
          }
```

ShellCheck exit codes:

| [CODE] | [MEANING]                    |
| :----: | :--------------------------- |
| **0**  | Clean                        |
| **1**  | Issues at/above severity     |
| **2**  | Parse errors                 |
| **3**  | Bad options or missing files |
