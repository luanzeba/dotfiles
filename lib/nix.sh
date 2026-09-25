#!/bin/bash
#
# Nix helpers. Every Nix-managed tool is a package in nix/flake.nix, installed
# into the user's Nix profile as an entry with the same name (e.g. `go`).
# Versions are pinned by nix/flake.lock, so every machine gets the same ones.
#

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

NIX_FLAKE="path:$(cd "$(dirname "${BASH_SOURCE[0]}")/../nix" && pwd)"

_nix() {
    nix --extra-experimental-features "nix-command flakes" "$@"
}

# Nix may not be on PATH in fresh non-login shells.
_source_nix_env() {
    command -v nix &>/dev/null && return 0
    local f
    for f in /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh \
             "$HOME/.nix-profile/etc/profile.d/nix.sh"; do
        # shellcheck disable=SC1090
        [[ -f "$f" ]] && . "$f" && break
    done
    command -v nix &>/dev/null
}

_nix_daemon_ready() { _nix store ping >/dev/null 2>&1; }

ensure_nix() {
    if ! _source_nix_env; then
        log_info "Installing Nix via Determinate Systems installer (will request sudo)..."
        curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix \
            | sh -s -- install --determinate --no-confirm
        _source_nix_env || {
            log_error "Nix installed but not on PATH. Open a new shell and re-run."
            return 1
        }
    fi
    _nix_daemon_ready && return 0

    # On machines without a service manager, start the daemon as before.
    local daemon_cmd
    if command -v determinate-nixd &>/dev/null; then
        daemon_cmd="determinate-nixd daemon"
    elif command -v nix-daemon &>/dev/null; then
        daemon_cmd="nix-daemon"
    else
        log_error "No nix-daemon binary found"
        return 1
    fi
    if ! pgrep -f 'determinate-nixd daemon' >/dev/null 2>&1 \
       && ! pgrep -x nix-daemon >/dev/null 2>&1; then
        log_info "Starting nix-daemon..."
        sudo sh -c "nohup $daemon_cmd >/var/log/nix-daemon.log 2>&1 </dev/null &"
    fi
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 1
        _nix_daemon_ready && return 0
    done
    log_error "nix-daemon did not become ready in time"
    return 1
}

# Usage: nix_installed <entry>
nix_installed() {
    _source_nix_env && _nix profile list --json 2>/dev/null | grep -q "\"$1\":{"
}

# Install the flake package <entry>, or upgrade it to what flake.lock pins.
# Node deliberately refreshes nixpkgs without changing the repository lock.
# Usage: nix_sync <entry>
nix_sync() {
    local entry="$1" options=() priority=()
    ensure_nix || return 1
    if [[ "$entry" == node || "$entry" == nodeRuntime ]]; then
        options=(--refresh --override-input nixpkgs github:NixOS/nixpkgs/nixpkgs-unstable)
    fi
    if nix_installed "$entry"; then
        log_info "Upgrading nix profile entry '$entry'..."
        _nix profile upgrade "${options[@]}" "$entry"
    else
        # A legacy catch-all profile entry may already provide these binaries.
        if [[ "$entry" == nodeRuntime ]] || nix_installed nix; then
            priority=(--priority 6)
        fi
        log_info "Installing nix profile entry '$entry' from $NIX_FLAKE#$entry..."
        _nix profile add "${priority[@]}" "${options[@]}" "$NIX_FLAKE#$entry"
    fi
}

# Print "name version" for each command, read from its Nix store path.
# Usage: nix_versions <command>...
nix_versions() {
    local cmd path
    for cmd in "$@"; do
        path="$(command -v "$cmd")" || continue
        path="$(readlink -f "$path")"
        [[ "$path" == /nix/store/* ]] || continue
        path="${path#/nix/store/*-}"
        echo "${path%%/*}"
    done | sed -E 's/-wrapper//; s/-([0-9])/ \1/; s/-[a-z]+$//' | awk '!seen[$1]++' | paste -sd, - | sed 's/,/, /g'
}

# Define the standard dot hooks for a tool that is just a flake package.
# Scripts may override any hook after calling this.
# Usage: nix_package_tool <entry> <command>...
nix_package_tool() {
    NIX_ENTRY="$1"
    shift
    NIX_COMMANDS=("$@")

    check_installed() {
        nix_installed "$NIX_ENTRY" || return 1
        local cmd
        for cmd in "${NIX_COMMANDS[@]}"; do
            command -v "$cmd" &>/dev/null || return 1
        done
    }
    get_installed_version() { nix_versions "${NIX_COMMANDS[@]}"; }
    install() { nix_sync "$NIX_ENTRY"; }
    configure() { :; }
    # Only upgrade tools this machine opted into.
    update() { nix_installed "$NIX_ENTRY" || return 0; nix_sync "$NIX_ENTRY"; }
}
