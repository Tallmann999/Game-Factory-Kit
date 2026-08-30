from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "game-factory-kit" / "scripts"
INIT_SCRIPT = SCRIPTS / "init_game_project.py"
VALIDATE_SCRIPT = SCRIPTS / "validate_game_project.py"
EXAMPLE = ROOT / "examples" / "mage-cleanse-corruption"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScriptTests(unittest.TestCase):
    def test_slugify(self):
        module = load_module("gfk_init", INIT_SCRIPT)
        self.assertEqual(module.slugify("Mage: Cleanse!"), "mage-cleanse")
        self.assertEqual(module.slugify("---"), "game-project")

    def test_initializer_creates_valid_workspace_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            command = [
                sys.executable,
                str(INIT_SCRIPT),
                "Test Game",
                "--output",
                temporary,
                "--engine",
                "web",
                "--platform",
                "browser",
                "--genre",
                "incremental",
                "--stage",
                "prototype",
            ]
            first = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)

            project = Path(temporary) / "test-game"
            validation = subprocess.run(
                [sys.executable, str(VALIDATE_SCRIPT), str(project)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(validation.returncode, 0, validation.stderr)

            second = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("already exists", second.stderr)

    def test_example_is_valid(self):
        result = subprocess.run(
            [sys.executable, str(VALIDATE_SCRIPT), str(EXAMPLE)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
