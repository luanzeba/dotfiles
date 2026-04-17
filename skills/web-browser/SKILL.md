---
name: web-browser
description: "Allows to interact with web pages by performing actions such as clicking buttons, filling out forms, and navigating links. It works by remote controlling Google Chrome or Chromium browsers using the Chrome DevTools Protocol (CDP). When Claude needs to browse the web, it can use this skill."
license: Stolen from Armin (mitsuhiko)
---

# Web Browser Skill

Minimal CDP tools for collaborative site exploration.

## Safety Rules (must follow)

- **Never run Chrome headless** for this skill.
- **Never kill Chrome processes** (`pkill`, `killall`, `kill -9`) as part of browsing setup/cleanup.
- **Never navigate arbitrary existing tabs.** Use tracked automation windows/tabs only.

## Start Chrome (visible session only)

```bash
./scripts/start.js
```

Run this before any other script in this skill.

On local macOS, you can also use the Raycast-friendly launcher:
```bash
~/dotfiles/bin/chrome-pi-debug.sh
```

Behavior:
- Reuses an existing `:9222` debug instance when safe
- Never uses headless mode
- Never kills existing Chrome processes
- Tries your regular Chrome profile first when supported
- On modern Chrome versions (136+), CDP on the primary profile is blocked, so `start.js` skips straight to the isolated Pi profile (`~/.cache/scraping`)
- Isolated fallback keeps automation working without touching your open browsing windows

Optional profile refresh for isolated fallback mode:
```bash
./scripts/start.js --refresh-profile
```

## Navigate

```bash
./scripts/nav.js https://example.com
./scripts/nav.js https://example.com --new
./scripts/nav.js https://example.com --current
```

Default behavior opens a **new automation window**.

Flags:
- `--new` opens a new automation tab
- `--current` navigates the currently tracked automation tab/window

Prefer the default (new automation window) to avoid touching unrelated tabs.

## Close automation tabs/windows safely

```bash
./scripts/close-tab.js        # Close active tracked automation tab/window
./scripts/close-tab.js --all  # Close all tracked automation tabs/windows
```

These commands close only tracked automation targets, never arbitrary user tabs.

## Evaluate JavaScript

```bash
./scripts/eval.js 'document.title'
./scripts/eval.js 'document.querySelectorAll("a").length'
./scripts/eval.js 'JSON.stringify(Array.from(document.querySelectorAll("a")).map(a => ({ text: a.textContent.trim(), href: a.href })).filter(link => !link.href.startsWith("https://")))'
```

Executes JavaScript in the active tracked automation tab/window.

## Screenshot

```bash
./scripts/screenshot.js
```

Screenshots the active tracked automation tab/window and returns a temp file path.

## Pick Elements

```bash
./scripts/pick.js "Click the submit button"
```

Interactive element picker. Click to select, Cmd/Ctrl+Click for multi-select, Enter to finish.

## Dismiss Cookie Dialogs

```bash
./scripts/dismiss-cookies.js          # Accept cookies
./scripts/dismiss-cookies.js --reject # Reject cookies (where possible)
```

Run after navigating to a page:
```bash
./scripts/nav.js https://example.com && ./scripts/dismiss-cookies.js
```

## Background Logging (Console + Errors + Network)

Automatically started by `start.js` and writes JSONL logs to:

```
~/.cache/agent-web/logs/YYYY-MM-DD/<targetId>.jsonl
```

Manually start:
```bash
./scripts/watch.js
```

Tail latest log:
```bash
./scripts/logs-tail.js           # dump current log and exit
./scripts/logs-tail.js --follow  # keep following
```

Summarize network responses:
```bash
./scripts/net-summary.js
```
