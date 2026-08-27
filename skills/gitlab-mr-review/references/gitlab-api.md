# GitLab MR API Reference

Load this reference when the helper cannot cover a GitLab review operation or when debugging draft-note positions.

## Identify the MR

For:

```text
https://gitlab.example.com/group/subgroup/project/-/merge_requests/123
```

Use:

```text
Host: gitlab.example.com
Project: group/subgroup/project
Encoded project: group%2Fsubgroup%2Fproject
IID: 123
```

Always pass `--hostname` to `glab api` for non-default GitLab instances.

## Read-only endpoints

```bash
BASE='projects/group%2Fsubgroup%2Fproject/merge_requests/123'
HOST='gitlab.example.com'

glab api --hostname "$HOST" "$BASE"
glab api --hostname "$HOST" "$BASE/changes?access_raw_diffs=true"
glab api --hostname "$HOST" "$BASE/commits"
glab api --hostname "$HOST" "$BASE/discussions?per_page=100"
glab api --hostname "$HOST" "$BASE/notes?per_page=100"
glab api --hostname "$HOST" "$BASE/draft_notes?per_page=100"
```

The MR response provides the required position SHAs:

```json
{
  "diff_refs": {
    "base_sha": "...",
    "start_sha": "...",
    "head_sha": "..."
  }
}
```

Use the MR's current `sha` to detect branch updates before mutating drafts.

## Pipelines and jobs

Read the MR's `head_pipeline.id`, then inspect jobs:

```bash
glab api --hostname "$HOST" \
  "projects/group%2Fsubgroup%2Fproject/pipelines/<pipeline-id>/jobs?per_page=100"
```

Read a job or trace through the project job endpoints. Do not claim local verification when only the remote pipeline ran.

## Add a positioned draft note

Use the Draft Notes endpoint, not the regular Notes endpoint:

```http
POST /projects/:id/merge_requests/:iid/draft_notes
```

Example JSON for an added line. Capture `line_code` from the exact rendered diff line, do not derive it from the REST `changes` patch:

```json
{
  "note": "The review comment in Markdown.",
  "position": {
    "position_type": "text",
    "base_sha": "<base_sha>",
    "start_sha": "<start_sha>",
    "head_sha": "<head_sha>",
    "old_path": "src/example.ts",
    "new_path": "src/example.ts",
    "new_line": 42,
    "line_range": {
      "start": {
        "line_code": "<rendered-diff-line-id>",
        "type": "new",
        "old_line": null,
        "new_line": 42
      },
      "end": {
        "line_code": "<rendered-diff-line-id>",
        "type": "new",
        "old_line": null,
        "new_line": 42
      }
    }
  }
}
```

GitLab can align a changed block differently in `/changes` and in the Changes UI. A position with only `new_line` may receive a different server-side `line_code`, leaving it listed under **Your review** but absent from the inline diff. Use the helper's `--line-code` or GitLab's draft composer, which creates this range automatically.

Send JSON explicitly:

```bash
glab api --hostname "$HOST" --method POST \
  -H 'Content-Type: application/json' \
  "$BASE/draft_notes" \
  --input /tmp/draft-note.json
```

For a removed line, use `old_line` and a rendered old-side anchor (`type: "old"`). For a context line, GitLab may include both `old_line` and `new_line`. Use the paths from the changed-file response so renamed files remain positioned correctly.

## Update a draft note safely

```http
PUT /projects/:id/merge_requests/:iid/draft_notes/:draft_note_id
```

First fetch the existing draft. Then resend its complete `position` object with the revised body:

```json
{
  "note": "Revised Markdown.",
  "position": {
    "position_type": "text",
    "base_sha": "<existing base_sha>",
    "start_sha": "<existing start_sha>",
    "head_sha": "<existing head_sha>",
    "old_path": "<existing old_path>",
    "new_path": "<existing new_path>",
    "new_line": 42
  }
}
```

The example omits `line_range` only for brevity. Preserve the exact existing `line_range` object when updating a positioned draft.

**Do not send only `note`.** GitLab can clear the structured position fields when the update omits `position`, leaving a draft that no longer appears on the intended line. Preserve the complete `line_range` too.

Refuse the update if the draft's `head_sha` differs from the MR's current SHA. Re-read the new diff and recreate the draft at its new location.

## Verify pending state

After mutations:

1. Fetch all draft notes.
2. Confirm the expected count.
3. Confirm every inline draft has a path, old/new line, `line_range`, and matching top-level `line_code`.
4. Fetch regular MR notes and confirm the current user's published count did not increase.
5. Re-fetch the MR and confirm its head SHA did not change during the review.

A draft shown under **Your review → drafts** but absent from Changes can have an invalid or missing `line_range`. Inspect the stored `line_code` and the rendered target line before recreating it. A valid stored range still needs a rendered-UI check when inline visibility matters.

## Never publish implicitly

GitLab exposes a bulk-publish endpoint for draft notes. Do not call it during review preparation. Only submit through an explicit user-requested action after showing what will be published.

The helper script intentionally does not implement publishing.
