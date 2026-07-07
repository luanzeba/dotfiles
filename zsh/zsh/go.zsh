# Go configuration
# Go itself and standard editor tools are managed by the dotfiles Nix profile.

# Keep GOPATH/bin available for ad-hoc binaries installed with `go install`.
if [[ -d "$HOME/go/bin" ]]; then
    export PATH="$HOME/go/bin:$PATH"
fi
