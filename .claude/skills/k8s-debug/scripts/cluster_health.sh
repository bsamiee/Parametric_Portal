#!/usr/bin/env bash
# Cluster health check -- function-dispatched kubectl diagnostics
# Dependencies: kubectl, jq
# Usage: ./cluster_health.sh
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly SEPARATOR="========================================"

# --- [ERRORS] -----------------------------------------------------------------

_err()  { printf '[ERROR] %s\n' "$1" >&2; }
_warn() { printf '[WARN] %s\n' "$1" >&2; }
_info() { printf '[INFO] %s\n' "$1"; }
_ok()   { printf '[OK] %s\n' "$1"; }

# --- [FUNCTIONS] --------------------------------------------------------------

command -v jq &>/dev/null || { _err "jq required"; exit 2; }
_diag_cluster_info()         { kubectl cluster-info; }
_diag_nodes()                { kubectl get nodes -o wide; }
_diag_node_resources()       { kubectl top nodes 2>/dev/null || printf 'Metrics server unavailable\n'; }
_diag_node_conditions()      { kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}'; }
_diag_parametric_pods()      { kubectl get pods -n parametric -o wide; }
_diag_parametric_resources() { kubectl top pods -n parametric --containers 2>/dev/null || printf 'Metrics unavailable\n'; }
_diag_parametric_hpa()       { kubectl get hpa -n parametric 2>/dev/null || printf 'No HPAs\n'; }
_diag_parametric_observe()   { kubectl get pods -n parametric -l tier=observe -o wide 2>/dev/null || printf 'No observe pods\n'; }
_diag_parametric_events()    { kubectl events -n parametric --sort-by=lastTimestamp 2>/dev/null || kubectl get events -n parametric --sort-by='.lastTimestamp' 2>/dev/null | tail -50; }
_diag_all_pods()             { kubectl get pods --all-namespaces -o wide; }
_diag_problematic_pods()     { kubectl get pods --all-namespaces --field-selector=status.phase!=Running,status.phase!=Succeeded; }
_diag_deployments()          { kubectl get deployments --all-namespaces; }
_diag_services()             { kubectl get services --all-namespaces; }
_diag_daemonsets()           { kubectl get daemonsets --all-namespaces; }
_diag_hpas()                 { kubectl get hpa --all-namespaces 2>/dev/null || printf 'No HPAs\n'; }
_diag_pvcs()                 { kubectl get pvc --all-namespaces; }
_diag_component_health()     { kubectl get --raw='/readyz?verbose' 2>/dev/null || kubectl get componentstatuses 2>/dev/null || printf 'Health endpoint unavailable\n'; }
_diag_crashloopbackoff()     { kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.status.containerStatuses[]?.state.waiting?.reason=="CrashLoopBackOff") | "\(.metadata.namespace)/\(.metadata.name)"' 2>/dev/null || printf 'None\n'; }
_diag_imagepullbackoff()     { kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.status.containerStatuses[]?.state.waiting?.reason=="ImagePullBackOff") | "\(.metadata.namespace)/\(.metadata.name)"' 2>/dev/null || printf 'None\n'; }
_diag_network_policies()     { kubectl get networkpolicies --all-namespaces 2>/dev/null || printf 'None\n'; }
_diag_resource_quotas()      { kubectl get resourcequotas --all-namespaces; }
_diag_ingresses()            { kubectl get ingresses --all-namespaces; }
readonly -a _DIAGNOSTICS=(
    "CLUSTER INFO:_diag_cluster_info"
    "NODES:_diag_nodes"
    "NODE RESOURCES:_diag_node_resources"
    "NODE CONDITIONS:_diag_node_conditions"
    "PARAMETRIC PODS:_diag_parametric_pods"
    "PARAMETRIC RESOURCES:_diag_parametric_resources"
    "PARAMETRIC HPA:_diag_parametric_hpa"
    "PARAMETRIC OBSERVABILITY:_diag_parametric_observe"
    "PARAMETRIC EVENTS (last 50):_diag_parametric_events"
    "ALL PODS:_diag_all_pods"
    "PROBLEMATIC PODS:_diag_problematic_pods"
    "DEPLOYMENTS:_diag_deployments"
    "SERVICES:_diag_services"
    "DAEMONSETS:_diag_daemonsets"
    "HPAs:_diag_hpas"
    "PVCs:_diag_pvcs"
    "COMPONENT HEALTH:_diag_component_health"
    "CRASHLOOPBACKOFF:_diag_crashloopbackoff"
    "IMAGEPULLBACKOFF:_diag_imagepullbackoff"
    "NETWORK POLICIES:_diag_network_policies"
    "RESOURCE QUOTAS:_diag_resource_quotas"
    "INGRESSES:_diag_ingresses"
)
_run_diagnostics() {
    local entry label fn
    local idx=0
    while (( idx < ${#_DIAGNOSTICS[@]} )); do
        entry="${_DIAGNOSTICS[idx]}"
        (( idx++ ))
        label="${entry%%:*}"
        fn="${entry#*:}"
        printf '\n## %s ##\n' "${label}"
        "${fn}" || true
    done
}

# --- [EXPORT] -----------------------------------------------------------------

_report_ts=""
printf -v _report_ts '%(%Y-%m-%d %H:%M:%S UTC)T' -1
printf '%s\nCluster Health @ %s\n%s\n' "${SEPARATOR}" "${_report_ts}" "${SEPARATOR}"
_run_diagnostics
printf -v _report_ts '%(%Y-%m-%d %H:%M:%S UTC)T' -1
printf '\n%s\nDone @ %s\n%s\n' "${SEPARATOR}" "${_report_ts}" "${SEPARATOR}"
