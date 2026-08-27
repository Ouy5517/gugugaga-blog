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

const root = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(root, ".github", "workflows", "sync-github-projects.yml");

test("defines a six-hour workflow with guarded commits", async () => {
  const workflow = YAML.parse(await fs.readFile(workflowPath, "utf8"));
  const job = workflow.jobs?.sync;
  assert.deepEqual(Object.keys(workflow.jobs ?? {}), ["sync"]);
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
