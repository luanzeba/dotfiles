# revise-message demo

This demo shows the `/revise` extension workflow:

1. Pick a previous assistant message from an overlay list.
2. Edit markdown inline.
3. `Ctrl+Y` copies the edited markdown to clipboard.
4. `Ctrl+S` sends edited markdown back to the assistant to continue.

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
