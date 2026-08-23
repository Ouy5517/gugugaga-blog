import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { bridgeUrl, formatBytes, statusLabel, targetFor } from "../src/toolbox/qqMusic.js";
import { createJobPoller } from "../src/toolbox/jobPolling.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("publishes toolbox routes in the generated sitemap", () => {
  const sitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8");

  assert.match(sitemap, /<loc>http:\/\/localhost:5173\/tools<\/loc>/);
  assert.match(sitemap, /<loc>http:\/\/localhost:5173\/tools\/qq-music-converter<\/loc>/);
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

test("defines a Windows release workflow with the public bridge filename", () => {
  const workflowPath = path.join(root, ".github", "workflows", "qq-music-bridge-release.yml");

  assert.ok(fs.existsSync(workflowPath), "release workflow must exist");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /qq-music-bridge-v\*/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-python@v5/);
  assert.match(workflow, /python-version: ["']3\.12["']/);
  assert.match(workflow, /requirements-build\.txt/);
  assert.match(workflow, /python -m unittest discover -s bridge\/qq-music\/tests -v/);
  assert.match(workflow, /\.\/bridge\/qq-music\/build\.ps1/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /path: dist\/qq-music-bridge\.exe/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /files: dist\/qq-music-bridge\.exe/);
});
