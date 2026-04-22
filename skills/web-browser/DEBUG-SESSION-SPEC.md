# Chrome + Pi Debug Session Spec

## Goal

Use exactly one **main** Chrome experience for day-to-day browsing:

- same tabs/pinned tabs/history/profiles
- same window used by Hyper+B
- same window/process that receives links from other apps (via Finicky)
- same process exposing CDP on `:9222` for Pi

## Desired Behavior

1. **Single root Chrome process** (no split-brain with extra Chrome app instances).
2. Root process should use the canonical Pi debug profile store (`~/.cache/pi-chrome-profile`) so CDP remains stable.
3. CDP endpoint `:9222` should be available on that same process.
4. `Hyper+B` (`chrome-pi-debug.sh`) should:
   - ensure debug readiness,
   - bring the main Chrome process to front,
   - never open a separate empty-profile Chrome instance.
5. Finicky should open links into that same canonical Chrome process (no second Chrome root process).
6. Clicking links should open the requested URL (no "open Chrome but drop URL" regression).

## Test Matrix

### Automated checks

- `~/dotfiles/bin/chrome-pi-debug-status.sh`
  - inventory of Chrome root processes + kinds + debug tabs (when available)
- `~/dotfiles/bin/chrome-pi-debug.sh --ensure-only`
  - strict debug readiness check
- `~/dotfiles/bin/chrome-pi-debug.sh`
  - UX mode, should bring Chrome to front

### Semi-automated checks

- Run `open <url>` (simulating external app link open)
- Confirm root process count is stable before/after

### Manual checks (required)

- Hyper+B opens/focuses your normal Chrome window (with expected tabs/pinned tabs)
- Link from Slack/other app opens in that same window/process and navigates to the URL
- Pi can still open new automation window/tab without disturbing your existing tabs

## Operational Notes

- If multiple root Chrome processes are already running, full convergence to a single process may require a one-time cleanup/relaunch cycle.
- Chrome cannot always add `--remote-debugging-port` to an already-running default-profile process, so a clean startup order matters.
- Finicky uses `~/dotfiles/bin/chrome-pi-open-url.sh` to route external links into the canonical Pi-debug Chrome process.
- Legacy path `~/.cache/scraping` is kept as a compatibility symlink to the canonical profile directory.
