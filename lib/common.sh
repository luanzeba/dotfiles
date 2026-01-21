#!/bin/bash
#
# Shared utilities for dotfiles scripts
#

# =============================================================================
# Error Log Configuration
# =============================================================================

ERROR_LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dotfiles"
ERROR_LOG="$ERROR_LOG_DIR/errors.log"

# =============================================================================
# Directory and Platform Detection
# =============================================================================

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

# =============================================================================
# Persistent Error Logging
# =============================================================================

# Log an error to persistent storage
# Usage: log_error_persistent <command> <tool> <exit_code> <output>
log_error_persistent() {
    local command="$1"
    local tool="${2:--}"
    local exit_code="${3:-1}"
    local full_msg="$4"
    
    mkdir -p "$ERROR_LOG_DIR"
    
    # Create short message (first line, truncated to 80 chars)
    local short_msg
    short_msg=$(echo "$full_msg" | head -n1 | cut -c1-80)
    
    # Escape newlines and pipes in full message for storage
    local escaped_msg
    escaped_msg=$(echo "$full_msg" | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/|/\\|/g')
    
    # Format: TIMESTAMP|COMMAND|TOOL|EXIT_CODE|SHORT_MSG|FULL_MSG
    echo "$(date -Iseconds)|$command|$tool|$exit_code|$short_msg|$escaped_msg" >> "$ERROR_LOG"
}

# Get the number of logged errors
error_count() {
    if [[ -f "$ERROR_LOG" ]]; then
        wc -l < "$ERROR_LOG" | tr -d ' '
    else
        echo "0"
    fi
}

# Clear the error log
clear_error_log() {
    rm -f "$ERROR_LOG"
}

# Show recent errors (summary view for doctor)
# Usage: show_recent_errors [count]
show_recent_errors() {
    local count="${1:-3}"
    if [[ -f "$ERROR_LOG" ]] && [[ -s "$ERROR_LOG" ]]; then
        tail -n "$count" "$ERROR_LOG" | while IFS='|' read -r ts cmd tool code short _full; do
            # Parse timestamp: 2026-01-21T14:30:15+00:00 -> 2026-01-21 14:30
            local date_part="${ts:0:16}"
            date_part="${date_part/T/ }"
            printf "  %-16s %-8s %-12s %s\n" "$date_part" "$cmd" "${tool:--}" "$short"
        done
    fi
}

# =============================================================================
# Table Drawing Helpers
# =============================================================================

# Calculate the maximum width needed for a column
# Usage: max_width <default_min> <values...>
max_width() {
    local min="$1"
    shift
    local max=$min
    for val in "$@"; do
        local len=${#val}
        (( len > max )) && max=$len
    done
    echo "$max"
}

# Print a horizontal table line
# Usage: print_table_line <char> <width1> <width2> ...
print_table_line() {
    local char="$1"
    shift
    local line="┌"
    local first=true
    for width in "$@"; do
        if [[ "$first" == true ]]; then
            first=false
        else
            line+="┬"
        fi
        line+=$(printf '%*s' "$((width + 2))" '' | tr ' ' "$char")
    done
    line+="┐"
    echo "$line"
}

print_table_separator() {
    local widths=("$@")
    local line="├"
    local first=true
    for width in "${widths[@]}"; do
        if [[ "$first" == true ]]; then
            first=false
        else
            line+="┼"
        fi
        line+=$(printf '%*s' "$((width + 2))" '' | tr ' ' '─')
    done
    line+="┤"
    echo "$line"
}

print_table_bottom() {
    local widths=("$@")
    local line="└"
    local first=true
    for width in "${widths[@]}"; do
        if [[ "$first" == true ]]; then
            first=false
        else
            line+="┴"
        fi
        line+=$(printf '%*s' "$((width + 2))" '' | tr ' ' '─')
    done
    line+="┘"
    echo "$line"
}

# Print a table row
# Usage: print_table_row <width1> <val1> <width2> <val2> ...
print_table_row() {
    local line="│"
    while [[ $# -ge 2 ]]; do
        local width="$1"
        local val="$2"
        shift 2
        line+=$(printf " %-*s │" "$width" "$val")
    done
    echo "$line"
}
