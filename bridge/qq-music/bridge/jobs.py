from dataclasses import dataclass, field
from pathlib import Path
from queue import Queue
import threading
from typing import Callable
from uuid import uuid4

from .converter import safe_source_name, target_name


ProgressCallback = Callable[[int, str], None]
Converter = Callable[[Path, str, Path, ProgressCallback], Path]


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


@dataclass
class Job:
    job_id: str
    source_name: str
    source_path: Path
    target_name: str
    status: str = "queued"
    progress: int = 0
    stage: str = "等待转换"
    error: str | None = None
    output_path: Path | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def to_dict(self) -> dict:
        with self.lock:
            payload = {
                "jobId": self.job_id,
                "sourceName": self.source_name,
                "targetName": self.target_name,
                "status": self.status,
                "progress": self.progress,
                "stage": self.stage,
            }
            if self.error:
                payload["error"] = self.error
            if self.status == "completed":
                payload["downloadUrl"] = f"/api/download/{self.job_id}"
            return payload


class JobManager:
    def __init__(self, converter: Converter, output_dir: Path, incoming_dir: Path):
        self.converter = converter
        self.output_dir = Path(output_dir)
        self.incoming_dir = Path(incoming_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.incoming_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._jobs_lock = threading.Lock()
        self._queue: Queue[Job | None] = Queue()
        self._shutdown_lock = threading.Lock()
        self._stopped = False
        self._worker = threading.Thread(target=self._work, name="qq-music-converter", daemon=True)
        self._worker.start()

    def submit(self, source_name: str, source_path: Path, job_id: str | None = None) -> Job:
        clean_name = safe_source_name(source_name)
        job = Job(
            job_id=job_id or uuid4().hex,
            source_name=clean_name,
            source_path=Path(source_path),
            target_name=target_name(clean_name),
        )
        with self._jobs_lock:
            if self._stopped:
                raise RuntimeError("转换服务不可用")
            self._jobs[job.job_id] = job
        self._queue.put(job)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def shutdown(self) -> None:
        with self._shutdown_lock:
            if self._stopped:
                return
            self._stopped = True
            self._queue.put(None)
        self._worker.join(timeout=5)

    def _work(self) -> None:
        while True:
            job = self._queue.get()
            try:
                if job is None:
                    return
                self._convert(job)
            finally:
                self._queue.task_done()

    def _convert(self, job: Job) -> None:
        def progress(value: int, stage: str) -> None:
            try:
                numeric_value = int(value)
            except (TypeError, ValueError):
                return
            with job.lock:
                job.progress = max(0, min(100, numeric_value))
                job.stage = str(stage)

        with job.lock:
            job.status = "converting"
            job.stage = "正在转换"
        try:
            result = Path(self.converter(job.source_path, job.source_name, self.output_dir, progress))
            if not result.is_file() or not _is_within(result, self.output_dir):
                raise RuntimeError("invalid conversion output")
            with job.lock:
                job.output_path = result
                job.status = "completed"
                job.progress = 100
                job.stage = "转换完成"
        except Exception:
            with job.lock:
                job.status = "failed"
                job.stage = "转换失败"
                job.error = "转换失败，请确认文件和 QQ 音乐状态后重试"
        finally:
            try:
                job.source_path.unlink(missing_ok=True)
            except OSError:
                pass
