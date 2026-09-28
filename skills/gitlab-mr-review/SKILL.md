---
name: gitlab-mr-review
description: Review GitLab merge requests with glab. Inspect metadata, diffs, discussions, pipelines, and repository code; create or revise pending inline draft notes; and verify nothing was published. Use whenever a GitLab MR URL is provided or the user asks to review, comment on, or inspect a GitLab merge request.
---

# GitLab Merge Request Review

Use `glab` for GitLab repository and merge request data. Use browser automation only when the task requires inspecting a rendered UI.

## Safety rules

- Leave comments as draft notes when the user asks for pending comments or an unsubmitted review.
- Never approve, submit, publish, or bulk-publish a review without explicit permission.
- Re-fetch the MR head SHA before every draft-note mutation.
- Never put a GitLab token in a clone URL, command, file, or response.
- Read existing discussions, including resolved threads, before adding comments so feedback is not repeated.
- If the user asks what a draft means, explain it without editing the draft unless they also ask for an update.

## Review workflow

1. Parse the MR URL into hostname, project path, and IID.
2. Confirm authentication with `glab auth status` for that hostname.
3. Fetch MR metadata, `diff_refs`, changed files, discussions, existing draft notes, and pipeline status.
4. Read repository instructions, the complete changed files, relevant callers, and tests. Do not review from the patch alone.
5. Check whether the same behavior appears in alternate components or code paths.
6. Draft comments using `../evidence-based-responses/SKILL.md` and `../voice-and-tone/SKILL.md`. Use voice for casual, direct prose; evidence rules still require a self-contained explanation instead of investigation narration.
7. Re-fetch the MR head and current diff after drafting. If the hunk changed, remap the comment before posting it.
8. Record the current head SHA and the current user's published-note count before mutating anything.
9. Add or update draft notes with `scripts/draft-notes.py`.
10. Verify the expected draft count, positioned comments, unchanged head SHA, and unchanged published-note count.
11. Report what remains pending. Do not submit it.

## Inspect the MR

```bash
PROJECT='group%2Fproject'
IID=123
HOST='gitlab.example.com'

glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID"
glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID/changes"
glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID/discussions?per_page=100"
glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID/draft_notes?per_page=100"
```

Inspect pipelines through the MR's `head_pipeline` and the project pipeline/jobs endpoints. See `references/gitlab-api.md` for endpoint examples and raw payload details.

## Get the source safely

Prefer an existing local checkout. Fetch refs without changing the user's branch.

If Git authentication is unavailable, download source archives through authenticated `glab api` calls rather than embedding credentials in Git URLs:

```bash
glab api --hostname "$HOST" \
  "projects/$PROJECT/repository/archive.tar.gz?sha=$HEAD_SHA" \
  > /tmp/mr-head.tar.gz
```

Use separate temporary directories for base and head when the review needs full source comparison.

## Manage pending comments

The helper intentionally has no publish command.

Run these commands from the skill directory (or replace `./scripts/draft-notes.py` with its absolute path):

```bash
MR_URL='https://gitlab.example.com/group/project/-/merge_requests/123'
HEAD_SHA='<full current head SHA>'

# Capture the baseline before adding anything.
./scripts/draft-notes.py verify "$MR_URL" --json

# Add a comment to a new-side line.
./scripts/draft-notes.py add "$MR_URL" \
  --file src/example.ts \
  --new-line 42 \
  --body-file /tmp/comment.md \
  --expected-head "$HEAD_SHA"

# Revise a pending comment without losing its diff position.
./scripts/draft-notes.py update "$MR_URL" 456 \
  --body-file /tmp/revised-comment.md \
  --expected-head "$HEAD_SHA"

# Verify that drafts remain positioned and nothing was published.
./scripts/draft-notes.py verify "$MR_URL" \
  --expected-head "$HEAD_SHA" \
  --expected-drafts 3 \
  --expected-published-count 0
```

Use the published-note count from the initial `verify` call as the final expected value. It may already be nonzero on MRs where the reviewer previously commented.

GitLab may hide pending comments under **Your review → drafts** instead of rendering them inline immediately. Use the API or helper output as the source of truth.

## Raw API fallback

Read `references/gitlab-api.md` before creating or updating draft notes manually. In particular, GitLab clears diff-position fields when an update omits the existing `position` object.
