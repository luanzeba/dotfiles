#!/bin/bash
# Offline smoke checks for the shared Nix installer and dot CLI.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# No Nix operations are performed: stub the profile backend.
source lib/nix.sh
ensure_nix() { :; }
installed=""
nix_installed() { [[ " $installed " == *" $1 "* ]]; }
calls=()
_nix() { calls=("$@"); }

nix_sync node
[[ "${calls[*]}" == "profile add --refresh --override-input nixpkgs github:NixOS/nixpkgs/nixpkgs-unstable $NIX_FLAKE#node" ]]
installed="node"
nix_sync node
[[ "${calls[*]}" == "profile upgrade --refresh --override-input nixpkgs github:NixOS/nixpkgs/nixpkgs-unstable node" ]]
installed="nix"
nix_sync base
[[ "${calls[*]}" == "profile add --priority 6 $NIX_FLAKE#base" ]]
installed=""
nix_sync nodeRuntime
[[ "${calls[*]}" == "profile add --priority 6 --refresh --override-input nixpkgs github:NixOS/nixpkgs/nixpkgs-unstable $NIX_FLAKE#nodeRuntime" ]]
installed="base"
nix_sync base
[[ "${calls[*]}" == "profile upgrade base" ]]

nix_package_tool base bash
check_installed
installed=""
! check_installed
calls=()
update
[[ ${#calls[@]} -eq 0 ]] # bulk updates must not install opt-in tools

bash bin/dotfiles update --help | grep -q 'dot update \[tool\.\.\.\]'
if bash bin/dotfiles update not-a-tool >/dev/null 2>&1; then
    echo 'Unknown update target was accepted' >&2
    exit 1
fi
if bash bin/dotfiles update blender >/dev/null 2>&1; then
    echo 'Tool without update() was accepted' >&2
    exit 1
fi

echo 'Installer smoke checks passed'
