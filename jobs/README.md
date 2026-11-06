# jobs

Scheduled jobs for this machine. They're declared once in [`jobs.json`](jobs.json) and run by launchd on macOS or by systemd user timers on Linux.

```bash
dot jobs                 # every job: last run, result, last success, next run, health
dot jobs qmd-reindex     # one job's details, its pi session and spend, and the end of its last output
dot jobs run qmd-reindex # run it now through launchd/systemd and show the output
dot jobs enable <job>    # schedule it on this machine (also enables jobs-check)
dot jobs disable <job>
dot jobs sync            # after editing jobs.json (dot pull does this, except on Omarchy without --apply)
dot jobs --json          # the same data for scripts (worklist, for example); exits 0 unless it errors
```

If a job isn't enabled on this machine, `dot jobs run` runs it directly in the terminal instead.

## Defining a job

```json
"qmd-reindex": {
  "description": "Re-index qmd collections and update embeddings",
  "schedule": "*/30 * * * *",
  "command": "qmd update && qmd embed",
  "timeout": "30m"
}
```

| Field | Meaning |
|---|---|
| `schedule` | Cron in local time: minute hour day-of-month month weekday. Restrict either the day of month or the weekday, not both. |
| `command` | Shell command, run by `/bin/sh` with Nix and `~/.local/bin` on `PATH`. |
| `pi` | An unattended pi run, used instead of `command`. See [Agent jobs](#agent-jobs). |
| `cwd` | Working directory. Default `~`. |
| `env` | Extra environment variables. |
| `env_files` | Files to source before the command, if they exist. Their values are never logged. |
| `timeout` | Default `30m`. Examples: `90s`, `2h`, `1d`. |
| `requires` | A command that must pass first, such as a check that the VPN is up. It's retried every 30s for up to 10 minutes. If it never passes, the run fails without starting. |
| `description` | Free-text summary. |

A job runs on a machine only after `dot jobs enable <job>` there. `qmd/install` and `gh/install` enable their own jobs.

### Agent jobs

```json
"verify-skill": {
  "schedule": "30 9 * * 1-5",
  "cwd": "~/beta/some-repo",
  "timeout": "45m",
  "env_files": ["~/.config/beta/proxy.env"],
  "requires": "curl -fsS -m 5 -o /dev/null https://proxy.chat.beta.team/health/liveliness",
  "pi": {
    "prompt": "/skill:maintain-verification-skill",
    "profile": "work",
    "model": "openai/us.anthropic.claude-opus-5-5",
    "max_cost": 3
  }
}
```

This runs `pi -p --name "job verify-skill" --model … -e jobs/pi-job.ts -- <prompt>` with `PI_PROFILE=work`.

| `pi` field | Meaning |
|---|---|
| `prompt` | Required. |
| `profile` | Sets `PI_PROFILE`. |
| `model`, `thinking` | Passed as `--model` and `--thinking`. |
| `max_cost` | Dollars. Default 5. |
| `max_turns` | Default 100. |
| `args` | Extra pi flags, such as a `--tools` allowlist. |

- **No prompts:** print mode can't ask anything, and stdin is `/dev/null`.
- **Key and VPN:** launchd and systemd don't load your shell. In the example, the BETA proxy key comes from `env_files`, and `requires` waits for the proxy.
- **Budget:** [`pi-job.ts`](pi-job.ts) adds up the cost of every model response and stops the run before it continues past `max_cost` or `max_turns`. A stopped run counts as failed.
- **Review afterwards:** `dot jobs <job>` shows the session file (`pi --session <file>` opens it), the spend, and the final answer. Todos go to the job's state directory, not the repo.

## When jobs run

| | macOS (launchd) | Linux (systemd) |
|---|---|---|
| Slot missed while asleep | Runs once on wake. Several missed slots become one run. | Runs once on wake. Several missed slots become one run. |
| Slot missed while powered off | Skipped. | One missed run is caught up at boot (`Persistent=true`). |
| Start time | Within seconds of the slot. | Within a minute of the slot. |

A skipped run shows as an older LAST RUN in `dot jobs`. The job turns `late`, and alerts, only when no run starts for a day after one was due, counting from boot at the earliest. See [Health and alerts](#health-and-alerts).

- **Never twice at once:** launchd and systemd don't start a job that's still running. When the job is enabled, `dot jobs run` also goes through them, so they act as the lock.
- **Timeout:** this is wall-clock time. At the deadline, the whole process group gets SIGTERM, then SIGKILL 10s later. A run that sleeps past its deadline is stopped on wake. Anything the command leaves running in the background is stopped the same way when the command exits.

## Health and alerts

| Health | Meaning |
|---|---|
| `ok` | No problems. |
| `off` | Not enabled here. This is only a problem for `jobs-check`. |
| `not loaded` | The unit file exists, but launchd/systemd doesn't have it. `dot jobs sync` fixes this. |
| `out of date` | The unit doesn't match `jobs.json` (for example a changed schedule). `dot jobs sync` fixes this. |
| `not in jobs.json` | A unit for a job that was removed from `jobs.json`. `dot jobs sync` removes it. |
| `stuck` | Still running 5 minutes past its timeout (plus the `requires` wait). |
| `failing` | The last 2 or more runs failed. Runs interrupted by a shutdown or logout don't count. |
| `late` | A run that was due more than a day ago hasn't started: the scheduler isn't running the job. This counts from the last run, from when the job was enabled, or from the last boot, whichever is latest. So a shutdown doesn't raise alerts, but a job whose slots always fall while the machine is off never turns late. A weekday job isn't late over the weekend. Runs that start and fail are `failing`'s business. |

`dot jobs` exits 1 when any job has a problem, so `dot status` shows `jobs` as not configured.

`jobs-check` runs `dot jobs check` at :15 and :45, two minutes after it starts so that runs catching up after a wake get going first. Each time the set of problems changes, it sends one [ntfy](https://ntfy.sh) message. That includes a message when everything is healthy again. Messages contain only job names and problem kinds, never output, because anyone who knows an ntfy.sh topic can read it. If a message can't be sent, the check fails and tries again next time.

Something also has to watch `jobs-check`. After every check, it pings a dead man's switch. If the pings stop, that service alerts you. This covers cases like Node breaking, the units being unloaded, or the check repeatedly crashing.

Set both URLs in the machine-local `~/.config/jobs/env`:

```bash
JOBS_NTFY_URL=https://ntfy.sh/<long random topic>
JOBS_HEARTBEAT_URL=https://hc-ping.com/<uuid>   # Healthchecks.io
```

On Healthchecks.io, use one check (one URL) per machine; the ntfy topic can be shared. Give the check a cron schedule that matches when the laptop is open, such as `0 12 * * 1-5` with a few hours' grace, and send its alerts to the same ntfy topic. That way, nights and weekends with the lid shut don't page you.

## Files

These are internal; scripts should read `dot jobs --json`, which adds health and the next run.

- `~/.local/state/jobs/<job>/state.json`: the current run, if any, and the last run. The last run has a `result` of `ok`, `failed`, `timeout`, or `interrupted`, plus `exit_code`, `duration_s`, the log path, and `pi` details. The file also holds `last_success_at` and the count of consecutive `failures`.
- `~/.local/state/jobs/<job>/logs/`: output from the last 10 runs, one file each. The first line is the command, and the last line is the result.
- `~/.local/state/jobs/<job>/runner.log` (macOS): errors from the runner itself. On Linux they're in `journalctl --user -u jobs-<job>`.
- Units: `~/Library/LaunchAgents/me.luanv.jobs.<job>.plist` or `~/.config/systemd/user/jobs-<job>.{service,timer}`. They're generated from `jobs.json`, so don't edit them.

## Tests

```bash
node --test jobs/test/          # offline: schedules, runner, health, alerts (fake clock, fake pi)
jobs/test/systemd-docker.sh     # real systemd user timers in a throwaway Fedora container
```
