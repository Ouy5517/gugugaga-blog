export function parseValue(value) {
  const normalized = value.trim();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try { return JSON.parse(normalized); } catch {}
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) return normalized.slice(1, -1);
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map(parseValue);
  return normalized;
}
