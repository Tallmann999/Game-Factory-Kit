#!/usr/bin/env python3
"""Validate the stable artifacts and required project facts in a GFK workspace."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_FILES = (
    "PROJECT.md",
    "GAME_SPEC.yaml",
    "docs/GDD.md",
    "docs/TECHNICAL_DESIGN.md",
    "ROADMAP.md",
    "BACKLOG.md",
    "QA.md",
    "DECISIONS.md",
    "HANDOFF.md",
)

REQUIRED_SPEC_KEYS = (
    "schema_version",
    "title",
    "slug",
    "stage",
    "engine",
    "platform",
    "genre",
    "core_loop",
    "current_milestone",
)

UNFINISHED_MARKERS = ("{{", "}}", "[TODO", "TODO:")


def spec_keys(text: str) -> set[str]:
    keys: set[str] = set()
    for line in text.splitlines():
        match = re.match(r"^([a-z][a-z0-9_]*):(?:\s|$)", line)
        if match:
            keys.add(match.group(1))
    return keys


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    for relative in REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            errors.append(f"missing required file: {relative}")
            continue
        if not path.read_text(encoding="utf-8").strip():
            errors.append(f"empty required file: {relative}")

    spec_path = root / "GAME_SPEC.yaml"
    if spec_path.is_file():
        text = spec_path.read_text(encoding="utf-8")
        missing_keys = sorted(set(REQUIRED_SPEC_KEYS) - spec_keys(text))
        if missing_keys:
            errors.append("GAME_SPEC.yaml missing keys: " + ", ".join(missing_keys))

    for relative in REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for marker in UNFINISHED_MARKERS:
            if marker in text:
                errors.append(f"unfinished marker {marker!r} in {relative}")
                break
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a Game Factory Kit workspace.")
    parser.add_argument("project_path", nargs="?", default=".")
    args = parser.parse_args()
    root = Path(args.project_path).expanduser().resolve()

    if not root.is_dir():
        print(f"error: project directory does not exist: {root}", file=sys.stderr)
        return 2

    errors = validate(root)
    if errors:
        print(f"Validation failed with {len(errors)} issue(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Game Factory Kit workspace is valid: {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
