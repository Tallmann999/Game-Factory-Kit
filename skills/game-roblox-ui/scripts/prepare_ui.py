"""Materialize the Roblox UI modules and a feature draft without replacing project files."""
import argparse
from pathlib import Path
import re

FILES = ("UI_STYLES.md", "UI_SPEC_TEMPLATE.md", "UI_GENERATION_GUIDE_DRAFT.md")


def safe_path(root, relative):
    target = root / relative
    for part in (target, *target.parents):
        if part.is_symlink() or getattr(part, "is_junction", lambda: False)():
            raise ValueError(f"Linked paths are not supported: {part}")
    if not target.resolve().is_relative_to(root):
        raise ValueError("Path leaves the game folder")
    return target


def prepare(folder, feature):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", feature):
        raise ValueError("FeatureName: use letters, digits, '-' or '_'.")
    root = Path(folder).absolute()
    if not root.is_dir():
        raise ValueError("Select an existing game folder")
    safe_path(root, "Instructions/UI")
    source = Path(__file__).resolve().parent.parent / "references"
    contents = {f"Instructions/UI/{name}": (source / name).read_text(encoding="utf-8") for name in FILES}
    draft = contents["Instructions/UI/UI_SPEC_TEMPLATE.md"].replace("<название игры или набора фич>", feature, 1)
    for name in FILES:
        draft = draft.replace(f"]({name})", f"](../../Instructions/UI/{name})")
    contents[f"docs/Features/{feature}.UI.md"] = draft
    # Check every destination before creating anything; never follow linked directories.
    targets = {name: safe_path(root, name) for name in contents}
    report = {}
    for name, target in targets.items():
        if target.exists():
            report[name] = "unchanged" if target.read_text(encoding="utf-8-sig") == contents[name] else "kept_existing"
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with target.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(contents[name])
            report[name] = "created"
        except FileExistsError:
            report[name] = "kept_existing"
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project")
    parser.add_argument("--feature", required=True)
    args = parser.parse_args()
    try:
        for name, status in prepare(args.project, args.feature).items():
            print(f"{status}: {name}")
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + "\n")
