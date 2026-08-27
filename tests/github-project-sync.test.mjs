import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import {
  extractRepository,
  metadataForRepository,
  syncProjects,
  updateProjectDocument,
} from "../scripts/sync-github-projects.mjs";
import { parseValue } from "../src/content/parse-value.js";

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "sync-github-projects.yml");

test("documents automatic GitHub project synchronization", async () => {
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /每 6 小时|6 小时/);
  assert.match(readme, /workflow_dispatch|手动.*同步/);
  assert.match(readme, /githubSync: true/);
  assert.match(readme, /只在.*变化.*提交|有变化.*提交/);
  assert.match(readme, /归档.*已归档/);
  assert.match(readme, /未归档.*180 天.*进行中/);
  assert.match(readme, /否则.*维护中/);
  assert.match(readme, /owner.*name|owner.*仓库/si);
  assert.match(readme, /缺少可解析.*GitHub URL.*GITHUB_USERNAME.*name.*回退/s);
  assert.match(readme, /缺少\s+`?name`?.*跳过/s);
  assert.match(readme, /未加入.*githubSync.*跳过/s);
  assert.match(readme, /githubStars.*githubForks.*githubUpdated/s);
  assert.match(readme, /空描述.*保留.*描述/);
  assert.match(readme, /API.*失败.*零写入/s);
  assert.match(readme, /GITHUB_TOKEN.*无需额外配置/s);
});

test("defines a six-hour workflow with guarded commits", async () => {
  const workflow = YAML.parse(await fs.readFile(workflowPath, "utf8"));
  const job = workflow.jobs?.sync;
  assert.deepEqual(Object.keys(workflow.jobs ?? {}), ["sync"]);
  assert.equal(job?.["runs-on"], "ubuntu-latest");
  assert.deepEqual(workflow.on?.schedule, [{ cron: "17 */6 * * *" }]);
  assert.equal(workflow.on?.workflow_dispatch, null);
  assert.deepEqual(job?.permissions, { contents: "write" });
  const checkoutStep = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkoutStep?.uses, "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09");
  assert.equal(checkoutStep?.with?.ref, "main");
  const setupNodeStep = job?.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"));
  assert.equal(setupNodeStep?.uses, "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
  assert.equal(setupNodeStep?.with?.["node-version"], "20");
  const syncStep = job?.steps?.find((step) => step.run === "npm run sync:github");
  assert.ok(syncStep);
  assert.equal(syncStep.env?.GITHUB_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  const commitStep = job.steps.find((step) => step.run?.includes("git diff --quiet -- src/content/projects"));
  assert.match(commitStep.run, /git commit -m/);
  assert.match(commitStep.run, /git push origin HEAD:main/);
  assert.match(commitStep.run, /git add src\/content\/projects/);
  assert.match(commitStep.run, /github-actions\[bot\]/);
  assert.equal(commitStep.shell, "bash");
  const executableLines = commitStep.run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const stagingCommands = executableLines.filter((line) => /^(?:git(?:\s+-C\s+\S+)?\s+add)\s+/.test(line));
  assert.deepEqual(stagingCommands, ["git add src/content/projects"]);
  const executableScript = executableLines.join("\n");
  assert.doesNotMatch(executableScript, /\bgit add (?:\.|-A|--all)(?:\s|$)/m);
  assert.doesNotMatch(executableScript, /\bgit -C\s+\S+\s+add\b/m);
  for (const step of job.steps) {
    assert.equal(step["continue-on-error"], undefined);
    assert.doesNotMatch(step.run ?? "", /\|\|\s*true/);
  }
});

function githubRepository(name, overrides = {}) {
  return {
    archived: false,
    description: `GitHub description for ${name}`,
    forks_count: 2,
    html_url: `https://github.com/Ouy5517/${name}`,
    pushed_at: "2026-08-25T00:00:00Z",
    stargazers_count: 3,
    ...overrides,
  };
}

function optedInProject(name) {
  return `---
name: ${name}
title: 手工标题
description: 本地描述
detail: 手工项目说明
stack:
  - React
url: https://github.com/Ouy5517/${name}
status: 维护中
featured: true
image: /images/demo.png
draft: false
githubSync: true
customField: 手工扩展字段
---

正文不能被覆盖。
`;
}

async function snapshotTemporaryProjects() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gugu-sync-"));
  await fs.writeFile(path.join(directory, "one.md"), optedInProject("one"));
  await fs.writeFile(path.join(directory, "two.md"), optedInProject("two"));
  return { directory, files: await readTemporaryProjects(directory) };
}

async function readTemporaryProjects(directory) {
  return Promise.all(["one.md", "two.md"].map((file) => fs.readFile(path.join(directory, file), "utf8")));
}

async function readSyncArtifacts(directory) {
  return (await fs.readdir(directory)).filter((file) => file.includes(".sync-"));
}

test("extractRepository prefers the owner and repository in a GitHub URL", () => {
  assert.deepEqual(
    extractRepository({ url: "https://github.com/example/demo?tab=readme#top", name: "wrong" }, "Ouy5517"),
    { owner: "example", repository: "demo" },
  );
});

test("extractRepository handles a YAML-quoted GitHub URL", () => {
  assert.deepEqual(
    extractRepository({ url: '"https://github.com/acme/demo"' }, "Ouy5517"),
    { owner: "acme", repository: "demo" },
  );
});

test("extractRepository handles a YAML-single-quoted GitHub URL", () => {
  assert.deepEqual(
    extractRepository({ url: "'https://github.com/acme/demo'" }, "Ouy5517"),
    { owner: "acme", repository: "demo" },
  );
});

test("metadataForRepository maps an active repository", () => {
  const metadata = metadataForRepository({
    archived: false,
    description: "Updated description",
    forks_count: 4,
    html_url: "https://github.com/Ouy5517/demo",
    pushed_at: "2026-08-20T00:00:00Z",
    stargazers_count: 7,
  }, Date.parse("2026-08-26T00:00:00Z"));
  assert.deepEqual(metadata, {
    description: "Updated description",
    url: "https://github.com/Ouy5517/demo",
    status: "进行中",
    githubStars: 7,
    githubForks: 4,
    githubUpdated: "2026-08-20",
  });
});

test("parseValue decodes JSON-escaped Markdown description text", () => {
  assert.equal(parseValue('"Quote: \\\"hello\\\"; path C:\\\\tmp; line\\nnext"'), "Quote: \"hello\"; path C:\\tmp; line\nnext");
});

test("updateProjectDocument preserves the Front Matter separator blank line and body", () => {
  const raw = "---\nname: demo\ndescription: local\ngithubSync: true\n---\n\n正文第一行\n\n正文末行\n";
  const repo = {
    archived: false,
    description: "Remote description",
    forks_count: 2,
    html_url: "https://github.com/acme/demo",
    pushed_at: "2026-08-20T00:00:00Z",
    stargazers_count: 5,
  };
  const updated = updateProjectDocument(raw, repo, Date.parse("2026-08-26T00:00:00Z"));
  assert.equal(updated.slice(updated.indexOf("---", 4) + 3), "\n\n正文第一行\n\n正文末行\n");
  assert.match(updated, /description: "Remote description"/);
});

test("updateProjectDocument preserves editorial fields and the Markdown body", () => {
  const raw = optedInProject("demo");
  const next = updateProjectDocument(raw, githubRepository("demo"), Date.parse("2026-08-26T00:00:00Z"));
  assert.match(next, /title: 手工标题/);
  assert.match(next, /detail: 手工项目说明/);
  assert.match(next, /- React/);
  assert.match(next, /正文不能被覆盖。/);
  assert.match(next, /featured: true/);
  assert.match(next, /image: \/images\/demo\.png/);
  assert.match(next, /draft: false/);
  assert.match(next, /githubSync: true/);
  assert.match(next, /customField: 手工扩展字段/);
  assert.match(next, /githubStars: 3/);
  assert.match(next, /githubForks: 2/);
});

test("updateProjectDocument preserves the local description when GitHub description is empty", () => {
  const next = updateProjectDocument(optedInProject("demo"), githubRepository("demo", { description: "" }));
  assert.match(next, /description: "本地描述"/);
});

test("syncProjects writes nothing when one opted-in repository API request fails", async () => {
  const before = await snapshotTemporaryProjects();
  await assert.rejects(() => syncProjects({
    projectsDir: before.directory,
    fetchImpl: async (url) => url.endsWith("/two")
      ? new Response("missing", { status: 404 })
      : Response.json(githubRepository("one")),
    env: { GITHUB_USERNAME: "Ouy5517" },
  }), /GitHub API 404.*Ouy5517\/two/);
  assert.deepEqual(await readTemporaryProjects(before.directory), before.files);
});

test("syncProjects rolls back every file when a later replacement fails", async () => {
  const before = await snapshotTemporaryProjects();
  let replacements = 0;
  const failingFs = {
    ...fs,
    rename: async (...args) => {
      replacements += 1;
      if (replacements === 4) throw new Error("injected replacement failure");
      return fs.rename(...args);
    },
  };
  await assert.rejects(() => syncProjects({
    projectsDir: before.directory,
    fsImpl: failingFs,
    fetchImpl: async (url) => Response.json(githubRepository(url.endsWith("/one") ? "one" : "two")),
    env: { GITHUB_USERNAME: "Ouy5517" },
  }), /injected replacement failure/);
  assert.deepEqual(await readTemporaryProjects(before.directory), before.files);
  assert.deepEqual(await readSyncArtifacts(before.directory), []);
});

test("syncProjects cleans a temporary file when staging write fails", async () => {
  const before = await snapshotTemporaryProjects();
  let writes = 0;
  const failingFs = {
    ...fs,
    writeFile: async (...args) => {
      writes += 1;
      await fs.writeFile(...args);
      if (writes === 2) throw new Error("injected staging failure");
    },
  };
  await assert.rejects(() => syncProjects({
    projectsDir: before.directory,
    fsImpl: failingFs,
    fetchImpl: async (url) => Response.json(githubRepository(url.endsWith("/one") ? "one" : "two")),
    env: { GITHUB_USERNAME: "Ouy5517" },
  }), /injected staging failure/);
  assert.deepEqual(await readTemporaryProjects(before.directory), before.files);
  assert.deepEqual(await readSyncArtifacts(before.directory), []);
});

test("syncProjects keeps a backup when rollback restoration fails", async () => {
  const before = await snapshotTemporaryProjects();
  let replacements = 0;
  const errors = [];
  const failingFs = {
    ...fs,
    rename: async (from, to) => {
      replacements += 1;
      if (replacements === 4 || replacements === 5) throw new Error("injected restore failure");
      return fs.rename(from, to);
    },
  };
  await assert.rejects(() => syncProjects({
    projectsDir: before.directory,
    fsImpl: failingFs,
    logger: { error: (message) => errors.push(message) },
    fetchImpl: async (url) => Response.json(githubRepository(url.endsWith("/one") ? "one" : "two")),
    env: { GITHUB_USERNAME: "Ouy5517" },
  }), /injected restore failure/);
  assert.equal(await fs.readFile(path.join(before.directory, "one.md"), "utf8"), before.files[0]);
  const artifacts = await readSyncArtifacts(before.directory);
  assert.equal(artifacts.filter((file) => file.includes(".sync-backup-")).length, 1);
  assert.equal(artifacts.filter((file) => file.startsWith(".two.md.sync-")).length, 0);
  assert.equal(await fs.readFile(path.join(before.directory, artifacts.find((file) => file.includes(".sync-backup-"))), "utf8"), before.files[1]);
  assert.match(errors.join("\n"), /Failed to restore/);
});

test("syncProjects reports actual changes and then zero changes", async () => {
  const before = await snapshotTemporaryProjects();
  const options = {
    projectsDir: before.directory,
    fetchImpl: async (url) => Response.json(githubRepository(url.endsWith("/one") ? "one" : "two")),
    env: { GITHUB_USERNAME: "Ouy5517" },
  };
  assert.equal((await syncProjects(options)).changed, 2);
  assert.equal((await syncProjects(options)).changed, 0);
});
