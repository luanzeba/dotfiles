#!/bin/bash
#
# Nix bootstrap and profile management helpers.
#
# Source this file (it will source lib/common.sh if not already loaded) and
# call one of:
#   ensure_nix                   - install Nix if missing (one-time, may sudo)
#   nix_profile_sync_base        - install/upgrade dotfiles flake #base package
#   nix_profile_sync_node        - install/upgrade dotfiles flake #node package
#   nix_profile_sync_node_runtime- install/upgrade dotfiles flake #nodeRuntime package
#   nix_profile_sync_go          - install/upgrade dotfiles flake #go package
#   nix_profile_sync_rust        - install/upgrade dotfiles flake #rust package
#   nix_profile_sync_ruby        - install/upgrade dotfiles flake #ruby package
#   nix_profile_sync_nvim        - install/upgrade dotfiles flake #nvim package
#   nix_profile_sync_helix       - install/upgrade dotfiles flake #helix package
#   nix_profile_sync_jj          - install/upgrade dotfiles flake #jj package
#   nix_profile_sync_gh          - install/upgrade dotfiles flake #gh package
#   nix_profile_sync_zig         - install/upgrade dotfiles flake #zig package
#   nix_profile_sync_bat         - install/upgrade dotfiles flake #bat package
#

# Locate dotfiles dir without requiring common.sh to be sourced first.
_NIX_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "$_NIX_LIB_DIR/.." && pwd)"

# Source common.sh for logging if available and not already loaded.
if ! declare -F log_info >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    [[ -f "$_NIX_LIB_DIR/common.sh" ]] && source "$_NIX_LIB_DIR/common.sh"
fi

NIX_FLAKE_DIR="$DOTFILES_ROOT/nix"
NIX_EXPERIMENTAL_FEATURES="nix-command flakes"

# Nix profile entry names used by dotfiles scripts.
NIX_PROFILE_NAME="nix"
NIX_BASE_PROFILE_NAME="base"
NIX_NODE_PROFILE_NAME="node"
NIX_NODE_RUNTIME_PROFILE_NAME="nodeRuntime"
NIX_GO_PROFILE_NAME="go"
NIX_RUST_PROFILE_NAME="rust"
NIX_RUBY_PROFILE_NAME="ruby"
NIX_NVIM_PROFILE_NAME="nvim"
NIX_HELIX_PROFILE_NAME="helix"
NIX_JJ_PROFILE_NAME="jj"
NIX_GH_PROFILE_NAME="gh"
NIX_ZIG_PROFILE_NAME="zig"
NIX_BAT_PROFILE_NAME="bat"

# Installables exported by nix/flake.nix.
NIX_PROFILE_BASE_INSTALLABLE="path:$NIX_FLAKE_DIR#base"
NIX_PROFILE_NODE_INSTALLABLE="path:$NIX_FLAKE_DIR#node"
NIX_PROFILE_NODE_RUNTIME_INSTALLABLE="path:$NIX_FLAKE_DIR#nodeRuntime"
NIX_PROFILE_GO_INSTALLABLE="path:$NIX_FLAKE_DIR#go"
NIX_PROFILE_RUST_INSTALLABLE="path:$NIX_FLAKE_DIR#rust"
NIX_PROFILE_RUBY_INSTALLABLE="path:$NIX_FLAKE_DIR#ruby"
NIX_PROFILE_NVIM_INSTALLABLE="path:$NIX_FLAKE_DIR#nvim"
NIX_PROFILE_HELIX_INSTALLABLE="path:$NIX_FLAKE_DIR#helix"
NIX_PROFILE_JJ_INSTALLABLE="path:$NIX_FLAKE_DIR#jj"
NIX_PROFILE_GH_INSTALLABLE="path:$NIX_FLAKE_DIR#gh"
NIX_PROFILE_ZIG_INSTALLABLE="path:$NIX_FLAKE_DIR#zig"
NIX_PROFILE_BAT_INSTALLABLE="path:$NIX_FLAKE_DIR#bat"

# Source nix into PATH for the current shell, if installed.
_source_nix_env() {
    if command -v nix &>/dev/null; then
        return 0
    fi

    local candidates=(
        "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"
        "$HOME/.nix-profile/etc/profile.d/nix.sh"
    )
    local f
    for f in "${candidates[@]}"; do
        # shellcheck disable=SC1090
        [[ -f "$f" ]] && . "$f" && break
    done

    # Determinate Nix can install the nix CLI into the system profile without
    # making it visible to non-login shells in devcontainers.
    if ! command -v nix &>/dev/null && [[ -x /nix/var/nix/profiles/default/bin/nix ]]; then
        export PATH="/nix/var/nix/profiles/default/bin:$PATH"
    fi

    command -v nix &>/dev/null
}

ensure_nix() {
    if _source_nix_env && _nix_daemon_ready; then
        return 0
    fi

    if ! command -v nix &>/dev/null; then
        log_info "Installing Nix via Determinate Systems installer (will request sudo)..."
        curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix \
            | sh -s -- install --determinate --no-confirm

        _source_nix_env || {
            log_error "Nix installed but not on PATH. Open a new shell and re-run."
            return 1
        }
    fi

    _ensure_nix_daemon_running
}

# Check whether the nix-daemon socket is responding.
_nix_daemon_ready() {
    nix --extra-experimental-features 'nix-command' store ping >/dev/null 2>&1
}

# Start the Determinate nix-daemon if it isn't already running.
# Required on containers without systemd (e.g. supervisord-based devcontainers).
_ensure_nix_daemon_running() {
    if _nix_daemon_ready; then
        return 0
    fi

    if pgrep -f 'determinate-nixd daemon' >/dev/null 2>&1 \
       || pgrep -x nix-daemon >/dev/null 2>&1; then
        # Already started, just give it a moment.
        sleep 1
        _nix_daemon_ready && return 0
    fi

    log_info "Starting nix-daemon (no systemd; backgrounding via nohup)..."
    local daemon_cmd=""
    if command -v determinate-nixd &>/dev/null; then
        daemon_cmd="determinate-nixd daemon"
    elif command -v nix-daemon &>/dev/null; then
        daemon_cmd="nix-daemon"
    else
        log_error "No nix-daemon binary found"
        return 1
    fi

    # Redirect must happen inside sudo so /var/log is writable.
    sudo sh -c "nohup $daemon_cmd >/var/log/nix-daemon.log 2>&1 </dev/null &"

    # Wait up to 10s for the socket to come up.
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 1
        _nix_daemon_ready && return 0
    done

    log_error "nix-daemon did not become ready in time"
    return 1
}

_nix_profile_list_plain() {
    nix --extra-experimental-features "$NIX_EXPERIMENTAL_FEATURES" profile list 2>/dev/null \
        | sed -E 's/\x1B\[[0-9;]*[mK]//g'
}

nix_profile_has_entry() {
    local entry_name="$1"
    _source_nix_env || return 1

    _nix_profile_list_plain | awk -v entry="$entry_name" '
        $1 == "Name:" && $2 == entry { found = 1 }
        END { exit(found ? 0 : 1) }
    '
}

_nix_profile_add_installable() {
    local entry_name="$1"
    local installable="$2"

    local add_args=()
    if [[ "$entry_name" != "$NIX_PROFILE_NAME" ]] && nix_profile_has_entry "$NIX_PROFILE_NAME"; then
        # Allow per-tool entries to coexist with a legacy catch-all `nix` entry.
        add_args+=(--priority 6)
    fi

    if [[ "$entry_name" == "$NIX_NODE_RUNTIME_PROFILE_NAME" ]]; then
        # Runtime fallback for hunk should never shadow full node toolchains.
        add_args+=(--priority 6)
    fi

    nix --extra-experimental-features "$NIX_EXPERIMENTAL_FEATURES" \
        profile add "${add_args[@]}" "$installable"
}

# Generic helper to sync a specific profile entry.
# Usage: nix_profile_sync_installable <entry_name> <installable>
nix_profile_sync_installable() {
    local entry_name="$1"
    local installable="$2"

    ensure_nix || return 1

    if nix_profile_has_entry "$entry_name"; then
        log_info "Upgrading nix profile entry '$entry_name'..."
        nix --extra-experimental-features "$NIX_EXPERIMENTAL_FEATURES" \
            profile upgrade "$entry_name" 2>&1 || true
    else
        log_info "Installing nix profile entry '$entry_name' from $installable..."
        _nix_profile_add_installable "$entry_name" "$installable" || return 1
    fi
}

nix_profile_sync_base() {
    nix_profile_sync_installable "$NIX_BASE_PROFILE_NAME" "$NIX_PROFILE_BASE_INSTALLABLE"
}

nix_profile_sync_node() {
    nix_profile_sync_installable "$NIX_NODE_PROFILE_NAME" "$NIX_PROFILE_NODE_INSTALLABLE"
}

nix_profile_sync_node_runtime() {
    nix_profile_sync_installable "$NIX_NODE_RUNTIME_PROFILE_NAME" "$NIX_PROFILE_NODE_RUNTIME_INSTALLABLE"
}

nix_profile_sync_go() {
    nix_profile_sync_installable "$NIX_GO_PROFILE_NAME" "$NIX_PROFILE_GO_INSTALLABLE"
}

nix_profile_sync_rust() {
    nix_profile_sync_installable "$NIX_RUST_PROFILE_NAME" "$NIX_PROFILE_RUST_INSTALLABLE"
}

nix_profile_sync_ruby() {
    nix_profile_sync_installable "$NIX_RUBY_PROFILE_NAME" "$NIX_PROFILE_RUBY_INSTALLABLE"
}

nix_profile_sync_nvim() {
    nix_profile_sync_installable "$NIX_NVIM_PROFILE_NAME" "$NIX_PROFILE_NVIM_INSTALLABLE"
}

nix_profile_sync_helix() {
    nix_profile_sync_installable "$NIX_HELIX_PROFILE_NAME" "$NIX_PROFILE_HELIX_INSTALLABLE"
}

nix_profile_sync_jj() {
    nix_profile_sync_installable "$NIX_JJ_PROFILE_NAME" "$NIX_PROFILE_JJ_INSTALLABLE"
}

nix_profile_sync_gh() {
    nix_profile_sync_installable "$NIX_GH_PROFILE_NAME" "$NIX_PROFILE_GH_INSTALLABLE"
}

nix_profile_sync_zig() {
    nix_profile_sync_installable "$NIX_ZIG_PROFILE_NAME" "$NIX_PROFILE_ZIG_INSTALLABLE"
}

nix_profile_sync_bat() {
    nix_profile_sync_installable "$NIX_BAT_PROFILE_NAME" "$NIX_PROFILE_BAT_INSTALLABLE"
}
