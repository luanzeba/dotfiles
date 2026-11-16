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
- **Notes, not interruptions:** a message for the main agent becomes a note. Notes are files, one per
  note, in `.pending/notes/`:
  - `session_send` to the main agent: session-info hands the message over (`../session-info`, "Taken
    over by another extension").
  - A subagent tab it spawned with `report: true` drops its answer there after each turn
    (`../subagent`). Those tabs belong to the main agent, not to one session, so a new session (`/new`,
    `agent --new`, a restart) lists them and gets their reports.
  - Anything else can drop one with `addNote(stateRepo, { at, from, message, replyTo? })` from
    `state.ts`; each note is one JSON file.

  Nothing steers a turn. While the main agent is idle and the editor is empty, notes start a turn of
  their own, so the work files keep up without you asking. The turn waits until no note has come in for
  10 seconds, so reports that land together make one. It's told you aren't waiting: the agent updates
  the work files, puts what you have to act on in `needs`, and answers in a line or two. Notes that
  come in during a turn, or while there's text in the editor, wait for the next idle moment or your
  next message, whichever comes first; your message takes whatever is left. pi can't tell when you're
  writing in an external editor (Ctrl+G) or a dialog, so a notes turn can start then; what you send
  joins it, and the agent answers you as usual.

  A notes turn that fails, or that you stop with Esc, holds the rest for your next message so it can't
  repeat on its own; the footer says so, and the hold (`.pending/hold`) outlasts restarts. If the
  session ends before that message (`/new`, a restart), or `/tree` moves away from it, what that turn
  read goes back to `.pending/notes/`.

  Whichever turn reads notes removes them; until then they survive restarts and new sessions. The
  footer counts them, and `/status` shows each in full without using it up.
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
.pending/          unread notes and the hold on them (gitignored)
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
