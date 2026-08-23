import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { bridgeUrl, formatBytes, selectQQMusicFiles, statusLabel, targetFor } from "../src/toolbox/qqMusic.js";
import { createJobPoller } from "../src/toolbox/jobPolling.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const YAML = await import("yaml").catch(() => null);

let viteServer;

async function loadFrontendModule(pathname) {
  if (!viteServer) viteServer = await createServer({
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  return viteServer.ssrLoadModule(pathname);
}

test.after(async () => {
  await viteServer?.close();
});

test("maps supported QQ Music formats", () => {
  assert.equal(targetFor("song.mflac"), ".flac");
  assert.equal(targetFor("SONG.MGG"), ".ogg");
  assert.equal(targetFor("song.mp3"), null);
});

test("builds bridge URLs and status labels", () => {
  assert.equal(bridgeUrl("api/health"), "http://127.0.0.1:8765/api/health");
  assert.equal(statusLabel("converting", "正在连接 QQ 音乐"), "正在连接 QQ 音乐");
  assert.equal(statusLabel("completed"), "已完成");
});

test("formats queue file sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("keeps empty and oversized files out of the browser submit queue", () => {
  const oneGiB = 1024 ** 3;
  const empty = { name: "空文件.mflac", size: 0 };
  const atLimit = { name: "刚好.mgg", size: oneGiB };
  const oversized = { name: "过大.mflac", size: oneGiB + 1 };

  const selection = selectQQMusicFiles([empty, atLimit, oversized]);

  assert.deepEqual(selection.files, [atLimit]);
  assert.match(selection.notice, /“空文件\.mflac”为空文件，请重新选择有效的缓存文件/);
  assert.match(selection.notice, /“过大\.mflac”超过 1 GiB，请选择不大于 1 GiB 的文件/);
});

test("keeps bridge requests local while encoding non-ASCII path content", () => {
  assert.equal(
    bridgeUrl("//api/search/周杰伦"),
    "http://127.0.0.1:8765/api/search/%E5%91%A8%E6%9D%B0%E4%BC%A6",
  );
  assert.equal(bridgeUrl("https://example.test/api"), "http://127.0.0.1:8765/https://example.test/api");
});

test("uses Task 3 fallback labels for every job status", () => {
  assert.equal(statusLabel("queued"), "等待转换");
  assert.equal(statusLabel("converting"), "正在转换");
  assert.equal(statusLabel("completed"), "已完成");
  assert.equal(statusLabel("failed"), "转换失败");
  assert.equal(statusLabel("other"), "状态未知");
});

test("preserves the stage returned for each Task 3 job state", () => {
  for (const [status, stage] of [
    ["queued", "等待转换"],
    ["converting", "正在读取缓存"],
    ["completed", "转换完成"],
    ["failed", "转换失败"],
  ]) {
    assert.equal(statusLabel(status, stage), stage);
  }
});

test("caps displayed sizes at gigabytes", () => {
  assert.equal(formatBytes(1024 ** 4), "1024 GB");
});

test("polls one job request at a time and stops after a terminal response", async () => {
  const scheduled = [];
  const updates = [];
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const responses = [first.promise, second.promise];
  let calls = 0;
  const poller = createJobPoller({
    fetchJob: () => responses[calls++],
    onUpdate: (job) => updates.push(job.status),
    setTimeoutFn: (callback) => { scheduled.push(callback); return callback; },
    clearTimeoutFn: (callback) => { const index = scheduled.indexOf(callback); if (index >= 0) scheduled.splice(index, 1); },
  });

  poller.start();
  assert.equal(calls, 1);
  assert.equal(scheduled.length, 0, "a slow request must not overlap with another request");

  first.resolve({ status: "converting" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.equal(calls, 2);

  second.resolve({ status: "completed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ["converting", "completed"]);
  assert.equal(scheduled.length, 0, "completed jobs must not be polled again");
});

test("ignores an in-flight job response after the poller is stopped", async () => {
  const pending = Promise.withResolvers();
  const updates = [];
  const scheduled = [];
  const poller = createJobPoller({
    fetchJob: () => pending.promise,
    onUpdate: (job) => updates.push(job.status),
    setTimeoutFn: (callback) => { scheduled.push(callback); return callback; },
    clearTimeoutFn: (callback) => { const index = scheduled.indexOf(callback); if (index >= 0) scheduled.splice(index, 1); },
  });

  poller.start();
  poller.stop();
  pending.resolve({ status: "completed" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(updates, []);
  assert.equal(scheduled.length, 0);
});

test("renders the toolbox route with the QQ Music converter entry point", async () => {
  const { ToolboxPage } = await loadFrontendModule("/src/toolbox/ToolboxPage.jsx");
  const html = renderToStaticMarkup(createElement(ToolboxPage, { onNavigate: () => {} }));

  assert.match(html, /工具箱/);
  assert.match(html, /QQ 音乐缓存转换/);
  assert.match(html, /MFLAC → FLAC/);
  assert.match(html, /MGG → OGG/);
  assert.match(html, /开始转换/);
});

test("renders the converter dropzone and local-only conversion guidance", async () => {
  const { QQMusicConverterPage } = await loadFrontendModule("/src/toolbox/QQMusicConverterPage.jsx");
  const html = renderToStaticMarkup(createElement(QQMusicConverterPage, { onNavigate: () => {} }));

  assert.match(html, /拖放 QQ 音乐缓存文件/);
  assert.match(html, /选择文件/);
  assert.match(html, /仅在你的电脑本地处理/);
  assert.match(html, /桥接服务/);
});

test("exposes queue progress and terminal states without a noisy queue-wide live region", async () => {
  const { QueueJobStatus } = await loadFrontendModule("/src/toolbox/QQMusicConverterPage.jsx");
  const activeHtml = renderToStaticMarkup(createElement(QueueJobStatus, { item: {
    file: { name: "示例.mflac" }, status: "converting", stage: "正在解密", progress: 42, error: "",
  } }));
  const failedHtml = renderToStaticMarkup(createElement(QueueJobStatus, { item: {
    file: { name: "示例.mflac" }, status: "failed", stage: "转换失败", progress: 42,
    error: "当前 QQ 音乐版本暂不兼容，请更新 QQ Music Bridge 或更换 QQ 音乐版本",
  } }));
  const completedHtml = renderToStaticMarkup(createElement(QueueJobStatus, { item: {
    file: { name: "示例.mflac" }, status: "completed", stage: "转换完成", progress: 100, error: "",
  } }));

  assert.match(activeHtml, /role="status"[^>]*aria-live="polite"/);
  assert.match(activeHtml, /role="progressbar"/);
  assert.match(activeHtml, /aria-valuemin="0"/);
  assert.match(activeHtml, /aria-valuemax="100"/);
  assert.match(activeHtml, /aria-valuenow="42"/);
  assert.match(failedHtml, /role="alert"/);
  assert.match(failedHtml, /当前 QQ 音乐版本暂不兼容/);
  assert.match(completedHtml, /role="status"[^>]*aria-live="polite"/);

  const { QQMusicConverterPage } = await loadFrontendModule("/src/toolbox/QQMusicConverterPage.jsx");
  const pageHtml = renderToStaticMarkup(createElement(QQMusicConverterPage, { onNavigate: () => {} }));
  assert.doesNotMatch(pageHtml, /<ul[^>]+aria-live=/, "the whole queue must not announce every progress tick");
});

test("offers offline recheck guidance and collapses first-use steps once online", async () => {
  const { BridgeStatus, ConversionInstructions } = await loadFrontendModule("/src/toolbox/QQMusicConverterPage.jsx");
  const offlineHtml = renderToStaticMarkup(createElement(BridgeStatus, {
    health: { state: "offline", qqMusicRunning: false, version: "" }, onRetry: () => {},
  }));
  const onlineInstructions = renderToStaticMarkup(createElement(ConversionInstructions, { online: true }));
  const offlineInstructions = renderToStaticMarkup(createElement(ConversionInstructions, { online: false }));

  assert.match(offlineHtml, /重新检测/);
  assert.match(offlineHtml, /自动重检/);
  assert.doesNotMatch(offlineHtml, /重新打开此页面/);
  assert.doesNotMatch(onlineInstructions, /<ol>/);
  assert.match(onlineInstructions, /本地处理/);
  assert.match(offlineInstructions, /<ol>/);
});

test("generates toolbox sitemap routes for the production origin without changing public assets", async () => {
  const outputDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "qq-music-sitemap-"));
  const publicSitemapPath = path.join(root, "public", "sitemap.xml");
  const publicSitemap = await fsPromises.readFile(publicSitemapPath);

  try {
    await execFileAsync(process.execPath, ["scripts/generate-site-assets.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        SITE_URL: "https://gugugaga-blog.netlify.app",
        SITE_ASSETS_OUTPUT_DIR: outputDir,
      },
    });

    const sitemapPath = path.join(outputDir, "sitemap.xml");
    assert.ok(fs.existsSync(sitemapPath), "generator must write sitemap to SITE_ASSETS_OUTPUT_DIR");
    const sitemap = await fsPromises.readFile(sitemapPath, "utf8");
    assert.match(sitemap, /<loc>https:\/\/gugugaga-blog\.netlify\.app\/tools<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/gugugaga-blog\.netlify\.app\/tools\/qq-music-converter<\/loc>/);
    assert.deepEqual(await fsPromises.readFile(publicSitemapPath), publicSitemap);
  } finally {
    await fsPromises.writeFile(publicSitemapPath, publicSitemap);
    await fsPromises.rm(outputDir, { recursive: true, force: true });
  }
});

test("documents local QQ Music bridge operation and maintenance", () => {
  const rootReadme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const bridgeReadmePath = path.join(root, "bridge", "qq-music", "README.md");

  assert.match(rootReadme, /\/tools/);
  assert.match(rootReadme, /\/tools\/qq-music-converter/);
  assert.match(rootReadme, /本地/);
  assert.match(rootReadme, /QQ 音乐.*运行|运行.*QQ 音乐/);
  assert.ok(fs.existsSync(bridgeReadmePath), "bridge README must exist");
  const bridgeReadme = fs.readFileSync(bridgeReadmePath, "utf8");
  assert.match(bridgeReadme, /python -m unittest discover -s bridge\/qq-music\/tests -v/);
  assert.match(bridgeReadme, /powershell -ExecutionPolicy Bypass -File bridge\/qq-music\/build\.ps1/);
  assert.match(bridgeReadme, /dist\\qq-music-bridge\.exe/);
  assert.match(bridgeReadme, /DLL/);
  assert.match(bridgeReadme, /hook symbols|Hook symbols|挂钩符号|符号/);
});

test("defines a least-privilege, immutable Windows release workflow", () => {
  const workflowPath = path.join(root, ".github", "workflows", "qq-music-bridge-release.yml");

  assert.ok(fs.existsSync(workflowPath), "release workflow must exist");
  assert.ok(YAML, "yaml must be installed to parse the release workflow structurally");
  const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));
  const build = workflow.jobs?.build;
  const release = workflow.jobs?.release;

  assert.equal(workflow.on?.workflow_dispatch, null);
  assert.deepEqual(workflow.on?.push?.tags, ["qq-music-bridge-v*"]);
  assert.equal(build?.["runs-on"], "windows-latest");
  assert.deepEqual(build?.permissions, { contents: "read" });
  assert.equal(release?.["runs-on"], "windows-latest");
  assert.deepEqual(release?.needs, ["build"]);
  assert.equal(release?.if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/qq-music-bridge-v')");
  assert.deepEqual(release?.permissions, { contents: "write" });

  const uses = (steps, action) => steps.find((step) => step.uses?.startsWith(`${action}@`));
  assert.equal(uses(build.steps, "actions/checkout")?.uses, "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09");
  assert.equal(uses(build.steps, "actions/setup-python")?.uses, "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1");
  const upload = uses(build.steps, "actions/upload-artifact");
  assert.equal(upload?.uses, "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f");
  assert.equal(upload?.with?.name, "qq-music-bridge");
  assert.equal(upload?.with?.path, "dist/qq-music-bridge.exe");
  assert.equal(upload?.with?.["if-no-files-found"], "error");
  assert.match(build.steps.find((step) => step.run?.includes("Test-Path -LiteralPath"))?.run || "", /qq-music-bridge\.exe/);

  const download = uses(release.steps, "actions/download-artifact");
  assert.equal(download?.uses, "actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53");
  assert.equal(download?.with?.name, "qq-music-bridge");
  assert.equal(download?.with?.path, "dist");
  const releaseCommand = release.steps.find((step) => step.env?.GH_TOKEN);
  assert.equal(releaseCommand?.env?.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  assert.equal(releaseCommand?.env?.GH_REPO, "${{ github.repository }}");
  const releaseScript = releaseCommand?.run || "";
  assert.match(releaseScript, /\$ErrorActionPreference = "Continue"/);
  const viewPositions = [...releaseScript.matchAll(/gh release view/g)].map((match) => match.index);
  const createPosition = releaseScript.indexOf("gh release create");
  const uploadPosition = releaseScript.indexOf("gh release upload");
  assert.ok(viewPositions.length >= 2, "release existence and create-race recovery must both be checked");
  assert.ok(viewPositions[0] < createPosition, "an existing release must be viewed before create is attempted");
  assert.ok(createPosition < viewPositions[1], "a failed create must re-check whether another runner created the release");
  assert.ok(viewPositions[1] < uploadPosition, "asset upload must happen after release existence is established");
  assert.match(releaseScript, /gh release upload[^\r\n]+--clobber/);
  assert.match(releaseScript, /gh release create[^\r\n]+[\s\S]+\$createExitCode = \$LASTEXITCODE[\s\S]+throw "Release create failed/);
  assert.match(releaseScript, /gh release upload[^\r\n]+[\s\S]+if \(\$LASTEXITCODE -ne 0\)[\s\S]+throw "Release upload failed/);
  assert.match(releaseScript, /Test-Path -LiteralPath/);
  assert.ok(![...build.steps, ...release.steps].some((step) => step.uses?.startsWith("softprops/action-gh-release@")));
});
