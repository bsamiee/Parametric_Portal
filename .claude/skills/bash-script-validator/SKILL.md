---
name: bash-script-validator
description: Validates bash/shell scripts for syntax, static analysis (ShellCheck 0.11.0+), security, performance, and portability. Use when working with .sh/.bash files, checking ShellCheck codes, or debugging shell issues.
---

# Bash Script Validator

## Workflow

1. Run: `bash scripts/validate.sh <script-path>`
2. Review errors/warnings/info from output
3. Reference docs/ for fix patterns:
   - `docs/shell-reference.md` -- bash vs POSIX sh, parameter expansion, common mistakes
   - `docs/text-tools.md` -- grep/sed/awk/regex quick reference
   - `docs/shellcheck-reference.md` -- SC codes with severity, directives, CI integration (ShellCheck 0.11.0+)
4. Suggest fixes with before/after + line numbers

## Validation Layers

| Layer | Check | Tool |
|-------|-------|------|
| Syntax | `bash -n` / `sh -n` | Built-in |
| Static analysis | SC codes, 4 severity levels (SC2327-SC2335 in v0.11.0) | ShellCheck 0.11.0+ |
| Security | eval injection, unsafe rm -rf, pipe-to-shell, dynamic source | Structured check tables (`_SECURITY_CHECKS`) |
| Performance | UUOC, `$(cat file)` -> `$(<file)` | Structured check tables (`_PERF_CHECKS`) |
| Portability | Bashisms in sh scripts (`[[`, arrays, `function`, `source`) | Structured check tables (`_SH_BASHISM_CHECKS`) |
| Best practice | printf over echo, `$(<file)` over `$(cat)`, `[[ ]]` over `[ ]` | Structured check tables (`_PRACTICE_CHECKS`) |

### Data-Driven Check Architecture

Custom checks use associative array tables with `"pattern|message|level"` format and a generic runner via nameref:

```bash
declare -Ar _SECURITY_CHECKS=([eval]='eval[[:space:]]+.*\$|Potential command injection|_warn' ...)
_run_check_set() { local -n _checks=$1; for key in "${!_checks[@]}"; do IFS='|' read -r pat msg fn <<< "${_checks[${key}]}"; ...; done; }
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Clean |
| 1 | Warnings only |
| 2 | Errors found |

## File Map

| File | Purpose |
|------|---------|
| `scripts/validate.sh` | Main validator (shebang detection, associative array counters, `printf` output) |
| `scripts/shellcheck_wrapper.sh` | Auto-installs shellcheck-py via cached venv if system binary missing |
| `docs/shell-reference.md` | Bash vs POSIX sh, parameter expansion, common mistakes |
| `docs/text-tools.md` | grep/sed/awk/regex unified reference |
| `docs/shellcheck-reference.md` | SC codes with severity, directives, .shellcheckrc, CI (v0.11.0+) |
| `examples/good.sh` | Best practices (bash + POSIX) |
| `examples/bad.sh` | Anti-patterns (bash + POSIX) |
