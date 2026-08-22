export const VENTRILOC_API_ORIGIN = "http://127.0.0.1:8765";

const FORMAT_MAP = Object.freeze({
  ".mflac": ".flac",
  ".mgg": ".ogg",
});

export function targetFor(name) {
  const match = /\.[^.]+$/.exec(String(name).toLowerCase());
  return match ? FORMAT_MAP[match[0]] || null : null;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function serviceUrl(pathname = "") {
  const path = String(pathname).startsWith("/") ? pathname : `/${pathname}`;
  return `${VENTRILOC_API_ORIGIN}${path}`;
}
