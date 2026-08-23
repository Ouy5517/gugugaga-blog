export const QQ_MUSIC_BRIDGE_ORIGIN = "http://127.0.0.1:8765";
export const MAX_QQ_MUSIC_FILE_BYTES = 1024 ** 3;

const FORMAT_TARGETS = Object.freeze({
  ".mflac": ".flac",
  ".mgg": ".ogg",
});

const STATUS_LABELS = Object.freeze({
  queued: "等待转换",
  converting: "正在转换",
  completed: "已完成",
  failed: "转换失败",
});

export function targetFor(name) {
  if (typeof name !== "string") return null;
  const suffixIndex = name.lastIndexOf(".");
  if (suffixIndex < 0) return null;
  return FORMAT_TARGETS[name.slice(suffixIndex).toLowerCase()] || null;
}

export function selectQQMusicFiles(files) {
  const accepted = [];
  const messages = [];

  for (const file of Array.from(files || [])) {
    if (!targetFor(file?.name)) {
      messages.push(`“${file?.name || "未命名文件"}”格式不支持，仅支持 .mflac 和 .mgg 文件。`);
    } else if (!Number.isFinite(file.size) || file.size <= 0) {
      messages.push(`“${file.name}”为空文件，请重新选择有效的缓存文件。`);
    } else if (file.size > MAX_QQ_MUSIC_FILE_BYTES) {
      messages.push(`“${file.name}”超过 1 GiB，请选择不大于 1 GiB 的文件。`);
    } else {
      accepted.push(file);
    }
  }

  return { files: accepted, notice: messages.join(" ") };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

export function bridgeUrl(pathname) {
  const normalizedPath = `/${String(pathname ?? "").replace(/^\/+/, "")}`;
  return new URL(normalizedPath, `${QQ_MUSIC_BRIDGE_ORIGIN}/`).toString();
}

export function statusLabel(status, stage) {
  if (typeof stage === "string" && stage.trim()) return stage;
  return STATUS_LABELS[status] || "状态未知";
}
