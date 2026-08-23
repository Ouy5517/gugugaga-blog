import sys
from pathlib import Path
import tempfile
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.jobs import JobManager


def wait_until(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class JobManagerTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.output_dir = self.root / "output"
        self.incoming_dir = self.root / "incoming"
        self.managers = []

    def tearDown(self):
        for manager in self.managers:
            manager.shutdown()
        self.temporary_directory.cleanup()

    def make_manager(self, converter):
        manager = JobManager(converter, self.output_dir, self.incoming_dir)
        self.managers.append(manager)
        return manager

    def test_worker_completes_job_and_removes_uploaded_source(self):
        source = self.root / "song.mflac"
        source.write_bytes(b"encrypted")

        def converter(source_path, source_name, output_dir, progress):
            progress(50, "正在解密")
            target = output_dir / "song.flac"
            target.write_bytes(source_path.read_bytes())
            progress(100, "转换完成")
            return target

        manager = self.make_manager(converter)
        job = manager.submit("song.mflac", source)

        self.assertTrue(wait_until(lambda: job.status == "completed"))
        self.assertEqual(job.progress, 100)
        self.assertFalse(source.exists())
        self.assertEqual(job.to_dict()["downloadUrl"], f"/api/download/{job.job_id}")

    def test_worker_serializes_native_calls(self):
        active_calls = 0
        max_active_calls = 0
        counter_lock = threading.Lock()

        def converter(source_path, source_name, output_dir, progress):
            nonlocal active_calls, max_active_calls
            with counter_lock:
                active_calls += 1
                max_active_calls = max(max_active_calls, active_calls)
            time.sleep(0.05)
            target = output_dir / f"{Path(source_name).stem}.flac"
            target.write_bytes(b"decoded")
            with counter_lock:
                active_calls -= 1
            return target

        manager = self.make_manager(converter)
        first = self.root / "first.mflac"
        second = self.root / "second.mflac"
        first.write_bytes(b"one")
        second.write_bytes(b"two")
        first_job = manager.submit(first.name, first)
        second_job = manager.submit(second.name, second)

        self.assertTrue(wait_until(lambda: first_job.status == "completed"))
        self.assertTrue(wait_until(lambda: second_job.status == "completed"))
        self.assertEqual(max_active_calls, 1)

    def test_worker_never_exposes_an_output_outside_the_output_directory(self):
        source = self.root / "song.mflac"
        source.write_bytes(b"encrypted")
        outside_output = self.root / "outside.flac"
        outside_output.write_bytes(b"decoded")

        manager = self.make_manager(lambda *_args: outside_output)
        job = manager.submit(source.name, source)

        self.assertTrue(wait_until(lambda: job.status == "failed"))
        self.assertNotIn("downloadUrl", job.to_dict())
        self.assertNotIn(str(self.root), job.to_dict()["error"])
