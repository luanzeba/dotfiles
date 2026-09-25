#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib/common.sh"

check_installed() {
    command -v zsh &>/dev/null
}

check_configured() {
    [[ -L "$HOME/.zshrc" ]]
}

install() {
    if is_arch && ! command -v zsh &>/dev/null; then
        echo "Installing zsh..."
        sudo pacman -S --needed --noconfirm zsh
    fi
}

ensure_zsh_default() {
    is_arch || return 0

    local zsh_path
    zsh_path="$(command -v zsh)" || return 1

    local current_shell
    current_shell="$(getent passwd "$(id -un)" | cut -d: -f7)"
    [[ "$current_shell" == "$zsh_path" ]] || sudo chsh -s "$zsh_path" "$(id -un)"
}

configure() {
    cd "$SCRIPT_DIR"
    
    # Fetch the contents of zsh-autosuggestions submodule
    git submodule update --init
    
    ln -sfn "$SCRIPT_DIR/zsh"       "$HOME/.zsh"
    if [[ -L "$HOME/.zlogin" && "$(readlink "$HOME/.zlogin")" == "$SCRIPT_DIR/.zlogin" ]]; then
        rm -f "$HOME/.zlogin"
    fi
    ln -sf "$SCRIPT_DIR/.zlogout"   "$HOME/.zlogout"
    ln -sf "$SCRIPT_DIR/.zprofile"  "$HOME/.zprofile"
    ln -sf "$SCRIPT_DIR/.zshrc"     "$HOME/.zshrc"
    ensure_zsh_default
}

apply() {
    # Shell config requires a new terminal session to take effect
    # Cannot reliably source .zshrc in running shells
    echo "Zsh config updated. Start a new terminal to apply changes."
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install
    configure
fi
