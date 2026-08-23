import argparse
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import sys
import threading
from time import monotonic, sleep
from urllib.request import urlopen
import webbrowser

from bridge.server import create_server


BRIDGE_URL = "http://127.0.0.1:8765"
TOOL_URL = "https://gugugaga-blog.netlify.app/tools/qq-music-converter"


def _safe_print(message: str) -> None:
    """Print status text without crashing on legacy Windows consoles."""
    try:
        print(message)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
        safe_message = message.encode(encoding, errors="replace").decode(encoding)
        print(safe_message)


def resource_path(relative: str) -> Path:
    """Return a bundled resource path both in development and PyInstaller."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


def data_root() -> Path:
    """Return the persistent, per-user bridge data directory."""
    local_app_data = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    root = local_app_data / "Gugugaga" / "QQMusicBridge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def build_server() -> ThreadingHTTPServer:
    return create_server(
        "127.0.0.1", 8765, data_root(),
        hook_path=resource_path("hook_qq_music.js"),
    )


def _wait_for_health(timeout: float = 5) -> bool:
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        try:
            with urlopen(f"{BRIDGE_URL}/api/health", timeout=1) as response:
                if response.status == 200:
                    return True
        except OSError:
            sleep(0.05)
    return False


def main(open_browser: bool = True) -> int:
    try:
        server = build_server()
    except OSError as error:
        if error.errno == 10048:
            _safe_print("本地服务端口 8765 已被占用，请关闭占用该端口的程序后重试。")
        else:
            _safe_print(f"无法启动 QQ 音乐转换服务：{error}")
        return 1
    thread = threading.Thread(target=server.serve_forever, name="qq-music-bridge", daemon=True)
    thread.start()
    _safe_print(f"QQ 音乐转换服务已启动：{BRIDGE_URL}")
    try:
        if open_browser and _wait_for_health():
            webbrowser.open(TOOL_URL)
        thread.join()
    except KeyboardInterrupt:
        _safe_print("正在停止 QQ 音乐转换服务…")
    finally:
        server.shutdown()
        server.server_close()
        server.job_manager.shutdown()
        thread.join(timeout=5)
    return 0


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="QQ 音乐转换本地桥接服务")
    parser.add_argument("--no-browser", action="store_true", help="启动后不打开网页工具")
    args = parser.parse_args(argv)
    return main(open_browser=not args.no_browser)


if __name__ == "__main__":
    raise SystemExit(run_cli())
