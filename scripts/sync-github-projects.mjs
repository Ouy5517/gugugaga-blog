import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectsDir = path.join(root, "src", "content", "projects");
const recentWindow = 1000 * 60 * 60 * 24 * 180;

async function loadDotEnv() {
  try {
    const content = await fs.readFile(path.join(root, ".env"), "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    });
  } catch {}
}

function parseFrontMatter(raw) {
  const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!match) return null;
  const fields = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  });
  return { header: match[1], prefix: match[0], suffix: raw.slice(match[0].length), fields };
}

function replaceScalar(header, key, value) {
  const line = new RegExp(`^${key}:.*$`, "m");
  if (line.test(header)) return header.replace(line, `${key}: ${value}`);
  return `${header.trimEnd()}\n${key}: ${value}`;
}

export function extractRepository(fields, fallbackOwner = "") {
  const url = fields.url?.replace(/^(['"])(.*)\1$/, "$2");
  const match = url?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?(?:[?#].*)?$/i);
  if (match) return { owner: match[1], repository: match[2] };
  const repository = fields.name?.replace(/^['"]|['"]$/g, "").trim();
  return fallbackOwner && repository ? { owner: fallbackOwner, repository } : null;
}

export function metadataForRepository(repo, now = Date.now()) {
  const pushedAt = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const status = repo.archived ? "已归档" : (Number(now) - pushedAt < recentWindow ? "进行中" : "维护中");
  return { description: repo.description || "", url: repo.html_url, status, githubStars: repo.stargazers_count, githubForks: repo.forks_count, githubUpdated: repo.pushed_at?.slice(0, 10) || "" };
}

export function updateProjectDocument(raw, repo, now = Date.now()) {
  const parsed = parseFrontMatter(raw);
  if (!parsed) return raw;
  const metadata = metadataForRepository(repo, now);
  let header = parsed.header;
  if (metadata.description) header = replaceScalar(header, "description", JSON.stringify(metadata.description));
  header = replaceScalar(header, "url", metadata.url);
  header = replaceScalar(header, "status", metadata.status);
  header = replaceScalar(header, "githubStars", String(metadata.githubStars));
  header = replaceScalar(header, "githubForks", String(metadata.githubForks));
  header = replaceScalar(header, "githubUpdated", metadata.githubUpdated);
  return parsed.prefix.replace(parsed.header, `${header.trim()}`) + parsed.suffix;
}

export async function syncProjects({ projectsDir = defaultProjectsDir, fetchImpl = fetch, env = process.env, logger = console, now = Date.now(), fsImpl = fs } = {}) {
  const files = (await fs.readdir(projectsDir)).filter((file) => file.endsWith(".md"));
  const username = env.GITHUB_USERNAME || "Ouy5517";
  const token = env.GITHUB_TOKEN;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gugu-blog-content-sync" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const entries = [];
  for (const file of files) {
    const filePath = path.join(projectsDir, file);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    if (!parsed || parsed.fields.githubSync !== "true") continue;
    entries.push({ file, filePath, raw, repoRef: extractRepository(parsed.fields, username) });
  }
  const fetchedEntries = [];
  for (const entry of entries) {
    const { file, repoRef } = entry;
    if (!repoRef) { logger.warn?.(`Skipped ${file}: missing name or GitHub URL.`); continue; }
    const response = await fetchImpl(`https://api.github.com/repos/${repoRef.owner}/${repoRef.repository}`, { headers });
    if (!response.ok) {
      const detail = await response.text();
      const hint = response.status === 403 ? "；可能触发了 GitHub API 限流，请配置 GITHUB_TOKEN 后重试" : "";
      throw new Error(`GitHub API ${response.status} while reading ${repoRef.owner}/${repoRef.repository}${hint}\n${detail.slice(0, 240)}`);
    }
    fetchedEntries.push({ ...entry, repo: await response.json() });
  }
  const updates = fetchedEntries.map((entry) => ({ ...entry, nextRaw: updateProjectDocument(entry.raw, entry.repo, now) }))
    .filter((entry) => entry.nextRaw !== entry.raw);
  const staged = [];
  try {
    for (const [index, entry] of updates.entries()) {
      const temporaryPath = path.join(projectsDir, `.${entry.file}.sync-${process.pid}-${Date.now()}-${index}`);
      const stagedEntry = { ...entry, temporaryPath, backupPath: `${entry.filePath}.sync-backup-${process.pid}-${Date.now()}-${index}`, backedUp: false, installed: false };
      staged.push(stagedEntry);
      await fsImpl.writeFile(temporaryPath, entry.nextRaw, "utf8");
    }
  } catch (error) {
    for (const entry of staged) {
      try { await fsImpl.unlink(entry.temporaryPath); } catch {}
    }
    throw error;
  }
  let changed = 0;
  try {
    for (const entry of staged) {
      await fsImpl.rename(entry.filePath, entry.backupPath);
      entry.backedUp = true;
      await fsImpl.rename(entry.temporaryPath, entry.filePath);
      entry.installed = true;
      entry.temporaryPath = null;
      changed += 1;
    }
  } catch (error) {
    for (const entry of [...staged].reverse()) {
      let restored = false;
      if (entry.installed) {
        try {
          await fsImpl.unlink(entry.filePath);
          await fsImpl.rename(entry.backupPath, entry.filePath);
          restored = true;
        } catch (restoreError) {
          try {
            await fsImpl.copyFile(entry.backupPath, entry.filePath);
            restored = true;
          } catch (copyError) {
            logger.error?.(`Failed to restore ${entry.filePath} from ${entry.backupPath}: ${copyError.message}`);
          }
        }
      } else if (entry.backedUp) {
        try {
          await fsImpl.rename(entry.backupPath, entry.filePath);
          restored = true;
        } catch (restoreError) {
          logger.error?.(`Failed to restore ${entry.filePath} from ${entry.backupPath}: ${restoreError.message}`);
        }
      }
      if (entry.backedUp && !restored) continue;
      if (entry.backedUp) {
        try { await fsImpl.unlink(entry.backupPath); } catch {}
      }
    }
    for (const entry of staged) {
      try { await fsImpl.unlink(entry.temporaryPath); } catch {}
    }
    throw error;
  }
  const cleanupErrors = [];
  for (const entry of staged) {
    for (const artifactPath of [entry.backupPath, entry.temporaryPath].filter(Boolean)) {
      try {
        await fsImpl.unlink(artifactPath);
      } catch (cleanupError) {
        cleanupErrors.push(`${artifactPath}: ${cleanupError.message}`);
      }
    }
  }
  if (cleanupErrors.length) {
    const error = new Error(`GitHub sync cleanup failed:\n${cleanupErrors.join("\n")}`);
    cleanupErrors.forEach((message) => logger.error?.(message));
    throw error;
  }
  for (const entry of staged) {
    logger.log?.(`Synced ${entry.file} ← ${entry.repo.full_name || entry.repo.html_url}`);
  }
  if (!fetchedEntries.length) logger.log?.("No project has githubSync: true; add it to a project's Front Matter to opt in.");
  return { scanned: files.length, synced: fetchedEntries.length, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await loadDotEnv(); await syncProjects(); }
