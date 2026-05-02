# Auto-enter github/github devcontainer in new Ghostty splits.
#
# `dev ssh` (interactive mode) writes active-session markers to a global
# temp directory. New local Ghostty splits can detect those markers and run
# `dev ssh` automatically.
#
# Opt-out for a shell/session:
#   export DEV_AUTO_SSH_SPLITS=0
#
# Debug logs:
#   export DEV_AUTO_SSH_DEBUG=1

_DEV_AUTO_SSH_CONFIG_REL=".devcontainer/local-macos-arm64/devcontainer.json"

_dev_auto_ssh_debug() {
  [[ "${DEV_AUTO_SSH_DEBUG:-0}" == "1" ]] || return 0
  print -ru2 -- "[dev-auto-ssh] $*"
}

_dev_auto_ssh_marker_dir() {
  local base="${XDG_RUNTIME_DIR:-/tmp}"
  local user_id="${USER:-$(id -u)}"
  print -r -- "$base/dev-ssh-active-$user_id"
}

_dev_auto_ssh_workspace_has_config() {
  local workspace="$1"
  [[ -n "$workspace" && -f "$workspace/$_DEV_AUTO_SSH_CONFIG_REL" ]]
}

_dev_auto_ssh_context_workspace() {
  local workspace=""

  workspace="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if _dev_auto_ssh_workspace_has_config "$workspace"; then
    print -r -- "$workspace"
    return 0
  fi

  # If Ghostty inherited container cwd (/workspaces/<repo>), map to local host
  # checkout convention (~/github/<repo>) when available.
  if [[ "$PWD" == /workspaces/* ]]; then
    local repo="${PWD#/workspaces/}"
    repo="${repo%%/*}"
    workspace="$HOME/github/$repo"
    if _dev_auto_ssh_workspace_has_config "$workspace"; then
      print -r -- "$workspace"
      return 0
    fi
  fi

  return 1
}

_dev_auto_ssh_active_workspaces() {
  local marker_dir marker pid workspace
  local -a workspaces
  typeset -A seen

  marker_dir="$(_dev_auto_ssh_marker_dir)"
  [[ -d "$marker_dir" ]] || return 0

  for marker in "$marker_dir"/*; do
    [[ -e "$marker" ]] || continue

    pid="${${marker:t}%%.*}"
    if [[ "$pid" != <-> ]] || ! kill -0 "$pid" 2>/dev/null; then
      rm -f -- "$marker" 2>/dev/null || true
      continue
    fi

    workspace="$(< "$marker" 2>/dev/null || true)"
    _dev_auto_ssh_workspace_has_config "$workspace" || continue

    if [[ -z "${seen[$workspace]:-}" ]]; then
      seen[$workspace]=1
      workspaces+=("$workspace")
    fi
  done

  if (( ${#workspaces[@]} == 0 )); then
    rmdir "$marker_dir" 2>/dev/null || true
    return 0
  fi

  print -rl -- "${workspaces[@]}"
}

devcontainer_auto_ssh_if_needed() {
  [[ -o interactive ]] || return 0

  # Ghostty only (TERM_PROGRAM on macOS, TERM fallback for safety).
  if [[ "${TERM_PROGRAM:-}" != "ghostty" && "${TERM:-}" != *ghostty* ]]; then
    return 0
  fi

  # Never recurse once inside the container.
  [[ "${LOCAL_DEVCONTAINER:-}" != "1" ]] || return 0
  [[ ! -f "/.dockerenv" ]] || return 0

  [[ "${DEV_AUTO_SSH_SPLITS:-1}" == "1" ]] || return 0
  [[ -z "${DEV_AUTO_SSH_BOOTSTRAP_DONE:-}" ]] || return 0
  export DEV_AUTO_SSH_BOOTSTRAP_DONE=1

  command -v dev >/dev/null 2>&1 || return 0
  command -v git >/dev/null 2>&1 || return 0

  local context_workspace="" target_workspace="" ws
  local -a active_workspaces

  context_workspace="$(_dev_auto_ssh_context_workspace 2>/dev/null || true)"
  active_workspaces=("${(@f)$(_dev_auto_ssh_active_workspaces)}")

  # Prefer matching the shell's current repo context. If that can't be
  # determined, auto-attach only when there is exactly one active session.
  if [[ -n "$context_workspace" ]]; then
    for ws in "${active_workspaces[@]}"; do
      if [[ "$ws" == "$context_workspace" ]]; then
        target_workspace="$ws"
        break
      fi
    done
  fi

  if [[ -z "$target_workspace" ]] && (( ${#active_workspaces[@]} == 1 )); then
    target_workspace="$active_workspaces[1]"
  fi

  [[ -n "$target_workspace" ]] || return 0

  _dev_auto_ssh_debug "auto-attaching split via: dev --workspace-folder $target_workspace ssh"

  if dev --workspace-folder "$target_workspace" ssh; then
    return 0
  fi

  _dev_auto_ssh_debug "auto-attach failed; leaving host shell open"
  return 0
}

devcontainer_auto_ssh_if_needed
