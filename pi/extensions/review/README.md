# /review

Have a reviewer model review a change twice, with independent contexts:

1. **Simplification and redesign** — assume the AI-written implementation may be unnecessary or
   drastically overbuilt. Find every worthwhile deletion, collapse, reuse, or better overall design.
2. **Correctness and regressions** — look separately for bugs, unsafe behavior, and broken contracts
   without getting distracted by optional cleanup.

Both reviews run in parallel. There is no findings quota and no review-wide time cutoff. Zero findings
is a successful result, especially after earlier rounds have been addressed; neither reviewer should
invent replacement nits merely to return something. The parent editor stays usable; Escape still
interrupts the parent, while Ctrl+Shift+R cancels the review. The footer shows elapsed time and
both reviewers' current phases (`simplify` and `correct`): waiting, planning, reviewing, done,
failed, or cancelled. The timer updates every 30 seconds even while a reviewer
is waiting on a model response. There is no percentage or ETA because investigation and inference
times cannot be counted reliably in advance.

## Use

```
/review                                      review my uncommitted changes here
/review maintenance/.worktrees/task         review uncommitted changes in that worktree
/review --branch ~/beta/maintenance/.worktrees/task
                                             review that worktree's branch against its merge base
/review !384                                 review GitLab merge request 384
/review <merge-request-url>                  same, from anywhere
/review focus on the caching                 add steering text to both reviews
/review --focus git handling is too clever   force text that starts with an existing directory name
```

Findings come back to the current session in two sections. For a GitLab merge request, the
current session validates each actionable finding and leaves the valid, positioned comments as
pending drafts. When `write_for_publication` is available, it uses the tool to word those comments.
It never submits, publishes, approves, or resolves a review. Local reviews only return findings for
the parent session to verify and address. If one reviewer fails or is cancelled, a completed report still returns and the other section
says what happened; a later round can retry it.

## What each reviewer receives

A review should not begin by reverse-engineering why the code exists. The brief includes:

- The changed-file list and unified diff
- The MR title, description, commit messages, pipeline status, and existing comments for remote work
- The title and description of a Linear ticket named by the branch, MR title, or an explicit
  Linear URL, when an authenticated Linear tab is already open
- Recent user requests and implementation summaries from the parent Pi session for local work,
  or when that context names the remote MR or its ticket
- Checks the parent or CI already reported as complete
- Final findings from the same reviewer in the previous round
- Any extra focus supplied with `/review`

The parent context is especially useful for agent-created worktrees: it normally contains the original
request, implementation decisions, limitations, and the exact tests already run. Ticket enrichment is
best effort and never opens Chrome or a Linear tab just to run a review.

## How a review runs

Each reviewer gets a fresh Pi session and works in two explicit steps.

### 1. Understand the whole change

The first turn has no tools. The reviewer reads the brief and diff and makes a concise coverage plan
for every changed area. This prevents an early deep dive from consuming the review before the rest of
the diff has been seen. The plan is not a boundary: it does not limit later investigation or findings.

### 2. Perform the complete review

The same session resumes with read-only tools. The reviewer works through every changed area and may
inspect callers, related implementations, installed dependencies, and nearby architecture as deeply
as needed. The simplifier may propose an end-to-end redesign rather than restricting itself to edited
lines. Reviewers may follow new concerns revealed by the evidence and report every meaningful finding.

They stay centered on complexity or behavior introduced by the change rather than auditing unrelated
pre-existing code.

Broad tests, builds, typechecks, lint, and CI already listed in the brief are not rerun. A reviewer may
run a targeted command when it answers a concrete review question. Every bash command must have a
timeout, searches stay inside the reviewed repository, and filesystem-wide commands such as `find /`
are prohibited. The reviewers are allowed to finish naturally; there is no replacement for the old
30-minute process timeout.

## Repeated rounds without repeated baggage

Run `/review` again after addressing findings. Each new round receives the previous final
simplification and correctness reports, so the reviewers can say what was addressed, what remains, and
what they should withdraw. They then review the whole current change again.

Only final reports carry forward. Old greps, test output, failed experiments, and internal tool chatter
do not enter the next round's context. This preserves useful memory without making every round larger
and slower.

```
~/.cache/pi-review/
  history/<review-key>-simplification.md     simplification report for the next round
  history/<review-key>-correctness.md        correctness report for the next round
  sessions/<timestamp>_<review-session>.jsonl
                                             full per-pass transcripts for inspection
```

`--fresh` removes the compact prior reports before starting. Later plain `/review` runs continue from
the reports produced by that fresh round.

| Flag | Effect |
|---|---|
| `--branch` | Compare the whole branch instead of just uncommitted work |
| `--path <directory>` | Explicitly treat the next argument as the git directory to review |
| `--focus <text>` | Explicitly treat the rest as review guidance, even when its first word is a directory |
| `--fresh` | Forget both reviewers' prior final reports for this change |
| `--model <spec>` | Override the configured reviewer model for one run |
| `--setup` | Pick and save the reviewer model |

## Local and remote never mix

The argument decides the source:

- **No argument** reviews the current working tree in place.
- **A directory** reviews that working tree instead. Absolute, home-relative, and ordinary relative
  paths work; `--path` is available when positional text would be ambiguous.
- **A URL or `!number`** reviews that merge request from a downloaded snapshot of its head commit,
  cached by SHA under `~/.cache/pi-review/`.

You are often mid-change on your own work when someone asks for an MR review, so a remote review never
reads the current working tree or mentions local work. The snapshot has no git history; the reviewer
receives the base-to-head diff, MR context, and head files.

## Reviewer model

Set the model once per machine:

```
/review --setup
```

This writes the gitignored per-machine setting in `~/.pi/agent/settings.json`:

```json
{ "review": { "model": "provider/model-id", "thinking": "xhigh" } }
```

If nothing is configured, `/review` refuses instead of guessing. Before starting, it verifies that the
model exists and its provider authenticates. The reviewer may be the same model as the active session.

## Files

```
extensions/review/
  prompts/reviewer.md               shared read-only workflow and command boundaries
  prompts/simplifier.md             simplification and redesign mandate
  prompts/correctness-reviewer.md   correctness and regression mandate
  context.ts                        recent parent-session context
  index.ts                          command routing and parent handoff
  model.ts                          reviewer model configuration and checks
  runner.ts                         parallel two-step reviewers and compact round history
  sources/
    types.ts                        shared change shape
    git.ts                          local working tree or branch
    gitlab.ts                       GitLab MR metadata, diff, comments, commits, and snapshot
    linear.ts                       linked-ticket context
    materialize.ts                  remote snapshot cache
```

The prompt files above are the source of truth for reviewer behavior. The child sessions use
`--no-skills` and `--no-context-files`; skills and repository instructions can contain mutation or
publishing workflows, so the reviewers instead receive a curated brief and shared read-only mandate.
Extension discovery remains enabled because the configured model provider may be registered by an
extension.
