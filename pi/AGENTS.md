# Agent Operational Guidelines

## GitHub: Always Use `gh` CLI

When browsing GitHub content (issues, PRs, repos, files, comments):

- **Always use `gh`** — never use the web-browser skill or any browser automation to access github.com
- Use `gh issue view`, `gh pr view`, `gh api`, etc.
- For file contents: `gh api repos/{owner}/{repo}/contents/{path}` or `gh browse` for reference
- For issue/PR comments and details: `gh issue view <number> -R <repo> --comments`

## Bash: Servers and Long-Running Processes

When starting servers, watchers, or any long-running process:

- **Always set `timeout`** on the bash tool call (e.g., `timeout: 15` for server smoke tests)
- **Never use `wait`** — it blocks if the process doesn't exit cleanly
- **Use `kill -9` not just `kill`** — graceful shutdown can hang if event loops are busy:
  ```
  kill %1 2>/dev/null; sleep 0.5; kill -9 %1 2>/dev/null
  ```
- **Clean up before starting** — kill leftover processes from previous runs:
  ```
  pkill -f "pattern" 2>/dev/null; sleep 0.5
  ```
- macOS does not have the GNU `timeout` command. Use the bash tool's `timeout` parameter instead.

## Browser Automation: Protect Primary Chrome Session

When using browser automation / CDP tools:

- **Never run Chrome in headless mode** unless the user explicitly asks for headless.
- **Never kill or quit Chrome processes** (`pkill`, `killall`, `kill -9`, AppleScript quit) to free a debugging port.
- **Always run** `~/dotfiles/skills/web-browser/scripts/start.js` **before other web-browser scripts**.
- On local macOS, prefer the launcher `~/dotfiles/bin/chrome-pi-debug.sh` (Raycast hotkey friendly).
- `start.js` may fall back to the isolated Pi profile when Chrome blocks CDP on the primary profile.
- **Open a new automation window/tab** instead of navigating existing user tabs.
- **Close only automation tabs/windows** (never bulk-close all browser tabs).
- If Chrome is running without `:9222`, ask the user to relaunch Chrome with remote debugging manually rather than forcing shutdown.

### Persistent servers (across multiple tool calls)

Background processes (`&`, `nohup`, `disown`) are killed when the bash tool call ends. To keep a server alive across calls:

- **If in tmux** (`$TMUX` is set): `tmux new-window -d -n "name" "cd /path && exec command"`
- **Otherwise via Ghostty**: `ghostty -e "cd /path && command"` (Linux), `open -na Ghostty.app --args -e "cd /path && command"` (macOS)

Clean up with `tmux kill-window -t name` or `pkill -f "pattern"` when done.
