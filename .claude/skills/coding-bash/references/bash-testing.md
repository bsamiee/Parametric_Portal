# [H1][BASH-TESTING]
>**Dictum:** *Deterministic test infrastructure requires framework enforcement, filesystem sandboxing, and CI-owned quality gates.*

<br>

Production testing for Bash 5.2+/5.3. bats-core 1.13+, test isolation via subshell sandboxing, mocks via PATH manipulation, coverage via kcov 43+, CI with multi-shell container matrix, property-based fuzzing.

| [IDX] | [PATTERN]           |  [S]  | [USE_WHEN]                                    |
| :---: | :------------------ | :---: | :-------------------------------------------- |
|  [1]  | bats-core framework |  S1   | Every test suite — lifecycle, helpers, tags   |
|  [2]  | Test isolation      |  S2   | Side-effect-free — temp dirs, FD sandbox, env |
|  [3]  | Mock/stub patterns  |  S3   | External command interception, function stubs |
|  [4]  | Coverage/mutation   |  S4   | Quality gates — kcov, lcov, mutation sweep    |
|  [5]  | CI integration      |  S5   | GH Actions — lint, test matrix, coverage gate |
|  [6]  | Property-based      |  S6   | Input domain exploration, random generation   |
|  [7]  | Snapshot testing    |  S7   | Output baseline comparison, approval workflow |
|  [8]  | Contract testing    |  S8   | CLI exit codes, stdout schema, stderr rules   |
|  [9]  | ShellCheck 0.11.0   |  S9   | SC2327-SC2332 — new codes for test/prod code  |

---
## [1][BATS_CORE_FRAMEWORK]
>**Dictum:** *Lifecycle hooks, assertion libraries, tagging, and parallel execution compose the test harness.*

<br>

bats-core 1.13+: `setup_file`/`teardown_file` (suite fixtures), `bats_load_library` (dependency resolution), `bats::on_failure` (v1.12+ failure-only diagnostics), test tagging via `# bats test_tags=` with `--filter-tags` (v1.8+), `--negative-filter` (v1.13+), `--abort` (v1.13+ fail-fast — halts entire suite on first failure), JUnit/TAP13 formatters, `--jobs` parallel execution. Each `@test` runs in a subshell — variable mutations isolated by default. v1.13 fix: `run` now unsets `output`, `stderr`, `lines`, `stderr_lines` at invocation start — eliminates variable crosstalk between successive `run` calls within a test.

```bash
#!/usr/bin/env bats
# bats file_tags=component:deploy
bats_require_minimum_version 1.13.0
setup_file() {
    export TEST_FIXTURES="${BATS_FILE_TMPDIR}/fixtures"
    mkdir -p "${TEST_FIXTURES}"
    printf '{"env":"staging","replicas":3}\n' > "${TEST_FIXTURES}/config.json"
    export PROJECT_ROOT="${BATS_TEST_DIRNAME}/.."
}
setup() {
    bats_load_library bats-support
    bats_load_library bats-assert
    bats_load_library bats-file
    source "${PROJECT_ROOT}/lib/deploy.sh"
}
bats::on_failure() {
    printf 'FAILED: %s (status=%d)\n' "${BATS_TEST_NAME}" "${status:-?}" >&2
}

# --- Dispatch-table parameterized tests
declare -Ar _VALIDATION_CASES=(
    [zero_replicas]="validate_replicas 0|1|must be positive"
    [negative]="validate_replicas -5|1|must be positive"
    [string]="validate_replicas abc|2|not a number"
    [valid]="validate_replicas 3|0|"
)
# [PARADIGM:guard] — bats parameterization requires iteration for dynamic test generation
_run_validation_case() {
    local -r spec="${_VALIDATION_CASES[${1}]}"
    local -r cmd="${spec%%|*}" remainder="${spec#*|}"
    local -r expected_rc="${remainder%%|*}" pattern="${remainder#*|}"
    # shellcheck disable=SC2086 # intentional word splitting on cmd
    run ${cmd}
    assert_equal "${status}" "${expected_rc}"
    [[ -z "${pattern}" ]] || assert_output --partial "${pattern}"
}
# bats test_tags=unit:validation
@test "validate_replicas: zero rejected" { _run_validation_case zero_replicas; }
# bats test_tags=unit:validation
@test "validate_replicas: negative rejected" { _run_validation_case negative; }
# bats test_tags=unit:validation
@test "validate_replicas: string rejected" { _run_validation_case string; }
# bats test_tags=unit:validation
@test "validate_replicas: positive accepted" { _run_validation_case valid; }
```

### [1.1][HELPERS_TAGS_CONFIG]

| [LIBRARY]      | [KEY_ASSERTIONS]                                                                                                                                                                    |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bats-support` | `fail`, `bats_require_minimum_version`                                                                                                                                              |
| `bats-assert`  | `assert_success`, `assert_failure`, `assert_output`, `assert_line/regex`, `assert_stderr`/`refute_stderr`, `assert_stderr_line`/`refute_stderr_line`, `assert_regex`/`refute_regex` |
| `bats-file`    | `assert_file_exist`, `assert_dir_exist`, `assert_file_contains`                                                                                                                     |
| `bats-detik`   | k8s resource assertions (kubectl wait)                                                                                                                                              |

BREAKING (bats-assert): `assert_output`/`refute_output` without args no longer reads stdin — requires `-` or `--stdin`.

```bash
# tests/.bats — runtime configuration
--recursive
--jobs 4
--formatter pretty
--report-formatter junit --output tests/reports/
--timing
--print-output-on-failure
--no-parallelize-within-files
```

Tags: `# bats file_tags=` applies to all tests in file; `# bats test_tags=` applies to next `@test`. Tags compose (merge). `bats:focus` forces exclusive execution + exit 1 — prevents committing focused subsets. `--no-parallelize-within-files` keeps tests sequential within each file while parallelizing across files.

```bash
bats --filter-tags integration,!slow tests/         # include/exclude by tag
bats --negative-filter "legacy_" tests/              # exclude by name (v1.13+)
bats --abort tests/                                  # halt suite on first failure (v1.13+)
```

---
## [2][TEST_ISOLATION]
>**Dictum:** *Sandboxed filesystem, restricted PATH, and controlled env prevent cross-test contamination.*

<br>

`BATS_TEST_TMPDIR` (per-test, auto-cleaned) is the primary isolation mechanism. `BATS_FILE_TMPDIR` persists across tests in a file for expensive fixtures. PATH restriction prevents non-deterministic system commands.

```bash
_sandbox_env() {
    local -n _sb_ref=$1
    _sb_ref[HOME]="${BATS_TEST_TMPDIR}/home"
    _sb_ref[XDG_CONFIG_HOME]="${_sb_ref[HOME]}/.config"
    _sb_ref[XDG_DATA_HOME]="${_sb_ref[HOME]}/.local/share"
    mkdir -p "${_sb_ref[XDG_CONFIG_HOME]}" "${_sb_ref[XDG_DATA_HOME]}"
}
setup() {
    bats_load_library bats-support
    bats_load_library bats-assert
    # bats-core 1.12+: per-test hang prevention
    export BATS_TEST_TIMEOUT=30
    declare -A env_overrides=()
    _sandbox_env env_overrides
    local key; for key in "${!env_overrides[@]}"; do
        export "${key}=${env_overrides[${key}]}"
    done
    export ORIGINAL_PATH="${PATH}"
    export PATH="/usr/bin:/bin:${BATS_TEST_DIRNAME}/mocks"
}
teardown() { export PATH="${ORIGINAL_PATH}"; }
_make_project_fixture() {
    local -r root="${1:?root required}"; local -n _files=$2
    mkdir -p "${root}"/{src,tests,config}
    printf 'key=value\n' > "${root}/config/app.conf"
    printf '#!/usr/bin/env bash\nprintf "hello"\n' > "${root}/src/main.sh"
    chmod +x "${root}/src/main.sh"
    _files=("${root}/config/app.conf" "${root}/src/main.sh")
}
```

### [2.1][ADVANCED_ISOLATION]

```bash
# faketime: deterministic time-dependent tests (requires libfaketime)
@test "log rotation triggers at midnight" {
    LD_PRELOAD=/usr/lib/faketime/libfaketime.so.1 \
        FAKETIME="2025-01-01 00:00:00" \
        run check_rotation
    assert_success
    assert_output --partial "rotating"
}
# unshare --net: network namespace isolation (Linux only, requires CAP_SYS_ADMIN or unprivileged userns)
# prevents integration tests from hitting real endpoints
@test "service handles network unreachable" {
    [[ "$(uname -s)" == "Linux" ]] || skip "unshare requires Linux"
    run unshare --net -- bash -c 'source lib/client.sh; fetch_data "http://api.local/v1"'
    assert_failure
    assert_output --partial "unreachable"
}
# Signal testing: verify graceful shutdown
@test "service exits 143 on SIGTERM" {
    bash lib/service.sh &
    local -r pid=$!
    sleep 0.1
    kill -TERM "${pid}"
    wait "${pid}" && local -ri rc=$? || local -ri rc=$?
    (( rc == 143 )) || fail "Expected exit 143 (128+SIGTERM), got ${rc}"
}
# bats test_tags=flaky,integration:network
@test "upstream healthcheck recovers after transient failure" {
    # bats-core 1.12+: retry known-flaky integration tests before marking failure
    export BATS_TEST_RETRIES=2
    run check_upstream_health "https://api.internal/healthz"
    assert_success
}
```

---
## [3][MOCK_AND_STUB_PATTERNS]
>**Dictum:** *PATH-based mocks intercept external commands without modifying the code under test.*

<br>

Preference order: (1) function override — subshell-isolated by bats, (2) PATH mock — shadows system command via `tests/mocks/`, (3) stub file — controlled data dependency. Function overrides are zero-setup; PATH mocks required when code uses `command`, `env`, or absolute path.

```bash
# Uses printf %q for safe quoting — handles responses containing single quotes, newlines
_mock_with_recording() {
    local -r fn_name="$1" response="$2" rc="${3:-0}"; local -n _log=$4
    local -r safe_response="$(printf '%q' "${response}")"
    eval "${fn_name}() { _log+=(\"\$*\"); printf '%s\n' ${safe_response}; return ${rc}; }"
    export -f "${fn_name}"
}
@test "deploy calls API with correct endpoint" {
    local -a curl_calls=()
    _mock_with_recording curl '{"status":"ok"}' 0 curl_calls
    run deploy "production"
    assert_success
    [[ "${curl_calls[0]}" == *"api.example.com/deploy"* ]]
}

# PATH mock — tests/mocks/docker (chmod +x)
# Dispatch table routes subcommand behavior, logs all invocations to $MOCK_LOG
# #!/usr/bin/env bash
# set -Eeuo pipefail
# declare -Ar _MOCK_RESPONSES=([build]='sha256:abc' [push]='latest: digest: sha256:abc')
# printf '%s\n' "$*" >> "${MOCK_LOG:?MOCK_LOG required}"
# [[ -v "_MOCK_RESPONSES[$1]" ]] || { printf 'mock: unhandled: %s\n' "$*" >&2; exit 1; }
# printf '%s\n' "${_MOCK_RESPONSES[$1]}"

_assert_call_count() {
    local -r log="$1" pattern="$2" expected="$3"
    local -r actual="$(awk -v p="${pattern}" '$0 ~ p {c++} END {printf "%d", c+0}' "${log}")"
    (( actual == expected )) || {
        printf 'Expected %d calls matching "%s", got %d\n' "${expected}" "${pattern}" "${actual}" >&2
        return 1
    }
}
```

`export -f` propagates function overrides into child processes. Mock scripts must reject unrecognized arguments with `exit 1` — silent acceptance masks bugs. `printf '%q'` safely quotes responses containing single quotes, newlines, or special characters for use in `eval`-constructed function bodies.

### [3.1][PLAN_BASED_MOCKS]

`buildkite-plugins/bats-mock` provides `stub`/`unstub` with plan-based call expectations — verifies both behavior and call sequence on `unstub`.

```bash
# bats-mock: plan declares expected calls in order; unstub asserts plan fulfilled
@test "deploy_container builds then pushes" {
    stub docker \
        "build * : echo 'sha256:abc'" \
        "push * : echo 'pushed'"
    run deploy_container "myapp"
    assert_success
    unstub docker
}
```

Embedded `--self-test` assertion primitives (`_assert_eq`, `_assert_match`, `_assert_set`) owned by script-patterns.md S10.

---
## [4][COVERAGE_AND_MUTATION]
>**Dictum:** *kcov instruments execution breadth; mutation sweeps measure assertion kill rate.*

<br>

kcov 43+ instruments bash via `PS4` + `BASH_XTRACEFD` — zero source modification. `--include-path=./lib` restricts to production code. `--bash-dont-parse-binary-dir` prevents instrumenting non-bash executables. `--bash-parse-files-in-dir` tracks indirectly sourced files. v43: `--dump-summary` emits JSON coverage to stdout — machine-readable for CI gating without parsing HTML/Cobertura.

```bash
kcov --include-path=./lib \
     --exclude-pattern=tests/,node_modules/ \
     --bash-dont-parse-binary-dir \
     --bash-parse-files-in-dir=./lib \
     coverage/ \
     bats tests/
_check_coverage() {
    local -r report="$1" threshold="${2:-80}"
    local -r pct="$(jq -r '.percent_covered // empty' "${report}/kcov-result.json" 2>/dev/null)"
    [[ -n "${pct}" ]] || { printf 'Coverage report not found\n' >&2; return 1; }
    (( ${pct%.*} >= threshold )) || {
        printf 'Coverage %s%% below threshold %s%%\n' "${pct}" "${threshold}" >&2; return 1
    }
}
# Merge parallel runs: kcov --merge coverage/merged/ coverage/run-1/ coverage/run-2/
# CI gate via --dump-summary (v43+): JSON to stdout, no report parsing
# kcov --dump-summary coverage/ | jq -r '.percent_covered' | { read -r pct; (( ${pct%.*} >= 80 )); }
```

### [4.1][MUTATION_TESTING]

```bash
# Automated mutation: flip operator, run suite, check if tests catch it
# Every surviving mutant is an assertion gap
_mutate_operators() {
    local -r file="$1" backup="${1}.bak"
    cp "${file}" "${backup}"
    sd '&&' '||' "${file}"
    bats tests/ && {
        printf 'MUTANT SURVIVED: &&->|| in %s\n' "${file}" >&2
        cp "${backup}" "${file}"
        return 1
    }
    cp "${backup}" "${file}"
}
# [PARADIGM:guard] — iteration required; no higher-order combinator exists for mutation sweep
_mutation_sweep() {
    local -r target="$1"
    local -ra mutations=('&&:||' '||:&&' '-eq:-ne' '-gt:-lt' '>=:<=')
    local -i survived=0 killed=0
    local mut; for mut in "${mutations[@]}"; do
        local -r from="${mut%%:*}" to="${mut#*:}"
        cp "${target}" "${target}.bak"
        sd "${from}" "${to}" "${target}"
        bats tests/ 2>/dev/null && (( survived++ )) || (( killed++ ))
        cp "${target}.bak" "${target}"
    done
    printf 'Mutation score: %d/%d killed (%d%% kill rate)\n' \
        "${killed}" "$(( killed + survived ))" "$(( killed * 100 / (killed + survived) ))"
}
```

---
## [5][CI_INTEGRATION]
>**Dictum:** *CI pipeline is the canonical quality gate — lint, container matrix, coverage threshold, artifact upload.*

<br>

CI pipeline owned by bash-testing.md. validation.md cross-references for ShellCheck-specific diagnostic codes. `koalaman/shellcheck-action@v2` (maintained by ShellCheck author). Container matrix references bash-portability.md S5.1 image selection.

```yaml
# .github/workflows/shell-tests.yml — canonical pipeline: lint -> test (container matrix) -> coverage
name: Shell Tests
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: koalaman/shellcheck-action@v2
        with: { scandir: ./lib, severity: warning }
  test:
    needs: lint
    strategy:
      matrix:
        include:
          - { os: ubuntu-latest, bash: '5.2', container: '' }
          - { os: ubuntu-latest, bash: '5.2', container: 'alpine:3.21' }
          - { os: ubuntu-latest, bash: '5.2', container: 'cgr.dev/chainguard/wolfi-base:latest' }
          - { os: macos-latest, bash: '5.3', container: '' }
      fail-fast: false
    runs-on: ${{ matrix.os }}
    container: ${{ matrix.container || null }}
    steps:
      - uses: actions/checkout@v4
      - if: matrix.container == 'alpine:3.21'
        run: apk add --no-cache bash>=5.2 curl git
      - uses: bats-core/bats-action@4.0.0
        with: { support-install: true, assert-install: true, file-install: true, detik-install: false }
      - run: bats --recursive --jobs 2 --timing --print-output-on-failure --formatter pretty --report-formatter junit --output tests/reports/ tests/
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: 'test-results-${{ matrix.os }}-${{ matrix.bash }}-${{ matrix.container || "native" }}', path: tests/reports/ }
  coverage:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bats-core/bats-action@4.0.0
        with: { support-install: true, assert-install: true, file-install: true }
      - run: sudo apt-get install -y kcov
      - run: kcov --include-path=./lib --bash-dont-parse-binary-dir coverage/ bats tests/
      - run: |
          pct=$(jq -r '.percent_covered' coverage/bats/kcov-result.json)
          (( ${pct%.*} >= 80 )) || { echo "Coverage ${pct}% below 80%" >&2; exit 1; }
      - uses: actions/upload-artifact@v4
        with: { name: coverage-report, path: coverage/ }
```

### [5.1][CONTAINERIZED_TESTING]

`bats/bats` Docker image (Alpine-based, 5M+ pulls) bundles `bats-support` and `bats-assert` — `bats_load_library` resolves them without installation. Mount scripts read-only to prevent test pollution.

```bash
# Local: run tests in containerized bats with bundled helpers
docker run --rm -v "${PWD}/lib:/code/lib:ro" -v "${PWD}/tests:/code/tests:ro" \
    bats/bats:latest --jobs 4 --timing /code/tests

# Extended image for additional deps (jq, curl, etc.)
# FROM bats/bats:latest
# RUN apk --no-cache add jq curl
```

```yaml
# docker-compose.test.yml — CI-local parity
services:
  tests:
    image: bats/bats:latest
    volumes: ['./lib:/code/lib:ro', './tests:/code/tests:ro']
    command: ['--formatter', 'junit', '--output', '/code/tests/reports/', '/code/tests']
```

---
## [6][PROPERTY_BASED_PATTERNS]
>**Dictum:** *Constrained random generation over input domains verifies invariants that example-based tests structurally cannot.*

<br>

No mature property-based testing framework exists for bash. Pattern: generate random inputs from constrained domains, verify invariants (not specific outputs). `SRANDOM` for uniform 32-bit numeric domains; `/dev/urandom` for byte-stream domains.

```bash
_gen_string() {
    local -r len="${1:-16}" charset="${2:-A-Za-z0-9}"
    tr -dc "${charset}" < /dev/urandom | head -c "${len}"
}
_gen_int() {
    local -r min="${1:-0}" max="${2:-1000}"
    printf '%d' $(( SRANDOM % (max - min + 1) + min ))
}
_gen_config() {
    local -n _cfg=$1
    _cfg[env]="$(_gen_string 8 'a-z')"
    _cfg[replicas]="$(_gen_int 1 20)"
    _cfg[port]="$(_gen_int 1024 65535)"
    _cfg[region]="$(_gen_string 5 'a-z')-$(_gen_int 1 9)"
}
# [PARADIGM:guard] — iteration required; no higher-order combinator exists in bash
_prop_test() {
    local -r name="$1" iterations="${2:-100}"; shift 2
    # seed is triage marker, not replay seed — SRANDOM reseeds per generator call
    local -r seed="${SRANDOM}"
    local -i i; for (( i = 0; i < iterations; i++ )); do
        "$@" || {
            printf 'PROPERTY VIOLATION: %s (iteration %d/%d, seed=%d — non-deterministic, for triage only)\n' \
                "${name}" "${i}" "${iterations}" "${seed}" >&2
            return 1
        }
    done
    printf 'PROPERTY OK: %s (%d iterations, seed=%d — non-deterministic, for triage only)\n' \
        "${name}" "${iterations}" "${seed}"
}
# bats test_tags=property:codec
@test "base64 roundtrip preserves arbitrary printable data" {
    _check_roundtrip() {
        local -r original="$(_gen_string "$(_gen_int 1 256)" '[:print:]')"
        local -r decoded="$(printf '%s' "${original}" | base64 | base64 -d)"
        [[ "${original}" == "${decoded}" ]]
    }
    run _prop_test "base64_roundtrip" 50 _check_roundtrip
    assert_success
}
# bats test_tags=property:idempotent
@test "normalize_config is idempotent" {
    _check_idempotent() {
        local -A cfg=()
        _gen_config cfg
        local -r input="${cfg[env]}:${cfg[replicas]}:${cfg[port]}"
        local -r once="$(printf '%s' "${input}" | normalize_config)"
        local -r twice="$(printf '%s' "${once}" | normalize_config)"
        [[ "${once}" == "${twice}" ]]
    }
    run _prop_test "normalize_idempotent" 30 _check_idempotent
    assert_success
}
```

Shrinking on violation: binary-search input size `[lo=1, hi=failing_size]` to find minimal reproducing case.

### [6.1][HYPOTHESIS_PBT]

Python Hypothesis provides structured shrinking, replay databases, and rich strategies unavailable in pure bash. Pattern: Hypothesis generates inputs, `subprocess.run` invokes the script under test, assertions verify algebraic properties. Pass data via stdin — never interpolate into shell strings (injection). Set `timeout=` on every subprocess call.

```python
# test_sort_pbt.py — sort idempotency via Hypothesis
import subprocess
from hypothesis import given, settings, assume
from hypothesis import strategies as st

def run_bash(script: str, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", script], input=stdin,
        capture_output=True, text=True, timeout=5,
    )

@given(items=st.lists(st.integers(min_value=0, max_value=999), min_size=1, max_size=50))
@settings(max_examples=200)
def test_sort_idempotent(items: list[int]):
    """Property: sort(sort(X)) === sort(X) — idempotency."""
    stdin = "\n".join(str(i) for i in items)
    once = run_bash("sort -n", stdin=stdin)
    twice = run_bash("sort -n", stdin=once.stdout)
    assert once.stdout == twice.stdout

@given(line=st.from_regex(r"[a-zA-Z0-9_.@-]{1,100}", fullmatch=True))
@settings(max_examples=300)
def test_normalize_lowercase(line: str):
    """Property: normalize output is always lowercase — closure under transform."""
    result = run_bash("bash scripts/normalize.sh", stdin=line)
    assert result.returncode == 0
    assert result.stdout.strip() == result.stdout.strip().lower()
```

Constraints: `assume("\x00" not in value)` — bash variables cannot hold NUL bytes. Assert properties (idempotency, commutativity, roundtrip identity, monotonicity), never exact output. Hypothesis shrinks failing cases automatically — no manual binary search needed.

---
## [7][SNAPSHOT_TESTING]
>**Dictum:** *Snapshot baselines detect output regressions that assertion-based tests miss through structural blindness.*

<br>

```bash
_snapshot_dir="${BATS_TEST_DIRNAME}/snapshots"

_assert_snapshot() {
    local -r name="$1" actual="$2"
    local -r snapshot="${_snapshot_dir}/${name}.expected"
    # first run: create baseline and skip — forces explicit approval
    [[ -f "${snapshot}" ]] || { printf '%s' "${actual}" > "${snapshot}"; skip "Snapshot created: ${name}"; }
    local -r expected="$(<"${snapshot}")"
    [[ "${actual}" == "${expected}" ]] || {
        diff <(printf '%s\n' "${expected}") <(printf '%s\n' "${actual}") >&2
        fail "Snapshot mismatch: ${name} (update with BATS_UPDATE_SNAPSHOTS=1)"
    }
}
# bats test_tags=snapshot:cli
@test "deploy --help output matches snapshot" {
    run deploy --help
    assert_success
    [[ -n "${BATS_UPDATE_SNAPSHOTS:-}" ]] && { printf '%s' "${output}" > "${_snapshot_dir}/deploy-help.expected"; }
    _assert_snapshot "deploy-help" "${output}"
}
```

---
## [8][CONTRACT_TESTING]
>**Dictum:** *CLI contracts — exit codes, stdout schema, stderr conventions — are the public API surface of shell tools.*

<br>

```bash
_assert_cli_contract() {
    local -r cmd="$1" expected_rc="$2"; shift 2
    # shellcheck disable=SC2086 # intentional word splitting
    run ${cmd}
    assert_equal "${status}" "${expected_rc}"
    # stdout must be valid JSON when rc=0
    (( expected_rc == 0 )) && {
        printf '%s' "${output}" | jq empty 2>/dev/null || fail "stdout not valid JSON"
    }
    # stderr must be empty on success — noisy success output violates Unix convention
    (( expected_rc == 0 )) && {
        [[ -z "${stderr:-}" ]] || fail "stderr non-empty on success: ${stderr}"
    }
}
# bats test_tags=contract:cli
@test "deploy info returns valid JSON" {
    _assert_cli_contract "deploy info" 0
}
# bats test_tags=contract:cli
@test "deploy bad-command exits 2 (usage error)" {
    _assert_cli_contract "deploy bad-command" 2
}
```

---
## [9][SHELLCHECK_0_11_0]
>**Dictum:** *New SC codes in 0.11.0 target substitution/redirect confusion, dead functions, and portability traps.*

<br>

Full ShellCheck reference in validation.md S3. Test-relevant codes from 0.11.0 below — each surfaces in test infrastructure or scripts under test.

| [CODE]     | [SEV] | [ISSUE]                          | [VIOLATION]                            | [FIX]                                     |
| ---------- | :---: | :------------------------------- | :------------------------------------- | :---------------------------------------- |
| **SC2327** | warn  | Capture + redirect clash         | `v=$(cmd > out.txt)` — `$v` is empty   | `v=$(cmd \| tee out.txt)` or separate ops |
| **SC2328** | warn  | Redirect steals from `$()`       | `v=$(tr -d ':' < in > out)` — empty    | `v=$(tr -d ':' < in)` or redirect only    |
| **SC2329** | warn  | Function never invoked           | Defined `f()` but never called in file | Call, remove, or disable (dispatch-table) |
| **SC2330** | warn  | BusyBox `[[ ]]` glob unsupported | `[[ $1 == https:* ]]` in busybox sh    | `case "$1" in https:*) ... esac`          |
| **SC2331** | warn  | `-a` file test ambiguous         | `[ -a ~/.bashrc ]` — `-a` is also AND  | `[ -e ~/.bashrc ]` — unambiguous          |
| **SC2332** | error | `[ ! -o opt ]` always true       | OR precedence: `[ "!" ] -o [ "opt" ]`  | `[[ ! -o opt ]]` or `! [ -o opt ]`        |

SC2329 false-positives: dispatch-table functions called via `"${_DISPATCH[$cmd]}"` — ShellCheck cannot trace associative-array indirection. Suppress with `# shellcheck disable=SC2329` and justification comment.

---
## [RULES]

- bats-core 1.13+ exclusively — NEVER shunit2 or shellspec.
- `bats_require_minimum_version 1.13.0` at top of every `.bats` file.
- `# bats file_tags=` for component classification; `# bats test_tags=` per-test. `bats:focus` for local debugging only.
- `bats::on_failure` (v1.12+) for diagnostic capture — runs only on failure, before teardown.
- `run` (v1.13+) unsets `output`/`stderr`/`lines`/`stderr_lines` at invocation — no variable crosstalk between assertions.
- `BATS_TEST_TMPDIR` for per-test filesystem isolation — NEVER write to fixed paths.
- `bats_load_library` for helper resolution — NEVER `source` with hardcoded paths.
- Function override as primary mock strategy; PATH mocks for `command`/`env`/absolute-path invocations.
- kcov 43+ with `--include-path` restricting to production code — NEVER instrument test helpers. `--dump-summary` (v43+) for CI gating.
- 80% line coverage threshold as CI gate. `kcov --merge` for multi-suite aggregation.
- `bats-core/bats-action@4.0.0` for CI setup. `--jobs N` for file-level parallelism.
- `--filter-tags` for selective execution; `--negative-filter` (v1.13+) for name-based exclusion; `--abort` (v1.13+) for fail-fast.
- `bats/bats` Docker image for containerized testing — `bats_load_library` resolves bundled `bats-support`/`bats-assert`.
- Property tests via `_prop_test` with SRANDOM generators — seed is triage marker only, not deterministic replay.
- Hypothesis PBT (Python) for structured shrinking and algebraic property verification — pass data via stdin, timeout on subprocess.
- Embedded `--self-test`: assertion primitives owned by script-patterns.md S10 — cross-reference, do not duplicate.
- ShellCheck 0.11.0: SC2327-SC2332 codes — validation.md S3 for full reference, S9 above for test-relevant subset.
- CI pipeline owned by bash-testing.md S5 — validation.md cross-references for ShellCheck diagnostic codes.
- Container test matrix references bash-portability.md S5.1 image selection (Alpine ash, Wolfi bash, native).
- Multi-shell validation: probe `_has_pipefail` (bash-portability.md S2.1) when testing POSIX compatibility.
- Mutation sweep via `_mutation_sweep` — every surviving mutant is an assertion gap requiring investigation.
- Snapshot baselines stored in `tests/snapshots/` — `BATS_UPDATE_SNAPSHOTS=1` for refresh workflow.
