#!/usr/bin/env bash
# pg_lint — PostgreSQL 18 anti-pattern linter

set -Eeuo pipefail
shopt -s inherit_errexit nullglob extglob
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly _OK=0 _FAIL=1 _USAGE=2 _S=$'\x1f'
readonly _R=$'\033[31m' _Y=$'\033[33m' _G=$'\033[32m' _B=$'\033[1m' _Z=$'\033[0m'
declare -i _t=0; [[ -t 1 ]] && _t=1; readonly _TTY="${_t}"; unset -v _t
declare -Ar _CLR=([E]="${_R}" [W]="${_Y}")
declare -Ar _CTR=([E]=_errs [W]=_warns)

# --- [TRAPS] ------------------------------------------------------------------

declare -a _CLEANUP=()
declare -i _CLEANING=0
_register() { _CLEANUP+=("$1"); }
_on_exit() {
    (( _CLEANING )) && return; _CLEANING=1
    local i; for (( i=${#_CLEANUP[@]}-1; i>=0; i-- )); do rm -rf -- "${_CLEANUP[i]}" 2>/dev/null || :; done
}
# shellcheck disable=SC2329
_on_err() {
    printf '%s[ERR]%s pg_lint:%d in %s() — %s\n' \
        "${_R}" "${_Z}" "${BASH_LINENO[0]}" "${FUNCNAME[1]:-main}" "${BASH_COMMAND}" >&2
}
trap _on_exit EXIT
trap _on_err ERR

# --- [EMITTERS] ---------------------------------------------------------------

_emit_json() {
    jq -cn --arg l "$1" --arg v "$2" --arg m "$3" --arg c "$4" \
        '{label:$l,level:$v,message:$m,location:$c}'
}
_emit_text() {
    (( _TTY )) \
        && printf '%s[%s]%s %s — %s\n' "${_CLR[$2]}" "$1" "${_Z}" "$3" "$4" \
        || printf '[%s] %s — %s\n' "$1" "$3" "$4"
}
_emit() {
    case "${_FMT}" in
        json) _emit_json "$@" ;;
        text) _emit_text "$@" ;;
    esac
}

# --- [RULES] ------------------------------------------------------------------

# LABEL<FS>LEVEL<FS>EXT<FS>FLAGS<FS>MESSAGE<FS>PATTERN
readonly -a _RG_RULES=(
    "DUAL_COLUMN_RANGE${_S}E${_S}sql${_S}-i${_S}Use tstzrange — never dual start/end columns${_S}(start_date|_start|valid_from|begin_at).*(end_date|_end|valid_to|end_at)"
    "LEGACY_UUID${_S}W${_S}sql${_S}-i${_S}Prefer uuidv7() for new ordered PKs; justify random UUIDs by workload${_S}(uuid_generate_v4|gen_random_uuid)\\s*\\("
    "NOW_DEFAULT${_S}E${_S}sql${_S}-iP${_S}Use clock_timestamp() — now() is txn-start${_S}DEFAULT\\s+now\\s*\\(\\)"
    "OFFSET_PAGINATION${_S}E${_S}sql${_S}-iP${_S}Use keyset pagination${_S}LIMIT\\s+\\S+\\s+OFFSET"
    "NULL_UNSAFE_ANTIJOIN${_S}E${_S}sql${_S}-iP${_S}Use NOT EXISTS — NULL poisons NOT IN${_S}NOT\\s+IN\\s*\\(\\s*SELECT"
    "IMPERATIVE_BATCH${_S}E${_S}sql${_S}-iP${_S}Use set-based MERGE/CTE — not row-at-a-time${_S}FOR\\s+\\w+\\s+IN\\s+.*\\bLOOP\\b"
    "IF_THEN_DISPATCH${_S}E${_S}sql${_S}-iP${_S}Use VALUES-based dynamic SQL${_S}\\bIF\\b.*\\bTHEN\\b.*\\bELSIF\\b"
    "BARE_FOR_UPDATE${_S}W${_S}sql${_S}-P${_S}Queue/batch FOR UPDATE usually needs SKIP LOCKED; justify plain row locks${_S}FOR\\s+UPDATE\\b(?![^;]*(SKIP\\s+LOCKED|NOWAIT|OF\\s+\\w+))"
    "NONCOMPOSABLE_CAGG${_S}W${_S}sql${_S}-iP${_S}Non-composable across CAGG tiers${_S}percentile_(cont|disc)\\s*\\("
    "DISTINCT_OVER_EXISTS${_S}W${_S}sql${_S}-iP${_S}Use EXISTS semi-join — DISTINCT forces sort/dedup${_S}SELECT\\s+DISTINCT\\b.*\\bJOIN\\b"
    "EXTENSION_POLICY${_S}W${_S}sql${_S}-iP${_S}Document extension availability, privileges, and upgrade posture${_S}CREATE\\s+EXTENSION\\b(?!.*IF\\s+NOT\\s+EXISTS)"
    "TRIGGER_LOGIC${_S}W${_S}sql${_S}-iP${_S}Prefer MERGE RETURNING or generated columns${_S}CREATE\\s+(OR\\s+REPLACE\\s+)?TRIGGER"
    "EXCLUDE_WITHOUT_OVERLAPS${_S}W${_S}sql${_S}-iP${_S}Use WITHOUT OVERLAPS PK/UNIQUE for temporal constraints in PG 18${_S}EXCLUDE\\s+USING\\s+gist\\s*\\(.*&&"
    "UNVALIDATED_CONSTRAINT${_S}W${_S}sql${_S}-iP${_S}Use NOT VALID + VALIDATE two-phase${_S}ADD\\s+CONSTRAINT\\b(?!.*NOT\\s+VALID)"
    "MISSING_CONCURRENTLY${_S}W${_S}sql${_S}-P${_S}Use CREATE INDEX CONCURRENTLY in migrations${_S}CREATE\\s+(UNIQUE\\s+)?INDEX\\b(?!\\s+CONCURRENTLY)"
    "APPLICATION_SIDE_JSON${_S}W${_S}sql${_S}-iP${_S}Use jsonb_path_query/JSON_TABLE${_S}SELECT\\s+\\w+\\.(data|metadata|payload|config|settings)\\s*(,|\\s+FROM)"
    "STRING_TYPING${_S}W${_S}sql${_S}-P${_S}Bare text — consider domain type or CHECK${_S}^\\s+\\w+\\s+text\\s+NOT\\s+NULL(?!\\s*(CHECK|GENERATED|DEFAULT|REFERENCES))"
    "FUNCTION_PROLIFERATION${_S}W${_S}sql${_S}-iP${_S}Consolidate getter functions polymorphically${_S}CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(get_|find_|fetch_|lookup_)"
    "MANUAL_PARTITION${_S}W${_S}sql${_S}-iP${_S}Use pg_partman for partition lifecycle${_S}CREATE\\s+TABLE\\s+\\w+\\s+PARTITION\\s+OF"
    "STALE_HEALTH_VIEW${_S}W${_S}sql${_S}-iP${_S}MV is stale — use inline query for real-time${_S}CREATE\\s+MATERIALIZED\\s+VIEW\\s+\\w*(health|status|monitor|live|active)"
    "RAW_UUID_ID${_S}E${_S}ts${_S}-P${_S}Brand entity IDs: S.UUID.pipe(S.brand('XId'))${_S}S\\.UUID(?!\\.pipe\\(S\\.brand)"
)
# LABEL<FS>LEVEL<FS>PRESENT<FS>ABSENT<FS>MESSAGE
readonly -a _PAIR_RULES=(
    "SECURITY_DEFINER_LEAK${_S}E${_S}SECURITY\\s+DEFINER${_S}SET\\s+search_path${_S}SECURITY DEFINER without SET search_path — injection vector"
    "RLS_WITHOUT_FORCE${_S}E${_S}ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY${_S}FORCE\\s+ROW\\s+LEVEL\\s+SECURITY${_S}ENABLE RLS without FORCE — owner bypasses policies"
    "STRINGLY_POLICY${_S}E${_S}CREATE\\s+POLICY${_S}current_setting${_S}RLS policy without current_setting() — hardcoded tenant literals"
)

# --- [ENGINE] -----------------------------------------------------------------

declare -i _errs=0 _warns=0 _checks=0

_tally() {
    local -r label="$1" level="$2" msg="$3"
    [[ -n "$4" ]] || return 0
    local -a lines; mapfile -t lines <<< "$4"
    local -n ctr="${_CTR[${level}]}"
    (( ctr += ${#lines[@]} ))
    [[ "${_QUIET}" == true ]] && return 0
    local line; for line in "${lines[@]}"; do _emit "${label}" "${level}" "${msg}" "${line}"; done
}
_run_rg() {
    local -r workdir="$1"
    local -A meta=()
    local rule label level ext flags msg pattern idx=0
    for rule in "${_RG_RULES[@]}"; do
        IFS="${_S}" read -r label level ext flags msg pattern <<< "${rule}"
        [[ "${ext}" == "ts" && "${_TS}" != true ]] && continue
        [[ "${ext}" == "sql" && "${_SQL}" != true ]] && continue
        (( ++_checks ))
        meta[${idx}]="${label}${_S}${level}${_S}${msg}"
        # shellcheck disable=SC2086
        { rg --no-heading -n --glob "*.${ext}" ${flags} -- "${pattern}" "${_PATHS[@]}" \
            > "${workdir}/${idx}" 2>/dev/null || :; } &
        (( ++idx ))
    done
    wait
    local f key; for f in "${workdir}"/*; do
        [[ -s "${f}" ]] || continue
        key="${f##*/}"
        IFS="${_S}" read -r label level msg <<< "${meta[${key}]}"
        _tally "${label}" "${level}" "${msg}" "$(<"${f}")"
    done
}
_run_pairs() {
    [[ "${_SQL}" == true ]] || return 0
    local rule label level present absent msg
    local -a files violations
    for rule in "${_PAIR_RULES[@]}"; do
        IFS="${_S}" read -r label level present absent msg <<< "${rule}"
        (( ++_checks ))
        mapfile -t files < <(rg -l "${present}" --glob '*.sql' "${_PATHS[@]}" 2>/dev/null)
        [[ ${#files[@]} -eq 0 ]] && continue
        mapfile -t violations < <(rg --files-without-match "${absent}" "${files[@]}" 2>/dev/null)
        [[ ${#violations[@]} -eq 0 ]] && continue
        local hits; hits=$(rg -H --no-heading -n "${present}" "${violations[@]}" 2>/dev/null) || true
        [[ -n "${hits}" ]] && _tally "${label}" "${level}" "${msg}" "${hits}"
    done
}
_check_sprawl() {
    [[ "${_SQL}" == true ]] || return 0
    (( ++_checks ))
    local results
    # shellcheck disable=SC2016
    results=$(rg --no-filename --glob '*.sql' -ioP \
        'CREATE\s+(UNIQUE\s+)?INDEX\s+\w+\s+ON\s+(\w+)\s*\(([^)]+)\)' \
        --replace '$2|$3' "${_PATHS[@]}" 2>/dev/null | \
        awk -F'|' '{gsub(/[[:space:]]/,"",$2); if(split($2,c,",")==1)s[$1]++}
            END{for(t in s)if(s[t]>=3)printf "%d single-col indexes — review composite subsumption\ttable:%s\n",s[t],t}') || true
    [[ -z "${results}" ]] && return 0
    local -a lines; mapfile -t lines <<< "${results}"
    local line m l; for line in "${lines[@]}"; do
        IFS=$'\t' read -r m l <<< "${line}"
        (( ++_warns )); _emit "INDEX_SPRAWL" "W" "${m}" "${l}"
    done
}

# --- [INTERFACE] --------------------------------------------------------------
_usage() { cat <<'EOF'
pg_lint — PostgreSQL 18 anti-pattern linter
USAGE:  pg_lint [OPTIONS] [PATH...]
  -h,--help  -q,--quiet  --sql-only  --ts-only  --json  --self-test
EXIT: 0=clean 1=errors 2=usage
EOF
}

_SQL=true _TS=true _QUIET=false _FMT=text
declare -a _PATHS=()
_parse() {
    while (( $# )); do
        case "$1" in
            -h|--help)    _usage; exit 0 ;;
            -q|--quiet)   _QUIET=true; shift ;;
            --sql-only)   _TS=false; shift ;;
            --ts-only)    _SQL=false; shift ;;
            --json)       _FMT=json; shift ;;
            --self-test)  _self_test; exit $? ;;
            --)           shift; break ;;
            -*)           printf 'Unknown: %s\n' "$1" >&2; _usage >&2; exit "${_USAGE}" ;;
            *)            break ;;
        esac
    done
    _PATHS=("${@:-.}")
}
_summary() {
    [[ "${_QUIET}" == true ]] && return 0
    local -ri elapsed="${_elapsed:-0}" total=$(( _errs + _warns ))
    local -r line="${_checks} checks — ${_errs} errors, ${_warns} warnings (${elapsed} us)"
    [[ "${_FMT}" == json ]] && { printf '{"summary":true,"checks":%d,"errors":%d,"warnings":%d,"elapsed_us":%d}\n' \
        "${_checks}" "${_errs}" "${_warns}" "${elapsed}"; return; }
    local clr; (( total > 0 )) && clr="${_R}" || clr="${_G}"
    (( _TTY )) && printf '\n%s%s%s%s\n' "${_B}" "${clr}" "${line}" "${_Z}" || printf '\n%s\n' "${line}"
}

# --- [SELF-TEST] --------------------------------------------------------------

_self_test() {
    local -i pass=0 fail=0
    local _SQL=true _TS=false _QUIET=true _FMT=text
    local -i _errs=0 _warns=0 _checks=0
    local -a _PATHS=()
    local td; td=$(mktemp -d)
    local wd; wd=$(mktemp -d "${td}/w.XXXXXX")
    cat > "${td}/bad.sql" <<'SQL'
CREATE TABLE t (start_date date, end_date date);
SELECT * FROM t LIMIT 10 OFFSET 20;
id uuid DEFAULT gen_random_uuid() PRIMARY KEY;
DEFAULT now();
SELECT * FROM orders WHERE id NOT IN (SELECT order_id FROM returns);
SQL
    cat > "${td}/bad_rls.sql" <<'SQL'
CREATE FUNCTION x() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON t USING (tenant_id = 'hardcoded');
SQL
    _PATHS=("${td}")
    _run_rg "${wd}"; _run_pairs
    _assert() {
        [[ "$2" == "$3" ]] && { (( ++pass )); return 0; }
        printf 'FAIL: %s (expected=%s actual=%s)\n' "$1" "$2" "$3" >&2; (( ++fail )); return 0
    }
    _assert "rg errors detected" true "$( (( _errs >= 4 )) && printf true || printf false)"
    _assert "pair errors detected" true "$( (( _errs >= 7 )) && printf true || printf false)"
    _assert "checks executed" true "$( (( _checks >= 20 )) && printf true || printf false)"
    printf '%d passed, %d failed (%d checks, %d errors, %d warnings)\n' \
        "${pass}" "${fail}" "${_checks}" "${_errs}" "${_warns}"
    rm -rf -- "${td}"
    return $(( fail > 0 ))
}

# --- [ENTRY] ------------------------------------------------------------------

_main() {
    _parse "$@"
    readonly _SQL _TS _QUIET _FMT _PATHS
    command -v rg >/dev/null 2>&1 \
        || { printf '%s[ERR]%s ripgrep (rg) required\n' "${_R}" "${_Z}" >&2; exit "${_USAGE}"; }
    [[ "${_FMT}" != json ]] || command -v jq >/dev/null 2>&1 \
        || { printf '%s[ERR]%s jq required for --json\n' "${_R}" "${_Z}" >&2; exit "${_USAGE}"; }
    local -r t0="${EPOCHREALTIME}"
    local workdir; workdir=$(mktemp -d)
    _register "${workdir}"
    _run_rg "${workdir}"
    _run_pairs
    _check_sprawl
    local -r t1="${EPOCHREALTIME}"
    declare -gi _elapsed=$(( (${t1%.*} - ${t0%.*}) * 1000000 + 10#${t1#*.} - 10#${t0#*.} ))
    _summary
    (( _errs > 0 )) && { _on_exit; exit "${_FAIL}"; }
    _on_exit
    exit "${_OK}"
}
_main "$@"
