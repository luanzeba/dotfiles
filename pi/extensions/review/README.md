# /review

Have a different model read the change and try to delete code.

The model that wrote the code does not see its own over-engineering. A second model with an
explicit deletion mandate does, especially one required to prove each claim by running an
experiment rather than asserting it.

## Use

```
/review                      review my uncommitted changes
/review --branch             review my branch against its merge base
/review !384                 review GitLab merge request 384
/review <merge-request-url>  same, from anywhere
/review focus on the caching add steering text to any of the above
```

Findings come back as a message in the current session. For a GitLab merge request, the
current session validates each actionable finding against the current diff and leaves valid,
positioned comments as pending drafts automatically. It never submits, publishes, approves,
or resolves a review. Local reviews still only return findings.

Run it again after addressing the findings. The reviewer keeps its own session per change,
so later rounds say which findings were addressed, which remain, and withdraw anything it
got wrong.

## What carries over between rounds

Each change gets one reviewer session, resumed by id. The whole prior conversation comes
back: its earlier findings, its reasoning, every file it read, and the output of every command
it ran. So round 2 knows it already checked something and does not re-derive it, and it can
say "unchanged from round 1" because it still has round 1 in front of it.

What it gets *fresh* each round is the diff and the tree, so it always judges current code
against its own earlier conclusions.

The cost is that these sessions only grow, and tool output dominates: a couple of rounds on a
real merge request is already a few hundred KB. When a reviewer has drifted, or is anchored on
a design you have since replaced wholesale, `--fresh` starts a new conversation and leaves the
old one on disk. That choice sticks: later plain `/review` runs continue the new session
rather than resurrecting the abandoned one.

```
~/.cache/pi-review/sessions/
  <timestamp>_pi-review-<key>.jsonl   the transcript
  pi-review-<key>.current             which one later rounds resume
```

| Flag | Effect |
|---|---|
| `--branch` | Compare the whole branch instead of just uncommitted work |
| `--fresh` | Start a new reviewer conversation, forgetting earlier rounds |
| `--model <spec>` | Override the configured reviewer for one run |
| `--force` | Allow the reviewer model to equal the active model |
| `--setup` | Pick and save the reviewer model |

## Local and remote never mix

The argument decides everything:

- **No argument** reviews your working tree, in place, without copying anything.
- **A URL or `!number`** reviews that merge request from a downloaded snapshot of its head
  commit, cached by SHA under `~/.cache/pi-review/`.

You are usually mid-change on your own work when someone asks you to review their merge
request, so remote review never reads your working tree and never mentions your local work.
A snapshot cannot reach your checkout even by accident, and re-reviewing the same head costs
nothing while a force-push naturally produces a fresh copy.

The snapshot has no git history, so the reviewer sees the head tree plus the diff, not the
base tree. That has been enough so far; if a review ever needs the "before" state of a file
that the diff does not show, this is the thing to revisit.

## Reviewer model

Set once per machine, because the same intent needs different text in different places: on a
proxied setup the Claude models carry Bedrock-style ids under a different provider than
upstream Anthropic.

```
/review --setup
```

writes to `~/.pi/agent/settings.json` (a gitignored per-machine file here):

```json
{ "review": { "model": "provider/model-id", "thinking": "high" } }
```

If nothing is configured, `/review` refuses instead of guessing. Guessing "some model other
than the current one" is how you name a model whose provider reports itself ready but cannot
serve it, and get a 401 partway through a review. Before spawning anything it checks that the
model exists here, that its provider authenticates, and that it differs from the model doing
the implementing.

## Files

```
agents/simplifier.md              the mandate: what to hunt, and the duty to prove claims
extensions/review/index.ts        the /review command
extensions/review/model.ts        reviewer model config and its checks
extensions/review/runner.ts       spawns pi with a per-change session for round memory
extensions/review/sources/
  types.ts        the one shape everything downstream consumes
  git.ts          local git changes
  gitlab.ts       a merge request, via glab
  materialize.ts  snapshot cache for a remote commit
```

Everything after "what am I reviewing?" sees only `ChangeSet` and cannot tell local from
remote. Adding another kind of review (jj, GitHub PRs, a patch file) means adding one file
under `sources/` and choosing it in `index.ts`.

## Why a separate process

The reviewer runs as its own `pi` process so it can use a different model with its own
provider auth, get its own context window, and keep a session across rounds. It runs with
`--no-skills` and `--no-context-files`: skills in this setup include one that posts merge
request drafts, and the reviewer must stay read-only. The parent session handles pending
drafts after it validates the findings.

Extension discovery stays enabled, deliberately. Provider registration happens in an
extension here, so `--no-extensions` leaves the child with no way to authenticate the very
model it was told to use. Read-only is enforced by the tool allowlist and the mandate.

The child runs in `--mode text`, so its stdout is exactly the findings text.
