#!/usr/bin/env python3
"""Migrate Arc space folders/tabs into Chromium profile bookmarks.

Default mapping:
- Arc "Work" space -> Chromium "Work" profile
- Arc "Home" space -> Chromium "Home" profile
  (falls back to Arc "Personal" space when "Home" does not exist)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import uuid
from collections import Counter
from pathlib import Path
from typing import Any


def chrome_timestamp() -> str:
    # Microseconds since Windows epoch (1601-01-01)
    return str(int((time.time() + 11644473600) * 1_000_000))


def is_chromium_running() -> bool:
    proc = subprocess.run(
        ["pgrep", "-x", "Chromium"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return proc.returncode == 0


def pair_list_to_dict(arr: list[Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    i = 0
    while i < len(arr) - 1:
        k = arr[i]
        v = arr[i + 1]
        if isinstance(k, str) and isinstance(v, dict):
            out[k] = v
            i += 2
        else:
            i += 1
    return out


def pair_list_to_simple_map(arr: list[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    i = 0
    while i < len(arr) - 1:
        k = arr[i]
        v = arr[i + 1]
        if isinstance(k, str):
            out[k] = v
        i += 2
    return out


def find_arc_space(
    spaces_by_id: dict[str, dict[str, Any]],
    wanted_title: str,
    fallback_titles: list[str] | None = None,
) -> tuple[str, dict[str, Any]] | None:
    fallback_titles = fallback_titles or []
    wanted_lc = wanted_title.lower()

    for sid, space in spaces_by_id.items():
        if str(space.get("title", "")).lower() == wanted_lc:
            return sid, space

    for fallback in fallback_titles:
        fallback_lc = fallback.lower()
        for sid, space in spaces_by_id.items():
            if str(space.get("title", "")).lower() == fallback_lc:
                return sid, space

    return None


def extract_tree_for_space(
    space: dict[str, Any],
    items_by_id: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Return bookmark-tree nodes grouped by pinned/unpinned."""

    container_ids = pair_list_to_simple_map(space.get("containerIDs", []))

    result: dict[str, list[dict[str, Any]]] = {"pinned": [], "unpinned": []}

    def convert_item(item_id: str, visited: set[str]) -> list[dict[str, Any]]:
        if item_id in visited:
            return []
        visited.add(item_id)

        item = items_by_id.get(item_id)
        if not item:
            return []

        data = item.get("data", {})

        # Tab -> URL bookmark
        if isinstance(data, dict) and "tab" in data:
            tab = data.get("tab", {}) or {}
            url = tab.get("savedURL")
            if not isinstance(url, str) or not url.strip():
                return []
            title = tab.get("savedTitle") or item.get("title") or url
            return [{"type": "url", "name": str(title), "url": str(url)}]

        # Non-tab item -> recurse children
        child_nodes: list[dict[str, Any]] = []
        for child_id in item.get("childrenIds", []):
            if isinstance(child_id, str):
                child_nodes.extend(convert_item(child_id, visited))

        # Arc folders (list) should stay folders
        if isinstance(data, dict) and "list" in data:
            name = item.get("title") or "Untitled folder"
            return [{"type": "folder", "name": str(name), "children": child_nodes}]

        # Containers / unknown node types are flattened
        return child_nodes

    for section in ("pinned", "unpinned"):
        container_id = container_ids.get(section)
        if isinstance(container_id, str):
            result[section] = convert_item(container_id, set())

    return result


def load_or_init_bookmarks(path: Path) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text())

    ts = chrome_timestamp()
    return {
        "checksum": "",
        "roots": {
            "bookmark_bar": {
                "children": [],
                "date_added": ts,
                "date_last_used": "0",
                "date_modified": ts,
                "guid": str(uuid.uuid4()),
                "id": "1",
                "name": "Bookmarks bar",
                "type": "folder",
            },
            "other": {
                "children": [],
                "date_added": ts,
                "date_last_used": "0",
                "date_modified": ts,
                "guid": str(uuid.uuid4()),
                "id": "2",
                "name": "Other bookmarks",
                "type": "folder",
            },
            "synced": {
                "children": [],
                "date_added": ts,
                "date_last_used": "0",
                "date_modified": ts,
                "guid": str(uuid.uuid4()),
                "id": "3",
                "name": "Mobile bookmarks",
                "type": "folder",
            },
        },
        "version": 1,
    }


def find_max_bookmark_id(node: Any) -> int:
    max_id = 0

    def walk(x: Any) -> None:
        nonlocal max_id
        if isinstance(x, dict):
            raw_id = x.get("id")
            if isinstance(raw_id, str) and raw_id.isdigit():
                max_id = max(max_id, int(raw_id))
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(node)
    return max_id


def materialize_bookmark_nodes(
    logical_nodes: list[dict[str, Any]],
    next_id: list[int],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for node in logical_nodes:
        ts = chrome_timestamp()
        next_id[0] += 1
        bookmark_id = str(next_id[0])

        if node["type"] == "url":
            out.append(
                {
                    "date_added": ts,
                    "guid": str(uuid.uuid4()),
                    "id": bookmark_id,
                    "name": node["name"],
                    "type": "url",
                    "url": node["url"],
                }
            )
            continue

        children = materialize_bookmark_nodes(node.get("children", []), next_id)
        out.append(
            {
                "children": children,
                "date_added": ts,
                "date_last_used": "0",
                "date_modified": ts,
                "guid": str(uuid.uuid4()),
                "id": bookmark_id,
                "name": node["name"],
                "type": "folder",
            }
        )

    return out


def parse_map_args(raw_maps: list[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw in raw_maps:
        if "=" not in raw:
            raise ValueError(f"Invalid --map '{raw}'. Expected format: ArcSpace=ChromiumProfile")
        src, dst = raw.split("=", 1)
        src = src.strip()
        dst = dst.strip()
        if not src or not dst:
            raise ValueError(f"Invalid --map '{raw}'. Source and target must be non-empty")
        out.append((src, dst))
    return out


def summarize_nodes(nodes: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()

    def walk(n: dict[str, Any]) -> None:
        t = n.get("type")
        if t == "url":
            stats["tabs"] += 1
        elif t == "folder":
            stats["folders"] += 1
            for c in n.get("children", []):
                walk(c)

    for n in nodes:
        walk(n)
    return stats


def main() -> int:
    home = Path.home()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--arc-sidebar",
        default=str(home / "Library/Application Support/Arc/StorableSidebar.json"),
        help="Path to Arc StorableSidebar.json",
    )
    parser.add_argument(
        "--chromium-user-data",
        default=str(home / "Library/Application Support/Chromium"),
        help="Path to Chromium user data directory",
    )
    parser.add_argument(
        "--map",
        action="append",
        default=["Work=Work", "Home=Home"],
        help="Space/profile mapping in ArcSpace=ChromiumProfile format (repeatable)",
    )
    parser.add_argument(
        "--home-fallback-space",
        default="Personal",
        help="Arc space title to use if Arc 'Home' space is missing",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes to Chromium profile Bookmarks files",
    )

    args = parser.parse_args()

    arc_sidebar_path = Path(args.arc_sidebar)
    chromium_user_data = Path(args.chromium_user_data)
    local_state_path = chromium_user_data / "Local State"

    if not arc_sidebar_path.exists():
        print(f"Error: Arc sidebar file not found: {arc_sidebar_path}", file=sys.stderr)
        return 1
    if not local_state_path.exists():
        print(f"Error: Chromium Local State not found: {local_state_path}", file=sys.stderr)
        return 1

    try:
        mappings = parse_map_args(args.map)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    arc_obj = json.loads(arc_sidebar_path.read_text())
    sidebar_container = arc_obj["sidebar"]["containers"][1]
    items_by_id = pair_list_to_dict(sidebar_container["items"])
    spaces_by_id = pair_list_to_dict(sidebar_container["spaces"])

    local_state = json.loads(local_state_path.read_text())
    info_cache = local_state.get("profile", {}).get("info_cache", {})

    # Map Chromium profile display names -> directory basenames
    chromium_profiles: dict[str, str] = {}
    for directory, meta in info_cache.items():
        name = str(meta.get("name", "")).strip()
        if name:
            chromium_profiles[name.lower()] = directory

    run_summary: list[dict[str, Any]] = []

    for arc_space_name, chromium_profile_name in mappings:
        fallback_titles: list[str] = []
        if arc_space_name.lower() == "home" and args.home_fallback_space:
            fallback_titles.append(args.home_fallback_space)

        found = find_arc_space(spaces_by_id, arc_space_name, fallback_titles)
        if not found:
            print(f"Warning: Arc space '{arc_space_name}' not found; skipping")
            continue

        space_id, space = found
        actual_space_title = str(space.get("title", arc_space_name))

        chromium_dir = chromium_profiles.get(chromium_profile_name.lower())
        if not chromium_dir:
            print(f"Warning: Chromium profile '{chromium_profile_name}' not found; skipping")
            continue

        section_nodes = extract_tree_for_space(space, items_by_id)

        pinned_nodes = section_nodes.get("pinned", [])
        unpinned_nodes = section_nodes.get("unpinned", [])

        import_children: list[dict[str, Any]] = []
        if pinned_nodes:
            import_children.append({"type": "folder", "name": "Pinned", "children": pinned_nodes})
        if unpinned_nodes:
            import_children.append({"type": "folder", "name": "Unpinned", "children": unpinned_nodes})

        stats = summarize_nodes(import_children)

        run_summary.append(
            {
                "arc_space_requested": arc_space_name,
                "arc_space_used": actual_space_title,
                "arc_space_id": space_id,
                "chromium_profile": chromium_profile_name,
                "chromium_directory": chromium_dir,
                "logical_nodes": import_children,
                "stats": stats,
            }
        )

    if not run_summary:
        print("Nothing to migrate.")
        return 1

    print("Migration plan:")
    for entry in run_summary:
        stats = entry["stats"]
        print(
            f"- Arc '{entry['arc_space_used']}' -> Chromium '{entry['chromium_profile']}' "
            f"({entry['chromium_directory']}): {stats.get('folders', 0)} folders, {stats.get('tabs', 0)} tabs"
        )

    if not args.apply:
        print("\nDry run complete. Re-run with --apply to write Bookmarks files.")
        return 0

    if is_chromium_running():
        print(
            "\nError: Chromium is running. Please fully quit Chromium, then re-run with --apply.",
            file=sys.stderr,
        )
        return 2

    for entry in run_summary:
        profile_dir = chromium_user_data / entry["chromium_directory"]
        profile_dir.mkdir(parents=True, exist_ok=True)
        bookmarks_path = profile_dir / "Bookmarks"

        if bookmarks_path.exists():
            backup_path = profile_dir / f"Bookmarks.pre-arc-migration-{time.strftime('%Y%m%d-%H%M%S')}.bak"
            backup_path.write_text(bookmarks_path.read_text())
            print(f"Backed up: {backup_path}")

        bookmarks = load_or_init_bookmarks(bookmarks_path)
        bar = bookmarks.setdefault("roots", {}).setdefault("bookmark_bar", {})
        bar_children = bar.setdefault("children", [])

        max_id = find_max_bookmark_id(bookmarks)
        next_id = [max_id]

        root_name = f"Arc import · {entry['arc_space_used']} · {time.strftime('%Y-%m-%d %H:%M')}"
        logical_root = [{"type": "folder", "name": root_name, "children": entry["logical_nodes"]}]
        materialized = materialize_bookmark_nodes(logical_root, next_id)

        bar_children.extend(materialized)
        bar["date_modified"] = chrome_timestamp()

        bookmarks_path.write_text(json.dumps(bookmarks, separators=(",", ":")))
        print(f"Updated: {bookmarks_path}")

    print("\nDone. Open Chromium profiles to verify imported bookmark folders.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
