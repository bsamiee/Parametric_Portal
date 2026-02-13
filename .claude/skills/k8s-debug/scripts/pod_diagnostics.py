#!/usr/bin/env python3
"""Pod diagnostics -- table-driven kubectl data collector.

Usage: pod_diagnostics.py <pod> [-n namespace] [-c container] [-o output_file]

Architecture:
    DIAGNOSTIC_TABLE: tuple of (label, command_template, parser_fn) entries.
    Each entry is a pure function: (pod, namespace, container) -> str.
    No mutable state, no imperative loops, no print() in logic functions.
    Collectors imported from _collectors.py at system boundary.
"""

import argparse
import sys
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import reduce
from pathlib import Path
from typing import Final, TextIO

from _collectors import (
    describe,
    env_vars,
    events,
    limits,
    logs,
    node,
    probes,
    resources,
    sidecar_status,
    status,
)

# --- [CONSTANTS] --------------------------------------------------------------

DEFAULT_NAMESPACE: Final = "parametric"
DEFAULT_CONTAINER: Final = "api"
SEPARATOR: Final = "=" * 80


# --- [TYPES] -----------------------------------------------------------------

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


# --- [DIAGNOSTIC_TABLE] -------------------------------------------------------

DIAGNOSTIC_TABLE: Final[tuple[DiagnosticEntry, ...]] = (
    DiagnosticEntry(label="POD STATUS", command=status),
    DiagnosticEntry(label="POD DESCRIPTION", command=describe),
    DiagnosticEntry(label="EVENTS", command=events),
    DiagnosticEntry(label="CONTAINER LOGS", command=logs),
    DiagnosticEntry(label="RESOURCE USAGE", command=resources),
    DiagnosticEntry(label="RESOURCE LIMITS", command=limits),
    DiagnosticEntry(label="PROBE CONFIG", command=probes),
    DiagnosticEntry(label="SIDECAR CONTAINERS", command=sidecar_status),
    DiagnosticEntry(label="NODE INFO", command=node),
    DiagnosticEntry(label="ENV VARS", command=env_vars),
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
