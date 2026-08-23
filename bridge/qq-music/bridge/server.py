from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4

from .converter import ConversionError, FridaConverter, safe_source_name
from .jobs import JobManager


ALLOWED_ORIGINS = {"https://gugugaga-blog.netlify.app"}
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def server_close(self) -> None:
        manager = getattr(self, "job_manager", None)
        if manager is not None:
            manager.shutdown()
        super().server_close()


class BridgeRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        return

    def _origin_is_allowed(self) -> bool:
        return self.headers.get("Origin") in ALLOWED_ORIGINS

    def _add_cors_headers(self) -> None:
        if self._origin_is_allowed():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")

    def _send_json(self, status: int, payload: dict, cors: bool = True) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cors:
            self._add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str, cors: bool = True) -> None:
        self._send_json(status, {"error": message}, cors=cors)

    def do_OPTIONS(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/convert":
            self._error(404, "未找到接口")
            return
        if not self._origin_is_allowed():
            self._error(403, "不允许的来源", cors=False)
            return
        if self.headers.get("Access-Control-Request-Method", "").upper() != "POST":
            self._error(405, "不支持的预检请求")
            return
        requested_headers = {
            header.strip().lower()
            for header in self.headers.get("Access-Control-Request-Headers", "").split(",")
            if header.strip()
        }
        if not requested_headers.issubset({"content-type", "x-file-name"}):
            self._error(400, "不支持的请求头")
            return
        self.send_response(204)
        self._add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-File-Name")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/health":
            try:
                running = bool(self.server.process_probe())
            except Exception:
                running = False
            self._send_json(200, {
                "ok": True,
                "service": "qq-music-bridge",
                "version": "1.0.0",
                "qqMusicRequired": True,
                "qqMusicRunning": running,
            })
            return
        if path.startswith("/api/jobs/"):
            self._get_job(path.removeprefix("/api/jobs/"))
            return
        if path.startswith("/api/download/"):
            self._download(path.removeprefix("/api/download/"))
            return
        self._error(404, "未找到接口")

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/convert":
            self._error(404, "未找到接口")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/octet-stream":
            self._error(415, "仅支持二进制文件上传")
            return
        length_header = self.headers.get("Content-Length")
        try:
            content_length = int(length_header) if length_header is not None else None
        except ValueError:
            content_length = None
        if content_length is None:
            self._error(411, "缺少有效的文件大小")
            return
        if content_length <= 0:
            self._error(400, "文件不能为空")
            return
        if content_length > MAX_UPLOAD_BYTES:
            self._error(413, "文件不能超过 1 GiB")
            return
        raw_name = unquote(self.headers.get("X-File-Name", ""))
        if "/" in raw_name or "\\" in raw_name:
            self._error(400, "文件名无效")
            return
        try:
            source_name = safe_source_name(raw_name)
        except ConversionError as error:
            self._error(400, str(error))
            return
        job_id = uuid4().hex
        job_dir = self.server.incoming_dir / job_id
        source_path = job_dir / source_name
        if not _is_within(source_path, self.server.incoming_dir):
            self._error(400, "文件名无效")
            return
        try:
            job_dir.mkdir(parents=True, exist_ok=False)
            remaining = content_length
            with source_path.open("wb") as target:
                while remaining:
                    chunk = self.rfile.read(min(64 * 1024, remaining))
                    if not chunk:
                        raise OSError("incomplete upload")
                    target.write(chunk)
                    remaining -= len(chunk)
            job = self.server.job_manager.submit(source_name, source_path, job_id=job_id)
        except (OSError, RuntimeError):
            try:
                source_path.unlink(missing_ok=True)
            except OSError:
                pass
            try:
                job_dir.rmdir()
            except OSError:
                pass
            self._error(500, "无法保存上传文件")
            return
        self._send_json(202, job.to_dict())

    def _get_job(self, job_id: str) -> None:
        if not job_id or "/" in job_id:
            self._error(404, "任务不存在")
            return
        job = self.server.job_manager.get(job_id)
        if job is None:
            self._error(404, "任务不存在")
            return
        self._send_json(200, job.to_dict())

    def _download(self, job_id: str) -> None:
        if not job_id or "/" in job_id:
            self._error(404, "任务不存在")
            return
        job = self.server.job_manager.get(job_id)
        if job is None:
            self._error(404, "任务不存在")
            return
        with job.lock:
            status = job.status
            output_path = job.output_path
            target_name = job.target_name
        if status != "completed":
            self._error(409, "任务尚未完成")
            return
        if output_path is None or not output_path.is_file() or not _is_within(output_path, self.server.output_dir):
            self._error(404, "下载文件不存在")
            return
        try:
            size = output_path.stat().st_size
            with output_path.open("rb") as source:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(target_name)}")
                self._add_cors_headers()
                self.end_headers()
                shutil.copyfileobj(source, self.wfile)
        except OSError:
            # The headers may already be on the wire; do not expose filesystem details.
            return


def create_server(host, port, data_root, hook_path=None, converter=None, process_probe=None) -> ThreadingHTTPServer:
    if host != "127.0.0.1":
        raise ValueError("bridge must listen on 127.0.0.1")
    root = Path(data_root)
    runtime_dir = root / "runtime"
    incoming_dir = runtime_dir / "incoming"
    output_dir = runtime_dir / "output"
    if converter is None:
        default_hook = Path(hook_path) if hook_path is not None else Path(__file__).resolve().parents[1] / "hook_qq_music.js"
        frida_converter = FridaConverter(default_hook, runtime_dir / "decrypting")
        converter = frida_converter.convert
        if process_probe is None:
            process_probe = frida_converter.is_qq_music_running
    if process_probe is None:
        process_probe = lambda: False
    manager = JobManager(converter, output_dir, incoming_dir)
    try:
        httpd = BridgeHTTPServer((host, port), BridgeRequestHandler)
    except OSError:
        manager.shutdown()
        raise
    httpd.job_manager = manager
    httpd.incoming_dir = incoming_dir
    httpd.output_dir = output_dir
    httpd.process_probe = process_probe
    return httpd
