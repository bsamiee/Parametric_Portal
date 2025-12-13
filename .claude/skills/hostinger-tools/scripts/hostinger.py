#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Hostinger API CLI — polymorphic interface with zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final
from urllib.request import Request, urlopen
from urllib.error import HTTPError


# --- [TYPES] ------------------------------------------------------------------
type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, str, dict[str, Any] | None]]
type OutputFormatter = Callable[[dict[str, Any], Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    base_url: str = "https://developers.hostinger.com"
    token_env: str = "HOSTINGER_TOKEN"
    limit: int = 30
    timeout: int = 30
    encoding: str = "utf-8"
    user_agent: str = "hostinger-tools/1.0 (Python)"
    page: int = 1


B: Final[_B] = _B()

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


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _api(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute Hostinger API request with token auth."""
    token = os.environ.get(B.token_env, "")
    url = f"{B.base_url}{path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": B.user_agent,
        "Accept": "application/json",
    }
    data = json.dumps(body).encode(B.encoding) if body else None
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=B.timeout) as resp:
            return json.loads(resp.read().decode(B.encoding)) if resp.status == 200 else {}
    except HTTPError as e:
        return {"error": e.reason, "code": e.code, "body": e.read().decode(B.encoding)}


def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generate usage error with correct syntax."""
    lines = [f"[ERROR] {message}", "", "[USAGE]"]
    lines += (
        [
            f"  {SCRIPT_PATH} {cmd} {COMMANDS[cmd]['opts']}",
            *(f"  Required: {COMMANDS[cmd]['req']}" for _ in [1] if COMMANDS[cmd]["req"]),
        ]
        if cmd and cmd in COMMANDS
        else [
            f"  {SCRIPT_PATH} <command> [options]",
            "",
            "[ZERO_ARG_COMMANDS]",
            *[f"  {n:<28} {i['desc']}" for n, i in COMMANDS.items() if not i["req"]],
            "",
            "[REQUIRED_ARG_COMMANDS]",
            *[f"  {n:<28} {i['desc']}" for n, i in COMMANDS.items() if i["req"]],
        ]
    )
    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: Args) -> list[str]:
    """Return missing required arguments for command."""
    return [f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if args.get(k) is None]


def _list_fmt(key: str) -> OutputFormatter:
    """Create list formatter extracting array from response."""
    return lambda r, _: {key: r if isinstance(r, list) else r.get("data", r.get(key, r))}


def _item_fmt(key: str) -> OutputFormatter:
    """Create item formatter for single resource."""
    return lambda r, a: {"id": a.get("id"), key: r} if isinstance(a, dict) else {"id": None, key: r}


def _action_fmt(action: str) -> OutputFormatter:
    """Create action formatter for mutations."""
    return lambda r, a: {"id": a.get("id"), action: "error" not in r}


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    # --- VPS_CORE ---
    "vps-list": (
        lambda _: ("GET", "/api/vps/v1/virtual-machines", None),
        _list_fmt("machines"),
    ),
    "vps-view": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}", None),
        _item_fmt("machine"),
    ),
    "vps-start": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/start", None),
        _action_fmt("started"),
    ),
    "vps-stop": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/stop", None),
        _action_fmt("stopped"),
    ),
    "vps-restart": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/restart", None),
        _action_fmt("restarted"),
    ),
    "vps-metrics": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}/metrics?date_from={a['from_date']}&date_to={a['to_date']}", None),
        _item_fmt("metrics"),
    ),
    "vps-actions": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}/actions", None),
        _list_fmt("actions"),
    ),
    "vps-action-view": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}/actions/{a['action_id']}", None),
        lambda r, a: {"id": a["id"], "action_id": a["action_id"], "action": r},
    ),
    # --- VPS_CONFIG ---
    "vps-hostname-set": (
        lambda a: ("PUT", f"/api/vps/v1/virtual-machines/{a['id']}/hostname", {"hostname": a["hostname"]}),
        lambda r, a: {"id": a["id"], "hostname": a["hostname"], "set": "error" not in r},
    ),
    "vps-hostname-reset": (
        lambda a: ("DELETE", f"/api/vps/v1/virtual-machines/{a['id']}/hostname", None),
        _action_fmt("reset"),
    ),
    "vps-nameservers-set": (
        lambda a: ("PUT", f"/api/vps/v1/virtual-machines/{a['id']}/nameservers", {"ns1": a["ns1"], **({"ns2": a["ns2"]} if a.get("ns2") else {})}),
        lambda r, a: {"id": a["id"], "ns1": a["ns1"], "set": "error" not in r},
    ),
    "vps-password-set": (
        lambda a: ("PUT", f"/api/vps/v1/virtual-machines/{a['id']}/root-password", {"password": a["password"]}),
        _action_fmt("set"),
    ),
    "vps-panel-password-set": (
        lambda a: ("PUT", f"/api/vps/v1/virtual-machines/{a['id']}/panel-password", {"password": a["password"]}),
        _action_fmt("set"),
    ),
    "vps-ptr-create": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/ptr/{a['ip_id']}", {"domain": a["domain"]}),
        lambda r, a: {"id": a["id"], "ip_id": a["ip_id"], "domain": a["domain"], "created": "error" not in r},
    ),
    "vps-ptr-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/virtual-machines/{a['id']}/ptr/{a['ip_id']}", None),
        lambda r, a: {"id": a["id"], "ip_id": a["ip_id"], "deleted": "error" not in r},
    ),
    # --- VPS_RECOVERY ---
    "vps-recovery-start": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/recovery", {"root_password": a["root_password"]}),
        _action_fmt("started"),
    ),
    "vps-recovery-stop": (
        lambda a: ("DELETE", f"/api/vps/v1/virtual-machines/{a['id']}/recovery", None),
        _action_fmt("stopped"),
    ),
    "vps-recreate": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/recreate", {"template_id": int(a["template_id"]), **({"password": a["password"]} if a.get("password") else {})}),
        _action_fmt("recreated"),
    ),
    # --- DOCKER ---
    "docker-list": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project?page=1", None),
        _list_fmt("projects"),
    ),
    "docker-view": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}", None),
        lambda r, a: {"project": a["project"], "contents": r},
    ),
    "docker-containers": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}/containers", None),
        lambda r, a: {"project": a["project"], "containers": r if isinstance(r, list) else r.get("data", r)},
    ),
    "docker-logs": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}/logs", None),
        lambda r, a: {"project": a["project"], "logs": r.get("logs", r) if isinstance(r, dict) else r},
    ),
    "docker-create": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project", {"project_name": a["project"], "content": a["content"]}),
        lambda r, a: {"project": a["project"], "created": "error" not in str(r)},
    ),
    "docker-start": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}/start", None),
        lambda r, a: {"project": a["project"], "started": "error" not in str(r)},
    ),
    "docker-stop": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}/stop", None),
        lambda r, a: {"project": a["project"], "stopped": "error" not in str(r)},
    ),
    "docker-restart": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}/restart", None),
        lambda r, a: {"project": a["project"], "restarted": "error" not in str(r)},
    ),
    "docker-update": (
        lambda a: ("PUT", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}", None),
        lambda r, a: {"project": a["project"], "updated": "error" not in str(r)},
    ),
    "docker-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/virtual-machine/{a['id']}/docker-compose/project/{a['project']}", None),
        lambda r, a: {"project": a["project"], "deleted": "error" not in str(r)},
    ),
    # --- FIREWALL ---
    "firewall-list": (
        lambda _: ("GET", "/api/vps/v1/firewall?page=1", None),
        _list_fmt("firewalls"),
    ),
    "firewall-view": (
        lambda a: ("GET", f"/api/vps/v1/firewall/{a['id']}", None),
        _item_fmt("firewall"),
    ),
    "firewall-create": (
        lambda a: ("POST", "/api/vps/v1/firewall", {"name": a["name"]}),
        lambda r, a: {"name": a["name"], "created": r.get("id") if isinstance(r, dict) else None, "firewall": r},
    ),
    "firewall-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/firewall/{a['id']}", None),
        _action_fmt("deleted"),
    ),
    "firewall-activate": (
        lambda a: ("POST", f"/api/vps/v1/firewall/{a['firewall_id']}/virtual-machine/{a['vps_id']}", None),
        lambda r, a: {"firewall_id": a["firewall_id"], "vps_id": a["vps_id"], "activated": "error" not in r},
    ),
    "firewall-deactivate": (
        lambda a: ("DELETE", f"/api/vps/v1/firewall/{a['firewall_id']}/virtual-machine/{a['vps_id']}", None),
        lambda r, a: {"firewall_id": a["firewall_id"], "vps_id": a["vps_id"], "deactivated": "error" not in r},
    ),
    "firewall-sync": (
        lambda a: ("POST", f"/api/vps/v1/firewall/{a['firewall_id']}/virtual-machine/{a['vps_id']}/sync", None),
        lambda r, a: {"firewall_id": a["firewall_id"], "vps_id": a["vps_id"], "synced": "error" not in r},
    ),
    "firewall-rule-create": (
        lambda a: ("POST", f"/api/vps/v1/firewall/{a['id']}/rules", {"protocol": a["protocol"], "port": a["port"], "source": a["source"], "source_detail": a["source_detail"]}),
        lambda r, a: {"id": a["id"], "created": "error" not in r, "rule": r},
    ),
    "firewall-rule-update": (
        lambda a: ("PUT", f"/api/vps/v1/firewall/{a['id']}/rules/{a['rule_id']}", {"protocol": a["protocol"], "port": a["port"], "source": a["source"], "source_detail": a["source_detail"]}),
        lambda r, a: {"id": a["id"], "rule_id": a["rule_id"], "updated": "error" not in r},
    ),
    "firewall-rule-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/firewall/{a['id']}/rules/{a['rule_id']}", None),
        lambda r, a: {"id": a["id"], "rule_id": a["rule_id"], "deleted": "error" not in r},
    ),
    # --- SSH_KEYS ---
    "ssh-key-list": (
        lambda _: ("GET", "/api/vps/v1/public-keys", None),
        _list_fmt("keys"),
    ),
    "ssh-key-create": (
        lambda a: ("POST", "/api/vps/v1/public-keys", {"name": a["name"], "key": a["key"]}),
        lambda r, a: {"name": a["name"], "created": r.get("id"), "key": r},
    ),
    "ssh-key-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/public-keys/{a['id']}", None),
        _action_fmt("deleted"),
    ),
    "ssh-key-attach": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['vps_id']}/public-keys", {"ids": [int(i) for i in str(a["key_ids"]).split(",")]}),
        lambda r, a: {"vps_id": a["vps_id"], "attached": "error" not in r},
    ),
    "ssh-key-attached": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['vps_id']}/public-keys", None),
        _list_fmt("keys"),
    ),
    # --- SCRIPTS ---
    "script-list": (
        lambda _: ("GET", "/api/vps/v1/post-install-scripts", None),
        _list_fmt("scripts"),
    ),
    "script-view": (
        lambda a: ("GET", f"/api/vps/v1/post-install-scripts/{a['id']}", None),
        _item_fmt("script"),
    ),
    "script-create": (
        lambda a: ("POST", "/api/vps/v1/post-install-scripts", {"name": a["name"], "content": a["content"]}),
        lambda r, a: {"name": a["name"], "created": r.get("id") if isinstance(r, dict) else None, "script": r},
    ),
    "script-update": (
        lambda a: ("PUT", f"/api/vps/v1/post-install-scripts/{a['id']}", {"name": a["name"], "content": a["content"]}),
        lambda r, a: {"id": a["id"], "updated": "error" not in r},
    ),
    "script-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/post-install-scripts/{a['id']}", None),
        _action_fmt("deleted"),
    ),
    # --- SNAPSHOTS ---
    "snapshot-view": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}/snapshot", None),
        _item_fmt("snapshot"),
    ),
    "snapshot-create": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/snapshot", None),
        _action_fmt("created"),
    ),
    "snapshot-delete": (
        lambda a: ("DELETE", f"/api/vps/v1/virtual-machines/{a['id']}/snapshot", None),
        _action_fmt("deleted"),
    ),
    "snapshot-restore": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/snapshot/restore", None),
        _action_fmt("restored"),
    ),
    "backup-list": (
        lambda a: ("GET", f"/api/vps/v1/virtual-machines/{a['id']}/backups", None),
        _list_fmt("backups"),
    ),
    "backup-restore": (
        lambda a: ("POST", f"/api/vps/v1/virtual-machines/{a['id']}/backups/{a['backup_id']}/restore", None),
        lambda r, a: {"id": a["id"], "backup_id": a["backup_id"], "restored": "error" not in r},
    ),
    # --- DNS ---
    "dns-records": (
        lambda a: ("GET", f"/api/dns/v1/zones/{a['domain']}", None),
        lambda r, a: {"domain": a["domain"], "records": r if isinstance(r, list) else r.get("zone", r)},
    ),
    "dns-snapshots": (
        lambda a: ("GET", f"/api/dns/v1/snapshots/{a['domain']}", None),
        lambda r, a: {"domain": a["domain"], "snapshots": r if isinstance(r, list) else r.get("data", r)},
    ),
    # --- DOMAINS ---
    "domain-list": (
        lambda _: ("GET", "/api/domains/v1/portfolio", None),
        _list_fmt("domains"),
    ),
    "domain-view": (
        lambda a: ("GET", f"/api/domains/v1/portfolio/{a['domain']}", None),
        lambda r, a: {"domain": a["domain"], "details": r},
    ),
    "domain-check": (
        lambda a: ("POST", "/api/domains/v1/availability", {"domain": a["domain"], "tlds": str(a["tlds"]).split(",")}),
        lambda r, a: {"domain": a["domain"], "availability": r if isinstance(r, list) else r.get("results", r)},
    ),
    # --- BILLING ---
    "billing-catalog": (
        lambda a: ("GET", f"/api/billing/v1/catalog{'?category=' + a['category'] if a.get('category') else ''}", None),
        _list_fmt("items"),
    ),
    "billing-payment-methods": (
        lambda _: ("GET", "/api/billing/v1/payment-methods", None),
        _list_fmt("methods"),
    ),
    "billing-payment-method-set-default": (
        lambda a: ("PUT", f"/api/billing/v1/payment-methods/{a['id']}/default", None),
        _action_fmt("set"),
    ),
    "billing-payment-method-delete": (
        lambda a: ("DELETE", f"/api/billing/v1/payment-methods/{a['id']}", None),
        _action_fmt("deleted"),
    ),
    "billing-subscriptions": (
        lambda _: ("GET", "/api/billing/v1/subscriptions", None),
        _list_fmt("subscriptions"),
    ),
    "billing-subscription-cancel": (
        lambda a: ("DELETE", f"/api/billing/v1/subscriptions/{a['id']}", None),
        lambda r, a: {"id": a["id"], "cancelled": "error" not in r},
    ),
    "billing-auto-renewal-enable": (
        lambda a: ("POST", f"/api/billing/v1/subscriptions/{a['id']}/auto-renewal", None),
        lambda r, a: {"id": a["id"], "enabled": "error" not in r},
    ),
    "billing-auto-renewal-disable": (
        lambda a: ("DELETE", f"/api/billing/v1/subscriptions/{a['id']}/auto-renewal", None),
        lambda r, a: {"id": a["id"], "disabled": "error" not in r},
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
        lambda a: ("POST", "/api/hosting/v1/websites", {"domain": a["domain"], "order_id": int(a["order_id"]), **({} if not a.get("datacenter") else {"datacenter_code": a["datacenter"]})}),
        lambda r, a: {"domain": a["domain"], "created": "error" not in str(r), "website": r},
    ),
    "hosting-datacenters-list": (
        lambda a: ("GET", f"/api/hosting/v1/orders/{a['order_id']}/data-centers", None),
        _list_fmt("datacenters"),
    ),
    # --- DOMAIN_EXTENDED ---
    "domain-lock-enable": (
        lambda a: ("POST", f"/api/domains/v1/portfolio/{a['domain']}/domain-lock", None),
        lambda r, a: {"domain": a["domain"], "locked": "error" not in str(r)},
    ),
    "domain-lock-disable": (
        lambda a: ("DELETE", f"/api/domains/v1/portfolio/{a['domain']}/domain-lock", None),
        lambda r, a: {"domain": a["domain"], "unlocked": "error" not in str(r)},
    ),
    "domain-privacy-enable": (
        lambda a: ("POST", f"/api/domains/v1/portfolio/{a['domain']}/privacy-protection", None),
        lambda r, a: {"domain": a["domain"], "privacy_enabled": "error" not in str(r)},
    ),
    "domain-privacy-disable": (
        lambda a: ("DELETE", f"/api/domains/v1/portfolio/{a['domain']}/privacy-protection", None),
        lambda r, a: {"domain": a["domain"], "privacy_disabled": "error" not in str(r)},
    ),
    "domain-forwarding-view": (
        lambda a: ("GET", f"/api/domains/v1/portfolio/{a['domain']}/forwarding", None),
        lambda r, a: {"domain": a["domain"], "forwarding": r},
    ),
    "domain-forwarding-create": (
        lambda a: ("POST", f"/api/domains/v1/portfolio/{a['domain']}/forwarding", {"redirect_url": a["redirect_url"], "redirect_type": a["redirect_type"]}),
        lambda r, a: {"domain": a["domain"], "created": "error" not in str(r), "forwarding": r},
    ),
    "domain-forwarding-delete": (
        lambda a: ("DELETE", f"/api/domains/v1/portfolio/{a['domain']}/forwarding", None),
        lambda r, a: {"domain": a["domain"], "deleted": "error" not in str(r)},
    ),
    "domain-nameservers-set": (
        lambda a: ("PUT", f"/api/domains/v1/portfolio/{a['domain']}/nameservers", {"ns1": a["ns1"], "ns2": a["ns2"], **({} if not a.get("ns3") else {"ns3": a["ns3"]}), **({} if not a.get("ns4") else {"ns4": a["ns4"]})}),
        lambda r, a: {"domain": a["domain"], "nameservers_set": "error" not in str(r)},
    ),
    # --- WHOIS ---
    "whois-list": (
        lambda a: ("GET", f"/api/domains/v1/whois{'?tld=' + a['tld'] if a.get('tld') else ''}", None),
        _list_fmt("profiles"),
    ),
    "whois-view": (
        lambda a: ("GET", f"/api/domains/v1/whois/{a['id']}", None),
        _item_fmt("profile"),
    ),
    "whois-create": (
        lambda a: ("POST", "/api/domains/v1/whois", {"tld": a["tld"], "entity_type": a["entity_type"], "country": a["country"], "whois_details": json.loads(a["whois_details"]) if isinstance(a["whois_details"], str) else a["whois_details"]}),
        lambda r, a: {"tld": a["tld"], "created": r.get("id") if isinstance(r, dict) else None, "profile": r},
    ),
    "whois-delete": (
        lambda a: ("DELETE", f"/api/domains/v1/whois/{a['id']}", None),
        _action_fmt("deleted"),
    ),
    "whois-usage": (
        lambda a: ("GET", f"/api/domains/v1/whois/{a['id']}/usage", None),
        lambda r, a: {"id": a["id"], "domains": r if isinstance(r, list) else r.get("domains", r)},
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
        lambda a: ("GET", f"/api/vps/v1/templates/{a['id']}", None),
        _item_fmt("template"),
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — zero-arg defaults with optional args."""
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    if not args or args[0] in ("-h", "--help"):
        print(json.dumps(_usage_error("No command specified"), indent=2))
        return 1

    cmd = args[0]
    if cmd not in COMMANDS:
        print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2))
        return 1

    # Parse optional flags
    opts: Args = {}
    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            key = arg[2:].replace("-", "_")
            key = "from_date" if key == "from" else "to_date" if key == "to" else key
            opts[key] = (
                args[i + 1] if i + 1 < len(args) and not args[i + 1].startswith("--") else True
            )
            i += 1 if opts[key] is not True else 0
        i += 1

    if missing := _validate_args(cmd, opts):
        print(json.dumps(_usage_error(f"Missing required: {', '.join(missing)}", cmd), indent=2))
        return 1

    if not os.environ.get(B.token_env):
        print(json.dumps({"status": "error", "message": f"Missing {B.token_env} environment variable"}, indent=2))
        return 1

    builder, formatter = handlers[cmd]
    method, path, body = builder(opts)
    response = _api(method, path, body)

    result = (
        {"status": "success", **formatter(response, opts)}
        if "error" not in response
        else {"status": "error", "message": response.get("error", "API request failed"), **response}
    )
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
