#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

install() {
    # Zsh is installed via system package manager
    :
}

configure() {
    cd "$SCRIPT_DIR"
    
    # Fetch the contents of zsh-autosuggestions submodule
    git submodule update --init
    
    ln -sfn "$SCRIPT_DIR/zsh"       "$HOME/.zsh"
    ln -sf "$SCRIPT_DIR/.zlogin"    "$HOME/.zlogin"
    ln -sf "$SCRIPT_DIR/.zlogout"   "$HOME/.zlogout"
    ln -sf "$SCRIPT_DIR/.zprofile"  "$HOME/.zprofile"
    ln -sf "$SCRIPT_DIR/.zshrc"     "$HOME/.zshrc"
}

apply() {
    # Shell config requires a new terminal session to take effect
    # Cannot reliably source .zshrc in running shells
    echo "Zsh config updated. Start a new terminal to apply changes."
}

# Main
install
configure
