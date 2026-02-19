#!/usr/bin/env python3
# ruff: noqa: ARG005
"""PromQL Best Practices Checker -- detects anti-patterns, performance issues, optimization opportunities.

Commands:
    check <query>    Run all best practice checks (JSON output)
"""

from collections.abc import Callable
import json
import re
import sys
from typing import Final

from _advanced_checks import (
    check_dimensional_names,
    check_histogram_usage,
    check_mixed_types,
    check_native_histogram,
    check_predict_range,
    check_vector_matching,
)
from _checks import (
    check_high_cardinality,
    check_irate_range,
    check_missing_rate,
    check_rate_on_gauges,
    check_rate_range,
    check_recording_opportunity,
    check_regex_overuse,
    check_subquery_perf,
    check_unbounded,
)
from _common import (
    CheckSpec,
    cmd,
    CommandRegistry,
    dispatch,
    Finding,
    run_check_specs,
)


# --- [DATA_DRIVEN_CHECKS] ----------------------------------------------------

_BEST_PRACTICE_SPECS: Final = (
    CheckSpec(
        name="averaging_quantiles",
        pattern=re.compile(r"avg\s*\([^)]*\{[^}]*quantile\s*="),
        severity="error",
        message_fn=lambda match: (
            "Averaging pre-calculated quantiles is mathematically invalid because quantiles are non-additive "
            "(the average of p99s is NOT the p99 of the union)"
        ),
        recommendation="Use histogram_quantile() with histogram buckets instead",
    ),
    CheckSpec(
        name="deprecated_function",
        pattern=re.compile(r"\bholt_winters\s*\("),
        severity="warning",
        message_fn=lambda match: "holt_winters() deprecated in Prometheus 3.0 because it was renamed for clarity",
        recommendation="Use double_exponential_smoothing() (requires --enable-feature=promql-experimental-functions)",
    ),
    CheckSpec(
        name="changes_resets_limitation",
        pattern=re.compile(r"\b(changes|resets)\s*\("),
        severity="info",
        message_fn=lambda match: (
            f"{match.group(1)}() misses events between scrapes because it only sees sampled values"
        ),
        recommendation="Consider alternatives for alerting; use higher scrape frequency or event-based metrics",
    ),
    CheckSpec(
        name="absent_with_aggregation",
        pattern=re.compile(r"absent\s*\(\s*(sum|avg|min|max|count|group|stddev|stdvar)\s*\("),
        severity="warning",
        message_fn=lambda match: (
            f"absent() wrapping {match.group(1)}() may not detect missing metrics because "
            "aggregation returns empty set, not absent"
        ),
        recommendation="Use: group(present_over_time(m[r])) unless group(m)",
    ),
    CheckSpec(
        name="absent_with_by",
        pattern=re.compile(r"absent\s*\([^)]+\)\s*by\s*\("),
        severity="error",
        message_fn=lambda match: (
            "absent() does not support by() because absent() returns a single-element vector with fixed labels"
        ),
        recommendation=(
            "Use present_over_time pattern for per-label detection: count(present_over_time(m[5m])) by (label)"
        ),
    ),
    CheckSpec(
        name="info_metric_missing_group",
        pattern=re.compile(r"\*\s*on\s*\([^)]+\)\s*(?!group_left|group_right)[a-zA-Z_]+_info\b"),
        severity="warning",
        message_fn=lambda match: (
            "Info metric join missing group_left() -- without it, Prometheus rejects many-to-one joins"
        ),
        recommendation=(
            "Add group_left(labels): metric * on(job, instance) group_left(version) info_metric. "
            "Or use info() (3.0+ experimental)."
        ),
    ),
    CheckSpec(
        name="on_empty_labels",
        pattern=re.compile(r"\bon\s*\(\s*\)"),
        severity="info",
        message_fn=lambda match: (
            "on() with empty labels matches all series to a single group -- ensure this is intentional"
        ),
        recommendation="Specify labels: on(job, instance)",
    ),
    CheckSpec(
        name="division_by_zero_risk",
        pattern=re.compile(r"/\s*(?:rate|increase)\s*\([^)]*(?:_count|_total)[^)]*\)"),
        severity="info",
        message_fn=lambda match: "Division by rate(counter) produces NaN when denominator is 0 (no traffic)",
        recommendation='Add "or vector(0)" to denominator, or filter with "> 0"',
    ),
    CheckSpec(
        name="multiple_or_conditions",
        pattern=re.compile(r"(?:.*\bor\b.*){2,}"),
        severity="info",
        message_fn=lambda match: "Multiple OR conditions can be consolidated into a single regex alternation",
        recommendation='Use regex =~"val1|val2|val3" for same-label matching',
    ),
)


# --- [DISPATCH] ---------------------------------------------------------------

CMDS: CommandRegistry = {}

# --- [CHECK_REGISTRY] ---------------------------------------------------------

ALL_CHECKS: Final[tuple[Callable[[str], list[Finding]], ...]] = (
    check_high_cardinality,
    check_regex_overuse,
    check_missing_rate,
    check_rate_on_gauges,
    check_subquery_perf,
    check_irate_range,
    check_rate_range,
    check_unbounded,
    check_recording_opportunity,
    check_histogram_usage,
    check_predict_range,
    check_dimensional_names,
    check_vector_matching,
    check_native_histogram,
    check_mixed_types,
)

# --- [COMMANDS] ---------------------------------------------------------------


@cmd(CMDS, 1)
def check(query: str) -> str:
    """Run all best practice checks. Returns JSON.

    Args:
        query: PromQL query string to analyze.

    Returns:
        JSON string with status, issues, suggestions, optimizations, and summary counts.
    """
    query = query.strip()
    if not query:
        return json.dumps(
            {
                "status": "NO_QUERY",
                "message": "No query provided",
                "query": "",
                "issues": [],
                "suggestions": [],
                "optimizations": [],
                "summary": {"errors": 0, "warnings": 0, "suggestions": 0, "optimizations": 0},
            },
            indent=2,
        )

    # Run data-driven specs + custom check functions
    spec_findings = run_check_specs(query, _BEST_PRACTICE_SPECS)
    custom_findings = [finding for check_fn in ALL_CHECKS for finding in check_fn(query)]
    all_findings = spec_findings + custom_findings

    # Partition by severity using comprehensions (no mutable accumulators)
    issues = [finding for finding in all_findings if finding["severity"] in ("error", "warning")]
    optimizations = [
        finding
        for finding in all_findings
        if finding["severity"] == "info" and finding["type"].endswith(("_to_exact", "_optimization"))
    ]
    suggestions = [
        finding for finding in all_findings if finding["severity"] == "info" and finding not in optimizations
    ]

    has_errors = any(finding["severity"] == "error" for finding in issues)
    has_warnings = any(finding["severity"] == "warning" for finding in issues)
    match (has_errors, has_warnings, bool(optimizations or suggestions)):
        case (True, _, _):
            status = "ERROR"
        case (False, True, _):
            status = "WARNING"
        case (False, False, True):
            status = "CAN_BE_IMPROVED"
        case _:
            status = "OPTIMIZED"

    return json.dumps(
        {
            "status": status,
            "query": query,
            "issues": issues,
            "suggestions": suggestions,
            "optimizations": optimizations,
            "summary": {
                "errors": sum(1 for finding in issues if finding["severity"] == "error"),
                "warnings": sum(1 for finding in issues if finding["severity"] == "warning"),
                "suggestions": len(suggestions),
                "optimizations": len(optimizations),
            },
        },
        indent=2,
    )


# --- [ENTRY_POINT] ------------------------------------------------------------


def main() -> int:
    """Dispatch command and print output.

    Returns:
        Exit code: 0 if no errors found, 1 otherwise.
    """
    return dispatch(CMDS, "check_best_practices.py", exit_key="summary.errors")


if __name__ == "__main__":
    sys.exit(main())
