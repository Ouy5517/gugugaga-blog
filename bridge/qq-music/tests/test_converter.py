import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.converter import (
    ConversionError,
    ConversionPlan,
    FridaConverter,
    safe_source_name,
    target_name,
)


class FakeProcess:
    def __init__(self, name):
        self.name = name


class FakeExports:
    def __init__(self, frida):
        self.frida = frida

    def decrypt(self, source_path, temporary_path):
        Path(temporary_path).write_bytes(b"decoded")
        if self.frida.decrypt_error:
            raise self.frida.decrypt_error


class FakeScript:
    def __init__(self, source, frida):
        self.source = source
        self.loaded = False
        self.exports_sync = FakeExports(frida)

    def load(self):
        self.loaded = True


class FakeSession:
    def __init__(self, frida):
        self.frida = frida
        self.script = None
        self.detached = False

    def create_script(self, source):
        self.script = FakeScript(source, self.frida)
        return self.script

    def detach(self):
        self.detached = True


class FakeFrida:
    def __init__(self):
        self.attached_process = None
        self.attach_error = None
        self.decrypt_error = None
        self.process_names = []
        self.session = FakeSession(self)

    def attach(self, process_name):
        if self.attach_error:
            raise self.attach_error
        self.attached_process = process_name
        return self.session

    def get_local_device(self):
        return self

    def enumerate_processes(self):
        return [FakeProcess(name) for name in self.process_names]


class ConverterNamingTests(unittest.TestCase):
    def test_maps_supported_extensions_case_insensitively(self):
        self.assertEqual(target_name("demo.mflac"), "demo.flac")
        self.assertEqual(target_name("DEMO.MGG"), "DEMO.ogg")

    def test_reduces_upload_name_to_basename(self):
        self.assertEqual(safe_source_name("../../music/song.mflac"), "song.mflac")

    def test_rejects_unsupported_extension(self):
        with self.assertRaisesRegex(ConversionError, "仅支持"):
            safe_source_name("song.mp3")

    def test_creates_isolated_temporary_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "song.mflac"
            source.write_bytes(b"encrypted")
            plan = ConversionPlan.create(source, source.name, root / "output", root / "runtime")
            self.assertEqual(plan.output_path.name, "song.flac")
            self.assertEqual(plan.temporary_path.suffix, ".decrypting")


class FridaConverterTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.source = self.root / "song.mflac"
        self.source.write_bytes(b"encrypted")
        self.hook = self.root / "hook_qq_music.js"
        self.hook.write_text("rpc.exports = {};", encoding="utf-8")
        self.output = self.root / "output"
        self.runtime = self.root / "runtime"
        self.fake_frida = FakeFrida()
        self.converter = FridaConverter(self.hook, self.runtime, self.fake_frida)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_converter_attaches_loads_hook_and_moves_output(self):
        updates = []

        result = self.converter.convert(
            self.source,
            "song.mflac",
            self.output,
            lambda value, stage: updates.append((value, stage)),
        )

        self.assertEqual(result, self.output / "song.flac")
        self.assertEqual(self.fake_frida.attached_process, "QQMusic.exe")
        self.assertTrue(self.fake_frida.session.script.loaded)
        self.assertTrue(self.fake_frida.session.detached)
        self.assertEqual(result.read_bytes(), b"decoded")
        self.assertEqual(updates[-1], (100, "转换完成"))

    def test_converter_reuses_existing_output_without_calling_frida(self):
        self.output.mkdir()
        expected_output = self.output / "song.flac"
        expected_output.write_bytes(b"already decoded")

        result = self.converter.convert(self.source, self.source.name, self.output)

        self.assertEqual(result, expected_output)
        self.assertIsNone(self.fake_frida.attached_process)

    def test_converter_reports_missing_qq_music(self):
        self.fake_frida.attach_error = RuntimeError("process not found")

        with self.assertRaisesRegex(ConversionError, "QQ 音乐正在运行"):
            self.converter.convert(self.source, self.source.name, self.output)

    def test_converter_reports_missing_hook(self):
        converter = FridaConverter(self.root / "missing.js", self.runtime, self.fake_frida)

        with self.assertRaisesRegex(ConversionError, "找不到 hook_qq_music.js"):
            converter.convert(self.source, self.source.name, self.output)

    def test_converter_detaches_when_temporary_cleanup_fails(self):
        self.fake_frida.decrypt_error = RuntimeError("decrypt failed")

        def deny_temporary_file_cleanup(path):
            if path.suffix == ".decrypting":
                raise OSError(f"cleanup denied: {path}")
            return original_unlink(path)

        original_unlink = Path.unlink
        with patch("bridge.converter.Path.unlink", new=deny_temporary_file_cleanup):
            with self.assertRaisesRegex(ConversionError, "转换失败") as context:
                self.converter.convert(self.source, self.source.name, self.output)

        self.assertTrue(self.fake_frida.session.detached)
        self.assertNotIn(str(self.runtime), str(context.exception))

    def test_converter_hides_output_directory_creation_failure(self):
        invalid_output = self.root / "not-a-directory"
        invalid_output.write_bytes(b"not a directory")

        with self.assertRaisesRegex(ConversionError, "无法准备转换目录") as context:
            self.converter.convert(self.source, self.source.name, invalid_output)

        self.assertNotIn(str(invalid_output), str(context.exception))

    def test_converter_hides_runtime_directory_creation_failure(self):
        invalid_runtime = self.root / "not-a-directory"
        invalid_runtime.write_bytes(b"not a directory")
        converter = FridaConverter(self.hook, invalid_runtime, self.fake_frida)

        with self.assertRaisesRegex(ConversionError, "无法准备转换目录") as context:
            converter.convert(self.source, self.source.name, self.output)

        self.assertNotIn(str(invalid_runtime), str(context.exception))

    def test_process_probe_reports_qq_music(self):
        self.fake_frida.process_names = ["explorer.exe", "QQMusic.exe"]

        self.assertTrue(self.converter.is_qq_music_running())
