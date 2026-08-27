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
6. Draft comments using `../evidence-based-responses/SKILL.md` and `../voice-and-tone/SKILL.md`. When `write_for_publication` is available, use it to polish each verified comment. If it is not available, revise each comment yourself.
7. Re-fetch the MR head and current diff after drafting. If the hunk changed, remap the comment before posting it.
8. Record the current head SHA and the current user's published-note count before mutating anything.
9. For each new inline draft, capture the target line's rendered GitLab diff anchor and add it with `scripts/draft-notes.py`. Update only drafts whose stored range passes verification.
10. Verify the expected draft count, positioned comments with stored inline ranges, unchanged head SHA, and unchanged published-note count.
11. When inline visibility matters, open the rendered diff at each captured anchor and confirm the draft text appears before reporting completion.
12. Report what remains pending. Do not submit it.

## Inspect the MR

```bash
PROJECT='group%2Fproject'
IID=123
HOST='gitlab.example.com'

glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID"
glab api --hostname "$HOST" "projects/$PROJECT/merge_requests/$IID/changes?access_raw_diffs=true"
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

### Capture the rendered diff anchor

GitLab's REST change payload does not always use the same line alignment as the rendered Changes view. Before creating an inline draft, use the GitLab UI to inspect the exact target line and copy its DOM `id`, which is a value such as `<file-hash>_108_115`. The target line's draft composer exposes the same value as `form[data-line-code]`; cancel the empty composer after reading it. Load the `web-browser` skill first when browser automation is needed.

Pass that value as `--line-code`. The helper sends it in `position.line_range` and rejects a response that drops or changes that range. If a browser is unavailable, stop before creating the inline draft rather than guessing an anchor.

Run these commands from the skill directory (or replace `./scripts/draft-notes.py` with its absolute path):

```bash
MR_URL='https://gitlab.example.com/group/project/-/merge_requests/123'
HEAD_SHA='<full current head SHA>'
LINE_CODE='<rendered GitLab line id, for example: 0123...abcd_108_42>'

# Capture the baseline before adding anything.
./scripts/draft-notes.py verify "$MR_URL" --json

# Add a comment to a new-side line.
./scripts/draft-notes.py add "$MR_URL" \
  --file src/example.ts \
  --new-line 42 \
  --line-code "$LINE_CODE" \
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

A draft count alone does not prove an inline note is visible. `verify` reports `renderable_draft_count`, which validates the stored range. When visibility matters, also check the rendered Changes view at the captured anchor. If either check fails, do not publish or recreate blindly. Re-read the current diff and capture its current line anchor.

## Raw API fallback

Read `references/gitlab-api.md` before creating or updating draft notes manually. In particular, preserve the existing `position` and `line_range`, because GitLab can clear either when an update omits them.
