import importlib.util
from pathlib import Path
import tempfile
import unittest

MODULE = importlib.util.spec_from_file_location("prepare_ui", Path(__file__).resolve().parents[1] / "skills/game-roblox-ui/scripts/prepare_ui.py")
UI = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(UI)


class RobloxUITests(unittest.TestCase):
    def test_portable_bundle_is_repeatable_and_preserves_authored_spec(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            result = UI.prepare(root, "F-001_Inventory")
            self.assertEqual(set(result.values()), {"created"})
            spec = root / "docs/Features/F-001_Inventory.UI.md"
            self.assertIn("](../../Instructions/UI/UI_STYLES.md)", spec.read_text(encoding="utf-8"))
            self.assertEqual(set(UI.prepare(root, "F-001_Inventory").values()), {"unchanged"})
            spec.write_text("Author's UI decisions", encoding="utf-8")
            self.assertEqual(UI.prepare(root, "F-001_Inventory")["docs/Features/F-001_Inventory.UI.md"], "kept_existing")
            self.assertEqual(spec.read_text(encoding="utf-8"), "Author's UI decisions")
            self.assertFalse((root / "docs/Features/UI_HIERARCHY.md").exists())  # no fabricated Studio evidence

    def test_feature_name_cannot_escape_game(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                UI.prepare(Path(folder).resolve(), "../other")
            self.assertEqual(list(Path(folder).iterdir()), [])
