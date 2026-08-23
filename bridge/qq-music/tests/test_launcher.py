from pathlib import Path
import sys
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from main import build_server, data_root, resource_path


class LauncherTests(unittest.TestCase):
    def test_resource_path_uses_pyinstaller_bundle(self):
        original = getattr(sys, "_MEIPASS", None)
        try:
            sys._MEIPASS = r"C:\bundle"
            self.assertEqual(
                resource_path("hook_qq_music.js"),
                Path(r"C:\bundle\hook_qq_music.js"),
            )
        finally:
            if original is None:
                del sys._MEIPASS
            else:
                sys._MEIPASS = original

    def test_launcher_binds_only_to_loopback(self):
        with patch("main.create_server") as create:
            build_server()
            create.assert_called_once_with(
                "127.0.0.1", 8765, data_root(),
                hook_path=resource_path("hook_qq_music.js"),
            )
