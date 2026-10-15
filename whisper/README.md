# Whisper

Local speech transcription with [MLX-Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) on Apple Silicon. Audio stays on the machine; no paid transcription API is used.

## Installation

```bash
dot install whisper
```

This installs a pinned `mlx-whisper` (see `MLX_WHISPER_VERSION` in `install`) as a `uv` tool, so `mlx_whisper` lives in `~/.local/bin`. `uv` and `ffmpeg` come from the Nix `base` profile.

MLX-Whisper is deliberately not a Nix package: it is a fast-moving Python/ML package that depends on Apple's Metal libraries, which nixpkgs does not support well on macOS. To upgrade, bump the pin and run `dot update whisper`.

## Usage

```bash
~/dotfiles/whisper/transcribe path/to/meeting.m4a --language Portuguese --output-dir ~/Downloads/meeting-transcription
```

The wrapper uses the `mlx-community/whisper-large-v3-mlx` model, writes every output format (`txt`, `json`, `srt`, `vtt`, `tsv`), and disables conditioning on previous text, which prevents repetition loops on long, noisy recordings. The model downloads on first use and is cached afterward.
