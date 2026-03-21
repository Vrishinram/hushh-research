#!/usr/bin/env python3
"""Lightweight docs terminology check for PKM cutover.

This is intentionally small and focused. It exists to catch new stale
"world model" references in docs after the PKM rename.
"""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SKIP_PARTS = {
    ".git",
    ".next",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "temp",
}
ALLOWLIST = {
    ROOT / "docs" / "reference" / "architecture" / "pkm-cutover-runbook.md",
}


def main() -> int:
    failures: list[str] = []
    for path in ROOT.rglob("*.md"):
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        if path in ALLOWLIST:
            continue
        text = path.read_text(encoding="utf-8")
        if "world model" in text.lower():
            failures.append(str(path.relative_to(ROOT)))

    if failures:
        print("Found stale 'world model' references in docs:")
        for item in failures:
            print(f"- {item}")
        return 1

    print("PKM terminology check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
