# Whisper

Audio transcription using [OpenAI Whisper](https://github.com/openai/whisper).

## Installation

```bash
cd ~/dotfiles
zsh whisper/install
```

Supports macOS and Arch Linux only. Not installed automatically by the main `install` script.

## Usage

```bash
whisper audio.m4a --language pt --model large-v2
```

See the [official documentation](https://github.com/openai/whisper) for more options.
