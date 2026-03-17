#!/usr/bin/env python3
"""Archive Google Chrome bookmark folders into an Obsidian note.

Defaults are tuned for Luan's local setup:
- Google Chrome user data: ~/Library/Application Support/Google/Chrome
- Obsidian notes dir: ~/Obsidian/Personal/Notes
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


DEFAULT_CATEGORIES = [
    "[[Categories/GitHub|GitHub]]",
    "[[Categories/Projects|Projects]]",
]
DEFAULT_TYPES = ["Reference", "Link Archive"]
DEFAULT_TAGS = ["links", "archive", "qmd"]
DEFAULT_ORG = ["GitHub"]


def merge_unique(base: list[str], extra: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()

    for value in base + extra:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)

    return out


def escape_markdown_text(value: str) -> str:
    return value.replace("[", "\\[").replace("]", "\\]")


@dataclass
class FolderMatch:
    path: list[str]
    node: dict[str, Any]


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Failed to parse JSON: {path}: {exc}") from exc


def resolve_profile_dir(user_data_dir: Path, profile_name: str | None, profile_dir: str | None) -> str:
    if profile_dir:
        return profile_dir

    if not profile_name:
        raise RuntimeError("Provide either --profile-dir or --profile-name")

    local_state_path = user_data_dir / "Local State"
    local_state = load_json(local_state_path)
    info_cache = local_state.get("profile", {}).get("info_cache", {})

    wanted = profile_name.lower()
    for directory, metadata in info_cache.items():
        name = str(metadata.get("name", ""))
        if name.lower() == wanted:
            return directory

    raise RuntimeError(f"Could not find Google Chrome profile named '{profile_name}'")


def iter_folders(node: dict[str, Any], prefix: list[str]):
    if node.get("type") != "folder":
        return

    name = str(node.get("name", ""))
    current = prefix + [name]
    yield FolderMatch(path=current, node=node)

    for child in node.get("children", []):
        if isinstance(child, dict) and child.get("type") == "folder":
            yield from iter_folders(child, current)


def find_folder_matches(bookmarks: dict[str, Any], folder_names: list[str], folder_paths: list[str]) -> list[FolderMatch]:
    roots = bookmarks.get("roots", {})
    roots_map = {
        "bookmark_bar": "Bookmarks Bar",
        "other": "Other Bookmarks",
        "synced": "Mobile Bookmarks",
    }

    folder_name_set = {n.lower() for n in folder_names}
    folder_path_parts = [
        [p.strip() for p in raw.split("/") if p.strip()]
        for raw in folder_paths
    ]

    matches: list[FolderMatch] = []

    for root_key, root_label in roots_map.items():
        root = roots.get(root_key)
        if not isinstance(root, dict):
            continue

        for child in root.get("children", []):
            if not isinstance(child, dict) or child.get("type") != "folder":
                continue

            for folder in iter_folders(child, [root_label]):
                name_lc = folder.path[-1].lower()
                matched = False

                if folder_name_set and name_lc in folder_name_set:
                    matched = True

                for parts in folder_path_parts:
                    if not parts:
                        continue
                    path_lc = [p.lower() for p in folder.path]
                    parts_lc = [p.lower() for p in parts]
                    if len(parts_lc) <= len(path_lc) and path_lc[-len(parts_lc) :] == parts_lc:
                        matched = True
                        break

                if matched:
                    matches.append(folder)

    # De-duplicate by full path string
    unique: dict[str, FolderMatch] = {}
    for match in matches:
        key = " / ".join(match.path)
        unique[key] = match

    return list(unique.values())


def collect_links(folder: dict[str, Any], nested_path: list[str] | None = None):
    nested_path = nested_path or []

    for child in folder.get("children", []):
        if not isinstance(child, dict):
            continue

        ctype = child.get("type")
        if ctype == "url":
            title = str(child.get("name", "Untitled link"))
            url = str(child.get("url", ""))
            if url:
                yield nested_path, title, url
        elif ctype == "folder":
            child_name = str(child.get("name", "Untitled folder"))
            yield from collect_links(child, nested_path + [child_name])


def build_frontmatter(
    categories: list[str],
    note_types: list[str],
    orgs: list[str],
    tags: list[str],
    topics: list[str],
    aliases: list[str],
    status: str,
    source: str,
    note_date: str,
) -> str:
    lines: list[str] = ["---"]

    lines.append("category:")
    for category in categories:
        lines.append(f'  - "{category}"')

    if note_types:
        lines.append("type:")
        for t in note_types:
            lines.append(f"  - {t}")

    if orgs:
        lines.append("org:")
        for org in orgs:
            lines.append(f"  - {org}")

    lines.append(f"status: {status}")
    lines.append(f"created: {note_date}")
    lines.append(f"date: {note_date}")

    if tags:
        lines.append("tags:")
        for tag in tags:
            lines.append(f"  - {tag}")

    if topics:
        lines.append("topics:")
        for topic in topics:
            lines.append(f"  - {topic}")

    if aliases:
        lines.append("aliases:")
        for alias in aliases:
            lines.append(f"  - " + json.dumps(alias, ensure_ascii=False))

    lines.append(f"source: {source}")
    lines.append("---")

    return "\n".join(lines)


def build_note_content(
    note_title: str,
    summary: str,
    folders: list[FolderMatch],
    topics: list[str],
    aliases: list[str],
    questions: list[str],
    source_profile: str,
) -> str:
    blocks: list[str] = [f"# {note_title}", "", "## Summary", summary, ""]

    blocks.append("## Retrieval hints")
    if topics:
        blocks.append("- Topics: " + ", ".join(topics))
    if aliases:
        blocks.append("- Alternate phrasing: " + ", ".join(aliases))
    blocks.append(f"- Profile: {source_profile}")
    blocks.append("- Use this note when looking for original docs, planning references, or historical decision context.")
    blocks.append("")

    if questions:
        blocks.append("## Example prompts")
        for question in questions:
            blocks.append(f"- {question}")
        blocks.append("")

    blocks.append("## Saved links")

    total_links = 0
    seen_urls: set[str] = set()

    for folder in folders:
        folder_title = " / ".join(folder.path[1:])  # drop root label for readability
        blocks.append("")
        blocks.append(f"### {escape_markdown_text(folder_title)}")

        folder_links = list(collect_links(folder.node))
        if not folder_links:
            blocks.append("- _(No URLs found in this folder)_")
            continue

        line_number = 1
        for nested_path, title, url in folder_links:
            if url in seen_urls:
                continue
            seen_urls.add(url)
            total_links += 1

            safe_title = escape_markdown_text(title)
            if nested_path:
                nested = escape_markdown_text(" / ".join(nested_path))
                blocks.append(f"{line_number}. [{safe_title}]({url}) _(from {nested})_")
            else:
                blocks.append(f"{line_number}. [{safe_title}]({url})")
            line_number += 1

    blocks.append("")
    blocks.append(f"_Total links: {total_links}_")

    return "\n".join(blocks) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)

    parser.add_argument(
        "--chrome-user-data-dir",
        "--chromium-user-data-dir",
        dest="chrome_user_data_dir",
        default=str(Path.home() / "Library/Application Support/Google/Chrome"),
        help="Google Chrome user data directory",
    )
    parser.add_argument("--profile-name", help="Google Chrome profile display name (for example: Work)")
    parser.add_argument("--profile-dir", help="Google Chrome profile directory basename (for example: Default)")

    parser.add_argument("--folder-name", action="append", default=[], help="Bookmark folder name to archive (repeatable)")
    parser.add_argument(
        "--folder-path",
        action="append",
        default=[],
        help="Bookmark folder path suffix to archive (e.g. 'Arc import · Work · 2026-03-13 11:21/Pinned/🐙 Project Tentacle')",
    )

    parser.add_argument("--note-title", required=True, help="Obsidian note title")
    parser.add_argument("--summary", required=True, help="Short summary paragraph for the note")

    parser.add_argument(
        "--notes-dir",
        default=str(Path.home() / "Obsidian/Personal/Notes"),
        help="Target Obsidian Notes directory",
    )
    parser.add_argument("--output-file", help="Explicit output markdown filename")

    parser.add_argument("--category", action="append", default=[], help="Category wikilink (repeatable)")
    parser.add_argument("--type", dest="note_types", action="append", default=[], help="Type value (repeatable)")
    parser.add_argument("--org", action="append", default=[], help="Organization value (repeatable)")
    parser.add_argument("--tag", action="append", default=[], help="Tag value (repeatable)")
    parser.add_argument("--topic", action="append", default=[], help="Topic keyword (repeatable)")
    parser.add_argument("--alias", action="append", default=[], help="Alternate phrasing for retrieval (repeatable)")
    parser.add_argument("--question", action="append", default=[], help="Example user prompt this note should answer (repeatable)")
    parser.add_argument("--status", default="archived", help="Frontmatter status value")
    parser.add_argument("--source", default="Google Chrome bookmarks", help="Frontmatter source value")
    parser.add_argument("--date", default=date.today().isoformat(), help="Date for created/date fields (YYYY-MM-DD)")

    parser.add_argument("--apply", action="store_true", help="Write note to disk. Without this flag, only show preview.")

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.folder_name and not args.folder_path:
        print("Error: provide at least one --folder-name or --folder-path", file=sys.stderr)
        return 1

    chrome_user_data = Path(args.chrome_user_data_dir)
    profile_dir = resolve_profile_dir(chrome_user_data, args.profile_name, args.profile_dir)

    bookmarks_path = chrome_user_data / profile_dir / "Bookmarks"
    if not bookmarks_path.exists():
        print(f"Error: Bookmarks file not found: {bookmarks_path}", file=sys.stderr)
        return 1

    bookmarks = load_json(bookmarks_path)
    matches = find_folder_matches(bookmarks, args.folder_name, args.folder_path)

    if not matches:
        print("Error: no matching bookmark folders found", file=sys.stderr)
        return 1

    categories = merge_unique(DEFAULT_CATEGORIES, args.category)
    note_types = merge_unique(DEFAULT_TYPES, args.note_types)
    orgs = merge_unique(DEFAULT_ORG, args.org)
    tags = merge_unique(DEFAULT_TAGS, args.tag)

    frontmatter = build_frontmatter(
        categories=categories,
        note_types=note_types,
        orgs=orgs,
        tags=tags,
        topics=args.topic,
        aliases=args.alias,
        status=args.status,
        source=args.source,
        note_date=args.date,
    )

    body = build_note_content(
        note_title=args.note_title,
        summary=args.summary,
        folders=matches,
        topics=args.topic,
        aliases=args.alias,
        questions=args.question,
        source_profile=args.profile_name or profile_dir,
    )

    note_content = frontmatter + "\n\n" + body

    notes_dir = Path(args.notes_dir)
    output_file = Path(args.output_file) if args.output_file else notes_dir / f"{args.note_title}.md"

    print("Matched folders:")
    for match in matches:
        print(f"- {' / '.join(match.path)}")

    if not args.apply:
        print("\nDry run (no file written).")
        print(f"Target: {output_file}")
        print("\nPreview:\n")
        print(note_content)
        return 0

    notes_dir.mkdir(parents=True, exist_ok=True)
    output_file.write_text(note_content)

    print(f"\nWrote: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
