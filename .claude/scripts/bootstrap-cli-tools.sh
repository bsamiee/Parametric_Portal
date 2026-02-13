#!/usr/bin/env bash
# bootstrap-cli-tools.sh — Idempotent provisioning of modern CLI tools for VPS/CI.
# Dev machines use Nix; this script targets bare Ubuntu/Fedora where Nix is absent.
# Usage: bootstrap-cli-tools.sh
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [CONSTANTS] --------------------------------------------------------------

readonly _CARGO_BIN="${HOME}/.cargo/bin"
readonly _BINSTALL_URL='https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh'
# Tool registry: [binary]='crate:strategy'
declare -Ar _TOOLS=(
    [rg]='ripgrep:binstall'          [fd]='fd-find:binstall'
    [sd]='sd:binstall'               [bat]='bat:binstall'
    [eza]='eza:binstall'             [choose]='choose:binstall'
    [xh]='xh:binstall'               [dust]='du-dust:binstall'
    [procs]='procs:binstall'         [ouch]='ouch:binstall'
    [jnv]='jnv:binstall'             [tokei]='tokei:binstall'
    [hyperfine]='hyperfine:binstall' [gping]='gping:binstall'
    [trip]='trippy:binstall'
    [doggo]='mr-karan/doggo:github-go'
    [trash-put]='trash-cli:pipx'
)
# Strategy dispatch: strategy name → installer function (replaces case/esac)
declare -Ar _STRATEGY_DISPATCH=(
    [binstall]=_install_binstall
    [github-go]=_install_github_go
    [pipx]=_install_pipx
)
# Architecture normalization: uname -m → Go/Rust convention (replaces case/esac)
declare -Ar _ARCH_MAP=([x86_64]='amd64' [aarch64]='arm64')
# Post-install advisory notes keyed by binary (replaces inline conditional)
declare -Ar _POST_NOTES=(
    [trip]='requires: sudo setcap cap_net_raw+ep'
)
# Supported package managers (ordered by probe priority)
declare -ar _PKG_MGRS=(apt-get dnf)
# Prerequisites required before tool installation
declare -ar _PREREQS=(curl tar gzip pipx jq)
# Result accumulators (replaces mutable counters — count via ${#arr[@]})
declare -a _installed=() _skipped=() _failed=()

# --- [ERRORS] -----------------------------------------------------------------

_die() { printf '[FATAL] %s\n' "$1" >&2; exit 1; }

# --- [FUNCTIONS] --------------------------------------------------------------

_detect_pkg_mgr() {
    local mgr
    for mgr in "${_PKG_MGRS[@]}"; do
        command -v "${mgr}" >/dev/null 2>&1 && { printf '%s' "${mgr}"; return 0; }
    done
    _die "No supported package manager found (need ${_PKG_MGRS[*]})"
}
_ensure_prereqs() {
    local -r pkg_mgr="$(_detect_pkg_mgr)"
    local -a missing=()
    local bin
    for bin in "${_PREREQS[@]}"; do
        command -v "${bin}" >/dev/null 2>&1 || missing+=("${bin}")
    done
    (( ${#missing[@]} == 0 )) && return 0
    printf '[PREREQS] Installing: %s\n' "${missing[*]}"
    sudo "${pkg_mgr}" install -y "${missing[@]}"
}
_ensure_path() {
    [[ ":${PATH}:" == *":${_CARGO_BIN}:"* ]] && return 0
    export PATH="${_CARGO_BIN}:${PATH}"
    # shellcheck disable=SC2016
    printf 'export PATH="%s:${PATH}"\n' "${_CARGO_BIN}" >> "${HOME}/.bashrc"
    printf '[PATH] Appended %s to ~/.bashrc\n' "${_CARGO_BIN}"
}
_ensure_binstall() {
    command -v cargo-binstall >/dev/null 2>&1 && return 0
    printf '[BINSTALL] Installing cargo-binstall...\n'
    curl -L --proto '=https' --tlsv1.2 -sSf "${_BINSTALL_URL}" | bash
}
# shellcheck disable=SC2329  # invoked indirectly via _install_binstall
_emit_post_note() {
    local -r binary="$1"
    [[ -v _POST_NOTES["${binary}"] ]] || return 0
    local -r bin_path="$(command -v "${binary}")"
    printf '[NOTE] %s %s "%s"\n' "${binary}" "${_POST_NOTES[${binary}]}" "${bin_path}"
}
# shellcheck disable=SC2329  # invoked indirectly via _STRATEGY_DISPATCH
_install_binstall() {
    local -r crate="$1" binary="$2"
    cargo binstall --no-confirm "${crate}" || { _failed+=("${binary}"); return 1; }
    _installed+=("${binary}")
    _emit_post_note "${binary}"
}
# shellcheck disable=SC2329  # invoked indirectly via _STRATEGY_DISPATCH
_install_github_go() {
    local -r repo="$1" binary="$2"
    local -r raw_arch="$(uname -m)"
    [[ -v _ARCH_MAP["${raw_arch}"] ]] || _die "Unsupported arch: ${raw_arch}"
    local -r arch="${_ARCH_MAP[${raw_arch}]}"
    local raw_os; raw_os="$(uname -s)"
    local -r os="${raw_os@L}"
    local -r url="$(curl -sSf "https://api.github.com/repos/${repo}/releases/latest" \
        | jq -r --arg os "${os}" --arg arch "${arch}" \
            '[.assets[].browser_download_url | select(test($os) and test($arch) and test("\\.tar\\.gz$"))] | first // empty')"
    [[ -n "${url}" ]] || { printf '[FAIL] No release asset for %s/%s\n' "${os}" "${arch}"; _failed+=("${binary}"); return 1; }
    local -r tmp="$(mktemp -d)"
    curl -sSfL "${url}" | tar -xz -C "${tmp}"
    install -m 0755 "${tmp}/${binary}" "${_CARGO_BIN}/${binary}"
    rm -rf "${tmp}"
    _installed+=("${binary}")
}
# shellcheck disable=SC2329  # invoked indirectly via _STRATEGY_DISPATCH
_install_pipx() {
    local -r crate="$1" binary="$2"
    pipx install "${crate}" || { _failed+=("${binary}"); return 1; }
    _installed+=("${binary}")
}
_provision() {
    local binary spec crate strategy
    for binary in "${!_TOOLS[@]}"; do
        spec="${_TOOLS[${binary}]}"
        IFS=: read -r crate strategy <<< "${spec}"
        command -v "${binary}" >/dev/null 2>&1 && {
            printf '[SKIP] %s already present\n' "${binary}"
            _skipped+=("${binary}")
            continue
        }
        printf '[INSTALL] %s via %s (%s)\n' "${binary}" "${strategy}" "${crate}"
        [[ -v _STRATEGY_DISPATCH["${strategy}"] ]] || _die "Unknown strategy: ${strategy}"
        "${_STRATEGY_DISPATCH[${strategy}]}" "${crate}" "${binary}"
    done
}
_verify() {
    local binary
    for binary in "${!_TOOLS[@]}"; do
        command -v "${binary}" >/dev/null 2>&1 || continue
        "${binary}" --version >/dev/null 2>&1 || printf '[WARN] %s installed but --version failed\n' "${binary}"
    done
}
_report() {
    printf '\n[REPORT] installed=%d  skipped=%d  failed=%d\n' \
        "${#_installed[@]}" "${#_skipped[@]}" "${#_failed[@]}"
    [[ ${#_failed[@]} -gt 0 ]] && exit 1
    exit 0
}

# --- [EXPORT] -----------------------------------------------------------------

_main() {
    _ensure_prereqs
    _ensure_path
    _ensure_binstall
    _provision
    _verify
    _report
}
_main
