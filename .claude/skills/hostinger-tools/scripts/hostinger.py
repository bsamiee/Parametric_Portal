#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Hostinger API CLI -- polymorphic interface with zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
from typing import Any, Final
from urllib.error import HTTPError
from urllib.request import Request, urlopen


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
    # --- VPS_CORE ---
    "vps-list": {"desc": "List virtual machines", "opts": "", "req": ""},
    "vps-view": {"desc": "View VPS details", "opts": "--id NUM", "req": "--id"},
    "vps-start": {"desc": "Start VPS", "opts": "--id NUM", "req": "--id"},
    "vps-stop": {"desc": "Stop VPS", "opts": "--id NUM", "req": "--id"},
    "vps-restart": {"desc": "Restart VPS", "opts": "--id NUM", "req": "--id"},
    "vps-metrics": {"desc": "Get VPS metrics", "opts": "--id NUM --from DATE --to DATE", "req": "--id --from --to"},
    "vps-actions": {"desc": "List VPS actions", "opts": "--id NUM", "req": "--id"},
    "vps-action-view": {"desc": "View action details", "opts": "--id NUM --action-id NUM", "req": "--id --action-id"},
    # --- VPS_CONFIG ---
    "vps-hostname-set": {"desc": "Set VPS hostname", "opts": "--id NUM --hostname TEXT", "req": "--id --hostname"},
    "vps-hostname-reset": {"desc": "Reset VPS hostname", "opts": "--id NUM", "req": "--id"},
    "vps-nameservers-set": {"desc": "Set VPS nameservers", "opts": "--id NUM --ns1 TEXT [--ns2 TEXT]", "req": "--id --ns1"},
    "vps-password-set": {"desc": "Set root password", "opts": "--id NUM --password TEXT", "req": "--id --password"},
    "vps-panel-password-set": {"desc": "Set panel password", "opts": "--id NUM --password TEXT", "req": "--id --password"},
    "vps-ptr-create": {"desc": "Create PTR record", "opts": "--id NUM --ip-id NUM --domain TEXT", "req": "--id --ip-id --domain"},
    "vps-ptr-delete": {"desc": "Delete PTR record", "opts": "--id NUM --ip-id NUM", "req": "--id --ip-id"},
    # --- VPS_RECOVERY ---
    "vps-recovery-start": {"desc": "Start recovery mode", "opts": "--id NUM --root-password TEXT", "req": "--id --root-password"},
    "vps-recovery-stop": {"desc": "Stop recovery mode", "opts": "--id NUM", "req": "--id"},
    "vps-recreate": {"desc": "Recreate VPS", "opts": "--id NUM --template-id NUM [--password TEXT]", "req": "--id --template-id"},
    # --- DOCKER ---
    "docker-list": {"desc": "List Docker projects", "opts": "--id NUM", "req": "--id"},
    "docker-view": {"desc": "View Docker project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-containers": {"desc": "List project containers", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-logs": {"desc": "Get project logs", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-create": {"desc": "Create Docker project", "opts": "--id NUM --project NAME --content TEXT", "req": "--id --project --content"},
    "docker-start": {"desc": "Start project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-stop": {"desc": "Stop project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-restart": {"desc": "Restart project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-update": {"desc": "Update project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    "docker-delete": {"desc": "Delete project", "opts": "--id NUM --project NAME", "req": "--id --project"},
    # --- FIREWALL ---
    "firewall-list": {"desc": "List firewalls", "opts": "", "req": ""},
    "firewall-view": {"desc": "View firewall", "opts": "--id NUM", "req": "--id"},
    "firewall-create": {"desc": "Create firewall", "opts": "--name TEXT", "req": "--name"},
    "firewall-delete": {"desc": "Delete firewall", "opts": "--id NUM", "req": "--id"},
    "firewall-activate": {"desc": "Activate firewall", "opts": "--firewall-id NUM --vps-id NUM", "req": "--firewall-id --vps-id"},
    "firewall-deactivate": {"desc": "Deactivate firewall", "opts": "--firewall-id NUM --vps-id NUM", "req": "--firewall-id --vps-id"},
    "firewall-sync": {"desc": "Sync firewall rules", "opts": "--firewall-id NUM --vps-id NUM", "req": "--firewall-id --vps-id"},
    "firewall-rule-create": {"desc": "Create firewall rule", "opts": "--id NUM --protocol TEXT --port TEXT --source TEXT --source-detail TEXT", "req": "--id --protocol --port --source --source-detail"},
    "firewall-rule-update": {"desc": "Update firewall rule", "opts": "--id NUM --rule-id NUM --protocol TEXT --port TEXT --source TEXT --source-detail TEXT", "req": "--id --rule-id --protocol --port --source --source-detail"},
    "firewall-rule-delete": {"desc": "Delete firewall rule", "opts": "--id NUM --rule-id NUM", "req": "--id --rule-id"},
    # --- SSH_KEYS ---
    "ssh-key-list": {"desc": "List SSH keys", "opts": "", "req": ""},
    "ssh-key-create": {"desc": "Create SSH key", "opts": "--name TEXT --key TEXT", "req": "--name --key"},
    "ssh-key-delete": {"desc": "Delete SSH key", "opts": "--id NUM", "req": "--id"},
    "ssh-key-attach": {"desc": "Attach keys to VPS", "opts": "--key-ids IDS --vps-id NUM", "req": "--key-ids --vps-id"},
    "ssh-key-attached": {"desc": "List attached keys", "opts": "--vps-id NUM", "req": "--vps-id"},
    # --- SCRIPTS ---
    "script-list": {"desc": "List post-install scripts", "opts": "", "req": ""},
    "script-view": {"desc": "View script", "opts": "--id NUM", "req": "--id"},
    "script-create": {"desc": "Create script", "opts": "--name TEXT --content TEXT", "req": "--name --content"},
    "script-update": {"desc": "Update script", "opts": "--id NUM --name TEXT --content TEXT", "req": "--id --name --content"},
    "script-delete": {"desc": "Delete script", "opts": "--id NUM", "req": "--id"},
    # --- SNAPSHOTS ---
    "snapshot-view": {"desc": "Get VPS snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-create": {"desc": "Create snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-delete": {"desc": "Delete snapshot", "opts": "--id NUM", "req": "--id"},
    "snapshot-restore": {"desc": "Restore snapshot", "opts": "--id NUM", "req": "--id"},
    "backup-list": {"desc": "List VPS backups", "opts": "--id NUM", "req": "--id"},
    "backup-restore": {"desc": "Restore backup", "opts": "--id NUM --backup-id NUM", "req": "--id --backup-id"},
    # --- DNS ---
    "dns-records": {"desc": "Get DNS records", "opts": "--domain NAME", "req": "--domain"},
    "dns-snapshots": {"desc": "List DNS snapshots", "opts": "--domain NAME", "req": "--domain"},
    # --- DOMAINS ---
    "domain-list": {"desc": "List domains", "opts": "", "req": ""},
    "domain-view": {"desc": "View domain", "opts": "--domain NAME", "req": "--domain"},
    "domain-check": {"desc": "Check availability", "opts": "--domain NAME --tlds LIST", "req": "--domain --tlds"},
    # --- BILLING ---
    "billing-catalog": {"desc": "List catalog items", "opts": "[--category DOMAIN|VPS]", "req": ""},
    "billing-payment-methods": {"desc": "List payment methods", "opts": "", "req": ""},
    "billing-payment-method-set-default": {"desc": "Set default payment", "opts": "--id NUM", "req": "--id"},
    "billing-payment-method-delete": {"desc": "Delete payment method", "opts": "--id NUM", "req": "--id"},
    "billing-subscriptions": {"desc": "List subscriptions", "opts": "", "req": ""},
    "billing-subscription-cancel": {"desc": "Cancel subscription", "opts": "--id TEXT", "req": "--id"},
    "billing-auto-renewal-enable": {"desc": "Enable auto-renewal", "opts": "--id TEXT", "req": "--id"},
    "billing-auto-renewal-disable": {"desc": "Disable auto-renewal", "opts": "--id TEXT", "req": "--id"},
    # --- HOSTING ---
    "hosting-orders-list": {"desc": "List hosting orders", "opts": "", "req": ""},
    "hosting-websites-list": {"desc": "List websites", "opts": "", "req": ""},
    "hosting-website-create": {"desc": "Create website", "opts": "--domain NAME --order-id NUM [--datacenter CODE]", "req": "--domain --order-id"},
    "hosting-datacenters-list": {"desc": "List available datacenters", "opts": "--order-id NUM", "req": "--order-id"},
    # --- DOMAIN_EXTENDED ---
    "domain-lock-enable": {"desc": "Enable domain lock", "opts": "--domain NAME", "req": "--domain"},
    "domain-lock-disable": {"desc": "Disable domain lock", "opts": "--domain NAME", "req": "--domain"},
    "domain-privacy-enable": {"desc": "Enable privacy protection", "opts": "--domain NAME", "req": "--domain"},
    "domain-privacy-disable": {"desc": "Disable privacy protection", "opts": "--domain NAME", "req": "--domain"},
    "domain-forwarding-view": {"desc": "Get forwarding config", "opts": "--domain NAME", "req": "--domain"},
    "domain-forwarding-create": {"desc": "Create forwarding", "opts": "--domain NAME --redirect-url URL --redirect-type 301|302", "req": "--domain --redirect-url --redirect-type"},
    "domain-forwarding-delete": {"desc": "Delete forwarding", "opts": "--domain NAME", "req": "--domain"},
    "domain-nameservers-set": {"desc": "Set domain nameservers", "opts": "--domain NAME --ns1 TEXT --ns2 TEXT [--ns3 TEXT] [--ns4 TEXT]", "req": "--domain --ns1 --ns2"},
    # --- WHOIS ---
    "whois-list": {"desc": "List WHOIS profiles", "opts": "[--tld TEXT]", "req": ""},
    "whois-view": {"desc": "View WHOIS profile", "opts": "--id NUM", "req": "--id"},
    "whois-create": {"desc": "Create WHOIS profile", "opts": "--tld TEXT --entity-type TEXT --country CODE --whois-details JSON", "req": "--tld --entity-type --country --whois-details"},
    "whois-delete": {"desc": "Delete WHOIS profile", "opts": "--id NUM", "req": "--id"},
    "whois-usage": {"desc": "Get WHOIS profile usage", "opts": "--id NUM", "req": "--id"},
    # --- REFERENCE ---
    "datacenter-list": {"desc": "List datacenters", "opts": "", "req": ""},
    "template-list": {"desc": "List OS templates", "opts": "", "req": ""},
    "template-view": {"desc": "View template", "opts": "--id NUM", "req": "--id"},
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    # VPS_CORE
    "vps-view": ("id",),
    "vps-start": ("id",),
    "vps-stop": ("id",),
    "vps-restart": ("id",),
    "vps-metrics": ("id", "from_date", "to_date"),
    "vps-actions": ("id",),
    "vps-action-view": ("id", "action_id"),
    # VPS_CONFIG
    "vps-hostname-set": ("id", "hostname"),
    "vps-hostname-reset": ("id",),
    "vps-nameservers-set": ("id", "ns1"),
    "vps-password-set": ("id", "password"),
    "vps-panel-password-set": ("id", "password"),
    "vps-ptr-create": ("id", "ip_id", "domain"),
    "vps-ptr-delete": ("id", "ip_id"),
    # VPS_RECOVERY
    "vps-recovery-start": ("id", "root_password"),
    "vps-recovery-stop": ("id",),
    "vps-recreate": ("id", "template_id"),
    # DOCKER
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
    # FIREWALL
    "firewall-view": ("id",),
    "firewall-create": ("name",),
    "firewall-delete": ("id",),
    "firewall-activate": ("firewall_id", "vps_id"),
    "firewall-deactivate": ("firewall_id", "vps_id"),
    "firewall-sync": ("firewall_id", "vps_id"),
    "firewall-rule-create": ("id", "protocol", "port", "source", "source_detail"),
    "firewall-rule-update": ("id", "rule_id", "protocol", "port", "source", "source_detail"),
    "firewall-rule-delete": ("id", "rule_id"),
    # SSH_KEYS
    "ssh-key-create": ("name", "key"),
    "ssh-key-delete": ("id",),
    "ssh-key-attach": ("key_ids", "vps_id"),
    "ssh-key-attached": ("vps_id",),
    # SCRIPTS
    "script-view": ("id",),
    "script-create": ("name", "content"),
    "script-update": ("id", "name", "content"),
    "script-delete": ("id",),
    # SNAPSHOTS
    "snapshot-view": ("id",),
    "snapshot-create": ("id",),
    "snapshot-delete": ("id",),
    "snapshot-restore": ("id",),
    "backup-list": ("id",),
    "backup-restore": ("id", "backup_id"),
    # DNS
    "dns-records": ("domain",),
    "dns-snapshots": ("domain",),
    # DOMAINS
    "domain-view": ("domain",),
    "domain-check": ("domain", "tlds"),
    # BILLING
    "billing-payment-method-set-default": ("id",),
    "billing-payment-method-delete": ("id",),
    "billing-subscription-cancel": ("id",),
    "billing-auto-renewal-enable": ("id",),
    "billing-auto-renewal-disable": ("id",),
    # HOSTING
    "hosting-website-create": ("domain", "order_id"),
    "hosting-datacenters-list": ("order_id",),
    # DOMAIN_EXTENDED
    "domain-lock-enable": ("domain",),
    "domain-lock-disable": ("domain",),
    "domain-privacy-enable": ("domain",),
    "domain-privacy-disable": ("domain",),
    "domain-forwarding-view": ("domain",),
    "domain-forwarding-create": ("domain", "redirect_url", "redirect_type"),
    "domain-forwarding-delete": ("domain",),
    "domain-nameservers-set": ("domain", "ns1", "ns2"),
    # WHOIS
    "whois-view": ("id",),
    "whois-create": ("tld", "entity_type", "country", "whois_details"),
    "whois-delete": ("id",),
    "whois-usage": ("id",),
    # REFERENCE
    "template-view": ("id",),
}


# --- [FUNCTIONS] --------------------------------------------------------------
def _api(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute Hostinger API request with token auth.

    Args:
        method: HTTP method (GET, POST, PUT, DELETE).
        path: API path relative to base URL.
        body: Optional JSON body for request.

    Returns:
        Parsed JSON response or error dict.
    """
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


def _usage_error(message: str, command: str | None = None) -> dict[str, Any]:
    """Generate usage error with correct syntax.

    Args:
        message: Error message to display.
        command: Optional command name for specific usage.

    Returns:
        Error dict with status and formatted message.
    """
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
    """Return missing required arguments for command.

    Args:
        command: Command name to validate.
        args: Parsed argument dict.

    Returns:
        Tuple of missing argument flag names.
    """
    return tuple(
        f"--{key.replace('_', '-')}"
        for key in REQUIRED.get(command, ())
        if args.get(key) is None
    )


def _normalize_key(raw: str) -> str:
    """Normalize a CLI flag key, handling --from/--to date aliases.

    Args:
        raw: Raw flag name without leading dashes.

    Returns:
        Normalized key suitable for args dict.
    """
    key = raw.replace("-", "_")
    match key:
        case "from":
            return "from_date"
        case "to":
            return "to_date"
        case _:
            return key


@dataclass(frozen=True, slots=True, kw_only=True)
class _ParseState:
    """Immutable accumulator for CLI flag parsing."""

    opts: dict[str, Any]
    skip_next: bool


def _parse_flags(args: tuple[str, ...]) -> Args:
    """Parse CLI flags into args dict via functional fold.

    Args:
        args: Tuple of CLI argument strings (after command name).

    Returns:
        Dict mapping normalized keys to values.
    """
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

    return reduce(
        _fold,
        enumerate(args),
        _ParseState(opts={}, skip_next=False),
    ).opts


def _list_fmt(key: str) -> OutputFormatter:
    """Create list formatter extracting array from response.

    Args:
        key: Key name for the formatted output.

    Returns:
        Formatter function for list responses.
    """
    return lambda response, _: {key: response if isinstance(response, list) else response.get("data", response.get(key, response))}


def _item_fmt(key: str) -> OutputFormatter:
    """Create item formatter for single resource.

    Args:
        key: Key name for the formatted output.

    Returns:
        Formatter function for single-item responses.
    """
    return lambda response, args: {"id": args.get("id"), key: response} if isinstance(args, dict) else {"id": None, key: response}


def _action_fmt(action: str) -> OutputFormatter:
    """Create action formatter for mutations.

    Args:
        action: Action name key for the formatted output.

    Returns:
        Formatter function for mutation responses.
    """
    return lambda response, args: {"id": args.get("id"), action: "error" not in response}


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    # --- VPS_CORE ---
    "vps-list": (
        lambda _: ("GET", "/api/vps/v1/virtual-machines", None),
        _list_fmt("machines"),
    ),
    "vps-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}", None),
        _item_fmt("machine"),
    ),
    "vps-start": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/start", None),
        _action_fmt("started"),
    ),
    "vps-stop": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/stop", None),
        _action_fmt("stopped"),
    ),
    "vps-restart": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/restart", None),
        _action_fmt("restarted"),
    ),
    "vps-metrics": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/metrics?date_from={args['from_date']}&date_to={args['to_date']}", None),
        _item_fmt("metrics"),
    ),
    "vps-actions": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/actions", None),
        _list_fmt("actions"),
    ),
    "vps-action-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/actions/{args['action_id']}", None),
        lambda response, args: {"id": args["id"], "action_id": args["action_id"], "action": response},
    ),
    # --- VPS_CONFIG ---
    "vps-hostname-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/hostname", {"hostname": args["hostname"]}),
        lambda response, args: {"id": args["id"], "hostname": args["hostname"], "set": "error" not in response},
    ),
    "vps-hostname-reset": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/hostname", None),
        _action_fmt("reset"),
    ),
    "vps-nameservers-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/nameservers", {"ns1": args["ns1"], **({"ns2": args["ns2"]} if args.get("ns2") else {})}),
        lambda response, args: {"id": args["id"], "ns1": args["ns1"], "set": "error" not in response},
    ),
    "vps-password-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/root-password", {"password": args["password"]}),
        _action_fmt("set"),
    ),
    "vps-panel-password-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/panel-password", {"password": args["password"]}),
        _action_fmt("set"),
    ),
    "vps-ptr-create": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/ptr/{args['ip_id']}", {"domain": args["domain"]}),
        lambda response, args: {"id": args["id"], "ip_id": args["ip_id"], "domain": args["domain"], "created": "error" not in response},
    ),
    "vps-ptr-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/ptr/{args['ip_id']}", None),
        lambda response, args: {"id": args["id"], "ip_id": args["ip_id"], "deleted": "error" not in response},
    ),
    # --- VPS_RECOVERY ---
    "vps-recovery-start": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/recovery", {"root_password": args["root_password"]}),
        _action_fmt("started"),
    ),
    "vps-recovery-stop": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/recovery", None),
        _action_fmt("stopped"),
    ),
    "vps-recreate": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/recreate", {"template_id": int(args["template_id"]), **({"password": args["password"]} if args.get("password") else {})}),
        _action_fmt("recreated"),
    ),
    # --- DOCKER ---
    "docker-list": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project?page=1", None),
        _list_fmt("projects"),
    ),
    "docker-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}", None),
        lambda response, args: {"project": args["project"], "contents": response},
    ),
    "docker-containers": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/containers", None),
        lambda response, args: {"project": args["project"], "containers": response if isinstance(response, list) else response.get("data", response)},
    ),
    "docker-logs": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/logs", None),
        lambda response, args: {"project": args["project"], "logs": response.get("logs", response) if isinstance(response, dict) else response},
    ),
    "docker-create": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project", {"project_name": args["project"], "content": args["content"]}),
        lambda response, args: {"project": args["project"], "created": "error" not in str(response)},
    ),
    "docker-start": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/start", None),
        lambda response, args: {"project": args["project"], "started": "error" not in str(response)},
    ),
    "docker-stop": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/stop", None),
        lambda response, args: {"project": args["project"], "stopped": "error" not in str(response)},
    ),
    "docker-restart": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/restart", None),
        lambda response, args: {"project": args["project"], "restarted": "error" not in str(response)},
    ),
    "docker-update": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}", None),
        lambda response, args: {"project": args["project"], "updated": "error" not in str(response)},
    ),
    "docker-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}", None),
        lambda response, args: {"project": args["project"], "deleted": "error" not in str(response)},
    ),
    # --- FIREWALL ---
    "firewall-list": (
        lambda _: ("GET", "/api/vps/v1/firewall?page=1", None),
        _list_fmt("firewalls"),
    ),
    "firewall-view": (
        lambda args: ("GET", f"/api/vps/v1/firewall/{args['id']}", None),
        _item_fmt("firewall"),
    ),
    "firewall-create": (
        lambda args: ("POST", "/api/vps/v1/firewall", {"name": args["name"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id") if isinstance(response, dict) else None, "firewall": response},
    ),
    "firewall-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "firewall-activate": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "activated": "error" not in response},
    ),
    "firewall-deactivate": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "deactivated": "error" not in response},
    ),
    "firewall-sync": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}/sync", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "synced": "error" not in response},
    ),
    "firewall-rule-create": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['id']}/rules", {"protocol": args["protocol"], "port": args["port"], "source": args["source"], "source_detail": args["source_detail"]}),
        lambda response, args: {"id": args["id"], "created": "error" not in response, "rule": response},
    ),
    "firewall-rule-update": (
        lambda args: ("PUT", f"/api/vps/v1/firewall/{args['id']}/rules/{args['rule_id']}", {"protocol": args["protocol"], "port": args["port"], "source": args["source"], "source_detail": args["source_detail"]}),
        lambda response, args: {"id": args["id"], "rule_id": args["rule_id"], "updated": "error" not in response},
    ),
    "firewall-rule-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['id']}/rules/{args['rule_id']}", None),
        lambda response, args: {"id": args["id"], "rule_id": args["rule_id"], "deleted": "error" not in response},
    ),
    # --- SSH_KEYS ---
    "ssh-key-list": (
        lambda _: ("GET", "/api/vps/v1/public-keys", None),
        _list_fmt("keys"),
    ),
    "ssh-key-create": (
        lambda args: ("POST", "/api/vps/v1/public-keys", {"name": args["name"], "key": args["key"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id"), "key": response},
    ),
    "ssh-key-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/public-keys/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "ssh-key-attach": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['vps_id']}/public-keys", {"ids": [int(identifier) for identifier in str(args["key_ids"]).split(",")]}),
        lambda response, args: {"vps_id": args["vps_id"], "attached": "error" not in response},
    ),
    "ssh-key-attached": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['vps_id']}/public-keys", None),
        _list_fmt("keys"),
    ),
    # --- SCRIPTS ---
    "script-list": (
        lambda _: ("GET", "/api/vps/v1/post-install-scripts", None),
        _list_fmt("scripts"),
    ),
    "script-view": (
        lambda args: ("GET", f"/api/vps/v1/post-install-scripts/{args['id']}", None),
        _item_fmt("script"),
    ),
    "script-create": (
        lambda args: ("POST", "/api/vps/v1/post-install-scripts", {"name": args["name"], "content": args["content"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id") if isinstance(response, dict) else None, "script": response},
    ),
    "script-update": (
        lambda args: ("PUT", f"/api/vps/v1/post-install-scripts/{args['id']}", {"name": args["name"], "content": args["content"]}),
        lambda response, args: {"id": args["id"], "updated": "error" not in response},
    ),
    "script-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/post-install-scripts/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    # --- SNAPSHOTS ---
    "snapshot-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        _item_fmt("snapshot"),
    ),
    "snapshot-create": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        _action_fmt("created"),
    ),
    "snapshot-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        _action_fmt("deleted"),
    ),
    "snapshot-restore": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot/restore", None),
        _action_fmt("restored"),
    ),
    "backup-list": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/backups", None),
        _list_fmt("backups"),
    ),
    "backup-restore": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/backups/{args['backup_id']}/restore", None),
        lambda response, args: {"id": args["id"], "backup_id": args["backup_id"], "restored": "error" not in response},
    ),
    # --- DNS ---
    "dns-records": (
        lambda args: ("GET", f"/api/dns/v1/zones/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "records": response if isinstance(response, list) else response.get("zone", response)},
    ),
    "dns-snapshots": (
        lambda args: ("GET", f"/api/dns/v1/snapshots/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "snapshots": response if isinstance(response, list) else response.get("data", response)},
    ),
    # --- DOMAINS ---
    "domain-list": (
        lambda _: ("GET", "/api/domains/v1/portfolio", None),
        _list_fmt("domains"),
    ),
    "domain-view": (
        lambda args: ("GET", f"/api/domains/v1/portfolio/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "details": response},
    ),
    "domain-check": (
        lambda args: ("POST", "/api/domains/v1/availability", {"domain": args["domain"], "tlds": str(args["tlds"]).split(",")}),
        lambda response, args: {"domain": args["domain"], "availability": response if isinstance(response, list) else response.get("results", response)},
    ),
    # --- BILLING ---
    "billing-catalog": (
        lambda args: ("GET", f"/api/billing/v1/catalog{'?category=' + args['category'] if args.get('category') else ''}", None),
        _list_fmt("items"),
    ),
    "billing-payment-methods": (
        lambda _: ("GET", "/api/billing/v1/payment-methods", None),
        _list_fmt("methods"),
    ),
    "billing-payment-method-set-default": (
        lambda args: ("PUT", f"/api/billing/v1/payment-methods/{args['id']}/default", None),
        _action_fmt("set"),
    ),
    "billing-payment-method-delete": (
        lambda args: ("DELETE", f"/api/billing/v1/payment-methods/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "billing-subscriptions": (
        lambda _: ("GET", "/api/billing/v1/subscriptions", None),
        _list_fmt("subscriptions"),
    ),
    "billing-subscription-cancel": (
        lambda args: ("DELETE", f"/api/billing/v1/subscriptions/{args['id']}", None),
        lambda response, args: {"id": args["id"], "cancelled": "error" not in response},
    ),
    "billing-auto-renewal-enable": (
        lambda args: ("POST", f"/api/billing/v1/subscriptions/{args['id']}/auto-renewal", None),
        lambda response, args: {"id": args["id"], "enabled": "error" not in response},
    ),
    "billing-auto-renewal-disable": (
        lambda args: ("DELETE", f"/api/billing/v1/subscriptions/{args['id']}/auto-renewal", None),
        lambda response, args: {"id": args["id"], "disabled": "error" not in response},
    ),
    # --- HOSTING ---
    "hosting-orders-list": (
        lambda _: ("GET", "/api/hosting/v1/orders", None),
        _list_fmt("orders"),
    ),
    "hosting-websites-list": (
        lambda _: ("GET", "/api/hosting/v1/websites", None),
        _list_fmt("websites"),
    ),
    "hosting-website-create": (
        lambda args: ("POST", "/api/hosting/v1/websites", {"domain": args["domain"], "order_id": int(args["order_id"]), **({} if not args.get("datacenter") else {"datacenter_code": args["datacenter"]})}),
        lambda response, args: {"domain": args["domain"], "created": "error" not in str(response), "website": response},
    ),
    "hosting-datacenters-list": (
        lambda args: ("GET", f"/api/hosting/v1/orders/{args['order_id']}/data-centers", None),
        _list_fmt("datacenters"),
    ),
    # --- DOMAIN_EXTENDED ---
    "domain-lock-enable": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/domain-lock", None),
        lambda response, args: {"domain": args["domain"], "locked": "error" not in str(response)},
    ),
    "domain-lock-disable": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/domain-lock", None),
        lambda response, args: {"domain": args["domain"], "unlocked": "error" not in str(response)},
    ),
    "domain-privacy-enable": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/privacy-protection", None),
        lambda response, args: {"domain": args["domain"], "privacy_enabled": "error" not in str(response)},
    ),
    "domain-privacy-disable": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/privacy-protection", None),
        lambda response, args: {"domain": args["domain"], "privacy_disabled": "error" not in str(response)},
    ),
    "domain-forwarding-view": (
        lambda args: ("GET", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", None),
        lambda response, args: {"domain": args["domain"], "forwarding": response},
    ),
    "domain-forwarding-create": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", {"redirect_url": args["redirect_url"], "redirect_type": args["redirect_type"]}),
        lambda response, args: {"domain": args["domain"], "created": "error" not in str(response), "forwarding": response},
    ),
    "domain-forwarding-delete": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", None),
        lambda response, args: {"domain": args["domain"], "deleted": "error" not in str(response)},
    ),
    "domain-nameservers-set": (
        lambda args: ("PUT", f"/api/domains/v1/portfolio/{args['domain']}/nameservers", {"ns1": args["ns1"], "ns2": args["ns2"], **({} if not args.get("ns3") else {"ns3": args["ns3"]}), **({} if not args.get("ns4") else {"ns4": args["ns4"]})}),
        lambda response, args: {"domain": args["domain"], "nameservers_set": "error" not in str(response)},
    ),
    # --- WHOIS ---
    "whois-list": (
        lambda args: ("GET", f"/api/domains/v1/whois{'?tld=' + args['tld'] if args.get('tld') else ''}", None),
        _list_fmt("profiles"),
    ),
    "whois-view": (
        lambda args: ("GET", f"/api/domains/v1/whois/{args['id']}", None),
        _item_fmt("profile"),
    ),
    "whois-create": (
        lambda args: ("POST", "/api/domains/v1/whois", {"tld": args["tld"], "entity_type": args["entity_type"], "country": args["country"], "whois_details": json.loads(args["whois_details"]) if isinstance(args["whois_details"], str) else args["whois_details"]}),
        lambda response, args: {"tld": args["tld"], "created": response.get("id") if isinstance(response, dict) else None, "profile": response},
    ),
    "whois-delete": (
        lambda args: ("DELETE", f"/api/domains/v1/whois/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "whois-usage": (
        lambda args: ("GET", f"/api/domains/v1/whois/{args['id']}/usage", None),
        lambda response, args: {"id": args["id"], "domains": response if isinstance(response, list) else response.get("domains", response)},
    ),
    # --- REFERENCE ---
    "datacenter-list": (
        lambda _: ("GET", "/api/vps/v1/data-centers", None),
        _list_fmt("datacenters"),
    ),
    "template-list": (
        lambda _: ("GET", "/api/vps/v1/templates", None),
        _list_fmt("templates"),
    ),
    "template-view": (
        lambda args: ("GET", f"/api/vps/v1/templates/{args['id']}", None),
        _item_fmt("template"),
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point -- zero-arg defaults with optional args.

    Returns:
        Exit code: 0 for success, 1 for failure.
    """
    match sys.argv[1:]:
        case [] | ["-h" | "--help", *_]:
            sys.stdout.write(json.dumps(_usage_error("No command specified"), indent=2) + "\n")
            return 1

        case [command, *rest] if command not in COMMANDS:
            sys.stdout.write(json.dumps(_usage_error(f"Unknown command: {command}"), indent=2) + "\n")
            return 1

        case [command, *rest]:
            opts = _parse_flags(tuple(rest))

            if missing := _validate_args(command, opts):
                sys.stdout.write(json.dumps(_usage_error(f"Missing required: {', '.join(missing)}", command), indent=2) + "\n")
                return 1

            if not os.environ.get(DEFAULTS.token_env):
                sys.stdout.write(json.dumps({"status": "error", "message": f"Missing {DEFAULTS.token_env} environment variable"}, indent=2) + "\n")
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
