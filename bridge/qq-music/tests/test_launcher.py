from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main
from main import build_server, data_root, resource_path


BUILD_SCRIPT = ROOT / "build.ps1"
REPOSITORY_ROOT = ROOT.parents[1]


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

    def test_main_reports_occupied_port_without_traceback(self):
        with patch("main.build_server", side_effect=OSError(10048, "address already in use")), patch("builtins.print") as output:
            self.assertEqual(main.main(open_browser=False), 1)

        self.assertIn("8765", output.call_args.args[0])
        self.assertIn("被占用", output.call_args.args[0])

    def test_main_cleans_up_after_ctrl_c_without_opening_browser(self):
        server = MagicMock()
        manager = MagicMock()
        server.job_manager = manager
        thread = MagicMock()
        thread.join.side_effect = [KeyboardInterrupt, None]
        cleanup = []
        server.shutdown.side_effect = lambda: cleanup.append("server.shutdown")
        server.server_close.side_effect = lambda: cleanup.append("server.server_close")
        manager.shutdown.side_effect = lambda: cleanup.append("job_manager.shutdown")

        with patch("main.build_server", return_value=server), patch("main.threading.Thread", return_value=thread), patch("main.webbrowser.open") as open_browser, patch("main._wait_for_health") as wait_for_health:
            self.assertEqual(main.main(open_browser=False), 0)

        thread.start.assert_called_once_with()
        wait_for_health.assert_not_called()
        open_browser.assert_not_called()
        self.assertEqual(cleanup, ["server.shutdown", "server.server_close", "job_manager.shutdown"])

    def test_main_opens_browser_only_after_health_check(self):
        server = MagicMock()
        thread = MagicMock()
        thread.join.side_effect = [KeyboardInterrupt, None]

        with patch("main.build_server", return_value=server), patch("main.threading.Thread", return_value=thread), patch("main._wait_for_health", return_value=True) as wait_for_health, patch("main.webbrowser.open") as open_browser:
            self.assertEqual(main.main(), 0)

        wait_for_health.assert_called_once_with()
        open_browser.assert_called_once_with(main.TOOL_URL)

    def test_run_cli_disables_browser_for_no_browser_argument(self):
        with patch("main.main", return_value=0) as launch:
            self.assertEqual(main.run_cli(["--no-browser"]), 0)

        launch.assert_called_once_with(open_browser=False)

    def test_build_script_stops_after_failed_dependency_install_from_any_directory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            fake_bin = temporary_root / "fake-bin"
            fake_bin.mkdir()
            log_path = temporary_root / "python.log"
            (fake_bin / "python.cmd").write_text(
                "@echo off\n"
                "echo %CD% ^| %*>> \"%BUILD_LOG%\"\n"
                "if /I \"%2\"==\"pip\" exit /b 17\n"
                "exit /b 0\n",
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment["PATH"] = f"{fake_bin}{os.pathsep}{environment['PATH']}"
            environment["BUILD_LOG"] = str(log_path)
            result = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(BUILD_SCRIPT)],
                cwd=temporary_root,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 17)
            invocations = log_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(invocations), 1)
            self.assertEqual(Path(invocations[0].split(" | ", 1)[0]), REPOSITORY_ROOT)
            self.assertIn("-m pip install", invocations[0])
