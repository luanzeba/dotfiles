# Go configuration
# Managed Go installation at ~/.local/go

# Add managed Go binary to PATH (takes precedence over system Go)
if [[ -d "$HOME/.local/go/bin" ]]; then
    export PATH="$HOME/.local/go/bin:$PATH"
fi

# Add GOPATH/bin for installed Go tools (gopls, gofumpt, etc.)
if [[ -d "$HOME/go/bin" ]]; then
    export PATH="$HOME/go/bin:$PATH"
fi
