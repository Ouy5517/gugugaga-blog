import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectsDir = path.join(root, "src", "content", "projects");

async function loadDotEnv() {
  try {
    const content = await fs.readFile(path.join(root, ".env"), "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    });
  } catch {}
}

function frontMatter(raw) {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return null;
  const fields = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  });
  return { header: match[1], fields, start: match[0].length - match[1].length - 5, end: match[0].length - 4 };
}

function replaceScalar(header, key, value) {
  const line = new RegExp(`^${key}:.*$`, "m");
  if (line.test(header)) return header.replace(line, `${key}: ${value}`);
  return `${header.trimEnd()}\n${key}: ${value}`;
}

function repoName(fields) {
  if (fields.name) return fields.name.replace(/^['"]|['"]$/g, "");
  const match = fields.url?.match(/github\.com\/[^/]+\/([^/#]+)\/?$/i);
  return match?.[1] || "";
}

await loadDotEnv();
const username = process.env.GITHUB_USERNAME || "Ouy5517";
const token = process.env.GITHUB_TOKEN;
const files = (await fs.readdir(projectsDir)).filter((file) => file.endsWith(".md"));
const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gugu-blog-content-sync" };
if (token) headers.Authorization = `Bearer ${token}`;
let synced = 0;

for (const file of files) {
  const filePath = path.join(projectsDir, file);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = frontMatter(raw);
  if (!parsed || parsed.fields.githubSync !== "true") continue;

  const name = repoName(parsed.fields);
  if (!name) {
    console.warn(`Skipped ${file}: missing name or GitHub URL.`);
    continue;
  }
  const response = await fetch(`https://api.github.com/repos/${username}/${name}`, { headers });
  if (!response.ok) {
    const detail = await response.text();
    const hint = response.status === 403 ? "；可能触发了 GitHub API 限流，请配置 GITHUB_TOKEN 后重试" : "";
    throw new Error(`GitHub API ${response.status} while reading ${username}/${name}${hint}\n${detail.slice(0, 240)}`);
  }
  const repo = await response.json();
  const status = repo.archived ? "已归档" : (Date.now() - new Date(repo.pushed_at).getTime() < 1000 * 60 * 60 * 24 * 180 ? "进行中" : "维护中");
  let nextHeader = parsed.header;
  nextHeader = replaceScalar(nextHeader, "description", JSON.stringify(repo.description || parsed.fields.description || ""));
  nextHeader = replaceScalar(nextHeader, "url", repo.html_url);
  nextHeader = replaceScalar(nextHeader, "status", status);
  nextHeader = replaceScalar(nextHeader, "githubStars", String(repo.stargazers_count));
  nextHeader = replaceScalar(nextHeader, "githubForks", String(repo.forks_count));
  nextHeader = replaceScalar(nextHeader, "githubUpdated", repo.pushed_at.slice(0, 10));
  const nextRaw = `---\n${nextHeader.trim()}\n---${raw.slice(raw.indexOf("---", 4) + 3)}`;
  await fs.writeFile(filePath, nextRaw, "utf8");
  synced += 1;
  console.log(`Synced ${file} ← ${repo.full_name}`);
}

if (!synced) console.log("No project has githubSync: true; add it to a project's Front Matter to opt in.");
