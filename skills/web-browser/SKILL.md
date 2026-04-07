---
name: web-browser
description: "Allows to interact with web pages by performing actions such as clicking buttons, filling out forms, and navigating links. It works by remote controlling Google Chrome or Chromium browsers using the Chrome DevTools Protocol (CDP). When Claude needs to browse the web, it can use this skill to do so."
license: Stolen from Armin (mitsuhiko)
---

# Web Browser Skill

Minimal CDP tools for collaborative site exploration.

## Start Chrome

```bash
./scripts/start.js --headless   # Headless (no visible window, won't steal focus)
./scripts/start.js              # Fresh profile (visible window)
./scripts/start.js --profile    # Copy your profile (cookies, logins)
```

Start Chrome on `:9222` with remote debugging. Use `--headless` by default to avoid stealing window focus. Flags can be combined (e.g. `--headless --profile`).

**Safety rule:** never use `pkill`/`killall` for Chrome as part of this skill. Reuse the existing debug instance instead of terminating browser processes.

If `--profile` startup fails, retry once. If it still fails, clear stale locks and retry:
```bash
rm -f ~/.cache/scraping/SingletonLock ~/.cache/scraping/SingletonCookie ~/.cache/scraping/SingletonSocket
```

## Navigate

```bash
./scripts/nav.js https://example.com
./scripts/nav.js https://example.com --new
./scripts/nav.js https://example.com --new-window
```

Navigate current tab, open a new tab, or open an isolated window.
Use `--new-window` by default to avoid touching unrelated tabs.

## Close automation tabs safely

```bash
./scripts/close-tab.js        # Close current automation tab
./scripts/close-tab.js --all  # Close all tabs in debug instance
```

Prefer closing tabs/windows over killing Chrome processes.

## Evaluate JavaScript

```bash
./scripts/eval.js 'document.title'
./scripts/eval.js 'document.querySelectorAll("a").length'
./scripts/eval.js 'JSON.stringify(Array.from(document.querySelectorAll("a")).map(a => ({ text: a.textContent.trim(), href: a.href })).filter(link => !link.href.startsWith("https://")))'
```

Execute JavaScript in active tab (async context).  Be careful with string escaping, best to use single quotes.

## Screenshot

```bash
./scripts/screenshot.js
```

Screenshot current viewport, returns temp file path

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

Automatically dismisses EU cookie consent dialogs.

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
