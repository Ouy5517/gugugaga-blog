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
