"""Shared constants, dispatch, and utilities for PromQL validation scripts."""

import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
from typing import Any, Final

# --- [CONSTANTS] --------------------------------------------------------------
METRIC_NAME: Final = r'[a-zA-Z_:][a-zA-Z0-9_:]*'
DURATION: Final = r'\d+(?:ms|s|m|h|d|w|y)'

FUNCTIONS: Final = frozenset(
    {
        'sum',
        'min',
        'max',
        'avg',
        'group',
        'stddev',
        'stdvar',
        'count',
        'count_values',
        'bottomk',
        'topk',
        'quantile',
        'limitk',
        'limit_ratio',
        'rate',
        'irate',
        'increase',
        'delta',
        'idelta',
        'deriv',
        'resets',
        'timestamp',
        'time',
        'minute',
        'hour',
        'day_of_month',
        'day_of_week',
        'days_in_month',
        'month',
        'year',
        'abs',
        'ceil',
        'floor',
        'round',
        'sqrt',
        'exp',
        'ln',
        'log2',
        'log10',
        'sin',
        'cos',
        'tan',
        'asin',
        'acos',
        'atan',
        'sinh',
        'cosh',
        'tanh',
        'asinh',
        'acosh',
        'atanh',
        'deg',
        'rad',
        'sgn',
        'clamp',
        'clamp_max',
        'clamp_min',
        'histogram_quantile',
        'histogram_count',
        'histogram_sum',
        'histogram_fraction',
        'histogram_avg',
        'histogram_stddev',
        'histogram_stdvar',
        'label_replace',
        'label_join',
        'changes',
        'avg_over_time',
        'min_over_time',
        'max_over_time',
        'sum_over_time',
        'count_over_time',
        'quantile_over_time',
        'stddev_over_time',
        'stdvar_over_time',
        'last_over_time',
        'present_over_time',
        'mad_over_time',
        'first_over_time',
        'ts_of_max_over_time',
        'ts_of_min_over_time',
        'ts_of_last_over_time',
        'ts_of_first_over_time',
        'predict_linear',
        'holt_winters',
        'double_exponential_smoothing',
        'sort',
        'sort_desc',
        'sort_by_label',
        'sort_by_label_desc',
        'step',
        'absent',
        'absent_over_time',
        'scalar',
        'vector',
        'info',
        'pi',
        'start',
        'end',
    }
)

KEYWORDS: Final = frozenset(
    {
        'by',
        'without',
        'and',
        'or',
        'unless',
        'on',
        'ignoring',
        'group_left',
        'group_right',
        'bool',
        'offset',
        'inf',
        'nan',
    }
)

RESERVED: Final = FUNCTIONS | KEYWORDS

COUNTER_SUFFIXES: Final = ('_total', '_count', '_sum', '_bucket')
GAUGE_PATTERNS: Final = (
    '_bytes',
    '_ratio',
    '_usage',
    '_percent',
    '_gauge',
    '_celsius',
    '_fahrenheit',
    '_temperature',
    '_info',
    '_size',
    '_current',
    '_limit',
    '_available',
    '_free',
    '_used',
    '_utilization',
    '_capacity',
    '_level',
)

DURATION_MULTIPLIERS: Final[dict[str, float]] = {
    'ms': 0.001,
    's': 1,
    'm': 60,
    'h': 3600,
    'd': 86400,
    'w': 604800,
    'y': 31536000,
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
type Finding = dict[str, Any]
type CheckFn = Callable[[str], list[Finding]]


@dataclass(frozen=True, slots=True, kw_only=True)
class CheckSpec:
    """Data-driven validation check specification. Defines a single validation rule as a pure data record.
    A generic runner applies the pattern to the query and produces findings -- no per-check imperative logic needed."""

    name: str
    pattern: re.Pattern[str]
    severity: str
    message_fn: Callable[[re.Match[str]], str]
    recommendation: str = ''


# --- [FUNCTIONS] --------------------------------------------------------------


def to_seconds(value: int, unit: str) -> float:
    """Convert duration value + unit to seconds."""
    return value * DURATION_MULTIPLIERS.get(unit, 1.0)


def strip_strings_and_selectors(query: str) -> str:
    """Remove {...} blocks, quoted strings, and grouping clauses to isolate metric names.
    Uses a single-pass fold over characters, tracking brace depth and string context immutably via accumulator tuple."""
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
    """Levenshtein distance between two strings via dynamic programming."""
    match (first, second):
        case (_, ''):
            return len(first)
        case ('', _):
            return len(second)
        case _ if len(first) < len(second):
            return levenshtein(second, first)
        case _:
            pass

    prev = list(range(len(second) + 1))
    return reduce(
        lambda row, indexed_character: reduce(
            lambda curr, indexed: (
                [
                    *curr,
                    min(
                        row[indexed[0] + 1] + 1,
                        curr[-1] + 1,
                        row[indexed[0]] + (indexed_character[1] != indexed[1]),
                    ),
                ]
            ),
            enumerate(second),
            [row[0] + 1],
        ),
        enumerate(first),
        prev,
    )[-1]


def run_check_specs(query: str, specs: tuple[CheckSpec, ...]) -> list[Finding]:
    """Apply data-driven check specs to a query. Pure function: specs in, findings out."""
    return [
        {
            'type': spec.name,
            'message': spec.message_fn(match),
            'severity': spec.severity,
            **({'recommendation': spec.recommendation} if spec.recommendation else {}),
        }
        for spec in specs
        for match in spec.pattern.finditer(query)
    ]


# --- [DISPATCH] ---------------------------------------------------------------
def cmd(registry: CommandRegistry, argc: int) -> Callable[[CommandFn], CommandFn]:
    """Register command with argument count into given registry."""

    def register(fn: CommandFn) -> CommandFn:
        registry[fn.__name__] = (fn, argc)
        return fn

    return register


def dispatch(registry: CommandRegistry, script_name: str, *, exit_key: str = 'valid') -> int:
    """Dispatch CLI command from sys.argv. Returns exit code."""

    def _exit_code(result: str) -> int:
        parsed = json.loads(result)
        return (
            0
            if (
                parsed.get('valid', True)
                if exit_key == 'valid'
                else reduce(lambda acc, part: acc.get(part, {}), exit_key.split('.'), parsed) == 0
            )
            else 1
        )

    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if entry := registry.get(cmd_name):
            fn, argc = entry
            if len(cmd_args) < argc:
                sys.stdout.write(f'Usage: {script_name} {cmd_name} "<query>"\n')
                return 1
            result = fn(*cmd_args[: argc + 1])
            sys.stdout.write(result + '\n')
            return _exit_code(result)
        case [query] if not query.startswith('-') and registry:
            fn, _ = next(iter(registry.values()))
            result = fn(query)
            sys.stdout.write(result + '\n')
            return _exit_code(result)
        case _:
            return 1


# --- [EXPORT] -----------------------------------------------------------------
