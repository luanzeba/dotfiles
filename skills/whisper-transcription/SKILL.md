---
name: whisper-transcription
description: Transcribe local audio with Whisper and, when requested, create linked Obsidian transcripts and meeting minutes. Use when asked to transcribe a recording, use Whisper, or prepare minutes from meeting audio, especially Portuguese AKSSMA director meetings.
---

# Whisper Transcription

Transcribe recordings locally, then create the requested Obsidian notes. Do not send audio to paid or external transcription services unless explicitly asked.

## Workflow

1. Identify the audio path and meeting date from the user's instructions. Do not infer the meeting date from file metadata. If no date is given for a meeting, ask before naming the notes.
2. Run `~/dotfiles/whisper/transcribe AUDIO --language Portuguese --output-dir OUTPUT_DIR`. Use an ISO-date output directory such as `~/Downloads/transcricao-2026-08-10`. The wrapper runs the pinned MLX-Whisper `large-v3` model locally. If `mlx_whisper` is missing, run `dot install whisper`. Pass the language spoken in the recording; for other languages, replace `Portuguese` accordingly.
3. Wait for transcription to finish. Confirm that the `.txt`, `.json`, and timestamped output exist and that the final timestamp is near the audio duration. Inspect the beginning, middle, and end for repeated phrases, hallucinations, missing sections, and encoding issues. Do not use a partial or obviously corrupted transcript to write official minutes. If a section is unintelligible, mark it as uncertain rather than guessing.
4. Treat the output as automatic transcription, not verified fact. Whisper does not diarize speakers. Verify names, numbers, decisions, and action owners against the audio where possible; do not infer attendees from people merely mentioned.
5. If the user requests Obsidian notes, inspect an existing note from the same series before creating new ones. For AKSSMA board meetings, follow `Ata reunião diretoria - 13 de junho 2026.md` and `Transcrição reunião diretoria - 13 de junho 2026.md` in `~/Obsidian/Personal/Notes/` for titles, frontmatter, section style, and links.
6. Create the transcript note with timestamped segments in `[HH:MM:SS–HH:MM:SS] text` format, a source-audio line, duration, model, and a clear warning about noise, overlap, and absent speaker labels. Link it to the minutes note.
7. Create minutes as a concise, faithful summary: separate discussion, decisions, and follow-ups; assign owners or dates only when the recording makes them clear. Use the meeting date in ISO format in frontmatter, link to the transcript, and state when the complete participant list cannot be confirmed.
8. Verify both notes exist, their links resolve by title, the dates match the request, and the transcript is complete enough to support the minutes. Report any audio or transcription problem plainly.

## Local tools

- Transcription runs only through `~/dotfiles/whisper/transcribe` (MLX-Whisper, installed by `dot install whisper`). There is no fallback engine. If it fails, diagnose and fix the setup in `~/dotfiles/whisper/` rather than switching tools.
- Preserve privacy by keeping audio, model weights, and outputs local. Never upload a recording without explicit permission.
