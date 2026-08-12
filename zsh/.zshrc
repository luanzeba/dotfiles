# Enable true color support for terminals (helps helix, nvim, etc.)
export COLORTERM=truecolor

# Add ~/.local/bin to PATH for user-installed binaries
export PATH="$HOME/.local/bin:$PATH"

# Source configs
for config_file ($HOME/.zsh/*.zsh); do
  source $config_file
done

# Source functions
for function_file in ~/.zsh/functions/*; do
  source "$function_file"
done

source ~/.zsh/zsh-autosuggestions/zsh-autosuggestions.zsh

if [[ `uname` == "Darwin" ]]; then
  source $HOME/.zsh/os/macos.zsh
fi

alias v="nvim"
alias vvim="vim $HOME/.config/nvim/init.vim"
alias svim="source $HOME/.config/nvim/init.vim"
# Use bundled Tailscale binary on macOS only when `tailscale` isn't already in PATH.
if [[ "$(uname)" == "Darwin" ]] && ! command -v tailscale >/dev/null 2>&1 && [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
  alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi
alias k="kubectl"

# Map Ctrl-x to clear
bindkey '^X' clear-screen

# Map Ctrl-f to accept suggested completion
bindkey '^F' autosuggest-accept

# Expands symlinks on cd
setopt CHASE_LINKS

# Activate mise if it's installed
if [[ -x ~/.local/bin/mise ]]; then
  eval "$(~/.local/bin/mise activate zsh)"
fi

# opencode
export PATH="$HOME/.opencode/bin:$PATH"

# Nix profiles (dotfiles-managed base tools and language toolchains)
if [[ -d "/nix/var/nix/profiles/default/bin" ]]; then
    export PATH="/nix/var/nix/profiles/default/bin:$PATH"
fi
if [[ -d "$HOME/.nix-profile/bin" ]]; then
    export PATH="$HOME/.nix-profile/bin:$PATH"
fi

if [[ -f "$HOME/.config/beta/proxy.env" ]]; then
  source "$HOME/.config/beta/proxy.env"
fi
