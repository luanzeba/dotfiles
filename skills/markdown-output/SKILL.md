---
name: markdown-output
description: Format and deliver Markdown for GitHub and GitLab issues, pull or merge requests, reviews, comments, and discussions. Use when producing content that will be posted to either platform, when the user asks for copy/paste-ready Markdown, or when creating Markdown files.
---

# Markdown Output

## Delivery method

Determine where the content is going before formatting or posting it:

1. **GitHub:** use `gh` for issues, PRs, reviews, and comments.
2. **GitLab:** use `glab` for issues, MRs, discussions, pipelines, and comments. Use the `gitlab-mr-review` skill when comments must remain pending.
3. **Local file:** use the file tools and give the user the path.
4. **Manual paste:** copy to the clipboard only when the user needs to paste the content themselves.

For clipboard delivery, use a quoted heredoc so Markdown is not expanded by the shell:

```bash
# macOS
cat << 'EOF' | pbcopy
content here
EOF

# Linux
cat << 'EOF' | xclip -selection clipboard
content here
EOF
```

Do not post, submit, or publish review content when the user asked only for a draft.

## Review comment code

Use an exact suggestion fence only when the replacement is directly applicable at that location:

````markdown
```suggestion
const corrected = code;
```
````

Use a normal language-tagged fence when the example is shortened, approximate, spans files, or needs author input:

````markdown
Roughly:

```ts
const expectedShape = buildValue(input);
// ...
```
````

Never put approximate code in a suggestion fence. It may be applied as if it were complete.

## Code blocks

Always specify a language hint such as `ts`, `tsx`, `ruby`, `sql`, `json`, or `bash`.

JSON blocks must contain valid JSON with quoted keys and string values:

```json
{"my_policy": "enabled", "count": 42}
```

## Collapsible sections

GitHub and GitLab require blank lines around content inside `<details>` blocks:

```markdown
<details>

<summary>Click to expand</summary>

Content inside the collapsible section.

</details>
```

## Tables

Leave a blank line before and after a table:

```markdown
Some text above.

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |

Some text below.
```

## Alerts

GitHub supports alert callouts using blockquote syntax:

```markdown
> [!NOTE]
> Useful information that users should know.
```

Do not assume platform-specific alert rendering on GitLab. Use a normal blockquote or bold label when portability matters.
