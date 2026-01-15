#!/bin/bash
#
# Shared utilities for dotfiles scripts
#

# Get the dotfiles directory path
dotfiles_dir() {
    if [[ -n "$DOTFILES_DIR" ]]; then
        echo "$DOTFILES_DIR"
    elif [[ -n "$CODESPACES" ]]; then
        echo "/workspaces/.codespaces/.persistedshare/dotfiles"
    else
        echo "$HOME/dotfiles"
    fi
}

# Platform detection
is_codespaces() {
    [[ -n "$CODESPACES" ]]
}

is_macos() {
    [[ "$OSTYPE" == darwin* ]]
}

is_arch() {
    command -v pacman &>/dev/null
}

is_omarchy() {
    [[ -d "$HOME/.local/share/omarchy" ]]
}

# VCS wrapper - uses jj if available, falls back to git
vcs_cmd() {
    if command -v jj &>/dev/null; then
        jj "$@"
    else
        git "$@"
    fi
}

# Check if we're in a jj repo
is_jj_repo() {
    [[ -d "$(dotfiles_dir)/.jj" ]]
}

# Get VCS status (works with both jj and git)
vcs_status() {
    local dir
    dir="$(dotfiles_dir)"
    cd "$dir" || return 1
    
    if is_jj_repo && command -v jj &>/dev/null; then
        jj status
    else
        git status
    fi
}

# Pull from remote (works with both jj and git)
vcs_pull() {
    local dir
    dir="$(dotfiles_dir)"
    cd "$dir" || return 1
    
    if is_jj_repo && command -v jj &>/dev/null; then
        # jj workflow: fetch and rebase
        jj git fetch && jj rebase -d main@origin
    else
        git pull --rebase
    fi
}

# Get list of changed files since last pull
# Returns paths relative to dotfiles root
vcs_changed_files() {
    local dir
    dir="$(dotfiles_dir)"
    cd "$dir" || return 1
    
    # For now, just return files changed in working copy
    # This is used after pull to detect what needs apply()
    if is_jj_repo && command -v jj &>/dev/null; then
        jj diff --name-only 2>/dev/null || true
    else
        git diff --name-only HEAD@{1} HEAD 2>/dev/null || true
    fi
}

# Logging helpers
log_info() {
    echo "$(date +'%Y-%m-%d %T') - $*"
}

log_success() {
    echo "$(date +'%Y-%m-%d %T') - ✅ $*"
}

log_warn() {
    echo "$(date +'%Y-%m-%d %T') - ⚠️  $*"
}

log_error() {
    echo "$(date +'%Y-%m-%d %T') - ❌ $*"
}
