# [H1][BASH-PORTABILITY]
>**Dictum:** *Capability probing at runtime eliminates the false choice between features and portability.*

Cross-platform shell compatibility for Bash 5.2+/5.3, zsh, dash, and container-minimal shells. Platform detection, GNU/BSD coreutil divergence, capability probing, container environments, POSIX 2024 adoption reality.

| [INDEX] | [PATTERN]               |  [S]  | [USE_WHEN]                                                |
| :-----: | :---------------------- | :---: | :-------------------------------------------------------- |
|   [1]   | Shebang + macOS re-exec |  S1   | Entry point — env resolution, Homebrew fallback           |
|   [2]   | Shell compat matrix     |  S2   | Feature selection — bash/zsh/dash/ash semantic divergence |
|   [3]   | Coreutil divergence     |  S3   | Cross-platform — GNU vs BSD flag differences              |
|   [4]   | Platform dispatch       |  S4   | Runtime binding — OS-keyed function resolution            |
|   [5]   | Container environments  |  S5   | Alpine, Wolfi, distroless — PID 1 + image selection       |
|   [6]   | Signal/trap portability |  S6   | Cross-shell trap semantics — EXIT, ERR, subshell          |

---
## [1][SHEBANG_AND_MACOS_REEXEC]
>**Dictum:** *The shebang determines which interpreter runs the script — misconfiguration silently alters semantics.*

<br>

| [INDEX] | [SHEBANG]             | [USE_WHEN]                          |
| :-----: | :-------------------- | :---------------------------------- |
|   [1]   | `#!/usr/bin/env bash` | Default — portable across OSes      |
|   [2]   | `#!/bin/bash`         | Security policy mandates abs paths  |
|   [3]   | `#!/bin/sh`           | POSIX-only, system init, containers |

`env -S` (GNU coreutils 8.30+) supports flag passthrough — macOS and busybox `env` lack it entirely. Avoid in cross-platform shebangs; handle flags in the script body.

```bash
# macOS: /bin/bash is 3.2.57 permanently (Apple GPLv3 refusal)
# Homebrew: /opt/homebrew/bin/bash (ARM) | /usr/local/bin/bash (Intel)
# Version gate pattern owned by version-features.md — use _BASH_V from there
(( _BASH_V >= 502 )) || {
    declare -ar _BREW=("/opt/homebrew/bin/bash" "/usr/local/bin/bash")
    local _p; for _p in "${_BREW[@]}"; do
        [[ -x "${_p}" ]] && exec "${_p}" "$0" "$@"
    done
    printf 'Requires bash 5.2+, found %s\n' "${BASH_VERSION}" >&2; exit 1
}
```

---
## [2][SHELL_COMPATIBILITY_MATRIX]
>**Dictum:** *Feature availability determines which shell features are safe to use in a given deployment context.*

Cross-shell semantic divergences — not feature presence but behavioral differences that cause silent bugs:

| [INDEX] | [FEATURE]            | [BASH_5.2+]        | [ZSH_5.9+]            | [DASH/ASH]         |
| :-----: | :------------------- | :----------------- | :-------------------- | :----------------- |
|   [1]   | Array indexing       | 0-indexed          | **1-indexed** default | No arrays          |
|   [2]   | `local -n` (nameref) | Yes                | No                    | No                 |
|   [3]   | `${var,,}` case fold | Yes                | `${(L)var}` (differ)  | No                 |
|   [4]   | `[[ ]]` conditionals | Yes                | Yes (subtly differs)  | No — `[ ]` only    |
|   [5]   | Process substitution | `<(cmd)`           | `<(cmd)` (compat)     | No                 |
|   [6]   | `set -o pipefail`    | Yes                | Yes                   | **Not yet** (dash) |
|   [7]   | Here-strings `<<<`   | Yes                | Yes                   | No                 |
|   [8]   | `$BASH_SOURCE`       | Yes                | `$0` (differs)        | `$0` (differs)     |
|   [9]   | Brace expansion      | `{a,b}`, `{1..10}` | Yes                   | No                 |
|  [10]   | `shopt` / `setopt`   | `shopt`            | `setopt` (differ)     | No                 |
|  [11]   | `coproc`             | 4.0+ (not POSIX)   | `coproc` (differ)     | No — `mkfifo`      |
|  [12]   | `${ cmd; }` (nofork) | **5.3+ only**      | No                    | No                 |
|  [13]   | `GLOBSORT`           | **5.3+ only**      | No                    | No — alpha default |

Decision rule: dash/ash restricts to POSIX `[ ]`, no arrays, no namerefs, no here-strings. Bash 5.2+ means full feature set. zsh requires testing — array indexing, `$0`, option names diverge silently. `${ cmd; }` and `GLOBSORT` are 5.3-only — gate with `(( _BASH_V >= 503 ))`. `coproc` is 4.0+ only, not POSIX — use `mkfifo` for portable bidirectional IPC.

### [2.1][POSIX_2024_ISSUE_8]

IEEE 1003.1-2024 standardized `pipefail`, `sed -E`, `realpath`, `readlink`, `printf` numbered args (`%2$s%1$s`), `rm -d`. Explicitly **deferred**: `local` (reserved identifier, not standardized). `find -print0` / `xargs -0` remain non-standard.

Adoption bottleneck: dash (Debian/Ubuntu `/bin/sh`) has not shipped `pipefail`. Until dash implements Issue 8, `set -o pipefail` in `#!/bin/sh` scripts breaks on the most common container base images. Gate on runtime probe, not spec publication:

```bash
_has_pipefail() { (set -o pipefail 2>/dev/null); }
```

---
## [3][COREUTIL_DIVERGENCE]
>**Dictum:** *GNU and BSD coreutils share command names but diverge on flags — untested cross-platform scripts fail silently.*

| [INDEX] | [CMD]      | [GNU]                      | [BSD_(macOS)]                   | [PORTABLE]                             |
| :-----: | :--------- | :------------------------- | :------------------------------ | :------------------------------------- |
|   [1]   | `date`     | `date -d "2024-01-01" +%s` | `date -jf "%Y-%m-%d" "..." +%s` | `EPOCHSECONDS` / `printf '%(%s)T'`     |
|   [2]   | `sed -i`   | `sed -i 's/a/b/' f`        | `sed -i '' 's/a/b/' f`          | `sd` or temp+mv                        |
|   [3]   | `stat`     | `stat -c '%s' f`           | `stat -f '%z' f`                | `wc -c < f`                            |
|   [4]   | `readlink` | `readlink -f path`         | `readlink path` (no `-f`)       | `realpath` (POSIX 2024) or `cd+pwd -P` |
|   [5]   | `mktemp`   | `mktemp -d -t pfx.XXXXXX`  | `mktemp -d -t pfx`              | `mktemp -d "${TMPDIR:-/tmp}/p.XXXXXX"` |
|   [6]   | `sort -V`  | Version sort               | N/A                             | `sort -t. -k1,1n -k2,2n -k3,3n`        |
|   [7]   | `grep -P`  | PCRE2                      | N/A                             | `rg` or `grep -E`                      |
|   [8]   | `base64`   | `base64 -w 0`              | No `-w`                         | `base64 \| tr -d '\n'`                 |
|   [9]   | `xargs`    | `xargs -r` (skip-empty)    | No `-r`                         | `xargs` + empty guard                  |
|  [10]   | `cp`       | `cp --reflink=auto`        | `cp -c` (APFS clone)            | `cp` (plain)                           |

```bash
_sed_inplace() {
    local -r pattern="$1" replacement="$2" file="$3"
    local -r tmp="$(mktemp "${file}.XXXXXX")"
    sed "s/${pattern}/${replacement}/g" "${file}" > "${tmp}" && mv "${tmp}" "${file}"
}
_file_size() {
    local -ri bytes="$(
        stat -c '%s' "$1" 2>/dev/null \
            || stat -f '%z' "$1" 2>/dev/null \
            || wc -c < "$1"
    )"
    printf '%d' "${bytes}"
}
_realpath() {
    realpath "$1" 2>/dev/null \
        || readlink -f "$1" 2>/dev/null \
        || (cd "$(dirname "$1")" && printf '%s/%s' "$(pwd -P)" "$(basename "$1")")
}
_parse_date() {
    local -r input="$1" fmt="${2:-%Y-%m-%d}"
    date -d "${input}" "+%s" 2>/dev/null \
        || date -jf "${fmt}" "${input}" "+%s" 2>/dev/null \
        || python3 -c "from datetime import datetime; print(int(datetime.strptime('${input}','${fmt}').timestamp()))"
}
```

---
## [4][PLATFORM_DISPATCH]
>**Dictum:** *Runtime probing detects actual capability — version numbers lie when builds omit features.*

Resolve platform at init. Bind OS-specific functions once. All call sites dispatch through a uniform key — zero runtime branching after initialization. Tool probes (`_HAS_RG`, `_resolve_tool`) and bash version probes (`_HAS_INSITU`) are owned by `variable-features.md` and `version-features.md` respectively.

```bash
readonly _PLATFORM="$(uname -s)"
readonly _CAN_NAMEREF="$(
    (eval 'local -n _t=BASH_VERSION' 2>/dev/null && printf '1') || printf '0'
)"
readonly _CAN_PRINTF_T="$(
    (printf '%(%s)T' -1 >/dev/null 2>&1 && printf '1') || printf '0'
)"
readonly _DATE_FLAVOR="$(
    date -d '2024-01-01' '+%s' >/dev/null 2>&1 && printf 'gnu' || printf 'bsd'
)"
# --- Platform-keyed function binding: resolve once, dispatch forever
declare -Ar _PLATFORM_OPS=(
    [timestamp_Darwin]='_timestamp_bsd'
    [timestamp_Linux]='_timestamp_gnu'
    [inplace_Darwin]='_inplace_bsd'
    [inplace_Linux]='_inplace_gnu'
    [clipboard_Darwin]='pbcopy'
    [clipboard_Linux]='xclip -selection clipboard'
    [open_Darwin]='open'
    [open_Linux]='xdg-open'
    [sha256_Darwin]='shasum -a 256'
    [sha256_Linux]='sha256sum'
    [nproc_Darwin]='sysctl -n hw.logicalcpu'
    [nproc_Linux]='nproc'
)
_timestamp_bsd() {
    (( _CAN_PRINTF_T )) && { printf '%(%Y-%m-%dT%H:%M:%S)T' -1; return; }
    date '+%Y-%m-%dT%H:%M:%S'
}
_timestamp_gnu() { printf '%(%Y-%m-%dT%H:%M:%S)T' -1; }
_inplace_bsd() { sed -i '' "s/$1/$2/g" "$3"; }
_inplace_gnu() { sed -i "s/$1/$2/g" "$3"; }
# Polymorphic entry — dispatches via platform key, falls back to first variant
_platform() {
    local -r op="$1"; shift
    local -r fn="${_PLATFORM_OPS[${op}_${_PLATFORM}]:-${_PLATFORM_OPS[${op}_Linux]}}"
    ${fn} "$@"
}
_nproc() { _platform nproc; }
_sha256() { _platform sha256 "$@"; }
_clipboard() { _platform clipboard; }
```

`eval` in probes is safe — static string literals, not user input. `(( _CAN_X ))` for arithmetic dispatch is zero-cost.

### [4.1][EXTENDED_PLATFORM_DISPATCH]

Multi-axis dispatch — keys compose `action_platform_toolchain` for GNU/BSD/busybox:

```bash
declare -Ar _GREP_DISPATCH=(
    [pcre_Linux_gnu]='grep -P'  [pcre_Darwin_bsd]='rg'  [pcre_Linux_busybox]='rg'
)
readonly _TOOLCHAIN="$(
    grep --version 2>&1 | grep -q 'BusyBox' && printf 'busybox' \
        || (grep --version 2>&1 | grep -q 'GNU' && printf 'gnu' || printf 'bsd')
)"
_grep_pcre() {
    local -r engine="${_GREP_DISPATCH[pcre_${_PLATFORM}_${_TOOLCHAIN}]:-grep -E}"
    ${engine} "$@"
}
```

---
## [5][CONTAINER_ENVIRONMENTS]
>**Dictum:** *Alpine's ash and busybox sh implement a POSIX subset — bash assumptions break silently.*

<br>

### [5.1][IMAGE_SELECTION_MATRIX]

| [INDEX] | [IMAGE]               | [SHELL]      | [BASH]                  | [USE_WHEN]                         |
| :-----: | :-------------------- | :----------- | :---------------------- | :--------------------------------- |
|   [1]   | Alpine 3.21           | busybox ash  | `apk add bash` -> 5.2.x | Minimal footprint, build stages    |
|   [2]   | Debian bookworm-slim  | bash 5.2.15  | Pre-installed           | Default production base            |
|   [3]   | Debian trixie-slim    | bash 5.2.37  | Pre-installed           | Next-gen production base           |
|   [4]   | Wolfi (wolfi-base)    | bash + ash   | Pre-installed           | Supply-chain-hardened builds       |
|   [5]   | Chainguard distroless | **No shell** | N/A                     | Production runtime — no shell exec |
|   [6]   | Google distroless     | **No shell** | N/A                     | Production runtime — no shell exec |

Wolfi-base ships bash by default — more predictable than Alpine for build stages. Distroless images contain no shell — portability shifts to "what shell does the build image have?" Loadable builtins (`enable -f`) are distribution-dependent (Arch: included; Debian: `bash-builtins` pkg; macOS/Alpine: build from source) — never depend on them in portable scripts.

### [5.2][PID_1_PATTERNS]

Kernel does NOT deliver default SIGTERM to PID 1 — without explicit handling, SIGTERM is ignored and k8s escalates to SIGKILL after `terminationGracePeriodSeconds` (30s default).

```dockerfile
FROM alpine:3.21                          # Alpine: install bash explicitly
RUN apk add --no-cache bash>=5.2
SHELL ["/bin/bash", "-c"]
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]  # JSON-form mandatory — shell form blocks signals

FROM cgr.dev/chainguard/wolfi-base:latest   # Wolfi: bash pre-installed
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
```

```bash
# Pattern 1: exec replacement — single-process containers (preferred)
_exec_service() { exec "$@"; }

# Pattern 2: signal forwarding — multi-concern entrypoints only
# Implementation owned by variable-features.md S3 (_forward_signal, _spawn)
# K8s 1.33+: shareProcessNamespace: true makes pause container PID 1,
# handling reaping + signal forwarding natively — prefer over in-script forwarding
```

---
## [6][SIGNAL_AND_TRAP_PORTABILITY]
>**Dictum:** *Trap behavior differs across shells — untested signal handling fails in production.*

<br>

| [INDEX] | [BEHAVIOR]           | [BASH_5.2+]             | [DASH/ASH]       | [ZSH_5.9+]  |
| :-----: | :------------------- | :---------------------- | :--------------- | :---------- |
|   [1]   | EXIT on signal death | Fires                   | **No**           | **No**      |
|   [2]   | Subshell traps       | Inherited               | **Reset**        | Inherited   |
|   [3]   | ERR trap             | `set -E` for fn scope   | N/A              | `TRAPZERR`  |
|   [4]   | DEBUG trap           | `set -T` for fn scope   | N/A              | `TRAPDEBUG` |
|   [5]   | `$?` in EXIT trap    | Last cmd exit code      | Last cmd         | Last cmd    |
|   [6]   | Signal in `wait`     | Interrupts, re-waitable | Interrupts, lost | Interrupts  |
|   [7]   | Trapped → subshell   | **Reset to default**    | Reset            | Reset       |
|   [8]   | Ignored → subshell   | Inherited (SIG_IGN)     | Inherited        | Inherited   |
|   [9]   | Ignored → `exec`     | Inherited (POSIX req)   | Inherited        | Inherited   |

Critical gap: dash and zsh do NOT fire EXIT on signal death. Trapped signals reset in subshells and across `exec`; ignored signals (`trap ''`) inherit both (POSIX SIG_IGN requirement) — `_critical_section` below exploits this for child-safe signal masking. Portable scripts must explicitly trap each signal with re-raise to preserve 128+N exit codes for orchestrator classification:

```bash
# Portable signal registration — re-raise preserves 128+N for orchestrators
_register_signal_traps() {
    local _sig; for _sig in INT TERM HUP QUIT; do
        # shellcheck disable=SC2064
        trap "_cleanup; trap - ${_sig}; kill -${_sig} \$\$" "${_sig}"
    done
    trap '_cleanup' EXIT
}
# Portable critical section — signal masking without sigprocmask
_critical_section() {
    trap '' INT TERM
    "$@"
    trap - INT TERM
}
```

Cleanup implementation (`_cleanup`, `_CLEANUP_STACK`, `_CLEANING` guard) is owned by `script-patterns.md` S5. ERR trap stack trace (`_on_err` with `BASH_COMMAND`/`BASH_LINENO`/`FUNCNAME`) is owned by `script-patterns.md` S5 and `variable-features.md` S2.

---
## [RULES]

- `#!/usr/bin/env bash` default — NEVER `#!/bin/bash` unless security policy mandates. NEVER `env -S` (macOS/busybox lack it).
- macOS Homebrew re-exec pattern for `_BASH_V < 502` — probes `/opt/homebrew/bin/bash` then `/usr/local/bin/bash`.
- Capability probes over version checks — `(( _CAN_X ))` arithmetic dispatch, not `if [[ version >= N ]]`.
- `_PLATFORM_OPS[action_${_PLATFORM}]` for OS-specific function binding — resolve once at init, dispatch via key.
- `_sed_inplace` via temp+mv — NEVER `sed -i`/`sed -i ''` in cross-platform scripts.
- `[ ]` for POSIX scripts, `[[ ]]` for bash-only — NEVER mix in same script.
- Alpine/busybox: install bash explicitly (`apk add bash>=5.2`) when arrays, namerefs, or dispatch tables required.
- Wolfi-base over Alpine for build stages when bash is required — ships bash by default.
- Container PID 1: prefer `exec` replacement; K8s 1.33+ `shareProcessNamespace: true` for signal forwarding.
- EXIT trap + explicit INT/TERM/HUP/QUIT traps with re-raise — dash/zsh skip EXIT on signal death.
- POSIX 2024 `pipefail`: probe at runtime (`set -o pipefail 2>/dev/null`) — dash has not shipped it yet.
- `${ cmd; }` and `GLOBSORT` are Bash 5.3-only — gate with `(( _BASH_V >= 503 ))`, NEVER use in cross-shell scripts.
- `coproc` is Bash 4.0+, not POSIX — use `mkfifo` named pipes for portable bidirectional IPC.
- Trapped signals reset in subshells/exec; ignored signals (`trap ''`) inherit — use SIG_IGN for critical sections that spawn children.
- Loadable builtins are distribution-dependent — NEVER assume availability; probe or fall back.
