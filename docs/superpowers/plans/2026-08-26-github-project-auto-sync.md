# GitHub Project Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project cards update from their linked GitHub repositories automatically through a scheduled, manually triggerable GitHub Actions workflow that commits only real metadata changes and lets Netlify publish them.

**Architecture:** Keep Markdown as the editorial source for project titles, technical stacks, details, images, and body text. Refactor the existing GitHub sync script into a testable module that reads repository metadata, applies only owned fields after all requests succeed, and expose a CLI used by a new six-hour workflow. The workflow writes back only `src/content/projects`, so the existing Netlify Git integration remains the deployment mechanism.

**Tech Stack:** Node.js 20, native `fetch`, `node:test`, YAML 2.9, GitHub REST API, GitHub Actions, Vite/React, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-26-github-project-auto-sync-design.md`

## Global Constraints

- Only projects with `githubSync: true` are synchronized.
- GitHub-derived fields are `description`, `url`, `status`, `githubStars`, `githubForks`, and `githubUpdated`.
- Local `title`, `detail`, `stack`, `featured`, `image`, `draft`, `githubSync`, and Markdown body must remain unchanged.
- GitHub repository owner/name is parsed from the project URL before falling back to `GITHUB_USERNAME` and `name`.
- API errors must fail the sync before any project file is written.
- Empty GitHub descriptions must preserve the local description.
- The workflow runs every six hours and via `workflow_dispatch`, with `contents: write` only.
- Third-party Actions must be pinned to immutable commit SHAs.
- Never commit `.env`, tokens, or generated dependency/cache directories.

### Task 1: Extract and test repository metadata logic

**Files:**
- Modify: `scripts/sync-github-projects.mjs`
- Create: `tests/github-project-sync.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `extractRepository(fields, fallbackOwner)` returning `{ owner, repository } | null`.
- Produces `metadataForRepository(repo, now)` returning `{ description, url, status, githubStars, githubForks, githubUpdated }`.
- Produces `updateProjectDocument(raw, repo, now)` returning the complete Markdown document with only synchronized Front Matter fields changed.
- Produces `syncProjects({ projectsDir, fetchImpl, env, logger })` returning `{ scanned, synced, changed }` and writing only after all opted-in API requests succeed.
- Keeps CLI execution behind an `import.meta.url` guard so tests can import the functions without running the network sync.

- [ ] **Step 1: Write failing tests for GitHub URL parsing and metadata mapping.**

```js
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
```

- [ ] **Step 2: Run the focused test file and verify it fails for missing exports.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: FAIL because the existing script does not export the requested pure functions.

- [ ] **Step 3: Implement the pure parser and metadata functions.**

Use the existing Front Matter format and this URL-first repository lookup:

```js
export function extractRepository(fields, fallbackOwner = "") {
  const match = fields.url?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?(?:[?#].*)?$/i);
  if (match) return { owner: match[1], repository: match[2] };
  const repository = fields.name?.replace(/^['"]|['"]$/g, "").trim();
  return fallbackOwner && repository ? { owner: fallbackOwner, repository } : null;
}
```

Compute `进行中` for a non-archived repository pushed within 180 days, `维护中` for older non-archived repositories, and `已归档` for archived repositories. Preserve the local description when `repo.description` is empty.

Update the `package.json` test command so both suites run from one command:

```json
"test": "node --test tests/qq-music-toolbox.test.mjs tests/github-project-sync.test.mjs"
```

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: PASS for the parser and metadata mapping tests.

- [ ] **Step 5: Commit the tested extraction unit.**

```powershell
git add scripts/sync-github-projects.mjs tests/github-project-sync.test.mjs package.json
git commit -m "refactor: make GitHub project metadata sync testable"
```

### Task 2: Make synchronization atomic and preserve editorial content

**Files:**
- Modify: `scripts/sync-github-projects.mjs`
- Modify: `tests/github-project-sync.test.mjs`

**Interfaces:**
- Consumes the functions from Task 1.
- `syncProjects` accepts an injected `fetchImpl` and temporary `projectsDir` so tests do not call GitHub or modify repository content.
- On non-2xx response it throws an error containing the HTTP status and `{owner}/{repository}`, and performs no writes.

- [ ] **Step 1: Add failing tests for document preservation and all-or-nothing API failure.**

Define these test fixtures before the tests so every helper used by the examples is concrete and local to the test file:

```js
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
githubSync: true
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

test("updateProjectDocument preserves editorial fields and the Markdown body", () => {
  const raw = optedInProject("demo");
  const next = updateProjectDocument(raw, githubRepository("demo"), Date.parse("2026-08-26T00:00:00Z"));
  assert.match(next, /title: 手工标题/);
  assert.match(next, /detail: 手工项目说明/);
  assert.match(next, /- React/);
  assert.match(next, /正文不能被覆盖。/);
  assert.match(next, /githubStars: 3/);
  assert.match(next, /githubForks: 2/);
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
```

- [ ] **Step 2: Run the focused tests and verify the new cases fail for the current non-atomic behavior.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: FAIL in the preservation/atomicity cases before the implementation is updated.

- [ ] **Step 3: Implement delayed writes.**

Read all project files, fetch all opted-in repositories into memory, build each next document, then write only changed files after the fetch loop completes. Keep the existing Front Matter line order and body slice. Treat HTTP 403 as an error whose message includes `GITHUB_TOKEN`; treat all other non-2xx statuses as errors with the repository identifier.

- [ ] **Step 4: Run the focused tests and verify all sync cases pass.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: PASS, including proof that a failed request leaves every temporary file byte-for-byte unchanged.

- [ ] **Step 5: Commit the atomic sync behavior.**

```powershell
git add scripts/sync-github-projects.mjs tests/github-project-sync.test.mjs
git commit -m "fix: make GitHub project sync atomic"
```

### Task 3: Add scheduled GitHub Actions synchronization

**Files:**
- Create: `.github/workflows/sync-github-projects.yml`
- Modify: `tests/github-project-sync.test.mjs`

**Interfaces:**
- Consumes `npm run sync:github` from Tasks 1–2.
- Produces a workflow with `schedule` cron `17 */6 * * *` and `workflow_dispatch`.
- The workflow checks out `main`, runs Node 20, executes the sync, and pushes only changed project Markdown with `github-actions[bot]`.

- [ ] **Step 1: Add failing structural tests for the workflow contract.**

```js
test("defines a six-hour workflow with guarded commits", async () => {
  const workflow = YAML.parse(await fs.readFile(workflowPath, "utf8"));
  const job = workflow.jobs?.sync;
  assert.deepEqual(workflow.on?.schedule, [{ cron: "17 */6 * * *" }]);
  assert.equal(workflow.on?.workflow_dispatch, null);
  assert.deepEqual(job?.permissions, { contents: "write" });
  assert.equal(job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"))?.uses, "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09");
  assert.equal(job?.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"))?.uses, "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
  const commitStep = job.steps.find((step) => step.run?.includes("git diff --quiet -- src/content/projects"));
  assert.match(commitStep.run, /git commit -m/);
  assert.match(commitStep.run, /git push origin HEAD:main/);
});
```

- [ ] **Step 2: Run the structural test and verify it fails because the workflow is missing.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: FAIL with a missing workflow assertion.

- [ ] **Step 3: Implement the immutable workflow.**

Create `.github/workflows/sync-github-projects.yml` with the following exact job behavior:

```yaml
name: Sync GitHub Projects

on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09
        with:
          ref: main
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "20"
      - run: npm run sync:github
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit synchronized project metadata
        shell: bash
        run: |
          if git diff --quiet -- src/content/projects; then
            echo "No project metadata changes."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add src/content/projects
          git commit -m "chore: sync GitHub project metadata"
          git push origin HEAD:main
```

- [ ] **Step 4: Run the structural tests and verify the workflow contract passes.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: PASS for schedule, manual trigger, permissions, pinned actions, and guarded commit assertions.

- [ ] **Step 5: Commit the workflow.**

```powershell
git add .github/workflows/sync-github-projects.yml tests/github-project-sync.test.mjs
git commit -m "ci: sync project metadata from GitHub"
```

### Task 4: Document the automatic maintenance workflow

**Files:**
- Modify: `README.md`
- Modify: `tests/github-project-sync.test.mjs`

**Interfaces:**
- Produces Chinese instructions for adding `githubSync: true`, running a local sync, and manually starting the Actions workflow.
- Keeps `npm run sync:github` documented as a local preview/debug command.

- [ ] **Step 1: Add a failing documentation test.**

```js
test("documents automatic GitHub project synchronization", async () => {
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /每 6 小时|6 小时/);
  assert.match(readme, /workflow_dispatch|手动.*同步/);
  assert.match(readme, /githubSync: true/);
  assert.match(readme, /只在.*变化.*提交|有变化.*提交/);
});
```

- [ ] **Step 2: Run the documentation test and verify it fails before the README section is updated.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: FAIL because the current README describes only manual synchronization.

- [ ] **Step 3: Update the README.**

Explain that project metadata is synced every six hours or manually from Actions, list the automatically managed and hand-maintained fields, and show:

```powershell
cd blog-site
npm run sync:github
npm run build
```

State that no-change runs do not create commits, API failures do not overwrite project files, and Netlify deploys after a bot commit reaches `main`.

- [ ] **Step 4: Run the documentation test and verify it passes.**

Run: `node --test tests/github-project-sync.test.mjs`

Expected: PASS for workflow and maintenance guidance.

- [ ] **Step 5: Commit the maintenance documentation.**

```powershell
git add README.md tests/github-project-sync.test.mjs
git commit -m "docs: explain automatic GitHub project updates"
```

### Task 5: Run end-to-end verification and publish

**Files:**
- Modify: `src/content/projects/*.md` only if the first real sync produces legitimate metadata changes.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified GitHub Actions and Netlify deployment evidence.

- [ ] **Step 1: Install the locked Node dependencies.**

Run: `npm ci`

Expected: exit code 0 and a dependency tree matching `package-lock.json`.

- [ ] **Step 2: Run all automated tests.**

Run: `npm test`

Expected: the toolbox tests and GitHub synchronization tests pass with zero failures.

- [ ] **Step 3: Run a real public GitHub metadata sync and inspect the diff.**

Run: `npm run sync:github`

Expected: each opted-in public repository is fetched; only legitimate GitHub-derived fields change; local title, detail, stack, featured/image flags, and body remain unchanged.

- [ ] **Step 4: Build the production site and check generated assets.**

Run: `npm run build` and `git diff --check`

Expected: Vite exits 0, project cards render from synchronized Markdown, and feed/robots/sitemap generation succeeds without whitespace errors.

- [ ] **Step 5: Push the workflow and feature commits.**

```powershell
git push origin main
```

Expected: GitHub `main` contains the sync workflow and tests; no untracked user files or caches are included.

- [ ] **Step 6: Run the workflow manually once and verify the run.**

Use the repository Actions page to select `Sync GitHub Projects` → `Run workflow` → `main`. Confirm the run is green, then inspect its commit step for either `No project metadata changes.` or a single bot commit.

- [ ] **Step 7: Verify the production deployment.**

Open the Netlify deploy created by the bot commit and verify `/` displays project cards with current GitHub-derived fields. Also verify `/feed.xml` and `/sitemap.xml` return HTTP 200.

- [ ] **Step 8: Record final evidence before claiming completion.**

Run `git status --short`, confirm only pre-existing user-owned untracked files remain, record the successful test/build/workflow/deploy results, and then report the exact maintenance commands and six-hour update window.
