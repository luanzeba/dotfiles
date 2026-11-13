# Session info

Ways to find your way around sessions:

- **Ctrl+Shift+I** (or `/session-info`) toggles a card in the top-right corner with a one-sentence
  summary of the session, its Linear tickets, merge requests, dev servers, Slack threads, and other
  links you shared. Links are clickable in terminals with OSC 8 support. The card doesn't take focus,
  so you can keep typing while it's open; press the shortcut again to close it.
- **Ctrl+Shift+H** (or `/hunk [args]`) opens hunk on the session's worktree in a new Rex tab, so you
  can review what the session changed without opening a pane and `cd`-ing there.
- **`/resume-search [query]`** is `/resume` with search that understands links. It searches every
  session, not only the current directory's.
- **`@@`** in the editor mentions another session, and the agent gets told where it is. The
  agent can read sessions with `session_read`, and message live ones with `session_send`. See
  [Other sessions](#other-sessions).

```
/resume-search 743                    MR or PR number (also !743 or #743)
/resume-search config-service!743     a specific project's MR
/resume-search CUS-1203               Linear ticket
/resume-search <any URL>              the MR, ticket, Slack thread, or page it points at
/resume-search charge cap ground      words from the summary, your messages, cwd, or links
/resume-search 01a1b2eb               the start of a session id (4 characters or more)
```

Numbers match only MR and PR numbers, never text, so `743` doesn't match everything that contains
a 7, a 4, and a 3. Results are ranked by how tightly a session is tied to the match:

1. it created the MR or pushed to its branch (`glab mr create`, `gh pr create`, `git push`)
2. you named it in the session's first message
3. you mentioned it later
4. the session runs in its worktree (`.worktrees/cus-1203`)
5. the assistant mentioned it
6. it only showed up in tool output

## Reviewing the session's diff

Ctrl+Shift+H opens a tab in the current Rex session, in the checkout this session worked in, with
whatever there is to review there:

| Checkout state | Runs |
|---|---|
| jj, `@` has changes | `hunk diff` |
| jj, `@` is empty | `hunk show @-` |
| git, uncommitted changes (staged, unstaged, or new files) | `hunk diff HEAD` |
| git, several commits since the branch it forked from | `hunk diff origin/<base>...HEAD` |
| git, otherwise | `hunk show` (the last commit) |

The base is the nearest `develop`, `main`, `master`, `release/*`, or `feature/*` branch on the remote,
so a branch cut from `feature/v8.0` is compared with that and not `main`. On `develop` or `main`
itself, it's the branch's own remote copy, which shows unpushed commits. The status line says which
one it opened.

`/hunk <args>` runs what you ask instead: `/hunk show abc123` as given, and anything else as
`hunk diff <args>`, like `/hunk origin/develop...`. When the session worked in several checkouts, it
asks which one, busiest first. The tab closes when you quit hunk.

Switching the app to the new tab is an app action, which Rex allows only with **Remote Control** on
(Rex Settings > Rex Server). Without it the tab still opens, and the status line says why it didn't
come to the front.

"Worked in" means the session's cwd plus folders it `cd`'d into, ran `git -C` on, or edited files
in, weighted by how often. A checkout with under a quarter of the busiest one's activity counts as a
quick visit and is left out, here and on the card's Dev rows.

Hunk registers the tab as a live session for that repo, so you can then ask the agent to read your
review comments with `hunk session` commands.

## What shows up on the card

- **Linear**: linear.app URLs, and bare ids like `CUS-1203` once a linear.app URL has shown which
  workspace that team belongs to. Ids such as `UTF-8` are ignored.
- **MR / GitHub**: merge and pull requests. `pushed` marks the ones this session created or pushed to.
- **Dev**: portless servers running from the checkouts this session worked in: its cwd, folders
  it `cd`'d into or ran `git -C` on, and folders of files it edited. They're grouped by worktree,
  the session's main one first, with each app as a link. Dev URLs you or the assistant named show
  too, with `○` when they're not running. A URL that only appeared in tool output doesn't count,
  because `portless list` and dev logs print every worktree's servers.
- **Slack**: threads you or the assistant linked.
- **Link**: other URLs from your own messages.

The assistant mentions related tickets and MRs in passing, so its mentions show only when nothing
stronger names a ticket or MR of that kind.

The summary is written once the session has a user message and rewritten after every three new
ones. A failed attempt also waits for three new messages before retrying. It is saved in the session as a `session-info` custom entry,
which never reaches the model's context, so `/resume-search` can match it too. Print-mode sessions
(reviewers, helpers) are not summarized.

The model is a per-machine choice in pi's `settings.json`, like `/review`'s:

```json
{ "session-info": { "model": "openai/gpt-6-luna" } }
```

Without it, the extension looks for `gpt-6-luna`, then `claude-haiku-5-5`, on the session's own
provider, so session digests never go to another account. It never falls back to the session's
model itself, because summaries run in the background where an expensive fallback would go
unnoticed. When neither is available, the card says so.

## Performance

The index lives in `~/.pi/agent/session-info/`. An interactive pi refreshes it in the background
when it starts, and again when `@@`, a mention, or a session tool needs it (at most every 3
seconds). Building it from scratch takes a couple of seconds for a few hundred sessions. In
`/resume-search`, results show up while it runs, newest first, and closing the picker keeps what was
already scanned. After that, a refresh only redoes what changed:

- Only sessions whose file changed since the last search are rescanned, at about 1–2 ms per MB.
- Records are sharded by the month a session started. A refresh rewrites only the shards that
  changed, which is usually just the current month.
- Records keep up to 150 links and the distinct words of your messages, not the transcript: at
  most 8 KB, and 2 KB of new words per message, so a pasted log can't crowd out what you typed
  later. Skill bodies that `/skill:name` inlines are left out.

The card does no work until you first open it in a session. After that it reads only the session
entries added since it last looked, including your own `!` commands.

## Other sessions

### Mentioning one with `@@`

Type `@@` in the editor for a dropdown of your sessions, newest first:

```
→ ●  3m  session-mentions        Adds @@ session mentions and live messaging to session-info
  ●  5m  subagents               Building the Pi subagent extension and fixing its tab bridge
    2h  config-service ⎇ cus-1203 CUS-1203 adds session charge-target controls for Ground…
```

Each row is what the session is about (its summary, else its name, else its first message), how
long ago it was active, its folder or worktree, and `●` when it's live. The current session isn't
listed. Text after `@@` filters the way `/resume-search` matches, one word at a time: `@@743`,
`@@cus-1203`, `@@ocpp`, a folder name, or the start of a session id. `@` alone still completes
files.

Picking a row inserts a token such as `@@01a1b2eb`: the start of the session id, long enough to
name one session. Ids begin with a timestamp, so sessions started within the same minute share their
first 8 characters, and their tokens grow a little (`@@01a1b345-a7`). The token is a plain id
prefix, so `pi --session 01a1b345-a7` works too.

When you send a message with a token in it, your text stays as you typed it. The agent also gets a
note right after it with each mentioned session's id, file, cwd, what it's about, last activity, and
whether it's live, so it never has to search for the session file. The transcript shows the note as
one line per mention (Ctrl+O shows all of it). A token that matches no session is reported as such.

The note is added to each request rather than queued as a message: pi delivers queued steering
messages one at a time, so a queued note would reach the model in its own turn. It's computed once,
saved as a `session-mention` entry, and inserted after its message the same way every time, so the
prompt cache keeps working.

### Tools

| Tool | What it does |
|---|---|
| `session_list({ query?, live?, limit? })` | Sessions, newest first or best match first, with token, cwd, last activity, live or not, and what each is about |
| `session_read({ session, query?, last?, from?, full? })` | A compact transcript, described below |
| `session_send({ session, message, mode? })` | Message a live session |

`session` takes an `@@` token, a session id or id prefix, or a path to a session file.

`session_read` starts with the same details as the mention note, then numbered items: your
messages, assistant text, one line per tool call with a trimmed result, compactions, errors such as
503s, model changes, and messages from other sessions. Thinking is left out. Pages are about 24 KB;
`from` continues where one stopped, `query` keeps only items containing some text, `last` takes the
last N, and `full` keeps long messages whole. It reads the branch that ends at the file's last
entry and says how many entries other `/tree` branches have. It reads a 100 MB session in about
150 ms.

`session_send` delivers into the other session as a message that names the sender (its token, cwd,
and what it's about) and says how to answer, unless the sender doesn't listen, like a script's
`pi -p`. An idle session starts a turn on it. A busy one gets it after its current tool calls
(`mode: "steer"`, the default) or when it's done (`"followUp"`). The sender's transcript has the
call and how it was delivered; the receiver's shows `✉ Message from @@…`. The message is a custom
message rather than a user message, so it doesn't count as something you typed in summaries or
`/resume-search`.

### Live sessions

Every interactive pi listens on `~/.pi/agent/session-sockets/<session id>.sock`. Print, JSON, and
RPC mode pis (reviewers, subagents, helpers) don't, and neither do `--no-session` sessions. The
socket follows the session through `/new`, `/resume`, `/fork`, and `/reload`, and goes away when pi
exits. If the same session is open in two pis, the first one keeps the socket and the second says
so.

- **Access:** the directory is 0700 and each socket 0600. Node can't read a peer's uid, so the
  directory is the boundary, as with ssh-agent sockets. Anything running as you can message your
  sessions.
- **Limits:** 256 KB per request and 50,000 characters per message. A peer has 5 seconds to send
  its request, and at most 16 connections are open at once. A send waits 5 seconds for an answer.
- **Stale sockets:** a pi killed with `kill -9` leaves its socket behind. The next listing
  (the dropdown, `session_list`, `session_send`) finds that nothing listens and removes it. A pi
  that doesn't answer within half a second, such as one suspended with Ctrl+Z, counts as not live,
  and its socket stays.
- **Protocol:** one JSON line in, one JSON line out, then the connection closes. Requests carry
  `"v": 1` and a `type`, so new types can be added later:

  ```
  {"v":1,"type":"status"}  ->  {"ok":true,"status":{"sessionId","file","cwd","idle","pid","about"}}
  {"v":1,"type":"send","message":"…","mode":"steer","from":{"sessionId","token","cwd","about","listening"}}
                          ->  {"ok":true,"delivery":"started" | "steered" | "followUp" | "noted"}
  ```

- **Taken over by another extension:** before delivering, session-info emits `session-info:incoming`
  on `pi.events` with `{ from, message, taken: false }`. A listener that sets `taken` takes the message
  over: nothing is started or steered here, and the sender is told `noted`. The main agent
  (`../agent-state`) takes every message and keeps it as a note for your next message, so children and
  other sessions never interrupt you talking to it.

- **Busy without a run:** during `/compact` or a `/tree` summary pi isn't idle but has no run to
  steer into, so a message waits there until pi is idle or a run starts, and the sender is told
  `followUp`.
- **Not in v1:** a message steered into a busy session, or waiting as above, is held in that pi's
  memory until it's delivered. If you quit the session before then, the message is lost. The sender
  was told it was queued, not that it was read.

## Testing a change without the installed copy

The installed extension is a link to `~/dotfiles`, so `pi -e` with a workspace copy would load
both. Run test pis with their own agent dir instead: a copy of `settings.json`, links to every other
global extension, and `extensions/session-info` pointing at the copy under test.

```sh
export PI_CODING_AGENT_DIR=/tmp/sm-agent   # short: macOS caps socket paths at 104 bytes
```

Sessions, the index, and sockets then all live under that directory.
`pi/check-extensions` honors `PI_CODING_AGENT_DIR` too.

## Tests

```
node --test ~/dotfiles/pi/extensions/session-info/
```
