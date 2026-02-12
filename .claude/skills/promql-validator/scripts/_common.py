"""Shared constants, dispatch, and utilities for PromQL validation scripts."""

import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
from typing import Final

# --- [CONSTANTS] --------------------------------------------------------------

METRIC_NAME: Final = r'[a-zA-Z_:][a-zA-Z0-9_:]*'
DURATION: Final = r'\d+(?:ms|s|m|h|d|w|y)'

FUNCTIONS: Final = frozenset({
    # Aggregation
    'sum', 'min', 'max', 'avg', 'group', 'stddev', 'stdvar', 'count',
    'count_values', 'bottomk', 'topk', 'quantile', 'limitk', 'limit_ratio',
    # Rate/increase
    'rate', 'irate', 'increase', 'delta', 'idelta', 'deriv', 'resets',
    # Time
    'timestamp', 'time', 'minute', 'hour', 'day_of_month', 'day_of_week',
    'days_in_month', 'month', 'year',
    # Math
    'abs', 'ceil', 'floor', 'round', 'sqrt', 'exp', 'ln', 'log2', 'log10',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'asinh', 'acosh', 'atanh', 'deg', 'rad', 'sgn', 'clamp', 'clamp_max', 'clamp_min',
    # Histogram
    'histogram_quantile', 'histogram_count', 'histogram_sum', 'histogram_fraction',
    'histogram_avg', 'histogram_stddev', 'histogram_stdvar',
    # Label
    'label_replace', 'label_join',
    # Over-time
    'changes', 'avg_over_time', 'min_over_time', 'max_over_time',
    'sum_over_time', 'count_over_time', 'quantile_over_time', 'stddev_over_time',
    'stdvar_over_time', 'last_over_time', 'present_over_time', 'mad_over_time',
    'first_over_time',
    # Timestamp experimental (3.5+/3.7+)
    'ts_of_max_over_time', 'ts_of_min_over_time', 'ts_of_last_over_time',
    'ts_of_first_over_time',
    # Prediction
    'predict_linear', 'holt_winters', 'double_exponential_smoothing',
    # Sort
    'sort', 'sort_desc', 'sort_by_label', 'sort_by_label_desc',
    # Duration (3.6+, promql-duration-expr)
    'step',
    # Other
    'absent', 'absent_over_time', 'scalar', 'vector', 'info', 'pi',
    # Timestamp modifiers (@ start() / @ end())
    'start', 'end',
})

KEYWORDS: Final = frozenset({
    'by', 'without', 'and', 'or', 'unless', 'on', 'ignoring',
    'group_left', 'group_right', 'bool', 'offset', 'inf', 'nan',
})

RESERVED: Final = FUNCTIONS | KEYWORDS

COUNTER_SUFFIXES: Final = ('_total', '_count', '_sum', '_bucket')
GAUGE_PATTERNS: Final = (
    '_bytes', '_ratio', '_usage', '_percent', '_gauge', '_celsius', '_fahrenheit',
    '_temperature', '_info', '_size', '_current', '_limit', '_available', '_free',
    '_used', '_utilization', '_capacity', '_level',
)

DURATION_MULTIPLIERS: Final[dict[str, float]] = {
    'ms': 0.001, 's': 1, 'm': 60, 'h': 3600,
    'd': 86400, 'w': 604800, 'y': 31536000,
}

# --- [PRECOMPILED_REGEX] -----------------------------------------------------

RE_METRIC_NAME: Final = re.compile(METRIC_NAME)
RE_DURATION: Final = re.compile(DURATION)
RE_STRING_LITERAL: Final = re.compile(r'"(?:[^"\\]|\\.)*"')
RE_FUNC_CALL: Final = re.compile(r'([a-z_][a-z0-9_]*)\s*\(', re.IGNORECASE)
RE_GROUPING_CLAUSE: Final = re.compile(r'\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)')

# --- [TYPES] -----------------------------------------------------------------

type CommandFn = Callable[..., str]
type CommandRegistry = dict[str, tuple[CommandFn, int]]
type Finding = dict[str, str]
type CheckFn = Callable[[str], list[Finding]]


@dataclass(frozen=True, slots=True, kw_only=True)
class CheckSpec:
    """Data-driven validation check specification.

    Defines a single validation rule as a pure data record. A generic runner
    applies the pattern to the query and produces findings -- no per-check
    imperative logic needed.
    """
    name: str
    pattern: re.Pattern[str]
    severity: str
    message_fn: Callable[[re.Match[str]], str]
    recommendation: str = ''


# --- [FUNCTIONS] --------------------------------------------------------------


def to_seconds(value: int, unit: str) -> float:
    """Convert duration value + unit to seconds.

    Args:
        value: Numeric duration magnitude.
        unit: Duration unit string (ms, s, m, h, d, w, y).

    Returns:
        Duration in seconds as float.
    """
    return value * DURATION_MULTIPLIERS.get(unit, 1.0)


def strip_strings_and_selectors(query: str) -> str:
    """Remove {...} blocks, quoted strings, and grouping clauses to isolate metric names.

    Uses a single-pass fold over characters, tracking brace depth and string
    context immutably via accumulator tuple.

    Args:
        query: Raw PromQL query string.

    Returns:
        Cleaned query with selectors, strings, and grouping clauses removed.
    """
    query = RE_GROUPING_CLAUSE.sub(r'\1 ( )', query)

    def _fold(state: tuple[list[str], int, bool, bool], character: str) -> tuple[list[str], int, bool, bool]:
        result, depth, in_str, escape = state
        match character:
            case _ if escape:
                return (result, depth, in_str, False)
            case '\\':
                return (result, depth, in_str, True)
            case '"':
                return (result, depth, not in_str, False)
            case _ if in_str:
                return (result, depth, in_str, False)
            case '{':
                result.append(' ')
                return (result, depth + 1, False, False)
            case '}':
                result.append(' ')
                return (result, max(0, depth - 1), False, False)
            case _:
                result.append(character if depth == 0 else ' ')
                return (result, depth, False, False)

    chars, _, _, _ = reduce(_fold, query, ([], 0, False, False))
    return ''.join(chars)


def levenshtein(first: str, second: str) -> int:
    """Levenshtein distance between two strings via dynamic programming.

    Args:
        first: Source string.
        second: Target string.

    Returns:
        Minimum edit distance as integer.
    """
    match (first, second):
        case (_, '') :
            return len(first)
        case ('', _):
            return len(second)
        case _ if len(first) < len(second):
            return levenshtein(second, first)

    prev = list(range(len(second) + 1))
    return reduce(
        lambda row, indexed_character: _levenshtein_row(row, indexed_character[1], second),
        enumerate(first),
        prev,
    )[-1]


def _levenshtein_row(prev: list[int], character: str, second: str) -> list[int]:
    """Compute one row of the Levenshtein matrix (pure function).

    Args:
        prev: Previous row of the distance matrix.
        character: Current character from first string.
        second: Target string being compared against.

    Returns:
        New row of the distance matrix.
    """
    return reduce(
        lambda curr, indexed: curr + [min(
            prev[indexed[0] + 1] + 1,
            curr[-1] + 1,
            prev[indexed[0]] + (character != indexed[1]),
        )],
        enumerate(second),
        [prev[0] + 1],
    )


def run_check_specs(query: str, specs: tuple[CheckSpec, ...]) -> list[Finding]:
    """Apply data-driven check specs to a query. Pure function: specs in, findings out.

    Args:
        query: PromQL query string to validate.
        specs: Tuple of frozen CheckSpec rules to apply.

    Returns:
        List of finding dicts for all pattern matches.
    """
    return [
        {
            'type': spec.name,
            'message': spec.message_fn(match),
            'severity': spec.severity,
            **(({'recommendation': spec.recommendation} if spec.recommendation else {})),
        }
        for spec in specs
        for match in spec.pattern.finditer(query)
    ]


# --- [DISPATCH] ---------------------------------------------------------------


def cmd(registry: CommandRegistry, argc: int) -> Callable[[CommandFn], CommandFn]:
    """Register command with argument count into given registry.

    Args:
        registry: Mutable command registry dict to register into.
        argc: Required argument count for the command.

    Returns:
        Decorator that registers the function and returns it unchanged.
    """
    def register(fn: CommandFn) -> CommandFn:
        registry[fn.__name__] = (fn, argc)
        return fn
    return register


def dispatch(registry: CommandRegistry, script_name: str, *, exit_key: str = 'valid') -> int:
    """Dispatch CLI command from sys.argv. Returns exit code.

    Args:
        registry: Command registry mapping names to (fn, argc) tuples.
        script_name: Script filename for usage messages.
        exit_key: JSON key to check for success. 'valid' for validate_syntax,
            'summary.errors' for check_best_practices.

    Returns:
        Exit code: 0 for success, 1 for failure.
    """
    def _exit_code(result: str) -> int:
        """Derive exit code from JSON result string."""
        parsed = json.loads(result)
        match exit_key:
            case 'valid':
                return 0 if parsed.get('valid', True) else 1
            case nested:
                node = reduce(lambda accumulator, part: accumulator.get(part, {}), nested.split('.'), parsed)
                return 0 if node == 0 else 1

    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := registry.get(cmd_name)):
            fn, argc = entry
            if len(cmd_args) < argc:
                sys.stdout.write(f'Usage: {script_name} {cmd_name} "<query>"\n')
                return 1
            result = fn(*cmd_args[:argc + 1])
            sys.stdout.write(result + "\n")
            return _exit_code(result)
        case [query] if not query.startswith('-'):
            # Backward compat: bare query without subcommand
            if not registry:
                return 1
            fn, _ = next(iter(registry.values()))
            result = fn(query)
            sys.stdout.write(result + "\n")
            return _exit_code(result)
        case _:
            return 1


# --- [EXPORT] -----------------------------------------------------------------
