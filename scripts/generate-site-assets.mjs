import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postsDir = path.join(root, "src", "content", "posts");
const publicDir = path.join(root, "public");

function loadDotEnv() {
  try {
    const raw = fs.readFile(path.join(root, ".env"), "utf8");
    return raw.then((content) => {
      content.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      });
    }).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

function parseFrontMatter(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return {};
  const meta = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (field) meta[field[1]] = field[2].replace(/^(['"])(.*)\1$/, "$2");
  });
  return meta;
}

function xml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[character]));
}

function dateValue(value) {
  const normalized = String(value || "").replace(/\./g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00+08:00` : new Date().toISOString();
}

await loadDotEnv();
const siteUrl = (process.env.SITE_URL || process.env.VITE_SITE_URL || "http://localhost:5173").replace(/\/$/, "");
const files = (await fs.readdir(postsDir)).filter((file) => file.endsWith(".md"));
const posts = [];

for (const file of files) {
  const raw = await fs.readFile(path.join(postsDir, file), "utf8");
  const meta = parseFrontMatter(raw);
  if (meta.draft === "true" || !meta.slug || !meta.title) continue;
  posts.push(meta);
}

posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
const latestDate = posts[0] ? dateValue(posts[0].date) : new Date().toISOString();
const feedItems = posts.map((post) => {
  const link = `${siteUrl}/articles/${encodeURIComponent(post.slug)}`;
  return `    <item>\n      <title>${xml(post.title)}</title>\n      <link>${xml(link)}</link>\n      <guid isPermaLink="true">${xml(link)}</guid>\n      <description>${xml(post.excerpt || "咕咕嘎嘎的技术文章")}</description>\n      <pubDate>${new Date(dateValue(post.date)).toUTCString()}</pubDate>\n    </item>`;
}).join("\n");

const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>咕咕嘎嘎的个人博客</title>\n    <link>${xml(siteUrl)}</link>\n    <description>分享计算机学习、技术文章与个人项目。</description>\n    <language>zh-CN</language>\n    <lastBuildDate>${new Date(latestDate).toUTCString()}</lastBuildDate>\n${feedItems}\n  </channel>\n</rss>\n`;

const urls = [
  `${siteUrl}/`,
  `${siteUrl}/articles`,
  `${siteUrl}/tools`,
  `${siteUrl}/tools/qq-music-converter`,
  ...posts.map((post) => `${siteUrl}/articles/${encodeURIComponent(post.slug)}`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
const robots = `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`;

await fs.mkdir(publicDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(publicDir, "feed.xml"), feed, "utf8"),
  fs.writeFile(path.join(publicDir, "sitemap.xml"), sitemap, "utf8"),
  fs.writeFile(path.join(publicDir, "robots.txt"), robots, "utf8"),
]);

console.log(`Generated feed.xml, sitemap.xml and robots.txt for ${siteUrl} (${posts.length} posts).`);
