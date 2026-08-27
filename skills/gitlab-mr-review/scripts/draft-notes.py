#!/usr/bin/env python3
"""Safely create and update pending GitLab merge request draft notes.

Publishing is intentionally unsupported. Use GitLab's UI only after the user
explicitly asks to submit the review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


class ReviewError(RuntimeError):
    pass


@dataclass(frozen=True)
class MergeRequest:
    url: str
    host: str
    project: str
    iid: int

    @property
    def endpoint(self) -> str:
        return f"projects/{quote(self.project, safe='')}/merge_requests/{self.iid}"


def parse_mr_url(value: str) -> MergeRequest:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ReviewError("expected a full GitLab merge request URL")

    marker = "/-/merge_requests/"
    path = parsed.path.rstrip("/")
    if marker not in path:
        raise ReviewError("expected a URL containing /-/merge_requests/<iid>")

    project_path, iid_path = path.split(marker, 1)
    iid_text = iid_path.split("/", 1)[0]
    if not iid_text.isdigit():
        raise ReviewError("could not parse the merge request IID from the URL")

    project = unquote(project_path.strip("/"))
    if not project:
        raise ReviewError("could not parse the project path from the URL")

    return MergeRequest(value, parsed.hostname, project, int(iid_text))


def glab_api(
    mr: MergeRequest,
    endpoint: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> Any:
    command = ["glab", "api", "--hostname", mr.host, "--method", method]
    payload_path: str | None = None

    try:
        if payload is not None:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".json", delete=False
            ) as payload_file:
                json.dump(payload, payload_file)
                payload_path = payload_file.name
            command.extend(
                ["-H", "Content-Type: application/json", "--input", payload_path]
            )
        command.append(endpoint)

        result = subprocess.run(command, text=True, capture_output=True, check=False)
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            raise ReviewError(f"glab api failed: {detail}")
        if not result.stdout.strip():
            return None
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ReviewError("glab api returned invalid JSON") from error
    finally:
        if payload_path:
            Path(payload_path).unlink(missing_ok=True)


def paginated_get(mr: MergeRequest, endpoint: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        separator = "&" if "?" in endpoint else "?"
        batch = glab_api(
            mr, f"{endpoint}{separator}per_page=100&page={page}", method="GET"
        )
        if not isinstance(batch, list):
            raise ReviewError(f"expected an array from {endpoint}")
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def mr_details(mr: MergeRequest) -> dict[str, Any]:
    details = glab_api(mr, mr.endpoint)
    if not isinstance(details, dict):
        raise ReviewError("could not read merge request details")
    return details


def require_head(details: dict[str, Any], expected_head: str) -> None:
    current_head = details.get("sha")
    if current_head != expected_head:
        raise ReviewError(
            "merge request head changed: "
            f"expected {expected_head}, current head is {current_head}. "
            "Reload the diff and remap comments before mutating drafts."
        )


def read_body(path: str) -> str:
    body = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    if not body.strip():
        raise ReviewError("comment body is empty")
    return body.rstrip()


HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def diff_line_maps(diff: str) -> tuple[dict[int, int | None], dict[int, int | None]]:
    """Return new->old and old->new line maps for lines visible in a diff."""
    new_to_old: dict[int, int | None] = {}
    old_to_new: dict[int, int | None] = {}
    old_line: int | None = None
    new_line: int | None = None

    for text in diff.splitlines():
        header = HUNK_HEADER.match(text)
        if header:
            old_line, new_line = map(int, header.groups())
            continue
        if old_line is None or new_line is None or text.startswith("\\ No newline"):
            continue
        if text.startswith("+"):
            new_to_old[new_line] = None
            new_line += 1
        elif text.startswith("-"):
            old_to_new[old_line] = None
            old_line += 1
        else:
            new_to_old[new_line] = old_line
            old_to_new[old_line] = new_line
            old_line += 1
            new_line += 1

    return new_to_old, old_to_new


def find_change(
    changes: list[dict[str, Any]], file_path: str, side: str
) -> dict[str, Any]:
    key = "new_path" if side == "new" else "old_path"
    matches = [change for change in changes if change.get(key) == file_path]
    if len(matches) != 1:
        raise ReviewError(
            f"expected exactly one changed file matching {file_path!r} on the {side} side"
        )
    return matches[0]


def load_changes(mr: MergeRequest) -> list[dict[str, Any]]:
    response = glab_api(mr, f"{mr.endpoint}/changes?access_raw_diffs=true")
    if not isinstance(response, dict) or not isinstance(response.get("changes"), list):
        raise ReviewError("could not read merge request changes")
    if response.get("overflow"):
        raise ReviewError(
            "GitLab reports an incomplete diff. Review the file manually before positioning comments."
        )
    return response["changes"]


LINE_CODE = re.compile(r"^[0-9a-f]{40}_(\d+)_(\d+)$")


def make_line_range(
    line_code: str,
    side: str,
    old_line: int | None,
    new_line: int | None,
) -> dict[str, Any]:
    match = LINE_CODE.fullmatch(line_code)
    if not match:
        raise ReviewError("line code must be a GitLab diff anchor")

    old_anchor, new_anchor = map(int, match.groups())
    if side == "new" and new_line != new_anchor:
        raise ReviewError("line code does not match the requested new-side line")
    if side == "old" and old_line != old_anchor:
        raise ReviewError("line code does not match the requested old-side line")

    endpoint = {
        "line_code": line_code,
        "type": side,
        "old_line": old_line,
        "new_line": new_line,
    }
    return {"start": endpoint, "end": endpoint.copy()}


def line_range_start_code(position: dict[str, Any]) -> str | None:
    line_range = position.get("line_range")
    if not isinstance(line_range, dict):
        return None
    start = line_range.get("start")
    end = line_range.get("end")
    if not isinstance(start, dict) or not isinstance(end, dict):
        return None
    start_code = start.get("line_code")
    end_code = end.get("line_code")
    if not isinstance(start_code, str) or not isinstance(end_code, str):
        return None
    return start_code


def is_renderable_draft(draft: dict[str, Any]) -> bool:
    position = draft.get("position")
    if not isinstance(position, dict):
        return False
    if not (position.get("new_path") or position.get("old_path")):
        return False
    if position.get("new_line") is None and position.get("old_line") is None:
        return False
    line_code = line_range_start_code(position)
    return line_code is not None and draft.get("line_code") == line_code


def require_renderable_draft(
    response: Any, expected_position: dict[str, Any]
) -> None:
    expected_line_code = line_range_start_code(expected_position)
    if not expected_line_code:
        raise ReviewError("expected draft position has no inline line range")
    if not isinstance(response, dict) or not is_renderable_draft(response):
        raise ReviewError(
            "GitLab did not preserve a renderable inline line range for the draft"
        )
    if response.get("line_code") != expected_line_code:
        raise ReviewError(
            "GitLab returned a different inline line code for the draft position"
        )


def make_position(
    details: dict[str, Any],
    change: dict[str, Any],
    *,
    new_line: int | None,
    old_line: int | None,
    line_code: str,
) -> dict[str, Any]:
    diff = change.get("diff") or ""
    new_to_old, old_to_new = diff_line_maps(diff)

    if new_line is not None:
        if new_line not in new_to_old:
            raise ReviewError(
                f"new line {new_line} is not visible in the current diff for {change['new_path']}"
            )
        mapped_old = new_to_old[new_line]
        if mapped_old is not None:
            old_line = mapped_old
        side = "new"
    else:
        assert old_line is not None
        if old_line not in old_to_new:
            raise ReviewError(
                f"old line {old_line} is not visible in the current diff for {change['old_path']}"
            )
        mapped_new = old_to_new[old_line]
        if mapped_new is not None:
            new_line = mapped_new
        side = "old"

    refs = details.get("diff_refs") or {}
    required_refs = ("base_sha", "start_sha", "head_sha")
    if any(not refs.get(name) for name in required_refs):
        raise ReviewError("merge request diff refs are incomplete")

    position: dict[str, Any] = {
        "position_type": "text",
        "base_sha": refs["base_sha"],
        "start_sha": refs["start_sha"],
        "head_sha": refs["head_sha"],
        "old_path": change["old_path"],
        "new_path": change["new_path"],
    }
    if old_line is not None:
        position["old_line"] = old_line
    if new_line is not None:
        position["new_line"] = new_line
    position["line_range"] = make_line_range(line_code, side, old_line, new_line)
    return position


def command_list(args: argparse.Namespace) -> None:
    mr = parse_mr_url(args.mr_url)
    notes = paginated_get(mr, f"{mr.endpoint}/draft_notes")
    if args.json:
        print(json.dumps(notes, indent=2))
        return

    for note in notes:
        position = note.get("position") or {}
        path = position.get("new_path") or position.get("old_path") or "general"
        line = position.get("new_line") or position.get("old_line") or "-"
        summary = (note.get("note") or "").splitlines()[0]
        print(f"{note['id']}\t{path}:{line}\t{summary}")
    print(f"{len(notes)} draft note(s)")


def command_add(args: argparse.Namespace) -> None:
    mr = parse_mr_url(args.mr_url)
    details = mr_details(mr)
    require_head(details, args.expected_head)
    changes = load_changes(mr)
    side = "new" if args.new_line is not None else "old"
    change = find_change(changes, args.file, side)
    position = make_position(
        details,
        change,
        new_line=args.new_line,
        old_line=args.old_line,
        line_code=args.line_code,
    )
    response = glab_api(
        mr,
        f"{mr.endpoint}/draft_notes",
        method="POST",
        payload={"note": read_body(args.body_file), "position": position},
    )
    try:
        require_renderable_draft(response, position)
    except ReviewError as error:
        note_id = response.get("id") if isinstance(response, dict) else None
        if isinstance(note_id, int):
            cleanup_details = mr_details(mr)
            require_head(cleanup_details, args.expected_head)
            glab_api(mr, f"{mr.endpoint}/draft_notes/{note_id}", method="DELETE")
        raise ReviewError(f"{error}; removed the unrenderable draft") from error
    print(json.dumps(response, indent=2))


def command_update(args: argparse.Namespace) -> None:
    mr = parse_mr_url(args.mr_url)
    details = mr_details(mr)
    require_head(details, args.expected_head)
    endpoint = f"{mr.endpoint}/draft_notes/{args.note_id}"
    existing = glab_api(mr, endpoint)
    position = existing.get("position") if isinstance(existing, dict) else None
    if not isinstance(position, dict) or not position.get("head_sha"):
        raise ReviewError("draft note has no usable diff position")
    if not line_range_start_code(position):
        raise ReviewError(
            "draft note has no renderable inline line range. Delete and recreate it "
            "on the current diff instead of updating it."
        )
    if position["head_sha"] != details["sha"]:
        raise ReviewError(
            "draft note belongs to an older diff. Delete and recreate it on the current diff."
        )

    # GitLab clears position fields when an update omits them, so always resend it.
    response = glab_api(
        mr,
        endpoint,
        method="PUT",
        payload={"note": read_body(args.body_file), "position": position},
    )
    require_renderable_draft(response, position)
    print(json.dumps(response, indent=2))


def command_verify(args: argparse.Namespace) -> None:
    mr = parse_mr_url(args.mr_url)
    details = mr_details(mr)
    drafts = paginated_get(mr, f"{mr.endpoint}/draft_notes")
    notes = paginated_get(mr, f"{mr.endpoint}/notes")
    user = glab_api(mr, "user")
    user_id = user.get("id") if isinstance(user, dict) else None

    positioned = sum(
        1
        for draft in drafts
        if (draft.get("position") or {}).get("new_path")
        and (
            (draft.get("position") or {}).get("new_line")
            or (draft.get("position") or {}).get("old_line")
        )
    )
    renderable = sum(1 for draft in drafts if is_renderable_draft(draft))
    published_by_user = sum(
        1
        for note in notes
        if not note.get("system") and (note.get("author") or {}).get("id") == user_id
    )
    result = {
        "head_sha": details.get("sha"),
        "draft_count": len(drafts),
        "positioned_draft_count": positioned,
        "renderable_draft_count": renderable,
        "published_by_current_user": published_by_user,
    }

    failures: list[str] = []
    if positioned != len(drafts):
        failures.append("one or more draft notes have no diff position")
    if renderable != len(drafts):
        failures.append("one or more draft notes will not render inline")
    if args.expected_head and result["head_sha"] != args.expected_head:
        failures.append(
            f"expected head {args.expected_head}, got {result['head_sha']}"
        )
    if args.expected_drafts is not None and len(drafts) != args.expected_drafts:
        failures.append(f"expected {args.expected_drafts} drafts, got {len(drafts)}")
    if (
        args.expected_published_count is not None
        and published_by_user != args.expected_published_count
    ):
        failures.append(
            "expected "
            f"{args.expected_published_count} published notes by current user, "
            f"got {published_by_user}"
        )

    print(json.dumps(result, indent=2) if args.json else "\n".join(f"{k}: {v}" for k, v in result.items()))
    if failures:
        raise ReviewError("; ".join(failures))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage pending GitLab MR draft notes without publishing them."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List pending draft notes")
    list_parser.add_argument("mr_url")
    list_parser.add_argument("--json", action="store_true")
    list_parser.set_defaults(handler=command_list)

    add_parser = subparsers.add_parser("add", help="Add a positioned draft note")
    add_parser.add_argument("mr_url")
    add_parser.add_argument("--file", required=True, help="Repository-relative path")
    line_group = add_parser.add_mutually_exclusive_group(required=True)
    line_group.add_argument("--new-line", type=int)
    line_group.add_argument("--old-line", type=int)
    add_parser.add_argument(
        "--line-code",
        required=True,
        help="GitLab diff anchor from the rendered changed line",
    )
    add_parser.add_argument("--body-file", required=True, help="Markdown file or - for stdin")
    add_parser.add_argument("--expected-head", required=True)
    add_parser.set_defaults(handler=command_add)

    update_parser = subparsers.add_parser("update", help="Update a draft note in place")
    update_parser.add_argument("mr_url")
    update_parser.add_argument("note_id", type=int)
    update_parser.add_argument("--body-file", required=True, help="Markdown file or - for stdin")
    update_parser.add_argument("--expected-head", required=True)
    update_parser.set_defaults(handler=command_update)

    verify_parser = subparsers.add_parser("verify", help="Verify draft and published-note state")
    verify_parser.add_argument("mr_url")
    verify_parser.add_argument("--expected-head")
    verify_parser.add_argument("--expected-drafts", type=int)
    verify_parser.add_argument("--expected-published-count", type=int)
    verify_parser.add_argument("--json", action="store_true")
    verify_parser.set_defaults(handler=command_verify)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        args.handler(args)
        return 0
    except (OSError, ReviewError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
