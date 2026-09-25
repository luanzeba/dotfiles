#!/bin/bash
#
# Shared utilities for dotfiles scripts
#

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
DIM='\033[0;90m'
NC='\033[0m'  # No Color (reset)

ERROR_LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dotfiles"
ERROR_LOG="$ERROR_LOG_DIR/errors.log"

# Make Nix profile tools and ~/.local/bin visible to non-interactive shells
# (install scripts, launchd/Raycast jobs). Same order as zsh/.zshrc.
for _dir in "$HOME/.local/bin" /nix/var/nix/profiles/default/bin "$HOME/.nix-profile/bin"; do
    [[ ":$PATH:" == *":$_dir:"* ]] || PATH="$_dir:$PATH"
done
unset _dir
export PATH

# npm globals live in ~/.local (=> ~/.local/bin); Nix's node prefix is read-only.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.local}"

dotfiles_dir() {
    echo "${DOTFILES_DIR:-$HOME/dotfiles}"
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

log_info()    { echo "$(date +'%Y-%m-%d %T') - $*"; }
log_success() { echo "$(date +'%Y-%m-%d %T') - ✅ $*"; }
log_warn()    { echo "$(date +'%Y-%m-%d %T') - ⚠️  $*"; }
log_error()   { echo "$(date +'%Y-%m-%d %T') - ❌ $*"; }

# =============================================================================
# Persistent error log (read by `dot logs` / `dot status`)
# Format: TIMESTAMP|COMMAND|TOOL|EXIT_CODE|SHORT_MSG|FULL_MSG (newlines escaped)
# =============================================================================

# Usage: log_error_persistent <command> <tool> <exit_code> <output>
log_error_persistent() {
    local command="$1" tool="${2:--}" exit_code="${3:-1}" full_msg="$4"
    local short_msg escaped_msg

    mkdir -p "$ERROR_LOG_DIR"
    short_msg=$(printf '%s' "$full_msg" | head -n1 | cut -c1-80)
    escaped_msg="${full_msg//$'\n'/\\n}"
    escaped_msg="${escaped_msg//|/\\|}"
    printf '%s|%s|%s|%s|%s|%s\n' "$(date -Iseconds)" "$command" "$tool" "$exit_code" "$short_msg" "$escaped_msg" >> "$ERROR_LOG"
}

# Run a command, streaming its output; on failure record it in the error log.
# Usage: run_logged <command> <tool> <cmd...>
run_logged() {
    local command="$1" tool="$2" output_file exit_code
    shift 2

    output_file=$(mktemp)
    "$@" 2>&1 | tee "$output_file"
    exit_code=${PIPESTATUS[0]}
    if [[ $exit_code -ne 0 ]]; then
        log_error_persistent "$command" "$tool" "$exit_code" "$(<"$output_file")"
    fi
    rm -f "$output_file"
    return "$exit_code"
}

error_count() {
    if [[ -f "$ERROR_LOG" ]]; then
        wc -l < "$ERROR_LOG" | tr -d ' '
    else
        echo "0"
    fi
}

clear_error_log() {
    rm -f "$ERROR_LOG"
}

# Usage: show_recent_errors [count]
show_recent_errors() {
    local count="${1:-3}"
    [[ -s "$ERROR_LOG" ]] || return 0
    tail -n "$count" "$ERROR_LOG" | while IFS='|' read -r ts cmd tool _code short _full; do
        local date_part="${ts:0:16}"
        printf "  %-16s %-8s %-12s %s\n" "${date_part/T/ }" "$cmd" "${tool:--}" "$short"
    done
}
