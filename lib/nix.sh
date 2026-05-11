#!/bin/bash
#
# Nix bootstrap and profile management helpers.
#
# Source this file (it will source lib/common.sh if not already loaded) and
# call:
#   ensure_nix              - install Nix if missing (one-time, may sudo)
#   nix_profile_sync        - install/upgrade the dotfiles flake profile
#   nix_profile_installed   - returns true if the profile is present
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
# Nix names profile entries by the last path component of the flake URL,
# so `path:.../dotfiles/nix` becomes the entry name `nix`.
NIX_PROFILE_NAME="nix"

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

    command -v nix &>/dev/null
}

ensure_nix() {
    if _source_nix_env; then
        return 0
    fi

    log_info "Installing Nix via Determinate Systems installer (will request sudo)..."
    curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix \
        | sh -s -- install --determinate --no-confirm

    _source_nix_env || {
        log_error "Nix installed but not on PATH. Open a new shell and re-run."
        return 1
    }
}

nix_profile_installed() {
    _source_nix_env || return 1
    # Match the flake URL rather than the entry name; more robust if the
    # flake dir is ever renamed.
    nix --extra-experimental-features 'nix-command flakes' profile list 2>/dev/null \
        | grep -q "Original flake URL:.*path:$NIX_FLAKE_DIR"
}

# Install or upgrade the dotfiles flake's default package into the user profile.
# Idempotent: safe to call repeatedly.
nix_profile_sync() {
    ensure_nix || return 1

    if nix_profile_installed; then
        # Profile entry name is the basename of the flake URL path.
        local entry_name
        entry_name="$(basename "$NIX_FLAKE_DIR")"
        log_info "Upgrading nix profile entry '$entry_name'..."
        nix --extra-experimental-features 'nix-command flakes' \
            profile upgrade "$entry_name" 2>&1 || true
    else
        log_info "Installing nix profile from $NIX_FLAKE_DIR..."
        nix --extra-experimental-features 'nix-command flakes' \
            profile add \
            "path:$NIX_FLAKE_DIR" \
        || return 1
    fi
}
