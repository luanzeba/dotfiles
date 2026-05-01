# revise-message demo

This demo shows the `/revise` extension workflow:

1. Load the most recent assistant message automatically.
2. Edit it in `$VISUAL`/`$EDITOR` (for example `nvim`) with inline fallback.
3. Choose what to do next: copy to clipboard, send back to assistant, or both.

You can also pass an action argument directly:

- `/revise copy`
- `/revise send`
- `/revise both`

## Files

- `demo-session.jsonl` – minimal seeded session with one assistant message.
- `revise-message-demo.tape` – VHS recording script.
- `revise-message-demo.gif` – generated demo animation.
- `index.html` – simple page that embeds the GIF.

## Re-record the GIF

```bash
cd ~/dotfiles
vhs ./pi/demos/revise-message/revise-message-demo.tape
```
