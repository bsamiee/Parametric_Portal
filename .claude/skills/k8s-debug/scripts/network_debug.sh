#!/usr/bin/env bash
# Network diagnostics for a pod in the parametric namespace
# Usage: ./network_debug.sh <namespace> <pod>
# Dependencies: kubectl
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly NAMESPACE="${1:-parametric}"
readonly POD_NAME="${2:?Usage: $0 <namespace> <pod>}"
readonly SEP="========================================"
POD_IP="$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.podIP}')"
readonly POD_IP
HOST_IP="$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.hostIP}')"
readonly HOST_IP

# --- [ERRORS] -----------------------------------------------------------------

_err()  { printf '[ERROR] %s\n' "$1" >&2; }
_warn() { printf '[WARN] %s\n' "$1" >&2; }
_info() { printf '[INFO] %s\n' "$1"; }
_ok()   { printf '[OK] %s\n' "$1"; }

# --- [FUNCTIONS] --------------------------------------------------------------

_diag_pod_ips()          { printf 'Pod: %s  Host: %s\n' "${POD_IP}" "${HOST_IP}"; }
_diag_dns_config()       { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- cat /etc/resolv.conf 2>/dev/null || printf 'Unavailable\n'; }
_diag_dns_kubernetes()   { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- nslookup kubernetes.default.svc.cluster.local 2>/dev/null || printf 'DNS tools unavailable\n'; }
_diag_dns_compute()      { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- nslookup compute-svc.parametric.svc.cluster.local 2>/dev/null || printf 'DNS tools unavailable\n'; }
_diag_svc_connectivity() { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- curl -sk --max-time 5 -o /dev/null -w '%{http_code}' http://compute-svc.parametric.svc.cluster.local:4000/api/health/liveness 2>/dev/null || printf 'curl unavailable\n'; }
_diag_services()         { kubectl get svc -n "${NAMESPACE}"; }
_diag_endpoints()        { kubectl get endpoints -n "${NAMESPACE}"; }
_diag_netpol()           { kubectl get networkpolicies -n "${NAMESPACE}" 2>/dev/null || printf 'None\n'; }
_diag_pod_labels()       { kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.metadata.labels}'; }
_diag_interfaces()       { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- ip addr 2>/dev/null || printf 'ip not available\n'; }
_diag_routes()           { kubectl exec "${POD_NAME}" -n "${NAMESPACE}" -- ip route 2>/dev/null || printf 'ip not available\n'; }
_diag_coredns()          { kubectl get pods -n kube-system -l k8s-app=kube-dns -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\n"}{end}' 2>/dev/null || printf 'Unavailable\n'; }
readonly -a _DIAGNOSTICS=(
    "POD IPs:_diag_pod_ips"
    "DNS CONFIG:_diag_dns_config"
    "DNS TEST (kubernetes):_diag_dns_kubernetes"
    "DNS TEST (compute-svc):_diag_dns_compute"
    "SERVICE CONNECTIVITY:_diag_svc_connectivity"
    "SERVICES:_diag_services"
    "ENDPOINTS:_diag_endpoints"
    "NETWORK POLICIES:_diag_netpol"
    "POD LABELS:_diag_pod_labels"
    "INTERFACES:_diag_interfaces"
    "ROUTES:_diag_routes"
    "COREDNS STATUS:_diag_coredns"
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
printf '%s\nNetwork Debug: %s (ns: %s) @ %s\n%s\n' "${SEP}" "${POD_NAME}" "${NAMESPACE}" "${_report_ts}" "${SEP}"
_run_diagnostics
printf '\n%s\nDone\n%s\n' "${SEP}" "${SEP}"
