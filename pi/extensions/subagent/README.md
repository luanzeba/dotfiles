# Subagents

Child pi processes, each with its own context, in two kinds:

- **`subagent`**: headless children. One call runs several in parallel (`count` repeats a task) and
  waits for every one.
- **`subagent_tab`**: a child in a background Rex tab. The call returns at once, the child keeps
  working while the parent does other things, and you can watch it or type into it.

The tool descriptions say what each one does and what it costs, not when to use it: that's the
agent's call.

## `subagent`: headless, waits for every child

```
subagent { agent: "scout", brief: "…Return exactly: 1) … 2) …", tasks: ["Feature doc: features/a.md", "Feature doc: features/b.md"] }
subagent { agent: "worker", tasks: ["Run the integration tests once and report pass or fail with the failing test names"], count: 5 }
```

| Parameter | Effect |
|---|---|
| `tasks` | One standalone task per child |
| `brief` | Instructions put before every task, such as the exact return shape |
| `count` | Run each task this many times; each copy is told it's copy i of N |
| `agent` | `scout` or `worker` (the default) |
| `cwd` | Working directory for every child; default the parent's |
| `model`, `thinking` | Run on something else; see [Models](#models) |

Each child is `pi --mode json -p` with the parent's environment, so it gets the same API keys and
profile. At most 8 run at once across all calls in one pi, and a call takes up to 32 runs. The tool
row shows each child's state and current tool call (Ctrl+O shows the start of each answer). The
result has every child's final answer, sharing a 50,000-character budget with at least 2,000 each, and
the transcript path for the rest. Usage from the children is added to the parent's totals, also when
Escape cancels the call. Escape kills every child's process group, so whatever its tools started goes
too, and quitting the parent kills any still running.

Children share the parent's checkout. Don't give several of them writing tasks on the same files;
the worker agent writes only in its cwd and its scratch directory unless the task says otherwise.

## `subagent_tab`: a child in a Rex tab

| Action | Effect |
|---|---|
| `spawn {name, task, agent?, cwd?, isolate?, report?, model?, thinking?}` | Open a background tab `sub:<name>` in this Rex session running an interactive pi, and return its id at once |
| `send {id, message, followUp?}` | An idle child starts a new turn; a busy one is steered, or with `followUp` gets the message when it finishes. Skill commands and prompt templates expand as if typed; an extension command such as `/review` reaches the child's model as text, and it has the same tools |
| `wait {id?, timeout?}` | Block until the child, or every running child of this session, is idle with nothing queued, then return its last answer. A tab that hasn't started its task 90 seconds after its tab opened counts as done, with a pointer to its tab, where it may be waiting at a prompt or show why its pi failed. Default timeout 30 minutes; Escape stops waiting, not the child |
| `stop {id}` | Close the tab, which ends its pi |
| `list` | This session's tabs and their states |

You can type into the tab yourself; it's an ordinary pi session (named `subagent <name>`). The
`subagents:` line below the editor shows each running tab as `name:busy` or `name:idle`, and
`/subagents` lists this session's tabs to switch Rex to one (needs Remote Control) or stop it.

Tabs keep running through `/reload`, `/new`, and quitting the parent. Resume the parent's session and
the widget, `list`, and `wait` find them again: `spawn` returns the tab's id in its tool result's
details, and the session rebuilds its list from those. At most 12 run per parent session. Outside Rex,
`subagent_tab` refuses.

The tab starts through `$SHELL`'s login environment with its interactive startup files, like a tab you
open, which is where the proxy key comes from (`~/.zshrc` sources `~/.config/beta/proxy.env`).
`PI_PROFILE` carries the parent's profile over. The parent loads `child.ts` into the tab's pi with
`-e`: it records busy, idle, and the latest answer for `wait`, and turns messages the parent leaves in
the inbox into prompts.

**`report: true`** has the tab send its parent each new answer when it finishes a turn, so the parent
doesn't need to `wait`. The report carries the first 4,000 characters of the answer; `wait` returns all
of it.

- **Spawned by the main agent** (`../agent-state`): the report is a note in the main agent's state repo
  (`reportTo` in `meta.json`), read with your next message. These tabs belong to the main agent rather
  than to one session: every main-agent session lists the live ones and gets their reports, so `/new`
  and restarts lose nothing.
- **Spawned by any other session:** it goes over the parent's session socket (`../session-info`, "Live
  sessions"). An idle parent starts a turn on it, a busy one gets it as a follow-up. A parent that
  isn't listening (between sessions, restarting) gets it on a retry every 10 seconds while the tab is
  idle; a parent that never comes back still has `wait`.

### Isolation

`isolate: true` gives the child its own checkout of `cwd`'s repository, in the run directory:

- **jj**: `jj workspace add -r @`, so the child starts on top of the parent's working-copy change.
  If the parent keeps editing, jj rebases the child's change and the child may need
  `jj workspace update-stale`; its brief says so.
- **git**: `git worktree add -b subagent-<name>-<id> … HEAD`. Uncommitted changes in the parent's
  checkout aren't in it.

`stop` never deletes a checkout. It says where the work is and how to remove the checkout when you're
done.

## Agents

Markdown files in `agents/`, with the instructions appended to pi's system prompt:

| Agent | Tools | Skills |
|---|---|---|
| `scout` | read, grep, find, ls; no MCP | no |
| `worker` | pi's defaults (read, bash, edit, write) | yes |

Frontmatter: `name`, `description`, optional `tools` (comma-separated), and `skills: false`. A new
file in `agents/` is a new agent after `/reload`. Every child also gets a short preamble: it's a
subagent, it can't see the parent's conversation, and its last message is its result.

## Models

A child runs on the parent's provider, model, and thinking level. The active profile
(`../profiles.ts`) already picked that model, so work children bill to Bedrock and personal children
to the subscriptions. To run an agent on something else, add it to `~/.pi/agent/settings.json`, per
profile like `review`, with a top-level fallback:

```json
"profiles": {
  "work": { "subagents": { "scout": { "model": "openai/gpt-6-luna", "thinking": "high" } } },
  "personal": { "subagents": { "scout": { "model": "claude-code/claude-sonnet-5-5" } } }
},
"subagents": { "worker": { "thinking": "high" } }
```

The call's `model` and `thinking` win over the profile's entry, which wins over the top-level one. A
bare model id means the parent's provider. A thinking level goes with the model it was configured
with; one configured alone applies to the parent's model. A model that isn't the parent's must be in
the catalog (after one refresh, for the proxy) and have credentials, or the call fails before any
child starts and lists close matches.

## Files

Every child gets `~/.pi/agent/subagents/<id>/`. A headless child has only `session.jsonl` and
`scratch/`; the tool result names each one's id.

| File | Written by | Holds |
|---|---|---|
| `session.jsonl` | the child's pi | the full transcript, and the answer if the parent is gone |
| `scratch/` | child | its own files, and its `PI_TODO_PATH` |
| `meta.json` | parent, tabs only | name, agent, model, cwd, parent session, whether it reports, Rex tab, checkout, stop time |
| `state.json` | the tab's pi | busy, idle, or exited; pid; whether it started; its latest answer |
| `inbox/` | parent, tabs only | messages waiting for the tab |
| `checkout/` | parent | the isolated workspace or worktree |

Nothing is pruned yet.

## Limits and safety

- No nesting: with `PI_SUBAGENT_DIR` set, this extension registers nothing, and
  `../rex-session.ts` doesn't ask a tab child to rename your Rex session.
- A child working in the parent's own directory, or an isolated checkout of it, takes the parent's
  project trust decision (`--approve` or `--no-approve`), so a tab doesn't stop at pi's trust prompt
  in a checkout with `.pi` or `.agents/skills`. A child anywhere else, subdirectories included, gets
  the decision pi makes for that directory.
- Tabs only end with `stop`, `/subagents`, or closing the tab.

## Not in v1

Headless children that run in the background and report back; suspending tabs when the parent quits
and resuming them with it; project-local or user agent directories; chained runs (call twice);
isolation for headless swarms; nested subagents; pruning old runs; tabs on other Rex hosts. After a
`rex-restart`, a tab comes back as its saved screen, not a running pi (`../../rex/pi/rex-restart.ts`
skips recording subagent tabs, which `pi --session` alone would reopen half-configured).

## Tests

```
node --test ~/dotfiles/pi/extensions/subagent/
```
