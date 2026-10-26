"""Behavioral tests for the portable installer; no external tools or services."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("gamekit_cli", Path(__file__).resolve().parents[1] / "scripts" / "kit.py")
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


class KitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gamekit-test-")
        self.addCleanup(self.temporary.cleanup)
        # macOS temp paths commonly start with the system /var -> /private/var
        # alias. Use its canonical directory for fixtures; explicit symlinks
        # created by the rejection tests must still be refused by the CLI.
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / "source"
        self.root.mkdir()
        self.dest = self.base / "project" / ".agents" / "skills"
        self.names = ["game-creator", "game-quality"]
        self.manifest = {"schema_version": 1, "name": "test-kit", "version": "1.0.0",
                         "skills": [{"name": name, "origin": "original", "license": "MIT"} for name in self.names],
                         "profiles": {"core": self.names, "web": self.names, "full": self.names}}
        self.write_manifest()
        for name in self.names:
            self.write(f"skills/{name}/SKILL.md", f"---\nname: {name}\ndescription: Test skill\n---\nInstructions.\n")
        for name in CLI.TEMPLATE_NAMES:
            template = '{"project_name": "{{PROJECT_NAME}}"}\n' if name == "state.json" else "{{PROJECT_NAME}}\n"
            self.write(f"skills/game-creator/assets/templates/{name}", template)
        self.kit = CLI.Kit(self.root)

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def write_manifest(self):
        self.write("kit.json", json.dumps(self.manifest))

    def test_install_is_idempotent_and_excludes_sensitive_files(self):
        self.write("skills/game-creator/.env", "SECRET")
        self.write("skills/game-creator/.git/config", "PRIVATE")
        self.write("skills/game-creator/__pycache__/ignored.pyc", "CACHE")
        result = self.kit.install(self.dest, "core")
        self.assertEqual(set(result["actions"].values()), {"install"})
        installed = self.dest / "game-creator" / "SKILL.md"
        original_mtime = installed.stat().st_mtime_ns
        repeated = self.kit.install(self.dest, "core")
        self.assertEqual(set(repeated["actions"].values()), {"unchanged"})
        self.assertEqual(installed.stat().st_mtime_ns, original_mtime)
        self.assertFalse((self.dest / "game-creator" / ".env").exists())
        self.assertFalse((self.dest / "game-creator" / ".git").exists())

    def test_conflict_preflight_prevents_partial_install(self):
        target = self.dest / "game-quality"
        target.mkdir(parents=True)
        custom = target / "SKILL.md"
        custom.write_text("User customization", encoding="utf-8")
        with self.assertRaisesRegex(CLI.KitError, "nothing installed"):
            self.kit.install(self.dest, "core")
        self.assertFalse((self.dest / "game-creator").exists())
        self.assertEqual(custom.read_text(encoding="utf-8"), "User customization")

    def test_explicit_replacement_preserves_original_in_backup(self):
        self.kit.install(self.dest, "core")
        custom = self.dest / "game-quality" / "SKILL.md"
        custom.write_text("User customization", encoding="utf-8")
        result = self.kit.install(self.dest, "core", backup_and_replace=True)
        self.assertEqual((Path(result["backup"]) / "game-quality" / "SKILL.md").read_text(), "User customization")
        self.assertFalse((Path(result["backup"]) / "game-creator").exists())
        self.assertIn("Instructions.", custom.read_text())

    def test_dry_run_creates_no_destination(self):
        report = self.kit.install(self.dest, "core", dry_run=True)
        self.assertTrue(report["dry_run"])
        self.assertFalse(self.dest.exists())

    def test_init_preserves_existing_documents(self):
        project = self.base / "My Game"
        output = project / "docs" / "game"
        output.mkdir(parents=True)
        (output / "idea.md").write_text("Existing idea", encoding="utf-8")
        report = self.kit.init_project(project)
        self.assertEqual(len(report["created"]), 7)
        self.assertEqual(report["preserved"], ["idea.md"])
        self.assertEqual((output / "idea.md").read_text(), "Existing idea")
        self.assertEqual((output / "concept.md").read_text(), "My Game\n")
        self.assertEqual(json.loads((output / "state.json").read_text())["project_name"], "My Game")
        self.assertEqual(self.kit.init_project(project)["created"], [])
        self.assertFalse((project / "AGENTS.md").exists())

    def test_json_template_handles_quoted_multiline_unicode_project_names(self):
        # Exercise names legal on Unix without requiring Windows to create one.
        name = 'A "quoted" game\nnext line\\path 🐉'
        template = json.dumps({"project_name": "{{PROJECT_NAME}}", "nested": [
            "prefix {{PROJECT_NAME}} suffix", {"message": "{{PROJECT_NAME}}"}, 42, True, None]})
        rendered = json.loads(CLI.render_template("state.json", template, name))
        self.assertEqual(rendered["project_name"], name)
        self.assertEqual(rendered["nested"][0], f"prefix {name} suffix")
        self.assertEqual(rendered["nested"][1]["message"], name)
        self.assertEqual(rendered["nested"][2:], [42, True, None])

    def test_invalid_json_template_prevents_partial_init(self):
        self.write("skills/game-creator/assets/templates/state.json", "not JSON")
        project = self.base / "uninitialized"
        with self.assertRaisesRegex(CLI.KitError, "Invalid JSON template"):
            self.kit.init_project(project)
        self.assertFalse(project.exists())

    def test_cli_json_supports_unicode_paths_with_legacy_windows_output(self):
        project = self.base / "Game Игра 🐉"
        output = io.BytesIO()
        stream = io.TextIOWrapper(output, encoding="cp1251", errors="strict")
        with patch.object(CLI.sys, "stdout", stream):
            result = CLI.main(["doctor", "--project", str(project)])
        stream.flush()
        report = json.loads(output.getvalue().decode("cp1251"))
        self.assertEqual(result, 0)
        self.assertEqual(report["project"], str(project))
        self.assertFalse(project.exists())

    def test_rejects_traversal_manifest_and_target(self):
        with self.assertRaisesRegex(CLI.KitError, "traversal"):
            self.kit.install(self.base / "x" / ".." / "outside", "core")
        self.manifest["skills"][0]["name"] = "../outside"
        self.write_manifest()
        with self.assertRaisesRegex(CLI.KitError, "Unsafe"):
            CLI.Kit(self.root)

    def test_rejects_source_symlink(self):
        link = self.root / "skills" / "game-quality" / "linked.txt"
        real = self.base / "real.txt"
        real.write_text("outside", encoding="utf-8")
        try:
            link.symlink_to(real)
        except OSError as error:
            self.skipTest(f"OS does not permit symlink creation: {error}")
        with self.assertRaisesRegex(CLI.KitError, "Symlink"):
            self.kit.install(self.dest, "core")
        self.assertFalse(self.dest.exists())

    def test_rejects_target_ancestor_symlink(self):
        real = self.base / "real-project"
        real.mkdir()
        link = self.base / "linked-project"
        try:
            link.symlink_to(real, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"OS does not permit symlink creation: {error}")
        with self.assertRaisesRegex(CLI.KitError, "Symlink"):
            self.kit.install(link / ".agents" / "skills", "core")
        self.assertEqual(list(real.iterdir()), [])

    def test_package_uses_allowlist_and_is_reproducible(self):
        self.write("README.md", "Instructions")
        self.write(".gitattributes", "* text=auto eol=lf\n")
        self.write(".git/config", "local")
        self.write("private/secret.txt", "secret")
        self.write("local-extras/custom.txt", "unknown-license")
        self.write("scripts/.env.local", "secret")
        self.write("scripts/__pycache__/cache.pyc", "cache")
        self.write("scripts/helper.py", "print('ok')")
        first = self.base / "first.zip"
        second = self.base / "second.zip"
        report = self.kit.package(first)
        repeated = self.kit.package(second)
        self.assertEqual(report["sha256"], repeated["sha256"])
        with zipfile.ZipFile(first) as archive:
            names = archive.namelist()
            self.assertIn("kit.json", names)
            self.assertIn(".gitattributes", names)
            self.assertIn("scripts/helper.py", names)
            self.assertFalse(any(".env" in name or ".git/" in name or "private/" in name or "local-extras/" in name or "__pycache__" in name for name in names))
        with self.assertRaisesRegex(CLI.KitError, "already exists"):
            self.kit.package(first)

    def test_failed_install_restores_originals(self):
        self.kit.install(self.dest, "core")
        for name in self.names:
            (self.dest / name / "SKILL.md").write_text(f"custom {name}", encoding="utf-8")
        real_move = CLI.shutil.move
        calls = 0

        def fail_once(source, destination):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise OSError("Simulated filesystem failure")
            return real_move(source, destination)

        with patch.object(CLI.shutil, "move", side_effect=fail_once):
            with self.assertRaisesRegex(CLI.KitError, "originals restored"):
                self.kit.install(self.dest, "core", backup_and_replace=True)
        for name in self.names:
            self.assertEqual((self.dest / name / "SKILL.md").read_text(), f"custom {name}")

    @unittest.skipUnless(os.name == "nt", "Windows junction test")
    def test_rejects_windows_junction_without_traversing_it(self):
        real = self.base / "junction-target"
        real.mkdir()
        sentinel = real / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        junction = self.root / "skills" / "game-quality" / "linked-dir"
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(real)],
                                capture_output=True, check=False)
        if result.returncode:
            self.skipTest("Windows does not permit creating a test junction")
        with self.assertRaisesRegex(CLI.KitError, "junction"):
            self.kit.install(self.dest, "core")
        self.assertFalse(self.dest.exists())
        self.assertEqual(sentinel.read_text(), "keep")

    def test_validate_reports_name_mismatch_and_profile_error(self):
        self.assertEqual(self.kit.validate(), [])
        self.write("skills/game-quality/SKILL.md", "---\nname: wrong-name\ndescription: Test\n---\nText")
        self.assertIn("frontmatter name", self.kit.validate()[0])
        self.manifest["profiles"]["core"] = ["missing"]
        self.write_manifest()
        with self.assertRaisesRegex(CLI.KitError, "Unknown skill"):
            CLI.Kit(self.root)


if __name__ == "__main__":
    unittest.main()
