#!/usr/bin/env bash
# @vicinae.schemaVersion 1
# @vicinae.title Dotfiles Status
# @vicinae.mode fullOutput
# @vicinae.icon 🩺
# @vicinae.keywords ["dotfiles", "health", "doctor", "configuration"]
# @vicinae.description Check installed tools and dotfiles configuration health.

set -euo pipefail
exec "$HOME/.local/bin/dot" status
