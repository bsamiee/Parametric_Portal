#!/usr/bin/env python3
"""Pod diagnostics -- table-driven kubectl data collector.

Usage: pod_diagnostics.py <pod> [-n namespace] [-c container] [-o output_file]

Architecture:
    DIAGNOSTIC_TABLE: tuple of (label, command_template, parser_fn) entries.
    Each entry is a pure function: (pod, namespace, container) -> str.
    No mutable state, no imperative loops, no print() in logic functions.
"""

import argparse
import subprocess
import sys
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from functools import reduce
from pathlib import Path
from typing import Final, TextIO

# --- [CONSTANTS] --------------------------------------------------------------

DEFAULT_NAMESPACE: Final = "parametric"
DEFAULT_CONTAINER: Final = "api"
SEPARATOR: Final = "=" * 80


# --- [TYPES] -----------------------------------------------------------------

class Severity(StrEnum):
    OK = "OK"
    WARN = "WARN"
    ERROR = "ERROR"


type CommandFn = Callable[[str, str, str], str]


@dataclass(frozen=True, slots=True, kw_only=True)
class DiagnosticEntry:
    """Immutable specification for a single diagnostic check."""

    label: str
    command: CommandFn


@dataclass(frozen=True, slots=True, kw_only=True)
class SectionResult:
    """Immutable result from executing a diagnostic entry."""

    label: str
    output: str


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


def _classify_pod_state(phase: str, restart_count: int) -> Severity:
    """Classify pod health from phase and restart count.

    Args:
        phase: Pod phase string from kubectl (e.g. 'Running', 'Succeeded', 'Failed').
        restart_count: Number of container restarts.

    Returns:
        Severity classification: OK, WARN, or ERROR.
    """
    match phase.lower():
        case "running" if restart_count == 0:
            return Severity.OK
        case "running":
            return Severity.WARN
        case "succeeded":
            return Severity.OK
        case _:
            return Severity.ERROR


def _parse_restart_count(raw: str) -> int:
    """Parse restart count from kubectl output, defaulting to 0.

    Args:
        raw: Raw string output from kubectl jsonpath query.

    Returns:
        Parsed integer restart count, or 0 if unparseable.
    """
    stripped = raw.strip()
    return int(stripped) if stripped.isdigit() else 0


def _status(pod: str, namespace: str, _container: str) -> str:
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


def _describe(pod: str, namespace: str, _container: str) -> str:
    """Fetch full pod description via kubectl describe."""
    return _kubectl(f"kubectl describe pod {pod} -n {namespace}")


def _events(pod: str, namespace: str, _container: str) -> str:
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


def _logs(pod: str, namespace: str, _container: str) -> str:
    """Collect current and previous logs for all containers in the pod."""
    names = _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{.spec.containers[*].name}}'"
    ).strip().split()
    return "\n".join(
        _container_logs_for_name(pod, namespace, name)
        for name in names
    )


def _resources(pod: str, namespace: str, _container: str) -> str:
    """Fetch live resource usage via kubectl top."""
    return _kubectl(f"kubectl top pod {pod} -n {namespace} --containers 2>&1")


def _limits(pod: str, namespace: str, container: str) -> str:
    """Fetch resource requests and limits for the specified container."""
    return _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{.spec.containers[?(@.name==\"{container}\")].resources}}'"
    )


def _probes(pod: str, namespace: str, container: str) -> str:
    probe_names = ("livenessProbe", "readinessProbe", "startupProbe")
    return "\n".join(
        f"{probe}: {result or 'not configured'}"
        for probe in probe_names
        for result in [_kubectl(
            f"kubectl get pod {pod} -n {namespace}"
            f" -o jsonpath='{{.spec.containers[?(@.name==\"{container}\")].{probe}}}'"
        ).strip()]
    )


def _node(pod: str, namespace: str, _container: str) -> str:
    """Fetch node name and resource usage for the pod's host node."""
    node_name = _kubectl(
        f"kubectl get pod {pod} -n {namespace} -o jsonpath='{{.spec.nodeName}}'"
    ).strip()
    return (
        "Pod not scheduled"
        if not node_name
        else f"Node: {node_name}\n{_kubectl(f'kubectl top node {node_name} 2>&1')}"
    )


def _env_vars(pod: str, namespace: str, container: str) -> str:
    """Dump environment variables from the running container via kubectl exec."""
    return (
        _kubectl(f"kubectl exec {pod} -n {namespace} -c {container} -- env 2>&1")
        or "[exec unavailable]"
    )


def _sidecar_status(pod: str, namespace: str, _container: str) -> str:
    """Check for sidecar containers (K8s 1.33+ GA: init containers with restartPolicy: Always)."""
    return _kubectl(
        f"kubectl get pod {pod} -n {namespace}"
        f" -o jsonpath='{{range .spec.initContainers[?(@.restartPolicy==\"Always\")]}}{{.name}} {{end}}'"
    ).strip() or "No sidecar containers"


# --- [DIAGNOSTIC_TABLE] -------------------------------------------------------

DIAGNOSTIC_TABLE: Final[tuple[DiagnosticEntry, ...]] = (
    DiagnosticEntry(label="POD STATUS", command=_status),
    DiagnosticEntry(label="POD DESCRIPTION", command=_describe),
    DiagnosticEntry(label="EVENTS", command=_events),
    DiagnosticEntry(label="CONTAINER LOGS", command=_logs),
    DiagnosticEntry(label="RESOURCE USAGE", command=_resources),
    DiagnosticEntry(label="RESOURCE LIMITS", command=_limits),
    DiagnosticEntry(label="PROBE CONFIG", command=_probes),
    DiagnosticEntry(label="SIDECAR CONTAINERS", command=_sidecar_status),
    DiagnosticEntry(label="NODE INFO", command=_node),
    DiagnosticEntry(label="ENV VARS", command=_env_vars),
)


# --- [COMPOSITION] ------------------------------------------------------------

def _run_diagnostic(pod: str, namespace: str, container: str, entry: DiagnosticEntry) -> SectionResult:
    """Execute a single diagnostic entry, producing an immutable result.

    Args:
        pod: Pod name.
        namespace: Kubernetes namespace.
        container: Target container name.
        entry: Diagnostic specification to execute.

    Returns:
        Frozen SectionResult with label and command output.
    """
    return SectionResult(
        label=entry.label,
        output=entry.command(pod, namespace, container),
    )


def _format_section(result: SectionResult) -> str:
    """Format a single section result as a decorated string block.

    Args:
        result: Frozen section result to format.

    Returns:
        Formatted string with section header and output.
    """
    return f"\n## {result.label} ##\n{result.output}"


def _format_report(header: str, results: tuple[SectionResult, ...]) -> str:
    """Compose full report from header and section results via fold.

    Args:
        header: Report title line.
        results: Tuple of frozen section results.

    Returns:
        Complete report string with separator, header, and all sections.
    """
    return reduce(
        lambda accumulator, section: f"{accumulator}{_format_section(section)}",
        results,
        f"{SEPARATOR}\n{header}\n{SEPARATOR}",
    )


# --- [ENTRY_POINT] ------------------------------------------------------------

@contextmanager
def _output(path: str | None) -> Generator[TextIO, None, None]:
    """Context-managed output file or stdout.

    Args:
        path: File path for output, or None for stdout.

    Yields:
        Writable file handle (stdout or opened file).
    """
    match path:
        case None:
            yield sys.stdout
        case filepath:
            target = Path(filepath)
            handle = target.open("w")
            try:
                yield handle
            finally:
                handle.close()
                sys.stderr.write(f"Written to: {target}\n")


def main() -> int:
    """Parse arguments, execute all diagnostics, and write report.

    Returns:
        Exit code: 0 for success.
    """
    parser = argparse.ArgumentParser(description="Kubernetes pod diagnostics")
    parser.add_argument("pod", help="Pod name")
    parser.add_argument("-n", "--namespace", default=DEFAULT_NAMESPACE)
    parser.add_argument("-c", "--container", default=DEFAULT_CONTAINER)
    parser.add_argument("-o", "--output", help="Output file path")
    args = parser.parse_args()

    header = (
        f"Pod Diagnostics: {args.pod}"
        f" (ns: {args.namespace}, container: {args.container})"
        f" @ {datetime.now(UTC).isoformat()}"
    )
    results = tuple(
        _run_diagnostic(args.pod, args.namespace, args.container, entry)
        for entry in DIAGNOSTIC_TABLE
    )
    report = _format_report(header, results)

    with _output(args.output) as destination:
        destination.write(report + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
