# [H1][ARRAY-ALGEBRA]
>**Dictum:** *Arrays are the compositional unit — set operations, structural transforms, and higher-order traversal replace imperative mutation.*

<br>

Set algebra via associative arrays, structural transforms via bulk expansion, higher-order traversal via nameref + function dispatch, and null-safe pipeline bridging. Declaration, access, slicing, and basic iteration are in [bash-scripting-guide.md S6](./bash-scripting-guide.md).

| [IDX] | [PATTERN]         |  [S]  | [USE_WHEN]                                                |
| :---: | :---------------- | :---: | :-------------------------------------------------------- |
|  [1]  | Set algebra       |  S1   | Union, intersect, diff, dedup on indexed arrays           |
|  [2]  | Relational ops    |  S1B  | Set algebra + joins on associative arrays                 |
|  [3]  | Structural xforms |  S2   | Reshape, zip, transpose w/o element-wise loops            |
|  [4]  | Nameref builders  |  S2B  | Accumulate/merge into caller's assoc array via `local -n` |
|  [5]  | Higher-order trav |  S3   | Map/filter/reduce/scan/predicates via nameref             |
|  [6]  | Pipeline bridge   |  S4   | Null-safe array-to-pipeline, parallel map, collect        |

---
## [1][SET_ALGEBRA]
>**Dictum:** *Associative arrays reduce set operations from O(n*m) to O(n+m).*

<br>

Build a set from one array and probe from the other instead of nested iteration. Case-insensitive sets: key via `${item,,}` in `_to_set` — propagates uniformly to all downstream operations.

```bash
# Indexed-array set primitives: build set, probe from other
_to_set() { local -n _src=$1 _dst=$2; local item; for item in "${_src[@]}"; do _dst["${item}"]=1; done; }
_union() {
    local -n _a=$1 _b=$2 _out=$3; local -A _s=()
    _to_set _a _s; _to_set _b _s; _out=("${!_s[@]}")
}
_intersect() {
    local -n _a=$1 _b=$2 _out=$3; local -A _sb=(); _to_set _b _sb
    local item; for item in "${_a[@]}"; do [[ -v _sb["${item}"] ]] && _out+=("${item}"); done
}
_diff() {
    local -n _a=$1 _b=$2 _out=$3; local -A _sb=(); _to_set _b _sb
    local item; for item in "${_a[@]}"; do [[ -v _sb["${item}"] ]] || _out+=("${item}"); done
}
_sym_diff() {  # (A \ B) ∪ (B \ A)
    local -n _a=$1 _b=$2 _out=$3; local -A _sa=() _sb=()
    _to_set _a _sa; _to_set _b _sb; local item
    for item in "${_a[@]}"; do [[ -v _sb["${item}"] ]] || _out+=("${item}"); done
    for item in "${_b[@]}"; do [[ -v _sa["${item}"] ]] || _out+=("${item}"); done
}
_unique() {  # order-preserving dedup
    local -n _src=$1 _out=$2; local -A _seen=()
    local item; for item in "${_src[@]}"; do
        [[ -v _seen["${item}"] ]] && continue; _seen["${item}"]=1; _out+=("${item}")
    done
}
# Composed: deployed vs expected config keys
declare -a expected=(API_URL DB_HOST DB_PORT REDIS_URL LOG_LEVEL)
declare -a deployed=(API_URL DB_HOST REDIS_URL SECRET_KEY)
declare -a drift=(); _diff expected deployed drift
(( ${#drift[@]} )) && printf 'Missing in deploy: %s\n' "${drift[*]}"
```

### [1.1][RELATIONAL_SET_OPERATIONS]

Set algebra on associative arrays — keys as elements, values irrelevant for pure set ops.

```bash
# Compact set primitives — O(n) per operation
set_intersect() {
    local -n _r=$1 _a=$2 _b=$3
    local k; for k in "${!_a[@]}"; do [[ -v _b["${k}"] ]] && _r["${k}"]=1; done
}
set_diff() {
    local -n _r=$1 _a=$2 _b=$3
    local k; for k in "${!_a[@]}"; do [[ -v _b["${k}"] ]] || _r["${k}"]=1; done
}
set_sym_diff() {
    local -n _r=$1 _a=$2 _b=$3
    local k
    for k in "${!_a[@]}"; do [[ -v _b["${k}"] ]] || _r["${k}"]=1; done
    for k in "${!_b[@]}"; do [[ -v _a["${k}"] ]] || _r["${k}"]=1; done
}
set_union() {
    local -n _r=$1 _a=$2 _b=$3
    local k; for k in "${!_a[@]}"; do _r["${k}"]=1; done
    for k in "${!_b[@]}"; do _r["${k}"]=1; done
}
set_is_subset() {
    local -n _a=$1 _b=$2
    local k; for k in "${!_a[@]}"; do [[ -v _b["${k}"] ]] || return 1; done
}
# Key-value inner join: composite value where keys exist in both
kv_inner_join() {
    local -n _r=$1 _left=$2 _right=$3
    local k; for k in "${!_left[@]}"; do
        [[ -v _right["${k}"] ]] && _r["${k}"]="${_left[${k}]}|${_right[${k}]}"
    done
}
# Key-value left join: all left keys; right value or default
kv_left_join() {
    local -n _r=$1 _left=$2 _right=$3
    local -r default="${4:-NULL}"
    local k; for k in "${!_left[@]}"; do
        _r["${k}"]="${_left[${k}]}|${_right[${k}]:-${default}}"
    done
}
# Composed: user-role join
declare -A users=([u1]="alice" [u2]="bob" [u3]="carol")
declare -A roles=([u1]="admin" [u3]="editor" [u4]="viewer")
declare -A joined=()
kv_inner_join joined users roles
# joined: [u1]="alice|admin" [u3]="carol|editor"
```

Nameref pitfalls: avoid `local -n _r=$1` where caller passes `_r` (circular ref); dynamic scoping resolves to nearest stack frame — prefix nameref locals with `_` or `__nr_` to prevent collisions.

**Performance**: all operations O(n) per call. Above ~10k elements, delegate to `comm`/`sort`/`join` on sorted files — external tools handle large datasets orders of magnitude faster than bash loops.

---
## [2][STRUCTURAL_TRANSFORMS]
>**Dictum:** *Bulk expansion operators reshape arrays without element-wise iteration.*

<br>

```bash
# Bulk prefix/suffix — O(n) in expansion engine, zero loops
# Raw expansion demo (prefix/suffix) owned by bash-scripting-guide.md S3/S5
# Composed: zip + flag building shows array-level composition

_join() { local -r delim="$1"; shift; local IFS="${delim}"; printf '%s' "$*"; }
_zip_kv() {  # fork-free via printf -v into destination index
    local -n _keys=$1 _vals=$2 _out=$3; local -r n="${#_keys[@]}"
    local i; for (( i = 0; i < n; i++ )); do printf -v "_out[i]" '%s=%s' "${_keys[i]}" "${_vals[i]}"; done
}
_transpose() {  # row-major ↔ column-major (BLAS-style)
    local -n _src=$1 _dst=$2; local -r rows="$3" cols="$4"
    local r c; for (( c = 0; c < cols; c++ )); do
        for (( r = 0; r < rows; r++ )); do _dst+=("${_src[r * cols + c]}"); done
    done
}
_unpack() {  # "a:b|c:d" → parallel key/value arrays
    local -r outer="$1" inner="$2"; shift 2; local -n _keys=$1 _vals=$2
    local -a pairs=(); IFS="${outer}" read -ra pairs <<< "$3"
    local pair; for pair in "${pairs[@]}"; do
        IFS="${inner}" read -r k v <<< "${pair}"; _keys+=("${k}"); _vals+=("${v}")
    done
}
# Composed: build CLI flags from parallel arrays
declare -a flag_names=(host port timeout) flag_vals=(localhost 5432 30) flags=()
_zip_kv flag_names flag_vals flags  # flags=("host=localhost" "port=5432" "timeout=30")
declare -a cli_flags=("${flags[@]/#/--}")  # cli_flags=("--host=localhost" ...)
```

`_zip_kv` binds directly into destination index via `printf -v` — zero forks. `_unpack` is the inverse of `_join` + `_zip_kv`.

### [2.1][NAMEREF_BUILDER]

Callee accumulates into caller's associative array via `local -n` — replaces `eval`-based indirection.

```bash
config_set() {
    local -n _target=$1; shift
    local pair; for pair in "$@"; do _target["${pair%%=*}"]="${pair#*=}"; done
}
config_merge() {
    local -n _dest=$1 _src=$2
    local k; for k in "${!_src[@]}"; do _dest["${k}"]="${_src[${k}]}"; done
}
# Composed: base config + environment overrides
declare -A base=() overrides=() merged=()
config_set base "host=localhost" "port=5432" "db=myapp"
config_set overrides "port=5433" "ssl=true"
config_merge merged base
config_merge merged overrides  # last-write wins
# merged: [ssl]="true" [port]="5433" [host]="localhost" [db]="myapp"
```

---
## [3][HIGHER_ORDER_TRAVERSE]
>**Dictum:** *Function names as first-class values enable map/filter/reduce without language-level support.*

```bash
_map() {
    local -r func="$1"; local -n _src=$2 _dst=$3
    local item result; for item in "${_src[@]}"; do
        "${func}" "${item}" result; _dst+=("${result}")
    done
}
_map_exec() {  # forking variant — external commands returning via stdout
    local -r func="$1"; local -n _src=$2 _dst=$3
    local item; for item in "${_src[@]}"; do _dst+=("$("${func}" "${item}")"  ); done
}
_filter() {
    local -r pred="$1"; local -n _src=$2 _dst=$3
    local item; for item in "${_src[@]}"; do "${pred}" "${item}" && _dst+=("${item}"); done
}
_reduce() {  # left-fold via nameref accumulator
    local -r func="$1"; local -n _src=$2 _result=$3
    [[ ${#_src[@]} -eq 0 ]] && { _result=""; return 1; }
    _result="${_src[0]}"
    local i; for (( i = 1; i < ${#_src[@]}; i++ )); do "${func}" "${_result}" "${_src[i]}" _result; done
}
_any() {
    local -r pred="$1"; local -n _src=$2
    local item; for item in "${_src[@]}"; do "${pred}" "${item}" && return 0; done; return 1
}
_all() {
    local -r pred="$1"; local -n _src=$2
    local item; for item in "${_src[@]}"; do "${pred}" "${item}" || return 1; done; return 0
}
_count_by() {  # frequency table via classifier
    local -r classifier="$1"; local -n _src=$2 _counts=$3
    local item key; for item in "${_src[@]}"; do
        "${classifier}" "${item}" key; (( _counts["${key}"]++ )) || true
    done
}
# Composed: file sizes → filtered → sum
_gt_1k() { (( $1 > 1024 )); }
_add() { printf -v "$3" '%d' "$(( $1 + $2 ))"; }
declare -a sources=(*.sh) sizes=() big=()
_map _file_size sources sizes  # _file_size: bash-portability.md S3
_filter _gt_1k sizes big
declare total=0; _reduce _add big total
```

`_map` (nameref, zero forks) vs `_map_exec` (stdout capture, one fork per element). `_any`/`_all` short-circuit — O(1) best case. `_count_by` builds a frequency table in a single pass.

---
## [4][PIPELINE_INTEGRATION]
>**Dictum:** *Null-delimited interchange prevents filename corruption at array↔pipeline boundaries.*

Only null-delimited (`\0`) is safe for arbitrary data — newline-delimited breaks on filenames with embedded newlines.

```bash
# Null-safe collect/emit
readarray -d '' -t targets < <(fd -e sh --print0 --type f)
printf '%s\0' "${targets[@]}" | xargs -0 shellcheck

_parallel_map() {  # xargs -P, null-safe; export -f required for child bash
    local -r jobs="$1" func="$2"; local -n _src=$3 _dst=$4
    export -f "${func}"
    readarray -d '' -t _dst < <(
        printf '%s\0' "${_src[@]}" | xargs -0 -P "${jobs}" -I{} bash -c "${func} \"\$1\"" _ {}
    )
}
_partition() {
    local -r pred="$1"; local -n _src=$2 _pass=$3 _fail=$4
    local item; for item in "${_src[@]}"; do "${pred}" "${item}" && _pass+=("${item}") || _fail+=("${item}"); done
}
_group_by() {  # pipe-delimited — assoc arrays cannot store nested arrays
    local -r classifier="$1"; local -n _src=$2 _groups=$3
    local item key; for item in "${_src[@]}"; do
        "${classifier}" "${item}" key; _groups["${key}"]+="${_groups["${key}"]:+|}${item}"
    done
}
_flat_map() {  # one-to-many: each transform emits zero or more elements
    local -r func="$1"; local -n _src=$2 _dst=$3
    local item; for item in "${_src[@]}"; do
        local -a _partial=(); "${func}" "${item}" _partial; _dst+=("${_partial[@]}")
    done
}
# Composed: classify files by extension
_ext() { printf -v "$2" '%s' "${1##*.}"; }
declare -a all_files=(main.ts utils.ts style.css reset.css app.sh)
declare -A by_ext=()
_group_by _ext all_files by_ext
for ext in "${!by_ext[@]}"; do
    IFS='|' read -ra group <<< "${by_ext[${ext}]}"; printf '%s: %d files\n' "${ext}" "${#group[@]}"
done
```

`_group_by`/`_count_by` use nameref classifier convention: classifier writes to `$2` via `printf -v`.

### [4.1][BASH_53_ARRAY_PRIMITIVES]

Gate all behind `(( _BASH_V >= 503 ))` — version probe in [version-features.md S7](./version-features.md).

```bash
(( _BASH_V >= 503 )) && {
    readarray -t arr <<< "${ generate_lines; }"           # zero-fork via current-shell ${ }
    GLOBSORT=mtime files=(*.log)                          # mtime-sorted glob without stat/ls
    shopt -s array_expand_once                            # prevent subscript double-evaluation
    compgen -V completions -W "deploy rollback" -- "${p}" # direct variable store, no fork
    # Streaming validation: callback fires per line, processes multi-GB without full load
    _validate_line() {
        local -r idx="$1" line="$2"
        [[ "${line}" =~ ^[A-Z]{3},[0-9]+$ ]] || { printf 'Rejected %d: %s\n' "${idx}" "${line}" >&2; return 1; }
    }
    readarray -t -C _validate_line -c 1 records < data.csv
    # Batch streaming: callback fires every N lines
    _batch() { local -ri index=$1; shift; printf '%d: %d lines\n' "${index}" "$#"; }
    readarray -C _batch -c 1000 -t < large_file.csv
}
# fltexpr loadable builtin: enable -f fltexpr fltexpr; fltexpr 'end - start'
```

### [4.2][BOUNDED_CONCURRENCY_POOL]

`wait -n -p` (5.2+) enables per-job result collection without polling — alternative to `xargs -P` when per-job exit status matters.

```bash
_pool_map() {
    local -r max_jobs="$1" func="$2"; local -n _src=$3 _results=$4
    local -A _pids=()
    local item; for item in "${_src[@]}"; do
        "${func}" "${item}" &
        _pids[$!]="${item}"
        (( ${#_pids[@]} >= max_jobs )) && {
            local -i done_pid=0
            wait -n -p done_pid
            _results["${_pids[${done_pid}]}"]=$?
            unset '_pids[${done_pid}]'
        }
    done
    local pid; for pid in "${!_pids[@]}"; do
        wait "${pid}"; _results["${_pids[${pid}]}"]=$?
    done
}
```

### [4.3][PERFORMANCE_THRESHOLDS]

| [INDEX] | [ELEMENT_COUNT] | [STRATEGY]                                                    |
| :-----: | :-------------- | :------------------------------------------------------------ |
|   [1]   | <1K             | Native arrays optimal — all `_map`/`_filter`/`_reduce` viable |
|   [2]   | 1K-10K          | Simple ops acceptable; `awk` for string manipulation          |
|   [3]   | >10K            | Delegate to `awk`/`jq` — per-element fork costs 2-5ms         |

`_map_exec` unusable above 10K (fork per element). Associative arrays degrade O(n^2) beyond ~50K entries on stock bash (no rehashing compiled in) — delegate to `awk` associative arrays or `jq`.

---
## [RULES]

- `declare -A` for set ops — O(n+m) beats O(n*m). `set_*` for assoc-array set algebra; `_union`/`_intersect`/`_diff` for indexed arrays.
- `printf -v` for fork-free binding in `_map`/`_reduce`/`_scan` — `$()` forks per element.
- `local -n` for zero-copy array params — never pass `"${arr[@]}"` (copies). Prefix nameref locals with `_` to avoid circular refs and scope collisions.
- `config_set`/`config_merge` via nameref builder — replaces `eval`-based indirection for assoc-array accumulation.
- `kv_inner_join`/`kv_left_join` for relational operations on assoc arrays — composite `"left|right"` value pattern.
- Null-delimited (`\0`) at array-to-pipeline boundaries via `readarray -d '' -t`.
- `_any`/`_all` short-circuit — use instead of `_filter` + length check for boolean queries.
- `export -f func` mandatory before `xargs -P ... bash -c`.
- Bash 5.3 features gate behind `(( _BASH_V >= 503 ))`.
- <1K native, 1K-10K selective, >10K delegate to `comm`/`sort`/`join`/`awk`/`jq`.
- `wait -n -p` for per-job result collection when exit status per item matters.
