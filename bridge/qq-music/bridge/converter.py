from dataclasses import dataclass
import os
from pathlib import Path, PurePosixPath
from typing import Callable
from uuid import uuid4


SUPPORTED_EXTENSIONS = {".mflac": ".flac", ".mgg": ".ogg"}
DEFAULT_CONVERSION_ERROR = "转换失败，请确认文件和 QQ 音乐状态后重试"
PUBLIC_CONVERSION_ERROR_MESSAGES = frozenset({
    "文件名无效",
    "仅支持 .mflac 和 .mgg 文件",
    "无法准备转换目录",
    "Frida 运行环境不可用，请重新下载并启动 QQ Music Bridge",
    "找不到 hook_qq_music.js，请重新下载并启动 QQ Music Bridge",
    "无法连接 QQ 音乐，请确认 QQ 音乐正在运行；若已运行，请退出后重新启动 QQ 音乐，再重试",
    "当前 QQ 音乐版本暂不兼容，请更新 QQ Music Bridge 或更换 QQ 音乐版本",
    "缓存文件转换失败，请确认文件有效后重试",
    "无法写入转换结果，请确认本机磁盘空间后重试",
})


class ConversionError(RuntimeError):
    pass


def safe_conversion_error_message(error: ConversionError) -> str:
    message = str(error)
    return message if message in PUBLIC_CONVERSION_ERROR_MESSAGES else DEFAULT_CONVERSION_ERROR


def safe_source_name(source_name: str) -> str:
    raw_name = str(source_name or "").strip()
    basename = PurePosixPath(raw_name.replace("\\", "/")).name
    if basename in {"", ".", ".."}:
        raise ConversionError("文件名无效")
    if Path(basename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ConversionError("仅支持 .mflac 和 .mgg 文件")
    return basename


def target_name(source_name: str) -> str:
    clean = safe_source_name(source_name)
    path = Path(clean)
    return f"{path.stem}{SUPPORTED_EXTENSIONS[path.suffix.lower()]}"


@dataclass(frozen=True)
class ConversionPlan:
    source_path: Path
    source_name: str
    output_path: Path
    temporary_path: Path
    conversion_needed: bool

    @classmethod
    def create(
        cls,
        source_path: str | Path,
        source_name: str,
        output_dir: str | Path,
        runtime_dir: str | Path,
    ) -> "ConversionPlan":
        source = Path(source_path)
        clean_name = safe_source_name(source_name)
        destination_dir = Path(output_dir)
        destination_dir.mkdir(parents=True, exist_ok=True)
        output_path = destination_dir / target_name(clean_name)
        conversion_needed = not output_path.exists()

        temporary_dir = Path(runtime_dir)
        if conversion_needed:
            temporary_dir.mkdir(parents=True, exist_ok=True)
        temporary_path = temporary_dir / f"{uuid4().hex}.decrypting"

        return cls(
            source_path=source,
            source_name=clean_name,
            output_path=output_path,
            temporary_path=temporary_path,
            conversion_needed=conversion_needed,
        )


class FridaConverter:
    def __init__(self, hook_path: Path, runtime_dir: Path, frida_api=None):
        self.hook_path = Path(hook_path)
        self.runtime_dir = Path(runtime_dir)
        self.frida_api = frida_api

    def _get_frida_api(self):
        if self.frida_api is not None:
            return self.frida_api
        try:
            import frida
        except ImportError as error:
            raise ConversionError("Frida 运行环境不可用，请重新下载并启动 QQ Music Bridge") from error
        return frida

    def is_qq_music_running(self) -> bool:
        try:
            processes = self._get_frida_api().get_local_device().enumerate_processes()
        except (ConversionError, Exception):
            return False
        return any(process.name.lower() == "qqmusic.exe" for process in processes)

    def convert(
        self,
        source_path: str | Path,
        source_name: str,
        output_dir: str | Path,
        progress: Callable[[int, str], None] | None = None,
    ) -> Path:
        try:
            plan = ConversionPlan.create(source_path, source_name, output_dir, self.runtime_dir)
        except ConversionError:
            raise
        except OSError as error:
            raise ConversionError("无法准备转换目录") from error
        if not plan.conversion_needed:
            return plan.output_path
        if not self.hook_path.is_file():
            raise ConversionError("找不到 hook_qq_music.js，请重新下载并启动 QQ Music Bridge")

        def update(value: int, stage: str) -> None:
            if progress is not None:
                progress(value, stage)

        session = None
        try:
            update(10, "正在连接 QQ 音乐")
            try:
                session = self._get_frida_api().attach("QQMusic.exe")
            except ConversionError:
                raise
            except Exception as error:
                raise ConversionError("无法连接 QQ 音乐，请确认 QQ 音乐正在运行；若已运行，请退出后重新启动 QQ 音乐，再重试") from error
            update(30, "已连接 QQ 音乐，开始解密")
            try:
                script = session.create_script(self.hook_path.read_text(encoding="utf-8"))
                script.load()
            except Exception as error:
                raise ConversionError("当前 QQ 音乐版本暂不兼容，请更新 QQ Music Bridge 或更换 QQ 音乐版本") from error
            try:
                script.exports_sync.decrypt(str(plan.source_path), str(plan.temporary_path))
            except Exception as error:
                raise ConversionError("缓存文件转换失败，请确认文件有效后重试") from error
            update(70, "正在写入目标格式")
            try:
                os.replace(plan.temporary_path, plan.output_path)
            except OSError as error:
                raise ConversionError("无法写入转换结果，请确认本机磁盘空间后重试") from error
            update(100, "转换完成")
            return plan.output_path
        except ConversionError:
            raise
        except Exception as error:
            raise ConversionError(DEFAULT_CONVERSION_ERROR) from error
        finally:
            try:
                if plan.temporary_path.exists():
                    plan.temporary_path.unlink()
            except OSError:
                pass
            finally:
                if session is not None:
                    try:
                        session.detach()
                    except Exception:
                        pass
