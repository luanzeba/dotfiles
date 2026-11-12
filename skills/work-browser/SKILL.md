---
name: work-browser
description: Browse, test, screenshot and record web apps in a headless Google Chrome that's signed in to work apps (Ground, Operate, GitLab, AMPECO, Linear). Use for any work task that needs a browser - checking UI changes on local dev servers, testing like a user, screenshots, demo videos, console errors, WebMCP tools. It never takes focus, and each agent gets its own tabs.
---

# work-browser

`wb` drives a headless Google Chrome on this machine. It has its own profile, signed in to work apps, separate from the user's Chrome. Each Pi session only sees the tabs it opened (keyed by `PI_SESSION_ID`), so parallel agents don't collide. The browser starts on first use.

## The loop

```sh
wb open https://ground.config.localhost/chargers
wb snapshot                 # @1 button "Add charger", @2 input[text] "Search", …
wb click @1                 # or text=Add charger, or a CSS selector
wb type @2 "Mini Cube"      # replaces the field's text; --append adds to it
wb press Enter
wb wait "text=Saved"        # or a selector, or --url <part>
wb eval 'document.querySelectorAll("tr").length'
```

Refs (`@N`) change with every `wb snapshot`; take a new one after the page changes. Prefer `wb eval` for facts (text, counts, state) and screenshots for how things look.

## Evidence for the user

- `wb screenshot <file.png>`: the viewport; `--full` for the whole page, `--element <target>` for one element.
- `wb record start <file.mp4>`, the actions, then `wb record stop`. The video follows you into tabs your clicks open, and clicks show a red marker. Set the viewport first: the video keeps its starting size. `.webm` works too.
- Save them where the user asked (or next to the task's other artifacts) and give the paths.

## Debugging

- `wb console`: console messages and uncaught errors, including ones logged before you looked. `--clear` empties it.
- `wb webmcp` lists the page's WebMCP tools; `wb webmcp <tool> '<json>'` calls one.
- `wb devtools` prints how the user can open Chrome DevTools on your tab (network, performance, elements).
- `wb viewport <width> <height>` resizes only your tab's page, for layout checks. Chrome won't go narrower than 500 px.

## Signed out?

If a page lands on `login.microsoftonline.com`, a BETA/Kinde sign-in page, or an app's login form, stop and tell the user. They sign in with `wb signin` on the Mac; the devbox gets the sessions from the Mac (`wb sync devbox`, every 15 minutes while the Mac is connected). Never type credentials.

## Rules

- Use `wb` for work browsing. Never drive the user's own Chrome (port 9222) or open URLs with `open`.
- Don't run `wb stop` or `wb signin`: other agents share this browser.
- Run `wb close --all` when your task is done. Links that open a new tab switch you to it; `wb tabs` and `wb tab <n>` move between your tabs.
