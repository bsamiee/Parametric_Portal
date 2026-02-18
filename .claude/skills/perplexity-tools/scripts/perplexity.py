#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Perplexity AI CLI — web research via REST API.

Commands:
    ask <query>                   Quick question with citations (sonar)
    pro <query>                   Deeper retrieval with 2x results (sonar-pro)
    research <query> [strip]      Deep research (sonar-deep-research, strip=strip thinking)
    reason <query> [strip]        Reasoning task (sonar-reasoning-pro, strip=strip thinking)
    search <query> [max] [country] Web search returning citations (default: 10)
"""

import json
import os
import re
import sys
from collections.abc import Callable
from typing import Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = 'https://api.perplexity.ai'
KEY_ENV: Final = 'PERPLEXITY_API_KEY'
TIMEOUT: Final = 240
TIMEOUT_DEEP: Final = 600
MAX_RESULTS: Final = 10

MODEL_ASK: Final = 'sonar'
MODEL_PRO: Final = 'sonar-pro'
MODEL_RESEARCH: Final = 'sonar-deep-research'
MODEL_REASON: Final = 'sonar-reasoning-pro'

# --- [TYPES] ------------------------------------------------------------------
type CommandEntry = tuple[Callable[..., dict], int, str, int]
type CommandRegistry = dict[str, CommandEntry]

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[CommandRegistry] = {}


def cmd(argc: int, model: str, timeout: int = TIMEOUT) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required arg count, model, and timeout."""

    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc, model, timeout)
        return fn

    return register


# --- [FUNCTIONS] --------------------------------------------------------------
def _post(model: str, messages: list[dict], timeout: int) -> dict:
    """POST to chat completions endpoint."""
    headers = {'Authorization': f'Bearer {os.environ.get(KEY_ENV, "")}', 'Content-Type': 'application/json'}
    body = {'model': model, 'messages': messages}
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f'{BASE}/chat/completions', headers=headers, json=body)
        response.raise_for_status()
        return response.json()


def _content(response: dict) -> str:
    """Extract content from response."""
    return response['choices'][0]['message']['content']


def _citations(response: dict) -> list:
    """Extract citations from response."""
    return response.get('citations', [])


def _strip_think(content: str, should_strip: bool) -> str:
    """Remove <think> tags when requested."""
    return re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip() if should_strip else content


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1, MODEL_ASK)
def ask(query: str) -> dict:
    """Quick question with citations."""
    response = _post(MODEL_ASK, [{'role': 'user', 'content': query}], TIMEOUT)
    return {'status': 'success', 'query': query, 'response': _content(response), 'citations': _citations(response)}


@cmd(1, MODEL_PRO)
def pro(query: str) -> dict:
    """Deeper retrieval with enhanced search and 2x results."""
    response = _post(MODEL_PRO, [{'role': 'user', 'content': query}], TIMEOUT)
    return {'status': 'success', 'query': query, 'response': _content(response), 'citations': _citations(response)}


@cmd(1, MODEL_RESEARCH, TIMEOUT_DEEP)
def research(query: str, strip: str = '') -> dict:
    """Deep research with optional thinking removal."""
    response = _post(MODEL_RESEARCH, [{'role': 'user', 'content': query}], TIMEOUT_DEEP)
    return {
        'status': 'success',
        'query': query,
        'response': _strip_think(_content(response), strip == 'strip'),
        'citations': _citations(response),
    }


@cmd(1, MODEL_REASON, TIMEOUT_DEEP)
def reason(query: str, strip: str = '') -> dict:
    """Reasoning task with optional thinking removal."""
    response = _post(MODEL_REASON, [{'role': 'user', 'content': query}], TIMEOUT_DEEP)
    return {'status': 'success', 'query': query, 'response': _strip_think(_content(response), strip == 'strip')}


@cmd(1, MODEL_ASK)
def search(query: str, max_: str = '10', country: str = '') -> dict:
    """Web search returning citations."""
    prompt = f'Search: {query}' + (f' (focus: {country})' if country else '')
    response = _post(MODEL_ASK, [{'role': 'user', 'content': prompt}], TIMEOUT)
    return {'status': 'success', 'query': query, 'results': _citations(response)[: int(max_)]}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if entry := CMDS.get(cmd_name):
            fn, argc, _, _ = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    sys.stdout.write(
                        f'Usage: perplexity.py {cmd_name} {" ".join(f"<arg{index + 1}>" for index in range(argc))}\n'
                    )
                    return 1
                case _:
                    try:
                        result = fn(*cmd_args[: argc + 2])
                        sys.stdout.write(json.dumps(result, indent=2) + '\n')
                        return 0 if result['status'] == 'success' else 1
                    except httpx.HTTPStatusError as error:
                        sys.stdout.write(
                            json.dumps(
                                {
                                    'status': 'error',
                                    'code': error.response.status_code,
                                    'message': error.response.text[:200],
                                }
                            )
                            + '\n'
                        )
                        return 1
                    except httpx.RequestError as error:
                        sys.stdout.write(json.dumps({'status': 'error', 'message': str(error)}) + '\n')
                        return 1
        case [cmd_name, *_]:
            sys.stdout.write(f"[ERROR] Unknown command '{cmd_name}'\n\n")
            sys.stdout.write(__doc__ + '\n')
            return 1
        case _:
            sys.stdout.write(__doc__ + '\n')
            return 1


if __name__ == '__main__':
    sys.exit(main())
