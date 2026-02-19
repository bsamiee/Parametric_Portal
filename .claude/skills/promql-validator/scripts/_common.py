"""Shared constants, dispatch, and utilities for PromQL validation scripts."""

from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
import json
import re
import sys
from typing import Any, Final


# --- [TYPES] -----------------------------------------------------------------

type CommandFn = Callable[..., str]
type CommandRegistry = dict[str, tuple[CommandFn, int]]
type Finding = dict[str, Any]
type CheckFn = Callable[[str], list[Finding]]

# --- [CONSTANTS] --------------------------------------------------------------

METRIC_NAME: Final = r"[a-zA-Z_:][a-zA-Z0-9_:]*"
DURATION: Final = r"\d+(?:ms|s|m|h|d|w|y)"
FUNCTIONS: Final = frozenset({
    # Aggregation
    "sum",
    "min",
    "max",
    "avg",
    "group",
    "stddev",
    "stdvar",
    "count",
    "count_values",
    "bottomk",
    "topk",
    "quantile",
    "limitk",
    "limit_ratio",
    # Rate / delta
    "rate",
    "irate",
    "increase",
    "delta",
    "idelta",
    "deriv",
    "resets",
    "changes",
    # Time
    "timestamp",
    "time",
    "minute",
    "hour",
    "day_of_month",
    "day_of_week",
    "days_in_month",
    "month",
    "year",
    # Math
    "abs",
    "ceil",
    "floor",
    "round",
    "sqrt",
    "exp",
    "ln",
    "log2",
    "log10",
    # Trigonometric
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "sinh",
    "cosh",
    "tanh",
    "asinh",
    "acosh",
    "atanh",
    # Conversion / clamping
    "deg",
    "rad",
    "sgn",
    "clamp",
    "clamp_max",
    "clamp_min",
    # Histogram
    "histogram_quantile",
    "histogram_count",
    "histogram_sum",
    "histogram_fraction",
    "histogram_avg",
    "histogram_stddev",
    "histogram_stdvar",
    # Label manipulation
    "label_replace",
    "label_join",
    # Over-time aggregations
    "avg_over_time",
    "min_over_time",
    "max_over_time",
    "sum_over_time",
    "count_over_time",
    "quantile_over_time",
    "stddev_over_time",
    "stdvar_over_time",
    "last_over_time",
    "present_over_time",
    "mad_over_time",
    "first_over_time",
    "ts_of_max_over_time",
    "ts_of_min_over_time",
    "ts_of_last_over_time",
    "ts_of_first_over_time",
    # Forecasting
    "predict_linear",
    "holt_winters",
    "double_exponential_smoothing",
    # Sort
    "sort",
    "sort_desc",
    "sort_by_label",
    "sort_by_label_desc",
    # Misc
    "step",
    "absent",
    "absent_over_time",
    "scalar",
    "vector",
    "info",
    "pi",
    "start",
    "end",
})
KEYWORDS: Final = frozenset({
    "by",
    "without",
    "and",
    "or",
    "unless",
    "on",
    "ignoring",
    "group_left",
    "group_right",
    "bool",
    "offset",
    "inf",
    "nan",
})
RESERVED: Final = FUNCTIONS | KEYWORDS
COUNTER_SUFFIXES: Final = ("_total", "_count", "_sum", "_bucket")
GAUGE_PATTERNS: Final = (
    "_bytes",
    "_ratio",
    "_usage",
    "_percent",
    "_gauge",
    "_celsius",
    "_fahrenheit",
    "_temperature",
    "_info",
    "_size",
    "_current",
    "_limit",
    "_available",
    "_free",
    "_used",
    "_utilization",
    "_capacity",
    "_level",
)
DURATION_MULTIPLIERS: Final[dict[str, float]] = {
    "ms": 0.001,
    "s": 1,
    "m": 60,
    "h": 3600,
    "d": 86400,
    "w": 604800,
    "y": 31536000,
}

# --- [PRECOMPILED_REGEX] -----------------------------------------------------

RE_METRIC_NAME: Final = re.compile(METRIC_NAME)
RE_DURATION: Final = re.compile(DURATION)
RE_STRING_LITERAL: Final = re.compile(r'"(?:[^"\\]|\\.)*"')
RE_FUNC_CALL: Final = re.compile(r"([a-z_][a-z0-9_]*)\s*\(", re.IGNORECASE)
RE_GROUPING_CLAUSE: Final = re.compile(r"\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)")


@dataclass(frozen=True, slots=True, kw_only=True)
class CheckSpec:
    """Data-driven validation check specification. Defines a single validation rule as a pure data record.
    A generic runner applies the pattern to the query and produces findings -- no per-check imperative logic needed.
    """

    name: str
    pattern: re.Pattern[str]
    severity: str
    message_fn: Callable[[re.Match[str]], str]
    recommendation: str = ""


# --- [FUNCTIONS] --------------------------------------------------------------


def to_seconds(value: int, unit: str) -> float:
    """Convert duration value + unit to seconds."""
    return value * DURATION_MULTIPLIERS.get(unit, 1.0)


def strip_strings_and_selectors(query: str) -> str:
    """Remove {...} blocks, quoted strings, and grouping clauses to isolate metric names.

    Single-pass fold over characters tracking brace depth and string context.
    """
    query = RE_GROUPING_CLAUSE.sub(r"\1 ( )", query)

    def _fold(state: tuple[list[str], int, bool, bool], ch: str) -> tuple[list[str], int, bool, bool]:
        result, depth, in_str, esc = state
        match (esc, ch, in_str):
            case (True, _, _):
                return (result, depth, in_str, False)
            case (_, "\\", _):
                return (result, depth, in_str, True)
            case (_, '"', _):
                return (result, depth, not in_str, False)
            case (_, _, True):
                return (result, depth, in_str, False)
            case (_, "{", False):
                result.append(" ")
                return (result, depth + 1, False, False)
            case (_, "}", False):
                result.append(" ")
                return (result, max(0, depth - 1), False, False)
            case _:
                result.append(ch if depth == 0 else " ")
                return (result, depth, False, False)

    chars, _, _, _ = reduce(_fold, query, ([], 0, False, False))
    return "".join(chars)


def _dp_row(prev: list[int], c1: str, target: str) -> list[int]:
    """Compute next row in Levenshtein DP matrix via in-place append."""
    curr: list[int] = [prev[0] + 1]
    for j, c2 in enumerate(target):
        curr.append(min(prev[j + 1] + 1, curr[-1] + 1, prev[j] + (c1 != c2)))
    return curr


def levenshtein(first: str, second: str) -> int:
    """Levenshtein distance between two strings via DP fold."""
    a, b = (second, first) if len(first) < len(second) else (first, second)
    match len(b):
        case 0:
            return len(a)
        case _:
            return reduce(lambda prev, c1: _dp_row(prev, c1, b), a, list(range(len(b) + 1)))[-1]


def run_check_specs(query: str, specs: tuple[CheckSpec, ...]) -> list[Finding]:
    """Apply data-driven check specs to a query. Pure function: specs in, findings out."""
    return [
        {
            "type": spec.name,
            "message": spec.message_fn(match),
            "severity": spec.severity,
            **({"recommendation": spec.recommendation} if spec.recommendation else {}),
        }
        for spec in specs
        for match in spec.pattern.finditer(query)
    ]


# --- [DISPATCH] ---------------------------------------------------------------
def cmd(registry: CommandRegistry, argc: int) -> Callable[[CommandFn], CommandFn]:
    """Register command with argument count into given registry."""

    def register(fn: CommandFn) -> CommandFn:
        match fn:
            case object(__name__=str() as name):
                registry[name] = (fn, argc)
            case _:
                registry[repr(fn)] = (fn, argc)
        return fn

    return register


def _resolve_exit(parsed: dict[str, Any], exit_key: str) -> int:
    """Resolve exit code from parsed JSON response."""
    match exit_key:
        case "valid":
            return 0 if parsed.get("valid", True) else 1
        case dotted:
            value = reduce(lambda acc, part: acc.get(part, {}), dotted.split("."), parsed)
            return 0 if value == 0 else 1


def dispatch(registry: CommandRegistry, script_name: str, *, exit_key: str = "valid") -> int:
    """Dispatch CLI command from sys.argv. Returns exit code."""

    def _run(fn: CommandFn, *args: str) -> int:
        result = fn(*args)
        sys.stdout.write(result + "\n")
        return _resolve_exit(json.loads(result), exit_key)

    match sys.argv[1:]:
        case [name, *args] if (entry := registry.get(name)) and len(args) >= entry[1]:
            return _run(entry[0], *args[: entry[1]])
        case [name, *_] if registry.get(name):
            sys.stdout.write(f'Usage: {script_name} {name} "<query>"\n')
            return 1
        case [query] if not query.startswith("-") and registry:
            return _run(next(iter(registry.values()))[0], query)
        case _:
            return 1


# --- [EXPORT] -----------------------------------------------------------------
