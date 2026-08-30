#!/usr/bin/env python3
"""Create a compact Game Factory Kit planning workspace."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from datetime import date
from pathlib import Path


ENGINE_CHOICES = ("unity", "web", "godot", "unreal", "custom", "undecided")
STAGE_CHOICES = ("idea", "spike", "prototype", "vertical-slice", "demo", "release")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "game-project"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a Game Factory Kit planning workspace from bundled templates."
    )
    parser.add_argument("title", help="Human-readable game title")
    parser.add_argument("--output", default=".", help="Parent output directory")
    parser.add_argument("--slug", help="Directory/project slug; defaults from title")
    parser.add_argument("--engine", choices=ENGINE_CHOICES, default="undecided")
    parser.add_argument("--platform", default="undecided")
    parser.add_argument("--genre", default="undecided")
    parser.add_argument("--stage", choices=STAGE_CHOICES, default="idea")
    return parser.parse_args()


def render(text: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


def create_workspace(args: argparse.Namespace) -> Path:
    skill_root = Path(__file__).resolve().parent.parent
    template_root = skill_root / "assets" / "project-template"
    if not template_root.is_dir():
        raise RuntimeError(f"Template directory is missing: {template_root}")

    project_slug = slugify(args.slug or args.title)
    destination = Path(args.output).expanduser().resolve() / project_slug
    if destination.exists():
        raise FileExistsError(
            f"Destination already exists: {destination}. Choose a new --slug or --output."
        )

    values = {
        "TITLE": args.title,
        "SLUG": project_slug,
        "ENGINE": args.engine,
        "PLATFORM": args.platform,
        "GENRE": args.genre,
        "STAGE": args.stage,
        "DATE": date.today().isoformat(),
    }

    destination.mkdir(parents=True)
    try:
        for source in sorted(template_root.rglob("*")):
            relative = source.relative_to(template_root)
            target = destination / relative
            if source.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(render(source.read_text(encoding="utf-8"), values), encoding="utf-8")
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    return destination


def main() -> int:
    args = parse_args()
    try:
        destination = create_workspace(args)
    except (FileExistsError, RuntimeError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(f"Created Game Factory Kit workspace: {destination}")
    print("Next: define the playable outcome in PROJECT.md and the core loop in docs/GDD.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
