#!/usr/bin/env python3
"""PromQL Best Practices Checker -- detects anti-patterns, performance issues, optimization opportunities.

Commands:
    check <query>    Run all best practice checks (JSON output)
"""

import json
import re
import sys
from collections.abc import Callable
from typing import Final

from _common import (
    COUNTER_SUFFIXES,
    GAUGE_PATTERNS,
    RESERVED,
    CheckSpec,
    CommandRegistry,
    Finding,
    RE_FUNC_CALL,
    RE_GROUPING_CLAUSE,
    cmd,
    dispatch,
    run_check_specs,
    strip_strings_and_selectors,
    to_seconds,
)

# --- [PRECOMPILED_REGEX] -----------------------------------------------------

_RE_METRIC_WORD: Final = re.compile(r'\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(?!\s*[{\(])')
_RE_METRIC_BARE: Final = re.compile(r'\b[a-zA-Z_:][a-zA-Z0-9_:]*\s*\{\s*\}')
_RE_LABEL_MATCHER: Final = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=~\s*"([^"]+)"')
_RE_COUNTER_METRIC: Final = re.compile(r'\b([a-zA-Z_:][a-zA-Z0-9_:]*(?:_total|_count|_sum|_bucket))\b')
_RE_RATE_FUNC_METRIC: Final = re.compile(r'(rate|irate|increase|delta|idelta)\s*\(\s*([a-zA-Z_:][a-zA-Z0-9_:]*)')
_RE_IRATE_RANGE: Final = re.compile(r'irate\s*\([^)]*\[(\d+)([smhdwy])\]')
_RE_RATE_RANGE: Final = re.compile(r'rate\s*\([^)]*\[(\d+)(ms|s|m|h|d|w|y)\]')
_RE_PREDICT_RANGE: Final = re.compile(r'predict_linear\s*\([^)]*\[(\d+)(ms|s|m|h|d|w|y)\]')
_RE_REGEX_METACHAR: Final = re.compile(r'[\.\*\+\?\^\$\[\]\(\)\|\\]')
_RE_SIMPLE_VALUE: Final = re.compile(r'^[a-zA-Z0-9_\-]+$')
_RE_COMPARISON: Final = re.compile(r'\s*(>|<|>=|<=|==|!=)\s*[\d\.]')
_RE_SUBQUERY: Final = re.compile(r'\[[^\]]+:[^\]]+\]')
_RE_FUNC_COUNT: Final = re.compile(r'\b[a-z_]+\s*\(')
_RE_HIST_RATE: Final = re.compile(r'\brate\s*\(')
_RE_HIST_LE: Final = re.compile(r'\bby\s*\([^)]*\ble\b')
_RE_DIV_RATE_COUNTER: Final = re.compile(r'/\s*(?:rate|increase)\s*\([^)]*(?:_count|_total)[^)]*\)')
_RE_NATIVE_HIST_FUNC: Final = re.compile(r'\b(histogram_avg|histogram_stddev|histogram_stdvar)\s*\(')
_RE_HIST_COUNT_SUM: Final = re.compile(r'\bhistogram_(?:count|sum)\s*\(')
_RE_HIST_COUNT_SUM_RATE: Final = re.compile(r'histogram_(?:count|sum)\s*\(\s*rate\s*\(')
_RE_RANGE_DURATION: Final = re.compile(r'\[(\d+)([smhdwy])[^\]]*:\s*(\d+)?([smhdwy])?\]')
_RE_NESTED_AGG: Final = re.compile(r'(sum|avg|min|max)\s*\([^)]*\b(sum|avg|min|max)\s*\(')

# --- [DATA_DRIVEN_CHECKS] ----------------------------------------------------

_BEST_PRACTICE_SPECS: Final = (
    CheckSpec(
        name='averaging_quantiles',
        pattern=re.compile(r'avg\s*\([^)]*\{[^}]*quantile\s*='),
        severity='error',
        message_fn=lambda match: 'Averaging pre-calculated quantiles is mathematically invalid because quantiles are non-additive (the average of p99s is NOT the p99 of the union)',
        recommendation='Use histogram_quantile() with histogram buckets instead',
    ),
    CheckSpec(
        name='deprecated_function',
        pattern=re.compile(r'\bholt_winters\s*\('),
        severity='warning',
        message_fn=lambda match: 'holt_winters() deprecated in Prometheus 3.0 because it was renamed for clarity',
        recommendation='Use double_exponential_smoothing() (requires --enable-feature=promql-experimental-functions)',
    ),
    CheckSpec(
        name='changes_resets_limitation',
        pattern=re.compile(r'\b(changes|resets)\s*\('),
        severity='info',
        message_fn=lambda match: f'{match.group(1)}() misses events between scrapes because it only sees sampled values',
        recommendation='Consider alternatives for alerting; use higher scrape frequency or event-based metrics',
    ),
    CheckSpec(
        name='absent_with_aggregation',
        pattern=re.compile(r'absent\s*\(\s*(sum|avg|min|max|count|group|stddev|stdvar)\s*\('),
        severity='warning',
        message_fn=lambda match: f'absent() wrapping {match.group(1)}() may not detect missing metrics because aggregation returns empty set, not absent',
        recommendation='Use: group(present_over_time(m[r])) unless group(m)',
    ),
    CheckSpec(
        name='absent_with_by',
        pattern=re.compile(r'absent\s*\([^)]+\)\s*by\s*\('),
        severity='error',
        message_fn=lambda match: 'absent() does not support by() because absent() returns a single-element vector with fixed labels',
        recommendation='Use present_over_time pattern for per-label detection: count(present_over_time(m[5m])) by (label)',
    ),
    CheckSpec(
        name='info_metric_missing_group',
        pattern=re.compile(r'\*\s*on\s*\([^)]+\)\s*(?!group_left|group_right)[a-zA-Z_]+_info\b'),
        severity='warning',
        message_fn=lambda match: 'Info metric join missing group_left() -- without it, Prometheus rejects many-to-one joins',
        recommendation='Add group_left(labels): metric * on(job, instance) group_left(version) info_metric. Or use info() (3.0+ experimental).',
    ),
    CheckSpec(
        name='on_empty_labels',
        pattern=re.compile(r'\bon\s*\(\s*\)'),
        severity='info',
        message_fn=lambda match: 'on() with empty labels matches all series to a single group -- ensure this is intentional',
        recommendation='Specify labels: on(job, instance)',
    ),
    CheckSpec(
        name='division_by_zero_risk',
        pattern=re.compile(r'/\s*(?:rate|increase)\s*\([^)]*(?:_count|_total)[^)]*\)'),
        severity='info',
        message_fn=lambda match: 'Division by rate(counter) produces NaN when denominator is 0 (no traffic)',
        recommendation='Add "or vector(0)" to denominator, or filter with "> 0"',
    ),
    CheckSpec(
        name='multiple_or_conditions',
        pattern=re.compile(r'(?:.*\bor\b.*){2,}'),
        severity='info',
        message_fn=lambda match: 'Multiple OR conditions can be consolidated into a single regex alternation',
        recommendation='Use regex =~"val1|val2|val3" for same-label matching',
    ),
)



# --- [DISPATCH] ---------------------------------------------------------------

CMDS: CommandRegistry = {}

# --- [FUNCTIONS] --------------------------------------------------------------


def _find_metrics(query: str) -> list[str]:
    """Extract metric names from query, excluding reserved words.

    Args:
        query: PromQL query string to scan.

    Returns:
        List of metric name strings found in query.
    """
    cleaned = strip_strings_and_selectors(query)
    return [metric for metric in _RE_METRIC_WORD.findall(cleaned) if metric.lower() not in RESERVED]


def _high_cardinality(query: str) -> list[Finding]:
    """Detect metrics without label filters.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for unfiltered high-cardinality metrics.
    """
    bare_matcher = (
        [{'type': 'high_cardinality', 'message': 'Empty label matcher {} may match many series', 'severity': 'warning', 'recommendation': 'Add {job="...", instance="..."}'}]
        if _RE_METRIC_BARE.search(query)
        else []
    )
    unfiltered = [
        {'type': 'high_cardinality', 'message': f'"{metric}" used without label filters', 'severity': 'warning', 'recommendation': f'{metric}{{job="...", instance="..."}}'}
        for metric in _find_metrics(query)
        if not re.search(rf'\b{re.escape(metric)}\s*\{{\s*[^}}]+\s*\}}', query)
    ]
    return bare_matcher + unfiltered


def _regex_overuse(query: str) -> list[Finding]:
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
            ([{'type': 'regex_to_exact', 'message': f'{label}=~"{pattern}" can be exact match (5-10x faster index lookup)', 'severity': 'info', 'recommendation': f'{label}="{pattern}"'}]
             if not _RE_REGEX_METACHAR.search(pattern) and _RE_SIMPLE_VALUE.fullmatch(pattern)
             else [])
            + ([{'type': 'regex_optimization', 'message': f'Wildcard suffix in "{pattern}" defeats index optimization', 'severity': 'info', 'recommendation': 'Use more specific label values or anchor: ^prefix.*'}]
               if pattern.endswith('.*')
               else [])
        )
    ]


def _missing_rate(query: str) -> list[Finding]:
    """Detect counter metrics without rate/increase.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for counters missing rate()/increase() wrapping.
    """
    return [
        {'type': 'missing_rate', 'message': f'Counter "{metric}" without rate()/increase() -- raw counter value is monotonically increasing', 'severity': 'warning', 'recommendation': f'rate({metric}[5m])'}
        for metric in _RE_COUNTER_METRIC.findall(query)
        if not re.search(rf'(?:rate|irate|increase|delta|idelta)\s*\([^)]*{re.escape(metric)}', query)
        and not re.search(rf'histogram_quantile\s*\([^)]*{re.escape(metric)}', query)
        and not re.search(rf'histogram_(?:avg|stddev|stdvar|count|sum|fraction)\s*\([^)]*{re.escape(metric)}', query)
        and not (metric.endswith(('_sum', '_count'))
                 and re.search(rf'{metric.rsplit("_", 1)[0]}_sum.*{metric.rsplit("_", 1)[0]}_count|{metric.rsplit("_", 1)[0]}_count.*{metric.rsplit("_", 1)[0]}_sum', query))
    ]


def _rate_on_gauges(query: str) -> list[Finding]:
    """Detect rate/irate on gauge metrics.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for rate functions applied to gauge-type metrics.
    """
    return [
        {'type': 'rate_on_gauge', 'message': f'{func}() on gauge "{metric}" -- gauges represent current state, not cumulative totals', 'severity': 'warning', 'recommendation': f'avg_over_time({metric}[5m]) for smoothing, or use direct value'}
        for func, metric in _RE_RATE_FUNC_METRIC.findall(query)
        if any(pattern in metric for pattern in GAUGE_PATTERNS) and not any(metric.endswith(suffix) for suffix in COUNTER_SUFFIXES)
    ]


def _subquery_perf(query: str) -> list[Finding]:
    """Detect expensive subqueries (>7d range).

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for subqueries exceeding 7-day range.
    """
    return [
        {'type': 'expensive_subquery', 'message': f'Subquery [{val}{unit}] may cause OOM or timeout -- {int(to_seconds(int(val), unit) / 86400):.0f}d of data', 'severity': 'warning', 'recommendation': 'Use recording rules for ranges >7d, or reduce resolution: [7d:5m]'}
        for val, unit, _, _ in _RE_RANGE_DURATION.findall(query)
        if to_seconds(int(val), unit) > 7 * 86400
    ]


def _irate_range(query: str) -> list[Finding]:
    """Detect irate with range > 5m.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for irate() with excessive lookback range.
    """
    return [
        {'type': 'irate_long_range', 'message': f'irate() with {duration}{unit} only uses last 2 samples -- the extra range is wasted lookback', 'severity': 'warning', 'recommendation': 'Use rate() for trends over >5m, or irate([2m]) for spike detection'}
        for duration, unit in _RE_IRATE_RANGE.findall(query)
        if to_seconds(int(duration), unit) > 300
    ]


def _rate_range(query: str) -> list[Finding]:
    """Detect rate with range < 2m.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for rate() with insufficient sample window.
    """
    return [
        {'type': 'rate_short_range', 'message': f'rate() with [{duration}{unit}] -- needs >=3 samples for reliable extrapolation', 'severity': 'warning', 'recommendation': '>= 4x scrape interval, typically [2m]+ with 30s scrape'}
        for duration, unit in _RE_RATE_RANGE.findall(query)
        if to_seconds(int(duration), unit) < 120
    ]


def _unbounded(query: str) -> list[Finding]:
    """Detect aggregations without by/without.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for aggregations missing explicit label control.
    """
    is_alert = bool(_RE_COMPARISON.search(query))
    return [
        {
            'type': 'missing_aggregation_clause',
            'message': f'{agg}() without by()/without()' + (' (likely intentional for alerting threshold)' if is_alert else ' -- produces single-value result losing all dimensional data'),
            'severity': 'info',
            'recommendation': ('Add by(label) for per-label breakdown' if is_alert else f'Add by()/without() to {agg}() for explicit label control'),
        }
        for agg in ('sum', 'avg', 'min', 'max', 'count')
        if re.search(rf'\b{agg}\s*\(', query)
        and not re.search(rf'\b{agg}\s+(?:by|without)\s*\(', query)
        and not re.search(rf'\b{agg}\s*\(.*\)\s*(?:by|without)\s*\(', query, re.DOTALL)
    ]


def _recording_opportunity(query: str) -> list[Finding]:
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
        [{'type': 'recording_rule_opportunity', 'message': 'Complex query (3+ functions, nested aggregations, or >150 chars) -- recording rules pre-compute at scrape time for 10-40x speedup', 'severity': 'info', 'recommendation': 'Create level:metric:operations recording rule if used frequently'}]
        if score >= 2
        else []
    )


def _histogram_usage(query: str) -> list[Finding]:
    """Detect histogram_quantile issues (missing rate, missing le).

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for histogram_quantile anti-patterns.
    """
    if 'histogram_quantile' not in query:
        return []
    has_bucket = '_bucket' in query
    missing_rate = (
        [{'type': 'histogram_missing_rate', 'message': 'histogram_quantile() on raw buckets -- rate() handles counter resets per-series before aggregation', 'severity': 'warning', 'recommendation': 'histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))'}]
        if has_bucket and not _RE_HIST_RATE.search(query)
        else []
    )
    missing_le = (
        [{'type': 'histogram_missing_le', 'message': 'Classic histograms need "le" in by() -- without it, bucket boundaries are lost producing incorrect percentiles', 'severity': 'warning', 'recommendation': 'sum by (job, le) (...)'}]
        if has_bucket and not _RE_HIST_LE.search(query)
        else []
    )
    return missing_rate + missing_le


def _predict_range(query: str) -> list[Finding]:
    """Detect predict_linear with short range.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for predict_linear() with insufficient data range.
    """
    return [
        {'type': 'predict_linear_short_range', 'message': f'predict_linear() with [{duration}{unit}] -- too few data points for reliable linear regression', 'severity': 'warning', 'recommendation': 'Use [10m]+ for sufficient data points; [1h]+ for production forecasts'}
        for duration, unit in _RE_PREDICT_RANGE.findall(query)
        if to_seconds(int(duration), unit) < 600
    ]


def _dimensional_names(query: str) -> list[Finding]:
    """Detect dimensions embedded in metric names.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for metrics with embedded dimensional values.
    """
    dimension_patterns = (
        re.compile(r'\b[a-zA-Z_]+_(GET|POST|PUT|DELETE|PATCH)_[a-zA-Z_]+'),
        re.compile(r'\b[a-zA-Z_]+_\d+_[a-zA-Z_]+'),
        re.compile(r'\b[a-zA-Z_]+_(2\d{2}|3\d{2}|4\d{2}|5\d{2})_[a-zA-Z_]+'),
    )
    return (
        [{'type': 'dimensional_metric_name', 'message': 'Dimensions embedded in metric name -- reduces queryability and increases series count', 'severity': 'info', 'recommendation': 'Use labels: http_requests_total{method="GET", status="200"}'}]
        if any(pattern.search(query) for pattern in dimension_patterns)
        else []
    )


def _vector_matching(query: str) -> list[Finding]:
    """Detect vector matching issues.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for group_left/right without on()/ignoring().
    """
    query_lower = query.lower()
    group_without_on = (
        [{'type': 'group_without_matching', 'message': 'group_left/right without on()/ignoring() -- Prometheus requires explicit label matching for many-to-one joins', 'severity': 'error', 'recommendation': 'Add on(label1, label2) before group_left/right'}]
        if re.search(r'\b(group_left|group_right)\s*\(', query_lower) and 'on(' not in query_lower and 'ignoring(' not in query_lower
        else []
    )
    return group_without_on


def _native_histogram(query: str) -> list[Finding]:
    """Detect native histogram issues.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for native histogram anti-patterns.
    """
    missing_rate = [
        {'type': 'native_histogram_missing_rate', 'message': f'{func}() needs rate() input -- without it, you get cumulative counts instead of per-second rates', 'severity': 'warning', 'recommendation': f'{func}(rate(histogram_metric[5m]))'}
        for func in _RE_NATIVE_HIST_FUNC.findall(query)
        if not re.search(rf'{func}\s*\(\s*rate\s*\(', query)
    ]
    unnecessary_le = (
        [{'type': 'native_histogram_unnecessary_le', 'message': 'Native histograms do not need "le" in aggregation -- "le" is only for classic histograms with explicit bucket boundaries', 'severity': 'info', 'recommendation': 'Simplify: sum by (job) (rate(metric[5m]))'}]
        if 'histogram_quantile' in query and '_bucket' not in query and _RE_HIST_LE.search(query)
        else []
    )
    helper_without_rate = (
        [{'type': 'histogram_helper_without_rate', 'message': 'histogram_count/sum typically need rate() -- otherwise returns cumulative total, not per-second rate', 'severity': 'info', 'recommendation': 'histogram_count(rate(metric[5m]))'}]
        if _RE_HIST_COUNT_SUM.search(query) and not _RE_HIST_COUNT_SUM_RATE.search(query)
        else []
    )
    return missing_rate + unnecessary_le + helper_without_rate


def _mixed_types(query: str) -> list[Finding]:
    """Detect mixed metric types in arithmetic.

    Args:
        query: PromQL query string to check.

    Returns:
        List of finding dicts for queries mixing counter/gauge/summary/histogram types.
    """
    is_classic_hist = 'histogram_quantile' in query and '_bucket' in query
    types: set[str] = set()
    metrics = _find_metrics(query)
    types = {
        detected_type
        for metric in metrics
        if not (metric.endswith('_bucket') and is_classic_hist) and not metric.endswith('_info')
        for detected_type in (
            ({'counter'} if any(metric.endswith(suffix) for suffix in COUNTER_SUFFIXES) else set())
            | ({'gauge'} if any(pattern in metric for pattern in GAUGE_PATTERNS) else set())
            | ({'summary'} if re.search(rf'{re.escape(metric)}\s*\{{[^}}]*quantile\s*=', query) else set())
        )
    }
    if 'histogram_quantile' in query and not is_classic_hist:
        types.add('histogram')
    return (
        [{'type': 'mixed_metric_types', 'message': f'Mixed types ({", ".join(sorted(types))}) in arithmetic -- different metric types have incompatible semantics', 'severity': 'warning', 'recommendation': 'Separate into distinct queries per metric type'}]
        if len(types) >= 2 and any(operator in query for operator in ('+', '-', '*', '/'))
        else []
    )


# --- [CHECK_REGISTRY] ---------------------------------------------------------

ALL_CHECKS: Final[tuple[Callable[[str], list[Finding]], ...]] = (
    _high_cardinality, _regex_overuse, _missing_rate, _rate_on_gauges,
    _subquery_perf, _irate_range, _rate_range,
    _unbounded, _recording_opportunity, _histogram_usage,
    _predict_range, _dimensional_names, _vector_matching,
    _native_histogram, _mixed_types,
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
        return json.dumps({'status': 'OPTIMIZED', 'query': '', 'issues': [], 'suggestions': [], 'optimizations': [], 'summary': {'errors': 0, 'warnings': 0, 'suggestions': 0, 'optimizations': 0}}, indent=2)

    # Run data-driven specs + custom check functions
    spec_findings = run_check_specs(query, _BEST_PRACTICE_SPECS)
    custom_findings = [finding for check_fn in ALL_CHECKS for finding in check_fn(query)]
    all_findings = spec_findings + custom_findings

    # Partition by severity using comprehensions (no mutable accumulators)
    issues = [finding for finding in all_findings if finding['severity'] in ('error', 'warning')]
    optimizations = [finding for finding in all_findings if finding['severity'] == 'info' and finding['type'].endswith(('_to_exact', '_optimization'))]
    suggestions = [finding for finding in all_findings if finding['severity'] == 'info' and finding not in optimizations]

    has_errors = any(finding['severity'] == 'error' for finding in issues)
    has_warnings = any(finding['severity'] == 'warning' for finding in issues)
    status = 'ERROR' if has_errors else ('WARNING' if has_warnings else ('CAN_BE_IMPROVED' if optimizations or suggestions else 'OPTIMIZED'))

    return json.dumps({
        'status': status, 'query': query, 'issues': issues, 'suggestions': suggestions, 'optimizations': optimizations,
        'summary': {
            'errors': sum(1 for finding in issues if finding['severity'] == 'error'),
            'warnings': sum(1 for finding in issues if finding['severity'] == 'warning'),
            'suggestions': len(suggestions),
            'optimizations': len(optimizations),
        },
    }, indent=2)


# --- [ENTRY_POINT] ------------------------------------------------------------

def main() -> int:
    """Dispatch command and print output.

    Returns:
        Exit code: 0 if no errors found, 1 otherwise.
    """
    return dispatch(CMDS, 'check_best_practices.py', exit_key='summary.errors')


if __name__ == '__main__':
    sys.exit(main())
