#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Hostinger API CLI -- polymorphic interface with zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
import json
import os
import sys
from typing import Any, Final
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from _billing_dispatch import BILLING_HANDLERS
from _dns_dispatch import DNS_HANDLERS
from _docker_dispatch import DOCKER_HANDLERS, SNAPSHOT_HANDLERS
from _vps_dispatch import VPS_HANDLERS


# --- [TYPES] ------------------------------------------------------------------
type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, str, dict[str, Any] | None]]
type OutputFormatter = Callable[[dict[str, Any], Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True, kw_only=True)
class _Defaults:
    """Immutable API configuration defaults."""

    base_url: str = "https://developers.hostinger.com"
    token_env: str = "HOSTINGER_TOKEN"
    limit: int = 30
    timeout: int = 30
    encoding: str = "utf-8"
    user_agent: str = "hostinger-tools/1.0 (Python)"
    page: int = 1


DEFAULTS: Final[_Defaults] = _Defaults()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/hostinger-tools/scripts/hostinger.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "vps-list": {"desc": "List virtual machines", "opts": "", "req": ""},
    "vps-view": {"desc": "View VPS details", "opts": "--id NUM", "req": "--id"},
    "vps-start": {"desc": "Start VPS", "opts": "--id NUM", "req": "--id"},
    "vps-stop": {"desc": "Stop VPS", "opts": "--id NUM", "req": "--id"},
    "vps-restart": {"desc": "Restart VPS", "opts": "--id NUM", "req": "--id"},
    "vps-metrics": {"desc": "Get VPS metrics", "opts": "--id NUM --from DATE --to DATE", "req": "--id --from --to"},
    "vps-actions": {"desc": "List VPS actions", "opts": "--id NUM", "req": "--id"},
    "vps-action-view": {"desc": "View action details", "opts": "--id NUM --action-id NUM", "req": "--id --action-id"},
    "vps-hostname-set": {"desc": "Set VPS hostname", "opts": "--id NUM --hostname TEXT", "req": "--id --hostname"},
    "vps-hostname-reset": {"desc": "Reset VPS hostname", "opts": "--id NUM", "req": "--id"},
    "vps-nameservers-set": {
        "desc": "Set VPS nameservers",
        "opts": "--id NUM --ns1 TEXT [--ns2 TEXT]",
        "req": "--id --ns1",
    },
    "vps-password-set": {"desc": "Set root password", "opts": "--id NUM --password TEXT", "req": "--id --password"},
    "vps-panel-password-set": {
        "desc": "Set panel password",
        "opts": "--id NUM --password TEXT",
        "req": "--id --password",
    },
    "vps-ptr-create": {
        "desc": "Create PTR record",
        "opts": "--id NUM --ip-id NUM --domain TEXT",
        "req": "--id --ip-id --domain",
    },
    "vps-ptr-delete": {"desc": "Delete PTR record", "opts": "--id NUM --ip-id NUM", "req": "--id --ip-id"},
    "vps-recovery-start": {
        "desc": "Start recovery mode",
        "opts": "--id NUM --root-password TEXT",
        "req": "--id --root-password",
    },
    "vps-recovery-stop": {"desc": "Stop recovery mode", "opts": "--id NUM", "req": "--id"},
    "vps-recreate": {
        "desc": "Recreate VPS",
        "opts": "--id NUM --template-id NUM [--password TEXT]",
        "req": "--id --template-id",
    },
    "docker-list": {"desc": "List Docker projects", "opts": "--id NUM", "req": "--id"},
    "docker-view": {"desc": "View Docker project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-containers": {
        "desc": "List project containers",
        "opts": "--id NUM --project NAME",
        "req": "--id --project",
    },
    "docker-logs": {"desc": "Get project logs", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-create": {
        "desc": "Create Docker project",
        "opts": "--id NUM --project NAME --content TEXT",
        "req": "--id --project --content",
    },
    "docker-start": {"desc": "Start project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-stop": {"desc": "Stop project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-restart": {"desc": "Restart project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-update": {"desc": "Update project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-delete": {"desc": "Delete project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "firewall-list": {"desc": "List firewalls", "opts": "", "req": ""},
    "firewall-view": {"desc": "View firewall", "opts": "--id NUM", "req": "--id"},
    "firewall-create": {"desc": "Create firewall", "opts": "--name TEXT", "req": "--name"},
    "firewall-delete": {"desc": "Delete firewall", "opts": "--id NUM", "req": "--id"},
    "firewall-activate": {
        "desc": "Activate firewall",
        "opts": "--firewall-id NUM --vps-id NUM",
        "req": "--firewall-id --vps-id",
    },
    "firewall-deactivate": {
        "desc": "Deactivate firewall",
        "opts": "--firewall-id NUM --vps-id NUM",
        "req": "--firewall-id --vps-id",
    },
    "firewall-sync": {
        "desc": "Sync firewall rules",
        "opts": "--firewall-id NUM --vps-id NUM",
        "req": "--firewall-id --vps-id",
    },
    "firewall-rule-create": {
        "desc": "Create firewall rule",
        "opts": "--id NUM --protocol TEXT --port TEXT --source TEXT --source-detail TEXT",
        "req": "--id --protocol --port --source --source-detail",
    },
    "firewall-rule-update": {
        "desc": "Update firewall rule",
        "opts": "--id NUM --rule-id NUM --protocol TEXT --port TEXT --source TEXT --source-detail TEXT",
        "req": "--id --rule-id --protocol --port --source --source-detail",
    },
    "firewall-rule-delete": {"desc": "Delete firewall rule", "opts": "--id NUM --rule-id NUM", "req": "--id --rule-id"},
    "ssh-key-list": {"desc": "List SSH keys", "opts": "", "req": ""},
    "ssh-key-create": {"desc": "Create SSH key", "opts": "--name TEXT --key TEXT", "req": "--name --key"},
    "ssh-key-delete": {"desc": "Delete SSH key", "opts": "--id NUM", "req": "--id"},
    "ssh-key-attach": {"desc": "Attach keys to VPS", "opts": "--key-ids IDS --vps-id NUM", "req": "--key-ids --vps-id"},
    "ssh-key-attached": {"desc": "List attached keys", "opts": "--vps-id NUM", "req": "--vps-id"},
    "script-list": {"desc": "List post-install scripts", "opts": "", "req": ""},
    "script-view": {"desc": "View script", "opts": "--id NUM", "req": "--id"},
    "script-create": {"desc": "Create script", "opts": "--name TEXT --content TEXT", "req": "--name --content"},
    "script-update": {
        "desc": "Update script",
        "opts": "--id NUM --name TEXT --content TEXT",
        "req": "--id --name --content",
    },
    "script-delete": {"desc": "Delete script", "opts": "--id NUM", "req": "--id"},
    "snapshot-view": {"desc": "Get VPS snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-create": {"desc": "Create snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-delete": {"desc": "Delete snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-restore": {"desc": "Restore snapshot", "opts": "--id NUM", "req": "--id"},
    "backup-list": {"desc": "List VPS backups", "opts": "--id NUM", "req": "--id"},
    "backup-restore": {"desc": "Restore backup", "opts": "--id NUM --backup-id NUM", "req": "--id --backup-id"},
    "dns-records": {"desc": "Get DNS records", "opts": "--domain NAME", "req": "--domain"},
    "dns-snapshots": {"desc": "List DNS snapshots", "opts": "--domain NAME", "req": "--domain"},
    "domain-list": {"desc": "List domains", "opts": "", "req": ""},
    "domain-view": {"desc": "View domain", "opts": "--domain NAME", "req": "--domain"},
    "domain-check": {"desc": "Check availability", "opts": "--domain NAME --tlds LIST", "req": "--domain --tlds"},
    "billing-catalog": {"desc": "List catalog items", "opts": "[--category DOMAIN|VPS]", "req": ""},
    "billing-payment-methods": {"desc": "List payment methods", "opts": "", "req": ""},
    "billing-payment-method-set-default": {"desc": "Set default payment", "opts": "--id NUM", "req": "--id"},
    "billing-payment-method-delete": {"desc": "Delete payment method", "opts": "--id NUM", "req": "--id"},
    "billing-subscriptions": {"desc": "List subscriptions", "opts": "", "req": ""},
    "billing-subscription-cancel": {"desc": "Cancel subscription", "opts": "--id TEXT", "req": "--id"},
    "billing-auto-renewal-enable": {"desc": "Enable auto-renewal", "opts": "--id TEXT", "req": "--id"},
    "billing-auto-renewal-disable": {"desc": "Disable auto-renewal", "opts": "--id TEXT", "req": "--id"},
    "hosting-orders-list": {"desc": "List hosting orders", "opts": "", "req": ""},
    "hosting-websites-list": {"desc": "List websites", "opts": "", "req": ""},
    "hosting-website-create": {
        "desc": "Create website",
        "opts": "--domain NAME --order-id NUM [--datacenter CODE]",
        "req": "--domain --order-id",
    },
    "hosting-datacenters-list": {"desc": "List available datacenters", "opts": "--order-id NUM", "req": "--order-id"},
    "domain-lock-enable": {"desc": "Enable domain lock", "opts": "--domain NAME", "req": "--domain"},
    "domain-lock-disable": {"desc": "Disable domain lock", "opts": "--domain NAME", "req": "--domain"},
    "domain-privacy-enable": {"desc": "Enable privacy protection", "opts": "--domain NAME", "req": "--domain"},
    "domain-privacy-disable": {"desc": "Disable privacy protection", "opts": "--domain NAME", "req": "--domain"},
    "domain-forwarding-view": {"desc": "Get forwarding config", "opts": "--domain NAME", "req": "--domain"},
    "domain-forwarding-create": {
        "desc": "Create forwarding",
        "opts": "--domain NAME --redirect-url URL --redirect-type 301|302",
        "req": "--domain --redirect-url --redirect-type",
    },
    "domain-forwarding-delete": {"desc": "Delete forwarding", "opts": "--domain NAME", "req": "--domain"},
    "domain-nameservers-set": {
        "desc": "Set domain nameservers",
        "opts": "--domain NAME --ns1 TEXT --ns2 TEXT [--ns3 TEXT] [--ns4 TEXT]",
        "req": "--domain --ns1 --ns2",
    },
    "whois-list": {"desc": "List WHOIS profiles", "opts": "[--tld TEXT]", "req": ""},
    "whois-view": {"desc": "View WHOIS profile", "opts": "--id NUM", "req": "--id"},
    "whois-create": {
        "desc": "Create WHOIS profile",
        "opts": "--tld TEXT --entity-type TEXT --country CODE --whois-details JSON",
        "req": "--tld --entity-type --country --whois-details",
    },
    "whois-delete": {"desc": "Delete WHOIS profile", "opts": "--id NUM", "req": "--id"},
    "whois-usage": {"desc": "Get WHOIS profile usage", "opts": "--id NUM", "req": "--id"},
    "datacenter-list": {"desc": "List datacenters", "opts": "", "req": ""},
    "template-list": {"desc": "List OS templates", "opts": "", "req": ""},
    "template-view": {"desc": "View template", "opts": "--id NUM", "req": "--id"},
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "vps-view": ("id",),
    "vps-start": ("id",),
    "vps-stop": ("id",),
    "vps-restart": ("id",),
    "vps-metrics": ("id", "from_date", "to_date"),
    "vps-actions": ("id",),
    "vps-action-view": ("id", "action_id"),
    "vps-hostname-set": ("id", "hostname"),
    "vps-hostname-reset": ("id",),
    "vps-nameservers-set": ("id", "ns1"),
    "vps-password-set": ("id", "password"),
    "vps-panel-password-set": ("id", "password"),
    "vps-ptr-create": ("id", "ip_id", "domain"),
    "vps-ptr-delete": ("id", "ip_id"),
    "vps-recovery-start": ("id", "root_password"),
    "vps-recovery-stop": ("id",),
    "vps-recreate": ("id", "template_id"),
    "docker-list": ("id",),
    "docker-view": ("id", "project"),
    "docker-containers": ("id", "project"),
    "docker-logs": ("id", "project"),
    "docker-create": ("id", "project", "content"),
    "docker-start": ("id", "project"),
    "docker-stop": ("id", "project"),
    "docker-restart": ("id", "project"),
    "docker-update": ("id", "project"),
    "docker-delete": ("id", "project"),
    "firewall-view": ("id",),
    "firewall-create": ("name",),
    "firewall-delete": ("id",),
    "firewall-activate": ("firewall_id", "vps_id"),
    "firewall-deactivate": ("firewall_id", "vps_id"),
    "firewall-sync": ("firewall_id", "vps_id"),
    "firewall-rule-create": ("id", "protocol", "port", "source", "source_detail"),
    "firewall-rule-update": ("id", "rule_id", "protocol", "port", "source", "source_detail"),
    "firewall-rule-delete": ("id", "rule_id"),
    "ssh-key-create": ("name", "key"),
    "ssh-key-delete": ("id",),
    "ssh-key-attach": ("key_ids", "vps_id"),
    "ssh-key-attached": ("vps_id",),
    "script-view": ("id",),
    "script-create": ("name", "content"),
    "script-update": ("id", "name", "content"),
    "script-delete": ("id",),
    "snapshot-view": ("id",),
    "snapshot-create": ("id",),
    "snapshot-delete": ("id",),
    "snapshot-restore": ("id",),
    "backup-list": ("id",),
    "backup-restore": ("id", "backup_id"),
    "dns-records": ("domain",),
    "dns-snapshots": ("domain",),
    "domain-view": ("domain",),
    "domain-check": ("domain", "tlds"),
    "billing-payment-method-set-default": ("id",),
    "billing-payment-method-delete": ("id",),
    "billing-subscription-cancel": ("id",),
    "billing-auto-renewal-enable": ("id",),
    "billing-auto-renewal-disable": ("id",),
    "hosting-website-create": ("domain", "order_id"),
    "hosting-datacenters-list": ("order_id",),
    "domain-lock-enable": ("domain",),
    "domain-lock-disable": ("domain",),
    "domain-privacy-enable": ("domain",),
    "domain-privacy-disable": ("domain",),
    "domain-forwarding-view": ("domain",),
    "domain-forwarding-create": ("domain", "redirect_url", "redirect_type"),
    "domain-forwarding-delete": ("domain",),
    "domain-nameservers-set": ("domain", "ns1", "ns2"),
    "whois-view": ("id",),
    "whois-create": ("tld", "entity_type", "country", "whois_details"),
    "whois-delete": ("id",),
    "whois-usage": ("id",),
    "template-view": ("id",),
}


# --- [FUNCTIONS] --------------------------------------------------------------
def _api(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute Hostinger API request with token auth."""
    token = os.environ.get(DEFAULTS.token_env, "")
    url = f"{DEFAULTS.base_url}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": DEFAULTS.user_agent,
        "Accept": "application/json",
    }
    data = json.dumps(body).encode(DEFAULTS.encoding) if body else None
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=DEFAULTS.timeout) as response:
            return json.loads(response.read().decode(DEFAULTS.encoding)) if response.status == 200 else {}
    except HTTPError as error:
        return {"error": error.reason, "code": error.code, "body": error.read().decode(DEFAULTS.encoding)}
    except URLError as error:
        return {"error": str(error.reason), "code": None, "body": ""}


def _usage_error(message: str, command: str | None = None) -> dict[str, Any]:
    """Generate usage error with correct syntax."""
    lines = (
        (
            f"[ERROR] {message}",
            "",
            "[USAGE]",
            f"  {SCRIPT_PATH} {command} {COMMANDS[command]['opts']}",
            *(f"  Required: {COMMANDS[command]['req']}" for _ in (1,) if COMMANDS[command]["req"]),
        )
        if command and command in COMMANDS
        else (
            f"[ERROR] {message}",
            "",
            "[USAGE]",
            f"  {SCRIPT_PATH} <command> [options]",
            "",
            "[ZERO_ARG_COMMANDS]",
            *tuple(f"  {name:<28} {info['desc']}" for name, info in COMMANDS.items() if not info["req"]),
            "",
            "[REQUIRED_ARG_COMMANDS]",
            *tuple(f"  {name:<28} {info['desc']}" for name, info in COMMANDS.items() if info["req"]),
        )
    )
    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(command: str, args: Args) -> tuple[str, ...]:
    """Return missing required arguments for command."""
    return tuple(f"--{key.replace('_', '-')}" for key in REQUIRED.get(command, ()) if args.get(key) is None)


def _normalize_key(raw: str) -> str:
    """Normalize a CLI flag key, handling --from/--to date aliases."""
    key = raw.replace("-", "_")
    return "from_date" if key == "from" else "to_date" if key == "to" else key


@dataclass(frozen=True, slots=True, kw_only=True)
class _ParseState:
    """Immutable accumulator for CLI flag parsing."""

    opts: dict[str, Any]
    skip_next: bool


def _parse_flags(args: tuple[str, ...]) -> Args:
    """Parse CLI flags into args dict via functional fold."""

    def _fold(state: _ParseState, indexed: tuple[int, str]) -> _ParseState:
        """Process a single argument, accumulating into immutable state."""
        index, arg = indexed
        match (state.skip_next, arg.startswith("--")):
            case (True, _):
                return _ParseState(opts=state.opts, skip_next=False)
            case (_, True):
                key = _normalize_key(arg[2:])
                next_index = index + 1
                has_value = next_index < len(args) and not args[next_index].startswith("--")
                value = args[next_index] if has_value else True
                return _ParseState(opts={**state.opts, key: value}, skip_next=has_value)
            case _:
                return state

    return reduce(_fold, enumerate(args), _ParseState(opts={}, skip_next=False)).opts


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point -- zero-arg defaults with optional args."""
    handlers = {**VPS_HANDLERS, **DOCKER_HANDLERS, **SNAPSHOT_HANDLERS, **DNS_HANDLERS, **BILLING_HANDLERS}

    match sys.argv[1:]:
        case [] | ["-h" | "--help", *_]:
            sys.stdout.write(json.dumps(_usage_error("No command specified"), indent=2) + "\n")
            return 1
        case [command, *_] if command not in COMMANDS:
            sys.stdout.write(json.dumps(_usage_error(f"Unknown command: {command}"), indent=2) + "\n")
            return 1
        case [command, *rest]:
            opts = _parse_flags(tuple(rest))
            if missing := _validate_args(command, opts):
                sys.stdout.write(
                    json.dumps(_usage_error(f"Missing required: {', '.join(missing)}", command), indent=2) + "\n"
                )
                return 1
            if not os.environ.get(DEFAULTS.token_env):
                sys.stdout.write(
                    json.dumps(
                        {"status": "error", "message": f"Missing {DEFAULTS.token_env} environment variable"}, indent=2
                    )
                    + "\n"
                )
                return 1

            builder, formatter = handlers[command]
            method, path, body = builder(opts)
            response = _api(method, path, body)

            result = (
                {"status": "success", **formatter(response, opts)}
                if "error" not in response
                else {"status": "error", "message": response.get("error", "API request failed"), **response}
            )
            sys.stdout.write(json.dumps(result, indent=2) + "\n")
            return 0 if result["status"] == "success" else 1
        case _:
            sys.stdout.write(json.dumps(_usage_error("No command specified"), indent=2) + "\n")
            return 1


if __name__ == "__main__":
    sys.exit(main())
