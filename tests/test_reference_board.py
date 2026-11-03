from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import importlib.util
SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "game-creator" / "scripts"
def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

board = load_module("gfk_board", SCRIPTS / "build_reference_board.py")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=")


class ReferenceBoardTests(unittest.TestCase):
    def fixture(self, root):
        image = root / "Картинки с пробелами" / "кадр.png"
        image.parent.mkdir()
        image.write_bytes(PNG)
        manifest = {"title": "<script>alert(1)</script>", "directions": [{
            "id": 'arena" onclick="alert(1)', "name": "Один экран", "notes": "<b>Notes</b>",
            "images": [{"path": "Картинки с пробелами/кадр.png", "caption": "Камера", "source": "https://example.com/?x=1&y=2"}]}]}
        path = root / "доска.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8-sig")
        return path, manifest

    def test_portable_board_escapes_input_and_preserves_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path, _ = self.fixture(root)
            output = board.build(path, root / "Просмотр доски" / "board.html")
            text = output.read_text(encoding="utf-8")
            self.assertIn("data:image/png;base64," + base64.b64encode(PNG).decode(), text)
            self.assertNotIn("<script>alert(1)</script>", text)
            self.assertIn("&lt;script&gt;", text)
            self.assertNotIn('value="arena" onclick=', text)
            self.assertIn("https://example.com/?x=1&amp;y=2", text)
            self.assertEqual((root / "Картинки с пробелами/кадр.png").read_bytes(), PNG)

    def test_existing_output_requires_explicit_replace(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path, _ = self.fixture(root)
            output = root / "board.html"
            output.write_text("user work", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                board.build(path, output)
            self.assertEqual(output.read_text(), "user work")
            board.build(path, output, replace=True)
            self.assertIn("<!doctype html>", output.read_text(encoding="utf-8"))

    def test_invalid_board_does_not_write_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path, manifest = self.fixture(root)
            for invalid in ("javascript:alert(1)", "file:///C:/secret.txt", "https:///missing-host"):
                manifest["directions"][0]["images"][0]["source"] = invalid
                path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    board.build(path, root / "new" / "board.html")
                self.assertFalse((root / "new").exists())

    def test_missing_images_and_duplicate_ids_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _, manifest = self.fixture(root)
            manifest["directions"].append(manifest["directions"][0])
            with self.assertRaises(ValueError):
                board.render(manifest, root)
            manifest["directions"].pop()
            manifest["directions"][0]["images"][0]["path"] = "missing.png"
            with self.assertRaises(FileNotFoundError):
                board.render(manifest, root)
            manifest["directions"][0]["images"] = []
            with self.assertRaises(ValueError):
                board.render(manifest, root)

    def test_unsupported_and_oversized_images(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "image.png"
            path.write_text("<svg onload='alert(1)'/>")
            with self.assertRaises(ValueError):
                board.image_data(path)
            path.write_bytes(PNG)
            with patch.object(board, "MAX_IMAGE_BYTES", 10):
                with self.assertRaises(ValueError):
                    board.image_data(path)

    def test_bundled_example_renders(self):
        manifest = SCRIPTS.parent / "assets" / "reference-board" / "board.json"
        with tempfile.TemporaryDirectory() as temp:
            output = board.build(manifest, Path(temp) / "example.html")
            self.assertEqual(output.read_text(encoding="utf-8").count("data:image/png;base64,"), 3)

    def test_core_profile_installs_a_self_contained_board(self):
        root = SCRIPTS.parents[2]
        cli = load_module("gfk_cli_board_test", root / "scripts" / "kit.py")
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp).resolve()
            destination = folder / "project" / ".agents" / "skills"
            cli.Kit(root).install(destination, "core")
            installed = destination / "game-creator"
            helper = load_module("gfk_installed_board", installed / "scripts" / "build_reference_board.py")
            output = helper.build(installed / "assets" / "reference-board" / "board.json", folder / "board.html")
            self.assertEqual(output.read_text(encoding="utf-8").count("data:image/png;base64,"), 3)


if __name__ == "__main__":
    unittest.main()
