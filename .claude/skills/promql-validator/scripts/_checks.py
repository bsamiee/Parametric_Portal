"""Core best practice check functions for PromQL validation."""

import re
from typing import Final

from _common import (
    COUNTER_SUFFIXES,
    Finding,
    GAUGE_PATTERNS,
    RESERVED,
    strip_strings_and_selectors,
    to_seconds,
)


# --- [PRECOMPILED_REGEX] -----------------------------------------------------

_RE_METRIC_WORD: Final = re.compile(r"\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(?!\s*[{\(])")
_RE_METRIC_BARE: Final = re.compile(r"\b[a-zA-Z_:][a-zA-Z0-9_:]*\s*\{\s*\}")
_RE_LABEL_MATCHER: Final = re.compile(r'([a-zA-Z_]\w*)\s*=~\s*"([^"]+)"')
_RE_COUNTER_METRIC: Final = re.compile(r"\b([a-zA-Z_:][a-zA-Z0-9_:]*(?:_total|_count|_sum|_bucket))\b")
_RE_RATE_FUNC_METRIC: Final = re.compile(r"(rate|irate|increase|delta|idelta)\s*\(\s*([a-zA-Z_:][a-zA-Z0-9_:]*)")
_RE_IRATE_RANGE: Final = re.compile(r"irate\s*\([^)]*\[(\d+)([smhdwy])\]")
_RE_RATE_RANGE: Final = re.compile(r"rate\s*\([^)]*\[(\d+)(ms|s|m|h|d|w|y)\]")
_RE_REGEX_METACHAR: Final = re.compile(r"[\.\*\+\?\^\$\[\]\(\)\|\\]")
_RE_SIMPLE_VALUE: Final = re.compile(r"^[a-zA-Z0-9_\-]+$")
_RE_COMPARISON: Final = re.compile(r"\s*(>|<|>=|<=|==|!=)\s*[\d\.]")
_RE_SUBQUERY: Final = re.compile(r"\[[^\]]+:[^\]]+\]")
_RE_FUNC_COUNT: Final = re.compile(r"\b[a-z_]+\s*\(")
_RE_RANGE_DURATION: Final = re.compile(r"\[(\d+)([smhdwy])[^\]]*:\s*(\d+)?([smhdwy])?\]")
_RE_NESTED_AGG: Final = re.compile(r"(sum|avg|min|max)\s*\([^)]*\b(sum|avg|min|max)\s*\(")

# --- [FUNCTIONS] --------------------------------------------------------------


def find_metrics(query: str) -> list[str]:
    """Extract metric names from query, excluding reserved words.

    Args:
        query: PromQL query string to scan.

    Returns:
        List of metric name strings found in query.
    """
    cleaned = strip_strings_and_selectors(query)
    return [metric for metric in _RE_METRIC_WORD.findall(cleaned) if metric.lower() not in RESERVED]


def check_high_cardinality(query: str) -> list[Finding]:
    """Detect metrics without label filters.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for unfiltered high-cardinality metrics.
    """
    bare_matcher = (
        [
            {
                "type": "high_cardinality",
                "message": "Empty label matcher {} may match many series",
                "severity": "warning",
                "recommendation": 'Add {job="...", instance="..."}',
            }
        ]
        if _RE_METRIC_BARE.search(query)
        else []
    )
    unfiltered = [
        {
            "type": "high_cardinality",
            "message": f'"{metric}" used without label filters',
            "severity": "warning",
            "recommendation": f'{metric}{{job="...", instance="..."}}',
        }
        for metric in find_metrics(query)
        if not re.search(rf"\b{re.escape(metric)}\s*\{{\s*[^}}]+\s*\}}", query)
    ]
    return bare_matcher + unfiltered


def check_regex_overuse(query: str) -> list[Finding]:
    """Detect regex matchers that could be exact matches.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for regex patterns convertible to exact matches.
    """
    return [
        finding
        for label, pattern in _RE_LABEL_MATCHER.findall(query)
        for finding in (
            (
                [
                    {
                        "type": "regex_to_exact",
                        "message": f'{label}=~"{pattern}" can be exact match (5-10x faster index lookup)',
                        "severity": "info",
                        "recommendation": f'{label}="{pattern}"',
                    }
                ]
                if not _RE_REGEX_METACHAR.search(pattern) and _RE_SIMPLE_VALUE.fullmatch(pattern)
                else []
            )
            + (
                [
                    {
                        "type": "regex_optimization",
                        "message": f'Wildcard suffix in "{pattern}" defeats index optimization',
                        "severity": "info",
                        "recommendation": "Use more specific label values or anchor: ^prefix.*",
                    }
                ]
                if pattern.endswith(".*")
                else []
            )
        )
    ]


def check_missing_rate(query: str) -> list[Finding]:
    """Detect counter metrics without rate/increase.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for counters missing rate()/increase() wrapping.
    """
    return [
        {
            "type": "missing_rate",
            "message": f'Counter "{metric}" without rate()/increase() -- raw counter value is monotonically increasing',
            "severity": "warning",
            "recommendation": f"rate({metric}[5m])",
        }
        for metric in _RE_COUNTER_METRIC.findall(query)
        if not re.search(rf"(?:rate|irate|increase|delta|idelta)\s*\([^)]*{re.escape(metric)}", query)
        and not re.search(rf"histogram_quantile\s*\([^)]*{re.escape(metric)}", query)
        and not re.search(rf"histogram_(?:avg|stddev|stdvar|count|sum|fraction)\s*\([^)]*{re.escape(metric)}", query)
        and not (
            metric.endswith(("_sum", "_count"))
            and re.search(
                (
                    rf"{metric.rsplit('_', 1)[0]}_sum.*{metric.rsplit('_', 1)[0]}_count"
                    rf"|{metric.rsplit('_', 1)[0]}_count.*{metric.rsplit('_', 1)[0]}_sum"
                ),
                query,
            )
        )
    ]


def check_rate_on_gauges(query: str) -> list[Finding]:
    """Detect rate/irate on gauge metrics.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for rate functions applied to gauge-type metrics.
    """
    return [
        {
            "type": "rate_on_gauge",
            "message": f'{func}() on gauge "{metric}" -- gauges represent current state, not cumulative totals',
            "severity": "warning",
            "recommendation": f"avg_over_time({metric}[5m]) for smoothing, or use direct value",
        }
        for func, metric in _RE_RATE_FUNC_METRIC.findall(query)
        if any(pattern in metric for pattern in GAUGE_PATTERNS)
        and not any(metric.endswith(suffix) for suffix in COUNTER_SUFFIXES)
    ]


def check_subquery_perf(query: str) -> list[Finding]:
    """Detect expensive subqueries (>7d range).

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for subqueries exceeding 7-day range.
    """
    return [
        {
            "type": "expensive_subquery",
            "message": (
                f"Subquery [{val}{unit}] may cause OOM or timeout -- "
                f"{int(to_seconds(int(val), unit) / 86400):.0f}d of data"
            ),
            "severity": "warning",
            "recommendation": "Use recording rules for ranges >7d, or reduce resolution: [7d:5m]",
        }
        for val, unit, _, _ in _RE_RANGE_DURATION.findall(query)
        if to_seconds(int(val), unit) > 7 * 86400
    ]


def check_irate_range(query: str) -> list[Finding]:
    """Detect irate with range > 5m.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for irate() with excessive lookback range.
    """
    return [
        {
            "type": "irate_long_range",
            "message": f"irate() with {duration}{unit} only uses last 2 samples -- the extra range is wasted lookback",
            "severity": "warning",
            "recommendation": "Use rate() for trends over >5m, or irate([2m]) for spike detection",
        }
        for duration, unit in _RE_IRATE_RANGE.findall(query)
        if to_seconds(int(duration), unit) > 300
    ]


def check_rate_range(query: str) -> list[Finding]:
    """Detect rate with range < 2m.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for rate() with insufficient sample window.
    """
    return [
        {
            "type": "rate_short_range",
            "message": f"rate() with [{duration}{unit}] -- needs >=3 samples for reliable extrapolation",
            "severity": "warning",
            "recommendation": ">= 4x scrape interval, typically [2m]+ with 30s scrape",
        }
        for duration, unit in _RE_RATE_RANGE.findall(query)
        if to_seconds(int(duration), unit) < 120
    ]


def check_unbounded(query: str) -> list[Finding]:
    """Detect aggregations without by/without.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for aggregations missing explicit label control.
    """
    is_alert = bool(_RE_COMPARISON.search(query))
    return [
        {
            "type": "missing_aggregation_clause",
            "message": f"{agg}() without by()/without()"
            + (
                " (likely intentional for alerting threshold)"
                if is_alert
                else " -- produces single-value result losing all dimensional data"
            ),
            "severity": "info",
            "recommendation": (
                "Add by(label) for per-label breakdown"
                if is_alert
                else f"Add by()/without() to {agg}() for explicit label control"
            ),
        }
        for agg in ("sum", "avg", "min", "max", "count")
        if re.search(rf"\b{agg}\s*\(", query)
        and not re.search(rf"\b{agg}\s+(?:by|without)\s*\(", query)
        and not re.search(rf"\b{agg}\s*\(.*\)\s*(?:by|without)\s*\(", query, re.DOTALL)
    ]


def check_recording_opportunity(query: str) -> list[Finding]:
    """Detect complex queries that should use recording rules.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for queries exceeding complexity threshold.
    """
    score = (
        (len(_RE_FUNC_COUNT.findall(query)) >= 3)
        + bool(_RE_NESTED_AGG.search(query))
        + bool(_RE_SUBQUERY.search(query))
        + (len(query) > 150)
    )
    return (
        [
            {
                "type": "recording_rule_opportunity",
                "message": (
                    "Complex query (3+ functions, nested aggregations, or >150 chars) -- "
                    "recording rules pre-compute at scrape time for 10-40x speedup"
                ),
                "severity": "info",
                "recommendation": "Create level:metric:operations recording rule if used frequently",
            }
        ]
        if score >= 2
        else []
    )


# --- [EXPORT] -----------------------------------------------------------------
