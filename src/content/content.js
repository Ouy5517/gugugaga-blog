function parseValue(value) {
  const normalized = value.trim();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if ((normalized.startsWith("\"") && normalized.endsWith("\"")) || (normalized.startsWith("'") && normalized.endsWith("'"))) return normalized.slice(1, -1);
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map(parseValue);
  return normalized;
}

function parseMarkdown(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  let activeArray = null;
  match[1].split(/\r?\n/).forEach((line) => {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    const item = line.match(/^\s+-\s+(.*)$/);
    if (field) {
      activeArray = field[2] ? null : field[1];
      meta[field[1]] = field[2] ? parseValue(field[2]) : [];
    } else if (item && activeArray) {
      meta[activeArray].push(parseValue(item[1]));
    }
  });
  return { meta, body: match[2].trim() };
}

const postModules = import.meta.glob("./posts/*.md", { eager: true, query: "?raw", import: "default" });
const projectModules = import.meta.glob("./projects/*.md", { eager: true, query: "?raw", import: "default" });

export const posts = Object.values(postModules).map((raw) => {
  const { meta, body } = parseMarkdown(raw);
  return { ...meta, body, tags: meta.tags || [], readingTime: Number(meta.readingTime || 1) };
}).filter((post) => !post.draft).sort((a, b) => b.date.localeCompare(a.date));

export const projects = Object.values(projectModules).map((raw) => {
  const { meta, body } = parseMarkdown(raw);
  return { ...meta, body, stack: meta.stack || [] };
}).filter((project) => !project.draft);

export const categories = ["全部", ...new Set(posts.map((post) => post.category))];
export const tags = ["全部", ...new Set(posts.flatMap((post) => post.tags))];

export function findPost(slug) {
  return posts.find((post) => post.slug === slug);
}
