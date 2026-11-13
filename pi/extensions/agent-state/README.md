# Agent state: the main agent and `/status`

One pi you talk to, the **main agent**, keeps your work moving through subagents, keeps track of it,
and stays free to chat. It's an ordinary pi started in the **state repo**, a private git repo of
markdown files: `~/luan-agent-state`, or wherever `PI_AGENT_STATE_DIR` points. Every other pi session is
unaffected.

```sh
agent          # pi in the state repo, resuming the main agent's latest session
agent --new    # a fresh session; the state is in the files, so this costs little
```

On the devbox, run it in a Rex session so it outlives your connection:
`rex -S devbox new main-agent -c ~/luan-agent-state -- agent`.

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

In any pi: what needs you, what's in progress, what's landed and awaiting cleanup, and (in the main
agent's session) unread notes. It reads the work files' front matter directly, so it costs no model
call. In a clone the main agent doesn't run in, it pulls first, so the Mac shows what the devbox's main
agent wrote a minute ago. Esc, Enter, or q closes it.

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

Only `title`, `status`, `updated`, and `needs` matter to `/status`; the lists are for the agent and for
cleanup.

`.pending/` ignores itself, so it stays out of git in any state repo. It also holds `main.json`, the pid
of the pi that has the main agent's role in this clone: another pi started there (a new Rex tab in the
same folder, say) runs as an ordinary session and says so. Across machines, keep one main agent per
state repo: two would push over each other. The work repo lives on the devbox; a personal machine gets
its own repo cloned to the same path.

## Tests

```
node --test ~/dotfiles/pi/extensions/agent-state/
```
