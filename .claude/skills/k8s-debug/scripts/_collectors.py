"""Diagnostic collector functions for pod_diagnostics.py.

Each collector follows the signature: (pod: str, namespace: str, container: str) -> str.
All collectors are pure functions wrapping kubectl calls at the system boundary.
"""

import subprocess
from typing import Final

# --- [CONSTANTS] --------------------------------------------------------------

_PROBE_NAMES: Final = ("livenessProbe", "readinessProbe", "startupProbe")


# --- [FUNCTIONS] --------------------------------------------------------------

def _kubectl(command: str, *, timeout: int = 30) -> str:
    """Execute kubectl, return stdout or stderr. Side effect at system boundary.

    Args:
        command: Shell command string to execute.
        timeout: Maximum execution time in seconds.

    Returns:
        Command stdout, or stderr if stdout is empty, or '[TIMEOUT]' on timeout.
    """
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout or result.stderr
    except subprocess.TimeoutExpired:
        return "[TIMEOUT]"


def _classify_pod_state(phase: str, restart_count: int) -> str:
    """Classify pod health from phase and restart count.

    Args:
        phase: Pod phase string from kubectl (e.g. 'Running', 'Succeeded', 'Failed').
        restart_count: Number of container restarts.

    Returns:
        Severity string: 'OK', 'WARN', or 'ERROR'.
    """
    match phase.lower():
        case "running" if restart_count == 0:
            return "OK"
        case "running":
            return "WARN"
        case "succeeded":
            return "OK"
        case _:
            return "ERROR"


def _parse_restart_count(raw: str) -> int:
    """Parse restart count from kubectl output, defaulting to 0.

    Args:
        raw: Raw string output from kubectl jsonpath query.

    Returns:
        Parsed integer restart count, or 0 if unparseable.
    """
    stripped = raw.strip()
    return int(stripped) if stripped.isdigit() else 0


def _container_logs_for_name(pod: str, namespace: str, name: str) -> str:
    """Collect current and previous logs for a single container."""
    current = _kubectl(
        f"kubectl logs {pod} -n {namespace} -c {name} --tail=100"
    )
    previous = _kubectl(
        f"kubectl logs {pod} -n {namespace} -c {name} --previous --tail=50 2>&1"
    )
    previous_section = (
        ""
        if "previous terminated container" in previous.lower()
        else f"--- {name} (previous) ---\n{previous}"
    )
    return f"--- {name} (current) ---\n{current}\n{previous_section}"


# --- [COLLECTORS] -------------------------------------------------------------

def status(pod: str, namespace: str, _container: str) -> str:
    """Collect pod status, phase, restart count, and health severity."""
    output = _kubectl(f"kubectl get pod {pod} -n {namespace} -o wide")
    phase = _kubectl(
        f"kubectl get pod {pod} -n {namespace} -o jsonpath='{{.status.phase}}'"
    ).strip()
    restart_count = _parse_restart_count(_kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{.status.containerStatuses[0].restartCount}}'"
    ))
    severity = _classify_pod_state(phase, restart_count)
    return f"[{severity}] Phase={phase} Restarts={restart_count}\n{output}"


def describe(pod: str, namespace: str, _container: str) -> str:
    """Fetch full pod description via kubectl describe."""
    return _kubectl(f"kubectl describe pod {pod} -n {namespace}")


def events(pod: str, namespace: str, _container: str) -> str:
    """Fetch pod events, falling back to legacy field-selector if modern syntax unavailable."""
    modern = _kubectl(f"kubectl events --for pod/{pod} -n {namespace} 2>&1")
    return (
        _kubectl(
            f"kubectl get events -n {namespace}"
            f" --field-selector involvedObject.name={pod}"
            f" --sort-by='.lastTimestamp'"
        )
        if "unknown command" in modern.lower()
        else modern
    )


def logs(pod: str, namespace: str, _container: str) -> str:
    """Collect current and previous logs for all containers in the pod."""
    names = _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{.spec.containers[*].name}}'"
    ).strip().split()
    return "\n".join(
        _container_logs_for_name(pod, namespace, name)
        for name in names
    )


def resources(pod: str, namespace: str, _container: str) -> str:
    """Fetch live resource usage via kubectl top."""
    return _kubectl(f"kubectl top pod {pod} -n {namespace} --containers 2>&1")


def limits(pod: str, namespace: str, container: str) -> str:
    """Fetch resource requests and limits for the specified container."""
    return _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{.spec.containers[?(@.name==\"{container}\")].resources}}'"
    )


def probes(pod: str, namespace: str, container: str) -> str:
    """Fetch probe configuration for the specified container."""
    return "\n".join(
        f"{probe}: {result or 'not configured'}"
        for probe in _PROBE_NAMES
        for result in [_kubectl(
            f"kubectl get pod {pod} -n {namespace}"
            f" -o jsonpath='{{.spec.containers[?(@.name==\"{container}\")].{probe}}}'"
        ).strip()]
    )


def node(pod: str, namespace: str, _container: str) -> str:
    """Fetch node name and resource usage for the pod's host node."""
    node_name = _kubectl(
        f"kubectl get pod {pod} -n {namespace} -o jsonpath='{{.spec.nodeName}}'"
    ).strip()
    return (
        "Pod not scheduled"
        if not node_name
        else f"Node: {node_name}\n{_kubectl(f'kubectl top node {node_name} 2>&1')}"
    )


def env_vars(pod: str, namespace: str, container: str) -> str:
    """Dump environment variables from the running container via kubectl exec."""
    return (
        _kubectl(f"kubectl exec {pod} -n {namespace} -c {container} -- env 2>&1")
        or "[exec unavailable]"
    )


def sidecar_status(pod: str, namespace: str, _container: str) -> str:
    """Check for sidecar containers (K8s 1.33+ GA: init containers with restartPolicy: Always)."""
    return _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{range .spec.initContainers[?(@.restartPolicy==\"Always\")]}}{{.name}} {{end}}'"
    ).strip() or "No sidecar containers"
