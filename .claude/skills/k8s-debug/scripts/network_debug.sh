#!/usr/bin/env bash
# Network diagnostics for a pod in the parametric namespace
# Usage: ./network_debug.sh <namespace> <pod>
# Dependencies: kubectl
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
readonly NAMESPACE="${1:-parametric}"
readonly POD_NAME="${2:?Usage: $0 <namespace> <pod>}"
readonly SEP="========================================"
readonly POD_IP="$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.podIP}')"
readonly HOST_IP="$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.hostIP}')"

# --- [DIAGNOSTIC_TABLE] -------------------------------------------------------
readonly -a SECTIONS=(
    "POD IPs:printf 'Pod: %s  Host: %s\n' '${POD_IP}' '${HOST_IP}'"
    "DNS CONFIG:kubectl exec ${POD_NAME} -n ${NAMESPACE} -- cat /etc/resolv.conf 2>/dev/null || printf 'Unavailable\n'"
    "DNS TEST (kubernetes):kubectl exec ${POD_NAME} -n ${NAMESPACE} -- nslookup kubernetes.default.svc.cluster.local 2>/dev/null || printf 'DNS tools unavailable\n'"
    "DNS TEST (compute-svc):kubectl exec ${POD_NAME} -n ${NAMESPACE} -- nslookup compute-svc.parametric.svc.cluster.local 2>/dev/null || printf 'DNS tools unavailable\n'"
    "SERVICE CONNECTIVITY:kubectl exec ${POD_NAME} -n ${NAMESPACE} -- curl -sk --max-time 5 -o /dev/null -w '%{http_code}' http://compute-svc.parametric.svc.cluster.local:4000/api/health/liveness 2>/dev/null || printf 'curl unavailable\n'"
    "SERVICES:kubectl get svc -n ${NAMESPACE}"
    "ENDPOINTS:kubectl get endpoints -n ${NAMESPACE}"
    "NETWORK POLICIES:kubectl get networkpolicies -n ${NAMESPACE} 2>/dev/null || printf 'None\n'"
    "POD LABELS:kubectl get pod ${POD_NAME} -n ${NAMESPACE} -o jsonpath='{.metadata.labels}'"
    "INTERFACES:kubectl exec ${POD_NAME} -n ${NAMESPACE} -- ip addr 2>/dev/null || printf 'ip not available\n'"
    "ROUTES:kubectl exec ${POD_NAME} -n ${NAMESPACE} -- ip route 2>/dev/null || printf 'ip not available\n'"
    "COREDNS STATUS:kubectl get pods -n kube-system -l k8s-app=kube-dns -o jsonpath='{range .items[*]}{.metadata.name}\t{.status.phase}{\"\n\"}{end}' 2>/dev/null || printf 'Unavailable\n'"
)

# --- [ENTRY_POINT] ------------------------------------------------------------
local_ts=""; printf -v local_ts '%(%Y-%m-%d %H:%M:%S UTC)T' -1
printf '%s\nNetwork Debug: %s (ns: %s) @ %s\n%s\n' "${SEP}" "${POD_NAME}" "${NAMESPACE}" "${local_ts}" "${SEP}"
for entry in "${SECTIONS[@]}"; do
    printf '\n## %s ##\n' "${entry%%:*}"
    eval "${entry#*:}" || true
done

printf '\n%s\nDone\n%s\n' "${SEP}" "${SEP}"
