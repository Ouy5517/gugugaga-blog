import test from "node:test";
import assert from "node:assert/strict";
import { bridgeUrl, formatBytes, statusLabel, targetFor } from "../src/toolbox/qqMusic.js";

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
