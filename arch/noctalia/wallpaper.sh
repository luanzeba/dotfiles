#!/bin/bash
set -euo pipefail

# Wallhaven d8dokj is portrait. This 3:2 crop keeps the crossing, sea, and train.
wallpaper_dir="${XDG_DATA_HOME:-$HOME/.local/share}/wallpapers"
wallpaper="$wallpaper_dir/wallhaven-d8dokj-3x2.jpg"
source_url="https://w.wallhaven.cc/full/d8/wallhaven-d8dokj.jpg"

[[ -f "$wallpaper" ]] || {
    command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
    command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

    mkdir -p "$wallpaper_dir"
    original=$(mktemp)
    cropped="${wallpaper%.jpg}.new.jpg"
    trap 'rm -f "$original" "$cropped"' EXIT
    curl --fail --location --retry 3 --output "$original" "$source_url"
    ffmpeg -hide_banner -loglevel error -y -i "$original" \
        -vf 'crop=3072:2048:0:1024,scale=2880:1920:flags=lanczos' -frames:v 1 -q:v 2 "$cropped"
    mv -f "$cropped" "$wallpaper"
}

printf '%s\n' "$wallpaper"
