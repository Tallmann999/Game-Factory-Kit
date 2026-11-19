"""Portable Roblox art profile; no Studio, uploads or live game changes."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gamekit_art", ROOT / "scripts/kit.py")
CLI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLI)


class RobloxArtTests(unittest.TestCase):
    def test_roblox_profile_carries_art_direction_and_its_dependency_closure(self):
        kit = CLI.Kit(ROOT)
        additions = {"game-roblox-art-director", "scenario-roblox-environment"}
        for profile in ["roblox", "full"]:
            self.assertTrue(additions <= set(kit.select(profile)))
        for profile in ["core", "web", "unity", "mobile"]:
            self.assertTrue(additions.isdisjoint(kit.select(profile)))
        with tempfile.TemporaryDirectory(prefix="gfk-art-") as folder:
            dest = Path(folder).resolve() / "installed skills"
            kit.install(dest, "roblox")
            for name in additions | {"scenario-roblox-expert", "game-roblox-ui", "game-art-director", "game-roblox"}:
                self.assertTrue((dest / name / "SKILL.md").is_file())
                self.assertTrue((dest / name / "LICENSE").is_file())
            # Resolve the new skill's Markdown dependencies from an installed copy.
            import re
            for source in (dest / "game-roblox-art-director").rglob("*.md"):
                for link in re.findall(r"\]\(([^)]+)\)", source.read_text(encoding="utf-8")):
                    if not link.startswith(("http:", "https:", "#")):
                        self.assertTrue((source.parent / link.split("#")[0]).is_file(), (source, link))
            code = """
import importlib.util, inspect, pathlib, sys
entry = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('installed_environment', entry)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
toolkit = entry.parents[2] / 'scenario-roblox-expert' / 'scripts'
assert module._toolkit().resolve() == toolkit.resolve()
assert pathlib.Path(module.rbx_run.__file__).parent.resolve() == toolkit.resolve()
inspect.signature(module.rbx_run.run).bind(None, 'return true', dm='Edit', timeout=None, kit=[])
source = module.kit_source(module.MODULES)
assert len(source) > 1000
try:
    module.kit_source(['unknown-module'])
except ValueError:
    pass
else:
    raise AssertionError('Unknown environment module accepted')
"""
            result = subprocess.run(
                [sys.executable, "-X", "utf8", "-c", code, str(dest / "scenario-roblox-environment/scripts/rbx_environment.py")],
                cwd=folder, capture_output=True, text=True, encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(set(kit.install(dest, "roblox")["actions"].values()), {"unchanged"})
