#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# ///
"""Validate n8n workflow JSON against structural constraints."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

# --- [TYPES] ------------------------------------------------------------------
type Data = dict[str, Any]
type Check = Callable[[Data], list[str]]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True, kw_only=True)
class _Defaults:
    """Immutable validation configuration."""

    uuid_pat: str = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ai_types: tuple[str, ...] = (
        'ai_tool',
        'ai_languageModel',
        'ai_memory',
        'ai_outputParser',
        'ai_embedding',
        'ai_vectorStore',
        'ai_retriever',
        'ai_textSplitter',
    )
    on_error: tuple[str, ...] = ('stopWorkflow', 'continueRegularOutput', 'continueErrorOutput')
    caller_policy: tuple[str, ...] = ('any', 'none', 'workflowsFromSameOwner', 'workflowsFromAList')


DEFAULTS: Final[_Defaults] = _Defaults()
UUID_RE: Final[re.Pattern[str]] = re.compile(DEFAULTS.uuid_pat, re.IGNORECASE)


# --- [FUNCTIONS] --------------------------------------------------------------
def _is_uuid(value: Any) -> bool:
    """Check whether a value is a valid UUID string.

    Args:
        value: Value to test.

    Returns:
        True if value is a valid UUID string.
    """
    return isinstance(value, str) and bool(UUID_RE.match(value))


def _is_pos(value: Any) -> bool:
    """Check whether a value is a valid [x, y] position pair.

    Args:
        value: Value to test.

    Returns:
        True if value is a two-element list of numbers.
    """
    return isinstance(value, list) and len(value) == 2 and all(isinstance(element, (int, float)) for element in value)


# --- [DISPATCH_TABLES] --------------------------------------------------------
checks: dict[str, Check] = {
    'root_required': lambda data: [
        f'missing root.{key}' for key in ('name', 'nodes', 'connections') if key not in data
    ],
    'root_types': lambda data: [
        *(['root.name must be string'] if 'name' in data and not isinstance(data['name'], str) else []),
        *(['root.nodes must be array'] if 'nodes' in data and not isinstance(data['nodes'], list) else []),
        *(
            ['root.connections must be object']
            if 'connections' in data and not isinstance(data['connections'], dict)
            else []
        ),
    ],
    'node_required': lambda data: [
        f'node[{index}] missing {key}'
        for index, node in enumerate(data.get('nodes', []))
        for key in ('id', 'name', 'type', 'position')
        if key not in node
    ],
    'node_id_uuid': lambda data: [
        f'node[{index}].id invalid UUID: {node.get("id")}'
        for index, node in enumerate(data.get('nodes', []))
        if 'id' in node and not _is_uuid(node['id'])
    ],
    'node_id_unique': lambda data: (
        lambda ids: [f'duplicate node.id: {identifier}' for identifier in ids if ids.count(identifier) > 1][:1]
    )([node.get('id') for node in data.get('nodes', []) if 'id' in node]),
    'node_name_unique': lambda data: (
        lambda names: [f'duplicate node.name: {name}' for name in names if names.count(name) > 1][:1]
    )([node.get('name') for node in data.get('nodes', []) if 'name' in node]),
    'node_position': lambda data: [
        f'node[{index}].position must be [x,y]: {node.get("position")}'
        for index, node in enumerate(data.get('nodes', []))
        if 'position' in node and not _is_pos(node['position'])
    ],
    'node_on_error': lambda data: [
        f'node[{index}].onError invalid: {node.get("onError")} (allowed: {DEFAULTS.on_error})'
        for index, node in enumerate(data.get('nodes', []))
        if 'onError' in node and node['onError'] not in DEFAULTS.on_error
    ],
    'conn_targets_exist': lambda data: (
        lambda names: [
            f'connection target not found: {conn["node"]}'
            for src in data.get('connections', {}).values()
            for key in src
            for arr in src[key]
            for conn in arr
            if isinstance(conn, dict) and conn.get('node') not in names
        ]
    )({node.get('name') for node in data.get('nodes', [])}),
    'conn_ai_type_match': lambda data: [
        f'AI connection key={key} but type={conn.get("type")} (must match)'
        for src in data.get('connections', {}).values()
        for key in src
        if key in DEFAULTS.ai_types
        for arr in src[key]
        for conn in arr
        if isinstance(conn, dict) and conn.get('type') != key
    ],
    'settings_caller_policy': lambda data: (
        lambda settings: (
            [f'settings.callerPolicy invalid: {settings.get("callerPolicy")} (allowed: {DEFAULTS.caller_policy})']
            if 'callerPolicy' in settings and settings['callerPolicy'] not in DEFAULTS.caller_policy
            else []
        )
    )(data.get('settings', {})),
    'settings_exec_order_ai': lambda data: (
        lambda has_ai, settings: (
            ["AI workflow requires settings.executionOrder='v1'"]
            if has_ai and settings.get('executionOrder') != 'v1'
            else []
        )
    )(
        any(node.get('type', '').startswith('@n8n/n8n-nodes-langchain') for node in data.get('nodes', [])),
        data.get('settings', {}),
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Validate n8n workflow JSON file and report errors.

    Returns:
        Exit code: 0 for valid, 1 for invalid or error.
    """
    match sys.argv[1:]:
        case [] | ['-h' | '--help', *_]:
            sys.stdout.write(
                json.dumps(
                    {
                        'status': 'error',
                        'message': '\n'.join(
                            (
                                '[USAGE] validate-workflow.py <workflow.json> [--strict]',
                                '',
                                '[CHECKS]',
                                *tuple(f'  - {key}' for key in checks),
                                '',
                                '[OPTIONS]',
                                '  --strict  Fail on warnings (UUID format, position array)',
                            )
                        ),
                    },
                    indent=2,
                )
                + '\n'
            )
            return 1

        case [filepath, *rest]:
            path = Path(filepath)
            strict = '--strict' in rest

            if not path.exists():
                sys.stdout.write(json.dumps({'status': 'error', 'message': f'file not found: {path}'}) + '\n')
                return 1

            try:
                data = json.loads(path.read_text('utf-8'))
            except json.JSONDecodeError as error:
                sys.stdout.write(json.dumps({'status': 'error', 'message': f'invalid JSON: {error}'}) + '\n')
                return 1

            errors = tuple(error for check in checks.values() for error in check(data))
            warnings = tuple(error for error in errors if 'UUID' in error or 'position' in error)
            critical = tuple(error for error in errors if error not in warnings)

            result = {
                'status': 'error' if critical or (strict and warnings) else 'success',
                'file': str(path),
                'checks': len(checks),
                'errors': list(critical),
                'warnings': list(warnings),
            }

            sys.stdout.write(json.dumps(result, indent=2) + '\n')
            return 0 if result['status'] == 'success' else 1

        case _:
            return 1


if __name__ == '__main__':
    sys.exit(main())
