# shellcheck shell=sh
# The devbox's environment, the same whatever the shell. devbox/install links this to
# ~/.devbox.sh and sources that from ~/.zshenv (every zsh, scripts included), ~/.bashrc and
# ~/.profile. POSIX sh, so any shell can read it.

# Nix (its own guard keeps this to once per process tree).
if [ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
  . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
fi
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
export EDITOR=nvim
export GITLAB_HOST=gitlab.beta.team # outside a repo, glab would default to gitlab.com
# wb, the agents' headless Chrome: the Mac reaches it on 9334 through the tunnel.
export WB_INSPECT_PORT=9334
# The BETA LiteLLM proxy token for Pi (~/beta/devbox's push-config copies it).
if [ -f "$HOME/.config/beta/proxy.env" ]; then
  . "$HOME/.config/beta/proxy.env"
fi
