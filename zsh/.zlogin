# zlogin happens after sourcing ~/.zshrc so it's safer to append to the path at this point
export PATH="$PATH:$HOME/bin"
export PATH="$PATH:$HOME/.cargo/bin"
export PATH="$PATH:$HOME/.local/bin"

# Extra configs for github/github codespace
if [[ -d /workspaces/github ]]; then
  export PATH="$PATH:/home/linuxbrew/.linuxbrew/bin"
  export PATH="$PATH:/workspaces/github/bin"
fi

