#!/usr/bin/env python3
"""Установщик Game Factory Kit. Python 3.10+, без внешних зависимостей."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import uuid
import zipfile


class KitError(Exception):
    """An actionable kit or destination error."""


EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", "__pycache__", ".pytest_cache", "node_modules",
    ".venv", "venv", "private", "local-extras", ".gamekit-backups",
}
ROOT_FILES = {
    "kit.json", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt",
    "THIRD_PARTY_NOTICES.md", "NOTICE", "NOTICE.md", ".gitignore", ".gitattributes", "AGENTS.md", "CHANGELOG.md",
}
PACKAGE_DIRS = {"skills", "scripts", "tests", "docs", "catalog", "licenses", ".codex-plugin"}
TEMPLATE_NAMES = (
    "idea.md", "research.md", "concept.md", "feature-index.md",
    "technical-plan.md", "qa.md", "state.json", "asset-register.csv",
)
SKILL_NAME = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def is_link(path: Path) -> bool:
    if path.is_symlink() or bool(getattr(os.path, "isjunction", lambda _: False)(path)):
        return True
    try:
        attributes = getattr(path.lstat(), "st_file_attributes", 0)
    except FileNotFoundError:
        return False
    # Python 3.10 does not expose os.path.isjunction. Reject Windows reparse
    # points as well, so the same path rule applies to every supported Python.
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def checked_path(value: str | Path) -> Path:
    """Reject traversal and linked ancestors before resolving a local path."""
    raw = Path(value).expanduser()
    if ".." in raw.parts:
        raise KitError(f"Parent traversal '..' is not allowed: {value}")
    absolute = Path(os.path.abspath(raw))
    for part in (absolute, *absolute.parents):
        if is_link(part):
            raise KitError(f"Symlink or junction is not allowed: {part}")
    return absolute


def excluded_file(name: str) -> bool:
    return name == ".DS_Store" or name.startswith(".env") or name.endswith((".pyc", ".pyo"))


def tree_files(root: Path) -> dict[str, Path]:
    root = checked_path(root)
    if not root.is_dir():
        raise KitError(f"Expected directory: {root}")
    result: dict[str, Path] = {}
    for current, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in dirs + files:
            item = current_path / name
            if is_link(item):
                raise KitError(f"Symlink or junction is not allowed: {item}")
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS)
        for name in sorted(files):
            if not excluded_file(name):
                item = current_path / name
                if not item.is_file():
                    raise KitError(f"Expected regular file: {item}")
                result[item.relative_to(root).as_posix()] = item
    return result


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def differences(source: dict[str, Path], target: dict[str, Path]) -> list[str]:
    changed = []
    for name in sorted(set(source) | set(target)):
        if name not in source:
            changed.append(f"extra {name}")
        elif name not in target:
            changed.append(f"missing {name}")
        elif file_hash(source[name]) != file_hash(target[name]):
            changed.append(f"changed {name}")
    return changed


def contained(parent: Path, child: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def render_template(name: str, content: str, project_name: str) -> str:
    """Substitute template values while preserving JSON syntax and types."""
    if Path(name).suffix != ".json":
        return content.replace("{{PROJECT_NAME}}", project_name)
    try:
        data = json.loads(content)
    except ValueError as error:
        raise KitError(f"Invalid JSON template {name}: {error}") from error

    def substitute(value):
        if isinstance(value, str):
            return value.replace("{{PROJECT_NAME}}", project_name)
        if isinstance(value, list):
            return [substitute(item) for item in value]
        if isinstance(value, dict):
            return {key: substitute(item) for key, item in value.items()}
        return value

    return json.dumps(substitute(data), ensure_ascii=False, indent=2) + "\n"


class Kit:
    def __init__(self, root: str | Path):
        self.root = checked_path(root)
        manifest = checked_path(self.root / "kit.json")
        try:
            self.manifest = json.loads(manifest.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as error:
            raise KitError(f"Cannot read manifest {manifest}: {error}") from error
        self._validate_manifest()

    def _validate_manifest(self) -> None:
        data = self.manifest
        if not isinstance(data, dict) or data.get("schema_version") != 1:
            raise KitError("kit.json must use schema_version 1")
        skills = data.get("skills")
        profiles = data.get("profiles")
        if not isinstance(skills, list) or not skills:
            raise KitError("kit.json skills must be a nonempty list")
        names = []
        for skill in skills:
            name = skill.get("name") if isinstance(skill, dict) else None
            if not isinstance(name, str) or not SKILL_NAME.fullmatch(name):
                raise KitError(f"Unsafe or invalid skill name: {name!r}")
            if name in names:
                raise KitError(f"Duplicate skill name: {name}")
            names.append(name)
        if not isinstance(profiles, dict) or not profiles:
            raise KitError("kit.json profiles must be a nonempty object")
        for profile, members in profiles.items():
            if not isinstance(members, list) or not members:
                raise KitError(f"Profile {profile!r} must be a nonempty list")
            if any(not isinstance(member, str) or member not in names for member in members):
                raise KitError(f"Unknown skill in profile {profile!r}")
            if len(members) != len(set(members)):
                raise KitError(f"Duplicate skill in profile {profile!r}")

    def select(self, profile: str | None = None) -> list[str]:
        if profile is None:
            return [skill["name"] for skill in self.manifest["skills"]]
        try:
            return list(self.manifest["profiles"][profile])
        except KeyError as error:
            choices = ", ".join(self.manifest["profiles"])
            raise KitError(f"Unknown profile {profile!r}; choose {choices}") from error

    def source_files(self, name: str) -> dict[str, Path]:
        source = checked_path(self.root / "skills" / name)
        if not contained(self.root / "skills", source):
            raise KitError(f"Skill escapes package: {name}")
        files = tree_files(source)
        if "SKILL.md" not in files:
            raise KitError(f"Missing SKILL.md for {name}")
        return files

    def list_skills(self, profile: str | None = None) -> list[dict]:
        selected = set(self.select(profile))
        return [entry for entry in self.manifest["skills"] if entry["name"] in selected]

    def validate(self) -> list[str]:
        issues = []
        for entry in self.manifest["skills"]:
            name = entry["name"]
            try:
                files = self.source_files(name)
                text = files["SKILL.md"].read_text(encoding="utf-8-sig")
                match = re.match(r"\A---\s*\n(.*?)\n---(?:\s*\n|$)", text, re.S)
                if not match:
                    issues.append(f"{name}: missing YAML frontmatter")
                    continue
                header = match.group(1)
                actual = re.search(r"^name:\s*[\"']?([^\"'\n]+)", header, re.M)
                if not actual or actual.group(1).strip() != name:
                    issues.append(f"{name}: frontmatter name must match directory")
                if not re.search(r"^description:\s*\S", header, re.M):
                    issues.append(f"{name}: missing description")
                if name.startswith("game-"):
                    for relative, file in files.items():
                        if file.suffix in {".md", ".yaml", ".yml", ".json", ".py"}:
                            content = file.read_text(encoding="utf-8-sig")
                            if re.search(r"[A-Za-z]:[\\/](?:Users|AI_PROJECTS|Program Files)|/(?:Users|home)/[^\s/]+/", content):
                                issues.append(f"{name}/{relative}: machine-specific absolute path")
            except (OSError, UnicodeError, KitError) as error:
                issues.append(str(error))
        return issues

    def install(self, destination: str | Path, profile: str, dry_run: bool = False,
                backup_and_replace: bool = False) -> dict:
        dest = checked_path(destination)
        if dest.exists() and not dest.is_dir():
            raise KitError(f"Destination is not a directory: {dest}")
        if contained(self.root, dest) or contained(dest, self.root):
            raise KitError("Install destination must be outside the kit source tree")
        sources = {name: self.source_files(name) for name in self.select(profile)}
        actions, conflicts = {}, {}
        for name, files in sources.items():
            target = checked_path(dest / name)
            if target.exists():
                if not target.is_dir():
                    raise KitError(f"Skill target is not a directory: {target}")
                diff = differences(files, tree_files(target))
                actions[name] = "replace" if diff else "unchanged"
                if diff:
                    conflicts[name] = diff
            else:
                actions[name] = "install"
        if conflicts and not backup_and_replace:
            details = "; ".join(f"{name}: {', '.join(diff[:5])}" for name, diff in conflicts.items())
            raise KitError("Conflicting skills; nothing installed. " + details +
                           ". Review changes or use --backup-and-replace to preserve originals.")
        report = {"destination": str(dest), "dry_run": dry_run, "actions": actions, "backup": None}
        changed = [name for name, action in actions.items() if action != "unchanged"]
        if dry_run or not changed:
            return report
        dest.mkdir(parents=True, exist_ok=True)
        checked_path(dest)
        with tempfile.TemporaryDirectory(prefix=".gamekit-stage-", dir=dest) as temporary:
            stage = checked_path(temporary)
            for name in changed:
                for relative, source in sources[name].items():
                    output = stage / name / relative
                    output.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, output)
            backup = None
            if conflicts:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
                backup = checked_path(dest / ".gamekit-backups" / stamp)
                backup.mkdir(parents=True)
                report["backup"] = str(backup)
            completed = []
            moved = []
            try:
                for name in changed:
                    target = checked_path(dest / name)
                    if name in conflicts:
                        shutil.move(str(target), str(backup / name))
                        moved.append(name)
                    shutil.move(str(stage / name), str(target))
                    completed.append(name)
            except OSError as error:
                # Roll back through moves; preserve every original directory.
                for name in reversed(completed):
                    shutil.move(str(dest / name), str(stage / name))
                for name in reversed(moved):
                    shutil.move(str(backup / name), str(dest / name))
                raise KitError(f"Install failed; originals restored: {error}") from error
        return report

    def init_project(self, project: str | Path) -> dict:
        project_path = checked_path(project)
        if project_path.exists() and not project_path.is_dir():
            raise KitError(f"Project is not a directory: {project_path}")
        if contained(self.root, project_path) or contained(project_path / "docs" / "game", self.root):
            raise KitError("Project must be outside the kit source tree")
        templates = checked_path(self.root / "skills" / "game-creator" / "assets" / "templates")
        files = tree_files(templates)
        missing = [name for name in TEMPLATE_NAMES if name not in files]
        if missing:
            raise KitError("Missing templates: " + ", ".join(missing))
        output_root = checked_path(project_path / "docs" / "game")
        contents = {}
        for name in TEMPLATE_NAMES:
            target = checked_path(output_root / name)
            if target.exists() and not target.is_file():
                raise KitError(f"Template target is not a regular file: {target}")
            contents[name] = render_template(name, files[name].read_text(encoding="utf-8-sig"), project_path.name)
        report = {"project": str(project_path), "created": [], "preserved": []}
        output_root.mkdir(parents=True, exist_ok=True)
        for name, content in contents.items():
            target = output_root / name
            try:
                with target.open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(content)
                report["created"].append(name)
            except FileExistsError:
                report["preserved"].append(name)
        return report

    def package(self, output: str | Path) -> dict:
        output_path = checked_path(output)
        if output_path.suffix.lower() != ".zip":
            raise KitError("Package output must have a .zip extension")
        if output_path.exists():
            raise KitError(f"Package output already exists: {output_path}")
        if any(contained(self.root / name, output_path) for name in PACKAGE_DIRS):
            raise KitError("Write archives outside packaged source directories (for example, dist/kit.zip)")
        files = {}
        for name in sorted(ROOT_FILES):
            path = self.root / name
            if is_link(path):
                raise KitError(f"Symlink is not allowed: {path}")
            if path.is_file():
                files[name] = path
        for name in sorted(PACKAGE_DIRS):
            path = self.root / name
            if is_link(path):
                raise KitError(f"Symlink is not allowed: {path}")
            if path.exists():
                for relative, file in tree_files(path).items():
                    files[f"{name}/{relative}"] = file
        if any(output_path == path for path in files.values()):
            raise KitError("Package output cannot replace package input")
        issues = self.validate()
        if issues:
            raise KitError("Package validation failed: " + "; ".join(issues))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        created = False
        try:
            with output_path.open("xb") as stream:
                created = True
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, path in sorted(files.items()):
                        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = 0o100644 << 16
                        archive.writestr(info, path.read_bytes())
        except Exception:
            # Only this exact, newly-created archive may be removed on failure.
            if created and output_path.is_file() and not is_link(output_path):
                output_path.unlink()
            raise
        return {"output": str(output_path), "files": len(files), "bytes": output_path.stat().st_size,
                "sha256": file_hash(output_path)}


def doctor(project: str | None = None) -> dict:
    tools = {"python": sys.executable}
    for name in ("git", "node", "npm", "blender", "unity", "rojo"):
        tools[name] = shutil.which(name) or "NOT_FOUND_ON_PATH"
    report = {"python_version": sys.version.split()[0], "tools": tools,
              "mcp": "UNKNOWN: check live tool availability in your agent session",
              "note": "PATH detection does not prove an editor session, license, browser, or MCP connection is ready."}
    if project:
        path = checked_path(project)
        report["project"] = str(path)
        report["project_exists"] = path.is_dir()
        report["skills_directory"] = str(path / ".agents" / "skills")
    return report


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="List bundled skills")
    listing.add_argument("--profile")
    install = commands.add_parser("install", help="Copy a profile without overwriting existing skills")
    target = install.add_mutually_exclusive_group(required=True)
    target.add_argument("--project", help="Install into PROJECT/.agents/skills")
    target.add_argument("--dest", help="Explicit skill directory (project or user scope)")
    install.add_argument("--profile", default="core")
    install.add_argument("--dry-run", action="store_true")
    install.add_argument("--backup-and-replace", action="store_true")
    init = commands.add_parser("init", help="Create design documents; preserve existing files")
    init.add_argument("--project", required=True)
    check = commands.add_parser("doctor", help="Report tools on PATH; MCP remains UNKNOWN")
    check.add_argument("--project")
    commands.add_parser("validate", help="Validate bundled skills and manifest")
    package = commands.add_parser("package", help="Create a portable ZIP from an allowlist")
    package.add_argument("--output", required=True)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "doctor":
            report = doctor(args.project)
        else:
            kit = Kit(Path(__file__).resolve().parents[1])
            if args.command == "list":
                report = kit.list_skills(args.profile)
            elif args.command == "install":
                dest = checked_path(args.project) / ".agents" / "skills" if args.project else args.dest
                report = kit.install(dest, args.profile, args.dry_run, args.backup_and_replace)
                if args.project and not args.dry_run:
                    location = checked_path(checked_path(args.project) / ".game-factory" / "kit-location.txt")
                    location.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        kit_location = os.path.relpath(kit.root, checked_path(args.project))
                    except ValueError:  # Separate Windows volumes
                        kit_location = str(kit.root)
                    location.write_text(kit_location + "\n", encoding="utf-8")
            elif args.command == "init":
                report = kit.init_project(args.project)
            elif args.command == "validate":
                issues = kit.validate()
                if issues:
                    raise KitError("Validation failed:\n" + "\n".join(issues))
                report = {"valid": True, "skills": len(kit.select()), "profiles": list(kit.manifest["profiles"])}
            else:
                report = kit.package(args.output)
        # JSON escapes keep paths round-trippable even when Windows redirects
        # output using a legacy code page that cannot encode their characters.
        print(json.dumps(report, ensure_ascii=True, indent=2))
        return 0
    except (KitError, OSError, UnicodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
