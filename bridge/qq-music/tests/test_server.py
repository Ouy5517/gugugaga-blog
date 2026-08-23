import http.client
import json
from pathlib import Path
from urllib.parse import quote
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.server import MAX_UPLOAD_BYTES, create_server


BLOG_ORIGIN = "https://gugugaga-blog.netlify.app"
LOCAL_DEV_ORIGIN = "http://127.0.0.1:5173"


class BridgeServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.server = create_server(
            "127.0.0.1",
            0,
            self.root,
            converter=self.fake_converter,
            process_probe=lambda: False,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    @staticmethod
    def fake_converter(source_path, source_name, output_dir, progress):
        progress(50, "正在解密")
        target = output_dir / f"{Path(source_name).stem}.flac"
        target.write_bytes(b"decoded")
        progress(100, "转换完成")
        return target

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        response.body = response.read()
        connection.close()
        return response

    def wait_for_job(self, job_id):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            response = self.request("GET", f"/api/jobs/{job_id}")
            payload = json.loads(response.body)
            if payload["status"] in {"completed", "failed"}:
                return payload
            time.sleep(0.01)
        self.fail("job did not finish")

    def upload(self, name="song.mflac", body=b"encrypted", headers=None):
        request_headers = {
            "Content-Type": "application/octet-stream",
            "X-File-Name": quote(name),
        }
        request_headers.update(headers or {})
        return self.request("POST", "/api/convert", body, request_headers)

    def test_health_upload_job_and_download(self):
        health = self.request("GET", "/api/health")
        self.assertEqual(health.status, 200)
        self.assertEqual(json.loads(health.body), {
            "ok": True,
            "service": "qq-music-bridge",
            "version": "1.0.0",
            "qqMusicRequired": True,
            "qqMusicRunning": False,
        })
        upload = self.upload("测试.mflac")
        self.assertEqual(upload.status, 202)
        job_id = json.loads(upload.body)["jobId"]
        self.assertEqual(self.wait_for_job(job_id)["status"], "completed")
        download = self.request("GET", f"/api/download/{job_id}")
        self.assertEqual(download.status, 200)
        self.assertEqual(download.body, b"decoded")

    def test_same_named_uploads_receive_their_own_output(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

        def reuse_if_present(source_path, source_name, output_dir, _progress):
            target = output_dir / f"{Path(source_name).stem}.flac"
            if not target.exists():
                target.write_bytes(source_path.read_bytes())
            return target

        self.server = create_server("127.0.0.1", 0, self.root, converter=reuse_if_present)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        first_id = json.loads(self.upload(body=b"first-owner").body)["jobId"]
        second_id = json.loads(self.upload(body=b"second-owner").body)["jobId"]
        self.assertEqual(self.wait_for_job(first_id)["status"], "completed")
        self.assertEqual(self.wait_for_job(second_id)["status"], "completed")

        self.assertEqual(self.request("GET", f"/api/download/{first_id}").body, b"first-owner")
        self.assertEqual(self.request("GET", f"/api/download/{second_id}").body, b"second-owner")

    def test_preflight_allows_only_blog_origin(self):
        allowed = self.request("OPTIONS", "/api/convert", headers={
            "Origin": BLOG_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-file-name",
            "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(allowed.status, 204)
        self.assertEqual(allowed.headers["Access-Control-Allow-Origin"], BLOG_ORIGIN)
        self.assertEqual(allowed.headers["Access-Control-Allow-Private-Network"], "true")

        denied = self.request("OPTIONS", "/api/convert", headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        })
        self.assertNotIn("Access-Control-Allow-Origin", denied.headers)
        self.assertNotIn("Access-Control-Allow-Private-Network", denied.headers)

    def test_preflight_allows_local_vite_origin(self):
        response = self.request("OPTIONS", "/api/convert", headers={
            "Origin": LOCAL_DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-file-name",
            "Access-Control-Request-Private-Network": "true",
        })

        self.assertEqual(response.status, 204)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], LOCAL_DEV_ORIGIN)
        self.assertEqual(response.headers["Access-Control-Allow-Private-Network"], "true")

    def test_rejects_invalid_uploads_without_writing_outside_runtime(self):
        for name, body, headers in [
            ("song.mp3", b"encrypted", {}),
            ("song.mflac", b"", {}),
            ("../../escape.mflac", b"encrypted", {}),
            ("song.mflac", b"encrypted", {"Content-Length": str(MAX_UPLOAD_BYTES + 1)}),
        ]:
            with self.subTest(name=name, headers=headers):
                response = self.upload(name, body, headers)
                self.assertIn(response.status, {400, 413})
                self.assertNotIn(str(self.root), response.body.decode("utf-8"))
        self.assertFalse((self.root / "escape.mflac").exists())

    def test_unknown_jobs_and_unfinished_downloads_return_safe_errors(self):
        unknown = self.request("GET", "/api/jobs/does-not-exist")
        self.assertEqual(unknown.status, 404)

        started = threading.Event()
        release = threading.Event()

        def slow_converter(source_path, source_name, output_dir, progress):
            started.set()
            release.wait(timeout=2)
            target = output_dir / "song.flac"
            target.write_bytes(b"decoded")
            return target

        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.server = create_server("127.0.0.1", 0, self.root, converter=slow_converter)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        job_id = json.loads(self.upload().body)["jobId"]
        self.assertTrue(started.wait(timeout=2))
        unfinished = self.request("GET", f"/api/download/{job_id}")
        self.assertEqual(unfinished.status, 409)
        self.assertNotIn(str(self.root), unfinished.body.decode("utf-8"))
        release.set()

    def test_download_refuses_a_completed_job_with_an_external_output_path(self):
        job_id = json.loads(self.upload().body)["jobId"]
        self.assertEqual(self.wait_for_job(job_id)["status"], "completed")
        outside_output = self.root / "outside.flac"
        outside_output.write_bytes(b"private")
        job = self.server.job_manager.get(job_id)
        with job.lock:
            job.output_path = outside_output

        response = self.request("GET", f"/api/download/{job_id}")

        self.assertEqual(response.status, 404)
        self.assertNotIn(str(self.root), response.body.decode("utf-8"))

    def test_rejects_non_loopback_listener(self):
        with self.assertRaises(ValueError):
            create_server("0.0.0.0", 0, self.root, converter=self.fake_converter)

    def test_failed_bind_shuts_down_the_created_job_manager(self):
        with patch("bridge.server.JobManager") as manager, patch("bridge.server.BridgeHTTPServer", side_effect=OSError(10048, "address already in use")):
            with self.assertRaises(OSError):
                create_server("127.0.0.1", 0, self.root, converter=self.fake_converter)

        manager.return_value.shutdown.assert_called_once_with()
