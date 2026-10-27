# Session info

Two things for finding your way around sessions:

- **Ctrl+Shift+I** (or `/session-info`) toggles a card in the top-right corner with a one-sentence
  summary of the session, its Linear tickets, merge requests, dev servers, Slack threads, and other
  links you shared. Links are clickable in terminals with OSC 8 support. The card doesn't take focus,
  so you can keep typing while it's open; press the shortcut again to close it.
- **`/resume-search [query]`** is `/resume` with search that understands links. It searches every
  session, not only the current directory's.

```
/resume-search 743                    MR or PR number (also !743 or #743)
/resume-search config-service!743     a specific project's MR
/resume-search CUS-1203               Linear ticket
/resume-search <any URL>              the MR, ticket, Slack thread, or page it points at
/resume-search charge cap ground      words from the summary, your messages, cwd, or links
```

Numbers match only MR and PR numbers, never text, so `743` doesn't match everything that contains
a 7, a 4, and a 3. Results are ranked by how tightly a session is tied to the match:

1. it created the MR or pushed to its branch (`glab mr create`, `gh pr create`, `git push`)
2. you named it in the session's first message
3. you mentioned it later
4. the session runs in its worktree (`.worktrees/cus-1203`)
5. the assistant mentioned it
6. it only showed up in tool output

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

The index lives in `~/.pi/agent/session-info/` and is built the first time you search. A few
hundred sessions take a couple of seconds. Results show up while it runs, newest first, and closing
the picker keeps what was already scanned. After that, a search only redoes what changed:

- Only sessions whose file changed since the last search are rescanned, at about 1–2 ms per MB.
- Records are sharded by the month a session started. A refresh rewrites only the shards that
  changed, which is usually just the current month.
- Records keep up to 150 links and the distinct words of your messages, not the transcript: at
  most 8 KB, and 2 KB of new words per message, so a pasted log can't crowd out what you typed
  later. Skill bodies that `/skill:name` inlines are left out.

The card does no work until you first open it in a session. After that it reads only the session
entries added since it last looked, including your own `!` commands.

## Tests

```
node --test ~/dotfiles/pi/extensions/session-info/
```
