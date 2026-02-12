#!/usr/bin/env bash
# Cluster health check -- table-driven kubectl diagnostics
# Dependencies: kubectl, jq
# Usage: ./cluster_health.sh
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly SEPARATOR="========================================"

# --- [DEPENDENCY_CHECK] -------------------------------------------------------
command -v jq >/dev/null 2>&1 || printf '[WARN] jq not found -- CrashLoopBackOff/ImagePullBackOff detection skipped\n' >&2

# --- [DIAGNOSTIC_TABLE] -------------------------------------------------------
readonly -a SECTIONS=(
    "CLUSTER INFO:kubectl cluster-info"
    "NODES:kubectl get nodes -o wide"
    "NODE RESOURCES:kubectl top nodes 2>/dev/null || printf 'Metrics server unavailable\n'"
    "NODE CONDITIONS:kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}\t{.status.conditions[?(@.type==\"Ready\")].status}{\"\n\"}{end}'"
    "PARAMETRIC PODS:kubectl get pods -n parametric -o wide"
    "PARAMETRIC RESOURCES:kubectl top pods -n parametric --containers 2>/dev/null || printf 'Metrics unavailable\n'"
    "PARAMETRIC HPA:kubectl get hpa -n parametric 2>/dev/null || printf 'No HPAs\n'"
    "PARAMETRIC OBSERVABILITY:kubectl get pods -n parametric -l tier=observe -o wide 2>/dev/null || printf 'No observe pods\n'"
    "PARAMETRIC EVENTS (last 50):kubectl events -n parametric --sort-by=lastTimestamp 2>/dev/null || kubectl get events -n parametric --sort-by='.lastTimestamp' 2>/dev/null | tail -50"
    "ALL PODS:kubectl get pods --all-namespaces -o wide"
    "PROBLEMATIC PODS:kubectl get pods --all-namespaces --field-selector=status.phase!=Running,status.phase!=Succeeded"
    "DEPLOYMENTS:kubectl get deployments --all-namespaces"
    "SERVICES:kubectl get services --all-namespaces"
    "DAEMONSETS:kubectl get daemonsets --all-namespaces"
    "HPAs:kubectl get hpa --all-namespaces 2>/dev/null || printf 'No HPAs\n'"
    "PVCs:kubectl get pvc --all-namespaces"
    "COMPONENT HEALTH:kubectl get --raw='/readyz?verbose' 2>/dev/null || kubectl get componentstatuses 2>/dev/null || printf 'Health endpoint unavailable\n'"
    "CRASHLOOPBACKOFF:kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.status.containerStatuses[]?.state.waiting?.reason==\"CrashLoopBackOff\") | \"\(.metadata.namespace)/\(.metadata.name)\"' 2>/dev/null || printf 'None\n'"
    "IMAGEPULLBACKOFF:kubectl get pods --all-namespaces -o json | jq -r '.items[] | select(.status.containerStatuses[]?.state.waiting?.reason==\"ImagePullBackOff\") | \"\(.metadata.namespace)/\(.metadata.name)\"' 2>/dev/null || printf 'None\n'"
    "NETWORK POLICIES:kubectl get networkpolicies --all-namespaces 2>/dev/null || printf 'None\n'"
    "RESOURCE QUOTAS:kubectl get resourcequotas --all-namespaces"
    "INGRESSES:kubectl get ingresses --all-namespaces"
)

# --- [ENTRY_POINT] ------------------------------------------------------------
_ts=""; printf -v _ts '%(%Y-%m-%d %H:%M:%S UTC)T' -1
printf '%s\nCluster Health @ %s\n%s\n' "${SEPARATOR}" "${_ts}" "${SEPARATOR}"
for entry in "${SECTIONS[@]}"; do
    printf '\n## %s ##\n' "${entry%%:*}"
    eval "${entry#*:}" || true
done

printf -v _ts '%(%Y-%m-%d %H:%M:%S UTC)T' -1
printf '\n%s\nDone @ %s\n%s\n' "${SEPARATOR}" "${_ts}" "${SEPARATOR}"
