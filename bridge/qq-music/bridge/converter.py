from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from uuid import uuid4


SUPPORTED_EXTENSIONS = {".mflac": ".flac", ".mgg": ".ogg"}


class ConversionError(RuntimeError):
    pass


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
