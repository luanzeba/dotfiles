# Agent state: the main agent and `/status`

One pi you talk to, the **main agent**, keeps your work moving through subagents, keeps track of it,
and stays free to chat. It's an ordinary pi started in the **state repo**, a private git repo of
markdown files: `~/beta/luan-agent-state`, or wherever `PI_AGENT_STATE_DIR` points. Every other pi session is
unaffected.

```sh
agent          # pi in the state repo, resuming the main agent's latest session
agent --new    # a fresh session; the state is in the files, so this costs little
```

On the devbox, run it in a Rex session so it outlives your connection:
`rex -S devbox new main-agent -c ~/beta/luan-agent-state -- agent`.

## In the main agent's session

- **Its Rex session keeps its name:** the main agent isn't told to rename it after its first task
  (`../rex-session.ts`).
- **Instructions:** [`main.md`](main.md) goes into the system prompt: delegate the work, keep the work
  files, decide or ask, clean up after landing, keep memory, stay lean.
- **Notes, not interruptions:** a message for the main agent becomes a note, read with your next
  message. Nothing starts or steers a turn. Notes are files, one per note, in `.pending/notes/`:
  - `session_send` to the main agent: session-info hands the message over (`../session-info`, "Taken
    over by another extension").
  - A subagent tab it spawned with `report: true` drops its answer there after each turn
    (`../subagent`). Those tabs belong to the main agent, not to one session, so a new session (`/new`,
    `agent --new`, a restart) lists them and gets their reports.
  - Anything else can drop one with `addNote(stateRepo, { at, from, message, replyTo? })` from
    `state.ts`; each note is one JSON file.

  The footer counts them, `/status` lists them, and the prompt that starts the next turn reads and
  removes them. They survive restarts and new sessions until then.
- **Its state, loaded:** the first prompt of each session gets the work overview and
  `memory/MEMORY.md` (first 200 lines or 25,000 characters).
- **Pushed:** after every turn, anything changed in the repo is committed and pushed. The footer says so
  when a push fails.

## `/status`

In any pi, on the whole screen: what needs you, what's in progress, what's landed and awaiting cleanup,
what was cleaned or dropped in the last 7 days (work often goes straight to cleaned), and (in the main
agent's session) unread notes.

- ↑/↓ or j/k move, Enter opens the work file: its front matter as a header (`needs` in full, links,
  sessions, artifacts), then its markdown. ↑/↓, j/k, PgUp/PgDn or Space/b, and g/G scroll it.
- Enter on a note shows all of it, a subagent's whole report say. That doesn't use it up: the main
  agent still reads it.
- Esc goes back to the list, on the same item; Esc or q there closes `/status`, and q closes it from a
  work file or note too.
- The list reads the work files again every 3 seconds and when you come back to it, so in the main
  agent's clone it shows what the main agent writes while it's open. Elsewhere it shows what the pull
  brought; open `/status` again to pull again.

It reads the files directly, so it costs no model call. In a clone the main agent doesn't run in, it
pulls first, so the Mac shows what the devbox's main agent wrote a minute ago. In RPC and print mode it
prints the list instead.

## The state repo

```
AGENTS.md          this agent's specifics (work or personal), loaded by pi from the repo
work/<slug>.md     one file per piece of work: front matter + why, decisions, log
memory/MEMORY.md   short index of memory notes, one line each
memory/<topic>.md  the notes
.pending/          unread notes (gitignored)
```

A work file's front matter, as `main.md` asks for it and `/status` reads it:

```yaml
title: A name you recognize
status: active        # active, waiting (on someone else), landed, cleaned, dropped
updated: 2026-11-13
needs: Review the diff   # only while you have to act
links: […]            # MRs, Linear, URLs
sessions: […]         # pi sessions, children's too
artifacts: […]        # worktrees, workspaces, prototypes, demos, tmp folders
```

`/status` lists items by `title`, `status`, `updated`, and `needs`, and shows the lists in a work file's
header; they're for the agent and for cleanup.

`.pending/` ignores itself, so it stays out of git in any state repo. It also holds `main.json`, the pid
of the pi that has the main agent's role in this clone: another pi started there (a new Rex tab in the
same folder, say) runs as an ordinary session and says so. Across machines, keep one main agent per
state repo: two would push over each other. The work repo lives on the devbox; a personal machine gets
its own repo cloned to the same path.

## Tests

```
node --test ~/dotfiles/pi/extensions/agent-state/
```
