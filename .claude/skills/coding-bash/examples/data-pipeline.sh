#!/usr/bin/env bash
# data-pipeline.sh — Log metrics aggregation pipeline
# Ingests JSON logs newest-first (GLOBSORT 5.3+), extracts metrics with
# jq 1.8+ skip/2+limit/2 pagination and add/1 null-safe aggregation,
# accumulates via nameref, emits JSON-ND logs with BASH_MONOSECONDS timing.
set -Eeuo pipefail
shopt -s inherit_errexit nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

# shellcheck disable=SC2034  # EX_OK exported for caller scripts
readonly VERSION="2.0.0" EX_OK=0 EX_ERR=1 EX_USAGE=2
readonly SCRIPT_NAME="${BASH_SOURCE[0]##*/}"
readonly _BASH_V=$(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] ))
readonly _MIN_BASH_V=502
(( _BASH_V >= _MIN_BASH_V )) || {
    printf 'Bash %d.%d+ required (found %s)\n' \
        "$((_MIN_BASH_V / 100))" "$((_MIN_BASH_V % 100))" "${BASH_VERSION}" >&2
    exit 1
}
(( _BASH_V >= 503 )) && shopt -s array_expand_once
declare -a _CLEANUP_STACK=() POSITIONAL_ARGS=()
declare -i _CLEANING=0 LOG_LEVEL=2 PAGE_SIZE=50 PAGE_OFFSET=0
LOG_FORMAT="${LOG_FORMAT:-text}"

# --- [LOGGING] ----------------------------------------------------------------

# shellcheck disable=SC2083,SC2084
# shellcheck disable=SC2015
(( _BASH_V >= 503 )) \
    && eval '_ts() { REPLY=${ printf "%(%FT%T%z)T" -1; }; }' \
    || _ts() {
        local _s; printf -v _s '%(%Y-%m-%dT%H:%M:%S)T' -1
        local _u; printf -v _u '%.6f' "${EPOCHREALTIME}"
        REPLY="${_s}.${_u#*.}"
    }

_init_color() {
    local -r _nc="${NO_COLOR+set}" _ci="${CI:-}${GITHUB_ACTIONS:-}${GITLAB_CI:-}"
    local -r _tty="$([[ -t 2 ]] && printf '1' || printf '0')"
    local -i _depth=0
    (( _tty )) && _depth="$(tput colors 2>/dev/null || printf '0')"
    local _enabled=0
    [[ -z "${_nc}" ]] && { (( _tty )) || [[ -n "${_ci}" ]]; } \
        && (( _depth >= 8 || ${#_ci} > 0 )) && _enabled=1
    local _b="" _d="" _r=""
    (( _enabled )) && { _b=$'\033[1m'; _d=$'\033[2m'; _r=$'\033[0m'; }
    readonly _BOLD="${_b}" _DIM="${_d}" _RESET="${_r}"
}
_init_color

declare -Ar _LOG_LEVELS=([DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3)
_LOG_FD="${_LOG_FD:-2}"
_log_json_emit() {
    local -r level="$1"; shift; _ts
    jq -nc --arg ts "${REPLY}" --arg level "${level}" \
        --arg fn "${FUNCNAME[3]:-main}" --argjson line "${BASH_LINENO[2]:-0}" \
        --arg msg "$*" '{ts:$ts,level:$level,fn:$fn,line:$line,msg:$msg}' >&"${_LOG_FD}"
}
_log_text_emit() {
    local -r level="$1"; shift; _ts
    printf '%-7s %s [%s:%d] %s\n' \
        "[${level}]" "${REPLY}" "${FUNCNAME[3]:-main}" "${BASH_LINENO[2]:-0}" "$*" >&2
}
declare -Ar _LOG_EMIT=([json]=_log_json_emit [text]=_log_text_emit)
readonly _LOG_EMITTER="${_LOG_EMIT[${LOG_FORMAT}]:-_log_text_emit}"

_log() {
    local -r level="$1"; shift
    (( ${_LOG_LEVELS[${level}]:-3} >= LOG_LEVEL )) || return 0
    "${_LOG_EMITTER}" "${level}" "$@"
}
_debug() { _log DEBUG "$@"; }
_info()  { _log INFO "$@";  }
_warn()  { _log WARN "$@";  }
_err()   { _log ERROR "$@"; }
_die()   { _err "$@"; exit "${EX_ERR}"; }
_die_usage() { _err "$@"; _err "See --help"; exit "${EX_USAGE}"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_on_err() {
    local -r rc=$? cmd="${BASH_COMMAND}" depth="${#FUNCNAME[@]}"
    _err "Command failed (rc=${rc}): ${cmd}"
    local i; for (( i = 1; i < depth; i++ )); do
        _err "  at ${BASH_SOURCE[${i}]:-?}:${BASH_LINENO[i - 1]:-?} in ${FUNCNAME[${i}]:-main}"
    done
}
_register_cleanup() { _CLEANUP_STACK+=("$1"); }
_run_cleanups() {
    (( _CLEANING )) && return; _CLEANING=1
    local i; for (( i = ${#_CLEANUP_STACK[@]} - 1; i >= 0; i-- )); do
        eval "${_CLEANUP_STACK[${i}]}" 2>/dev/null || true
    done
}
_mono_now() { local -n _o=$1; (( _BASH_V >= 503 )) && _o="${BASH_MONOSECONDS}" || _o="${EPOCHREALTIME}"; }
_perf_log() {
    local -r label="$1" start="$2"
    (( _BASH_V >= 503 )) \
        && { _info "${label}: $(( BASH_MONOSECONDS - start ))ms"; return; }
    local -r end="${EPOCHREALTIME}" s0="${start%.*}" u0="${start#*.}"
    local -r s1="${end%.*}" u1="${end#*.}"
    _info "${label}: $(( ((s1 - s0) * 1000000 + 10#${u1} - 10#${u0}) / 1000 ))ms"
}
_discover_files() {
    local -r src_dir="$1"; local -n _out=$2
    (( _BASH_V >= 503 )) && { local GLOBSORT='-mtime'; _out=("${src_dir}"/*.json); return; }
    command -v fd >/dev/null 2>&1 \
        && { readarray -d '' -t _out < <(fd -e json --type f --print0 . "${src_dir}"); return; }
    _debug "fd unavailable — find fallback"
    readarray -d '' -t _out < <(find "${src_dir}" -name '*.json' -type f -print0)
}
_extract_page() {
    local -r file="$1" offset="$2" limit="$3"; local -n _page=$4
    _page="$(jq -c "[limit(${limit}; skip(${offset}; .events[]))]
        | map(select(.level != null))
        | map({level: (.level | trim), latency: .latency_ms,
               endpoint: (.endpoint // \"unknown\")})" "${file}" 2>/dev/null)" \
        || { _page="[]"; return 1; }
}
_aggregate_metrics() {
    local -r json_array="$1"; local -n _agg=$2
    _agg="$(jq -c '{
        total: length,
        avg_latency: (if length > 0 then ([.[].latency] | add(0) / length) else 0 end),
        by_level: (group_by(.level) | map({key: .[0].level, value: length}) | from_entries),
        by_endpoint: (group_by(.endpoint) | map({key: .[0].endpoint, value: {
            count: length, p: ([.[].latency] | add(0) / length)
        }}) | from_entries)
    }' <<< "${json_array}")"
}
_accumulate() {
    local -n _accum=$1; local -r key="$2" value="$3"
    _accum["${key}"]="${value}"
}
# shellcheck disable=SC2178  # Nameref targets — ShellCheck misreads string namerefs as array conflict
_process_file() {
    local -r file="$1" offset="$2" limit="$3"; local -n _out=$4
    local page_data=""
    _extract_page "${file}" "${offset}" "${limit}" page_data || { _out="null"; return 1; }
    local -r count="$(jq 'length' <<< "${page_data}")"
    (( count > 0 )) || { _out="null"; return 1; }
    local aggregated=""
    _aggregate_metrics "${page_data}" aggregated
    _out="$(jq -c --arg file "${file##*/}" '. + {file: $file}' <<< "${aggregated}")"
}
_write_atomic() {
    local -r dest="$1"; shift
    local saved_umask; saved_umask="$(umask)"; umask 077
    local -r tmp="$(mktemp "${dest}.tmp.XXXXXX")"; umask "${saved_umask}"
    _register_cleanup "rm -f $(printf '%q' "${tmp}")"
    "$@" > "${tmp}" || { rm -f "${tmp}"; return 1; }
    mv -f "${tmp}" "${dest}"
}
_assemble_output() {
    local -n _results=$1
    local -a fragments=()
    local key; for key in "${!_results[@]}"; do
        [[ "${_results[${key}]}" == "null" ]] || fragments+=("${_results[${key}]}")
    done
    printf '%s\n' "${fragments[@]}" | jq -sc '{
        pipeline_version: "'"${VERSION}"'",
        files_processed: length,
        total_events: ([.[].total] | add(0)),
        overall_avg_latency: (if length > 0 then ([.[].avg_latency] | add(0) / length) else 0 end),
        level_totals: (reduce .[].by_level as $x ({}; reduce ($x | to_entries[]) as $e (.; .[$e.key] = ((.[$e.key] // 0) + $e.value)))),
        per_file: .
    }'
}

# --- [OPTIONS] ----------------------------------------------------------------

declare -Ar _OPT_META=(
    [h]="-h|--help|Show help||"
    [p]="-p|--page-size|Events per file page|N|50"
    [o]="-o|--offset|Event offset for pagination|N|0"
    [v]="-v|--verbose|Verbose output||"
    [d]="-d|--debug|Debug mode||"
)
readonly _OPT_DISPLAY_ORDER="h p o v d"

_usage() {
    printf '%s%s v%s%s\n\nLog metrics aggregation pipeline.\n' "${_BOLD}" "${SCRIPT_NAME}" "${VERSION}" "${_RESET}"
    printf '\n%sUSAGE:%s\n  %s [OPTIONS] SOURCE_DIR OUTPUT.json\n' "${_BOLD}" "${_RESET}" "${SCRIPT_NAME}"
    printf '\n%sOPTIONS:%s\n' "${_BOLD}" "${_RESET}"
    local key short long desc value_name default flag
    for key in ${_OPT_DISPLAY_ORDER}; do
        [[ -v _OPT_META["${key}"] ]] || continue
        IFS='|' read -r short long desc value_name default <<< "${_OPT_META[${key}]}"
        flag="${short}, ${long}"; [[ -n "${value_name}" ]] && flag+=" ${value_name}"
        printf '  %-28s %s' "${flag}" "${desc}"
        [[ -n "${default}" ]] && printf ' %s(default: %s)%s' "${_DIM}" "${default}" "${_RESET}"
        printf '\n'
    done
    printf '\n%sINPUT:%s  {"events": [{"level":"INFO","latency_ms":42,"endpoint":"/api"}]}\n' "${_BOLD}" "${_RESET}"
    printf '\n%sEXAMPLES:%s\n  %s ./logs metrics.json\n' "${_BOLD}" "${_RESET}" "${SCRIPT_NAME}"
    printf '  LOG_FORMAT=json %s -p 100 ./logs out.json 2>structured.jsonl\n' "${SCRIPT_NAME}"
}

# --- [PARSER] -----------------------------------------------------------------

_parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            -h|--help)       _usage; exit 0 ;;
            -p|--page-size)  PAGE_SIZE="${2:?--page-size requires N}"
                             [[ "${PAGE_SIZE}" =~ ^[1-9][0-9]*$ ]] || _die_usage "--page-size requires positive integer"
                             shift 2 ;;
            -o|--offset)     PAGE_OFFSET="${2:?--offset requires N}"
                             [[ "${PAGE_OFFSET}" =~ ^[0-9]+$ ]] || _die_usage "--offset requires non-negative integer"
                             shift 2 ;;
            -v|--verbose)    LOG_LEVEL=1; shift ;;
            -d|--debug)      LOG_LEVEL=0; shift ;;
            --self-test)     _self_test; exit 0 ;;
            --)              shift; break ;;
            -*)              _die_usage "Unknown option: $1" ;;
            *)               break ;;
        esac
    done
    POSITIONAL_ARGS=("$@")
}

# --- [TESTING] ----------------------------------------------------------------

_self_test() {
    _info "Running self-tests..."
    local -r test_data='[{"level":" INFO ","latency_ms":10,"endpoint":"/a"},{"level":"ERROR","latency_ms":20,"endpoint":"/b"}]'
    local agg=""; _aggregate_metrics "${test_data}" agg
    [[ "$(jq '.total' <<< "${agg}")" == "2" ]] || _die "ASSERT: aggregate total failed"
    [[ "$(jq -r '.by_level | keys[0]' <<< "${agg}")" == "ERROR" ]] || _die "ASSERT: trim/level failed"
    _info "All tests passed"
}

# --- [EXPORT] -----------------------------------------------------------------

trap '_on_err' ERR
trap '_run_cleanups' EXIT
_main() {
    _parse_args "$@"
    readonly LOG_LEVEL PAGE_SIZE PAGE_OFFSET POSITIONAL_ARGS
    local -r src_dir="${POSITIONAL_ARGS[0]:?SOURCE_DIR required. See --help}"
    local -r output="${POSITIONAL_ARGS[1]:?OUTPUT.json required. See --help}"
    [[ -d "${src_dir}" ]] || _die "Not a directory: ${src_dir}"
    local t0; _mono_now t0
    local td; _mono_now td
    local -a log_files=()
    _discover_files "${src_dir}" log_files
    _perf_log "Discovery" "${td}"
    (( ${#log_files[@]} > 0 )) || _die "No JSON files in ${src_dir}"
    _info "Found ${#log_files[@]} files (page=${PAGE_SIZE}, offset=${PAGE_OFFSET})"
    # used via nameref in _accumulate
    # shellcheck disable=SC2034
    local -A file_results=()
    local tp; _mono_now tp
    local -i ok=0 skip=0
    local file result
    for file in "${log_files[@]}"; do
        result=""
        # shellcheck disable=SC2015
        _process_file "${file}" "${PAGE_OFFSET}" "${PAGE_SIZE}" result \
            && { _accumulate file_results "${file##*/}" "${result}"; (( ok++ )); } \
            || { _debug "Skipped: ${file##*/}"; (( skip++ )); }
    done
    _perf_log "Processing" "${tp}"
    _info "Processed: ${ok}/${#log_files[@]} succeeded, ${skip} skipped"
    _write_atomic "${output}" _assemble_output file_results
    _perf_log "Total" "${t0}"
    _info "Output: ${output}"
}
_main "$@"
