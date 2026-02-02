# zlogin happens after sourcing ~/.zshrc so it's safer to append to the path at this point
export PATH="$PATH:$HOME/.cargo/bin"

# Extra configs for github/github codespace
if [[ -d /workspaces/github ]]; then
  # For some reason, the Ruby version used in the monolith is not set in the path
  # This ensures we use the correct Ruby version and its gems
  # Pulled this snippet from https://github.com/github/github/blob/2291d7a6f04656872b9c39fef9829aeb02d62599/script/setup_ruby_version#L17
  export PATH=/workspaces/github/vendor/ruby/"$(config/ruby-version)"/bin:$PATH
fi
