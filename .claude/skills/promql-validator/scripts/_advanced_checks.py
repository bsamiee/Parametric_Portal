"""Advanced best practice check functions for PromQL validation."""

import re
from typing import Final

from _common import (
    COUNTER_SUFFIXES,
    GAUGE_PATTERNS,
    Finding,
    to_seconds,
)
from _checks import _find_metrics

# --- [PRECOMPILED_REGEX] -----------------------------------------------------

_RE_HIST_RATE: Final = re.compile(r'\brate\s*\(')
_RE_HIST_LE: Final = re.compile(r'\bby\s*\([^)]*\ble\b')
_RE_NATIVE_HIST_FUNC: Final = re.compile(r'\b(histogram_avg|histogram_stddev|histogram_stdvar)\s*\(')
_RE_HIST_COUNT_SUM: Final = re.compile(r'\bhistogram_(?:count|sum)\s*\(')
_RE_HIST_COUNT_SUM_RATE: Final = re.compile(r'histogram_(?:count|sum)\s*\(\s*rate\s*\(')
_RE_PREDICT_RANGE: Final = re.compile(r'predict_linear\s*\([^)]*\[(\d+)(ms|s|m|h|d|w|y)\]')

# --- [FUNCTIONS] --------------------------------------------------------------


def check_predict_range(query: str) -> list[Finding]:
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


def check_dimensional_names(query: str) -> list[Finding]:
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


def check_histogram_usage(query: str) -> list[Finding]:
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


def check_vector_matching(query: str) -> list[Finding]:
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


def check_native_histogram(query: str) -> list[Finding]:
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


def check_mixed_types(query: str) -> list[Finding]:
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


# --- [EXPORT] -----------------------------------------------------------------
