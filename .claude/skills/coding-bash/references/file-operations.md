# [H1][FILE-PIPELINES]
>**Dictum:** *Atomic I/O, structured traversal, and descriptor-based multiplexing eliminate partial writes, glob hazards, and hardcoded FDs.*

<br>

Production patterns for file I/O beyond basic reads. Basic file reads (`$(<file)`, `mapfile`) and conditionals (`-f`, `-d`, `-r`) are in [bash-scripting-guide.md S6/S9](./bash-scripting-guide.md).

| [IDX] | [PATTERN]             |  [S]  | [USE_WHEN]                                    |
| :---: | :-------------------- | :---: | :-------------------------------------------- |
|  [1]  | Atomic write          |  S1   | Config/log output that must not be partial    |
|  [2]  | Descriptor multiplex  |  S2   | Parallel logging, lock files, output channels |
|  [3]  | Directory traversal   |  S3   | Sorted globs, fd search, recursive processing |
|  [4]  | Structured extraction |  S4   | Config parsing, marker sections, line access  |

---
## [1][ATOMIC_WRITE_LIFECYCLE]
>**Dictum:** *rename(2) is the only atomic filesystem operation — write-then-move prevents partial output on crash or signal.*

<br>

`rename(2)` atomicity holds only within a single filesystem — cross-device `mv` falls back to copy+delete. `umask 077` must precede `mktemp` — the race between creation and `chmod` is unclosable. `sync --data-only` (coreutils 8.24+) before `mv` ensures data durability — without it, power loss after `mv` can yield a zero-length file.

```bash
# Full atomic write pipeline: umask → mktemp → write → fsync → rename → cleanup
_atomic_write() {
    local -r target="$1"; shift
    local -r dir="$(dirname "${target}")"
    local saved_umask; saved_umask="$(umask)"
    umask 077
    local -r tmp="$(mktemp "${dir}/.tmp.XXXXXX")"
    umask "${saved_umask}"
    _register_cleanup "rm -f '${tmp}'"
    "$@" > "${tmp}" || return 1
    # fsync: flush page cache to disk before rename
    # sync -d (--data) is coreutils 8.24+; python fallback for older systems
    command -v sync >/dev/null 2>&1 && sync -d "${tmp}" 2>/dev/null \
        || python3 -c "import os;f=os.open('${tmp}',os.O_RDWR);os.fsync(f);os.close(f)" 2>/dev/null
    mv -f "${tmp}" "${target}"
}
# Usage: atomic config generation
_atomic_write /etc/app/config.json \
    jq -n --arg host "${DB_HOST}" --arg port "${DB_PORT}" \
    '{database: {host: $host, port: ($port | tonumber)}}'
# Atomic multi-file: consistent snapshot via symlink swap
# Individual renames are atomic; symlink swap provides multi-file atomicity
_atomic_snapshot() {
    local -r dest_dir="$1"; shift
    local saved_umask; saved_umask="$(umask)"
    umask 077
    local -r staging="$(mktemp -d "${dest_dir}/.staging.XXXXXX")"
    umask "${saved_umask}"
    _register_cleanup "rm -rf '${staging}'"
    "$@" "${staging}" || return 1
    local file; for file in "${staging}"/*; do
        [[ -f "${file}" ]] || continue
        mv -f "${file}" "${dest_dir}/${file##*/}"
    done
}
# Atomic append: flock serializes concurrent writers
_atomic_append() {
    local -r target="$1"; shift
    exec {fd}>>"${target}"
    flock "${fd}" || { exec {fd}>&-; return 1; }
    printf '%s\n' "$*" >&"${fd}"
    exec {fd}>&-
}
# Scoped temp directory: umask + cleanup registration
_with_tempdir() {
    local -r prefix="$1"; shift
    local saved_umask; saved_umask="$(umask)"
    umask 077
    local -r work="$(mktemp -d "/tmp/${prefix}-XXXXXX")"
    umask "${saved_umask}"
    _register_cleanup "rm -rf '${work}'"
    "$@" "${work}"
}
```

`_register_cleanup` pushes onto the LIFO `_CLEANUP_STACK` (see [script-patterns.md](./script-patterns.md)). `_atomic_snapshot` uses `${file##*/}` instead of `$(basename)` to avoid a fork per file. For true multi-file atomicity, swap a symlink: `ln -sfn "${staging}" "${dest_dir}.new" && mv -Tf "${dest_dir}.new" "${dest_dir}"`.

---
## [2][DESCRIPTOR_MULTIPLEX]
>**Dictum:** *Dynamic FD allocation via `exec {fd}>file` eliminates hardcoded descriptor collisions.*

<br>

`exec {fd}>file` delegates to the kernel's `open()` return, stored in `$fd`. Composable, collision-free, mandatory for library-quality functions — hardcoded FDs collide when functions compose.

```bash
# Structured logging: separate channels with cleanup registration
_init_logging() {
    local -r log_dir="$1"
    mkdir -p "${log_dir}"
    exec {_FD_AUDIT}>"${log_dir}/audit.log"
    _register_cleanup "exec ${_FD_AUDIT}>&- 2>/dev/null"
    exec {_FD_METRICS}>"${log_dir}/metrics.log"
    _register_cleanup "exec ${_FD_METRICS}>&- 2>/dev/null"
}
_log_audit() { printf '%(%F %T)T [AUDIT] %s\n' -1 "$*" >&"${_FD_AUDIT}"; }
_log_metric() { printf '%(%F %T)T %s\n' -1 "$*" >&"${_FD_METRICS}"; }
# Exclusive lock with timeout — prevents concurrent execution
# flock -w: block up to N seconds; flock -n: fail immediately
_with_lock() {
    local -r lock_file="$1" timeout="${2:-0}"; shift 2
    exec {fd}>"${lock_file}"
    local -a flock_args=()
    (( timeout > 0 )) && flock_args=(-w "${timeout}") || flock_args=(-n)
    flock "${flock_args[@]}" "${fd}" || { exec {fd}>&-; printf 'Lock held: %s\n' "${lock_file}" >&2; return 1; }
    _register_cleanup "exec ${fd}>&- 2>/dev/null"
    "$@"
}
# FD fan-out: single command writing to multiple outputs without temp files
_fan_out() {
    local -r primary="$1" secondary="$2"; shift 2
    "$@" > >(tee "${primary}") 2> >(tee "${secondary}" >&2)
    wait  # process substitutions may outlive parent
}
```

`exec {fd}>&-` closes the descriptor — omitting leaks FDs (default ulimit ~1024). `_fan_out` calls `wait` because `>(tee ...)` subshells can outlive the parent. For bounded-concurrency job pools, use `wait -n -p finished_pid` (Bash 5.1+) — see `_run_pool` in data-pipeline.sh.

---
## [3][DIRECTORY_TRAVERSAL]
>**Dictum:** *`GLOBSORT` for ordered glob expansion, `fd` for search, glob for in-process traversal, `find` as last resort.*

<br>

**GLOBSORT (Bash 5.3+)** controls glob result ordering without forking to `ls` or `stat`. Scoped via `local` in functions — does not leak. Replaces `ls -t | while read` pipelines entirely.

```bash
# GLOBSORT: sorted glob expansion without ls piping (Bash 5.3+)
# Values: name, size, blocks, mtime, atime, ctime, numeric, none; prefix - for descending
_recent_logs() {
    local -n _out=$1
    local GLOBSORT='-mtime'  # newest first — scoped to function via local
    shopt -s nullglob
    _out=(logs/*.log)
}
# GLOBSORT='-size' for largest-first; GLOBSORT='numeric' for natural sort of versioned files
```

`fd` respects `.gitignore`, handles special-character filenames via `--print0`, and provides regex/glob filtering with depth control. `--format` (fd 10+) produces structured output without `--exec` fork overhead. `--strip-cwd-prefix=always|never|auto` for clean pipeline output. `--hyperlink` emits OSC 8 clickable links (pairs with `rg --hyperlink-format`).

```bash
# fd-first file discovery with glob fallback
_discover() {
    local -r base="$1" pattern="$2"; local -n _out=$3
    command -v fd >/dev/null 2>&1 && {
        readarray -d '' -t _out < <(fd --type f --glob "${pattern}" --print0 . "${base}")
        return
    }
    shopt -s globstar nullglob
    _out=("${base}"/${pattern})
}
# fd --format: structured output without --exec fork (fd 10+)
# Placeholders: {/} basename, {//} parent, {.} stem, {/.} stem of basename
_discover_formatted() {
    local -r base="$1" ext="$2"
    fd -e "${ext}" --strip-cwd-prefix=always --format '{//}/{/.}' . "${base}"
}
# Type-filtered collection via fd
_discover_typed() {
    local -r base="$1" ext="$2"; local -n _out=$3
    command -v fd >/dev/null 2>&1 && {
        readarray -d '' -t _out < <(fd -e "${ext}" --type f --print0 . "${base}")
        return
    }
    shopt -s globstar nullglob
    _out=("${base}"/**/*."${ext}")
}
# Depth-limited walk: manual recursion when glob/fd depth control insufficient
# Bash has no TCO — stack depth ~200 on default ulimit; fall back to fd/find beyond that
_walk() {
    local -r base="$1" max_depth="$2" callback="$3"
    local -r depth="${4:-0}"
    (( depth > max_depth )) && return
    local entry; for entry in "${base}"/*; do
        [[ -e "${entry}" ]] || continue
        "${callback}" "${entry}" "${depth}"
        [[ -d "${entry}" && ! -L "${entry}" ]] && _walk "${entry}" "${max_depth}" "${callback}" "$(( depth + 1 ))"
    done
}
# Exclusion via associative set: O(1) per path segment
declare -Ar _EXCLUDE=([vendor]=1 [node_modules]=1 [.git]=1)
_not_excluded() {
    local -a segments; IFS='/' read -ra segments <<< "$1"
    local segment; for segment in "${segments[@]}"; do
        [[ -v _EXCLUDE["${segment}"] ]] && return 1
    done
}
# Composed: discover + filter in single pipeline
_collect_filtered() {
    local -r base="$1" pattern="$2"; local -n _out=$3
    local -a candidates=()
    _discover "${base}" "${pattern}" candidates
    local item; for item in "${candidates[@]}"; do
        _not_excluded "${item}" && _out+=("${item}")
    done
}
```

`globstar` recurses into symlinked directories — `_walk` checks `! -L` to prevent cycles. `_EXCLUDE` as associative set is O(1) per segment vs linear pattern matching. When `fd` is available, exclusion is better via `fd --exclude` rather than post-filtering.

---
## [4][STRUCTURED_EXTRACTION]
>**Dictum:** *`mapfile` + array indexing replaces sed/awk for structured file sections — zero forks, O(1) per line.*

<br>

Config files, markdown, and structured logs have internal structure. Pure bash extraction via `mapfile` + array slicing operates on the loaded array — no repeated file I/O.

```bash
# Line-addressed access: array indexing after mapfile
_line() {
    local -n _lines=$1
    local -r n="$2"
    printf '%s' "${_lines[n - 1]}"
}
_range() {
    local -n _lines=$1
    local -r start="$2" end="$3"
    printf '%s\n' "${_lines[@]:start - 1:end - start + 1}"
}
# Marker-bounded extraction: content between delimiters (exclusive)
_between_markers() {
    local -r start_marker="$1" end_marker="$2"; local -n _lines=$3 _out=$4
    local -i capturing=0
    local line; for line in "${_lines[@]}"; do
        (( capturing )) && [[ "${line}" == "${end_marker}" ]] && return
        (( capturing )) && _out+=("${line}")
        [[ "${line}" == "${start_marker}" ]] && capturing=1
    done
}
# Key-value config parser: comment-aware, whitespace-trimmed
# Uses mapfile to load, then iterates array — no while-read
_parse_kv() {
    local -r file="$1"; local -n _cfg=$2
    local -a raw=()
    mapfile -t raw < "${file}"
    local line key value
    local entry; for entry in "${raw[@]}"; do
        line="${entry}"
        # Skip comments and blank lines
        [[ "${line}" =~ ^[[:space:]]*(#|$) ]] && continue
        key="${line%%=*}"; value="${line#*=}"
        # Trim whitespace via parameter expansion
        key="${key#"${key%%[![:space:]]*}"}"; key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
        # Strip surrounding quotes
        [[ "${value}" =~ ^\"(.*)\"$ || "${value}" =~ ^\'(.*)\'$ ]] \
            && value="${BASH_REMATCH[1]}"
        _cfg["${key}"]="${value}"
    done
}
# Composed: extract SQL migration sections from changelog
declare -a changelog=()
mapfile -t changelog < CHANGELOG.md
declare -a sql_block=()
_between_markers '```sql' '```' changelog sql_block
printf '%s\n' "${sql_block[@]}"
```

`_parse_kv` handles `key = "quoted value"` and `key=bare_value` uniformly — regex alternation strips quotes only when matched symmetrically. `mapfile -t` loads the entire file once; subsequent iteration is pure array traversal. Array slicing `${arr[@]:offset:count}` is O(count) copy, not O(n) scan.

---
## [RULES]

- Atomic writes: `umask 077` → `mktemp` → write → `sync --data-only` (fsync) → `mv` — full pipeline.
- `rename(2)` is atomic only on same filesystem — cross-device `mv` copies, reintroducing partial-write risk.
- Lightweight atomic write (no fsync): `mktemp` → write → `mv` — sufficient when crash durability not required.
- `exec {fd}>file` for all FD allocation — hardcoded numbers collide in composed functions.
- `exec {fd}>&-` to close FDs on both success and error paths — leaked descriptors exhaust ulimit.
- `flock -n` (non-blocking) or `flock -w N` (timeout) — never bare `flock` unless blocking is intentional.
- `GLOBSORT` (Bash 5.3+) for sorted glob expansion — replaces `ls -t` piping. Scope via `local` to prevent leak.
- `fd --format` (fd 10+) for structured output — avoids `--exec` fork overhead per match.
- `fd --strip-cwd-prefix=always` for clean relative paths in pipelines.
- `fd` for file search, glob for in-process traversal, `find` as POSIX fallback only.
- `mapfile -t` + array iteration for file processing — `while IFS= read -r` is forbidden for collection.
- Exclusion via `declare -Ar` set — O(1) per check vs O(k) pattern matching.
- Process substitution `>(cmd)` subshells can outlive parent — call `wait` after fan-out.
