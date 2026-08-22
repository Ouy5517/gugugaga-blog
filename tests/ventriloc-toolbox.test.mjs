import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, serviceUrl, targetFor } from "../src/toolbox/ventriloc.js";

test("maps supported Ventriloc source formats to target formats", () => {
  assert.equal(targetFor("track.mflac"), ".flac");
  assert.equal(targetFor("TRACK.MGG"), ".ogg");
  assert.equal(targetFor("track.mp3"), null);
});

test("formats upload sizes for the queue", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
});

test("builds local service URLs without a double slash", () => {
  assert.equal(serviceUrl("/api/health"), "http://127.0.0.1:8765/api/health");
  assert.equal(serviceUrl("api/jobs/abc"), "http://127.0.0.1:8765/api/jobs/abc");
});
