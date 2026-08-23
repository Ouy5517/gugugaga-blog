from pathlib import Path
import hashlib
import unittest


ROOT = Path(__file__).resolve().parents[1]


class HookContractTests(unittest.TestCase):
    def test_preserves_supplied_hook_and_rpc_contract(self):
        source = (ROOT / "hook_qq_music.js").read_text(encoding="utf-8")
        self.assertIn('const TARGET_DLL = "QQMusicCommon.dll"', source)
        for symbol in [
            "??0EncAndDesMediaFile@@QAE@XZ",
            "??1EncAndDesMediaFile@@QAE@XZ",
            "?Open@EncAndDesMediaFile@@QAE_NPB_W_N1@Z",
            "?GetSize@EncAndDesMediaFile@@QAEKXZ",
            "?Read@EncAndDesMediaFile@@QAEKPAEK_J@Z",
        ]:
            self.assertIn(symbol, source)
        self.assertIn('"thiscall"', source)
        self.assertIn("rpc.exports", source)
        self.assertIn("decrypt: function", source)
        digest = hashlib.sha256((ROOT / "hook_qq_music.js").read_bytes()).hexdigest().upper()
        self.assertEqual(digest, "EB99931C457C767AF510DE7E1D01D71B13DF1FB21184110CBB8F7A97AEA6AE97")
