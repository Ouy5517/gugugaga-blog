export const QQ_MUSIC_BRIDGE_ORIGIN = "http://127.0.0.1:8765";

const FORMAT_TARGETS = Object.freeze({
  ".mflac": ".flac",
  ".mgg": ".ogg",
});

const STATUS_LABELS = Object.freeze({
  queued: "等待处理",
  processing: "转换中",
  completed: "已完成",
  failed: "转换失败",
});

export function targetFor(name) {
  if (typeof name !== "string") return null;
  const suffixIndex = name.lastIndexOf(".");
  if (suffixIndex < 0) return null;
  return FORMAT_TARGETS[name.slice(suffixIndex).toLowerCase()] || null;
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
  if (status === "processing" && typeof stage === "string" && stage.trim()) return stage;
  return STATUS_LABELS[status] || "状态未知";
}
