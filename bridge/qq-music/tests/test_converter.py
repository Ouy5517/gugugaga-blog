import sys
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.converter import ConversionError, ConversionPlan, safe_source_name, target_name


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
