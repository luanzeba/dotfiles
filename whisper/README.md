# Whisper

Audio transcription using [OpenAI Whisper](https://github.com/openai/whisper).

## Installation

```bash
cd ~/dotfiles
dot install whisper
```

Whisper is installed from the dotfiles Nix flake (`path:~/dotfiles/nix#whisper`) and is intentionally opt-in because the Python/ML dependency closure is large.

## Usage

```bash
whisper audio.m4a --language pt --model large-v2
```

See the [official documentation](https://github.com/openai/whisper) for more options.
