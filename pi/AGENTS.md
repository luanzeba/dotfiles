# Agent Operational Guidelines

## GitHub: Always Use `gh` CLI

When browsing GitHub content (issues, PRs, repos, files, comments):

- **Always use `gh`** — never use browser automation to access github.com
- Use `gh issue view`, `gh pr view`, `gh api`, etc.
- For file contents: `gh api repos/{owner}/{repo}/contents/{path}` or `gh browse` for reference
- For issue/PR comments and details: `gh issue view <number> -R <repo> --comments`

## Linear: Always Use `linear` CLI

When reading or modifying Linear content:

- **Always use `linear`** (`~/dotfiles/bin/linear`) instead of browser automation.
- Run `linear --help` for available commands and options.
- Use browser automation only when the CLI cannot perform the required operation.
- For recurring unsupported operations, extend the CLI instead of relying on browser automation.

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

## Browser Automation: work-browser (`wb`)

For work tasks that need a browser, use the `work-browser` skill: `wb` drives a headless Google Chrome with its own signed-in profile, gives each agent its own tabs, and never takes focus. Don't use the user's own Chrome (port 9222) for work tasks, and never kill or quit Chrome processes.

### Persistent servers (across multiple tool calls)

Background processes (`&`, `nohup`, `disown`) die when the bash call ends. Run them in a background Rex window in your session (see the `rex` skill):

```
rex window new -s "$REX_SESSION" "dev:name" -c /path --focus=false --json -- sh -c 'command 2>&1 | tee /tmp/name.log'
```

- Save the returned `window_id`; poll the log or endpoint for readiness instead of fixed `sleep`s (`rex capture` shows only the screen).
- When done, close your windows with `rex window close -s "$REX_SESSION" <window_id>` unless the user asks to keep them.
