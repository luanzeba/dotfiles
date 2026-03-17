#!/usr/bin/env python3
"""Backward-compatible wrapper for archive_chrome_bookmark_folder.py."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def main() -> int:
    target = Path(__file__).with_name("archive_chrome_bookmark_folder.py")
    print(
        "[deprecated] archive_chromium_bookmark_folder.py was renamed to "
        "archive_chrome_bookmark_folder.py",
        file=sys.stderr,
    )
    runpy.run_path(str(target), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
