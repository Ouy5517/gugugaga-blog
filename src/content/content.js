import { parseValue } from "./parse-value.js";

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
const categoryImages = {
  "技术实践": "/assets/card-periwinkle.png",
  "经验分享": "/assets/card-violet.png",
  "杂项": "/assets/card-orchid.png",
};

export const posts = Object.values(postModules).map((raw) => {
  const { meta, body } = parseMarkdown(raw);
  return { ...meta, image: meta.image || categoryImages[meta.category] || categoryImages["杂项"], body, tags: meta.tags || [], readingTime: Number(meta.readingTime || 1) };
}).filter((post) => !post.draft).sort((a, b) => b.date.localeCompare(a.date));

export const projects = Object.values(projectModules).map((raw) => {
  const { meta, body } = parseMarkdown(raw);
  return { ...meta, body, stack: meta.stack || [] };
}).filter((project) => !project.draft);

export const categories = ["全部", "技术实践", "经验分享", "杂项"];
export const tags = ["全部", ...new Set(posts.flatMap((post) => post.tags))];

export function findPost(slug) {
  return posts.find((post) => post.slug === slug);
}
