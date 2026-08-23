# QQ Music Toolbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage-matched toolbox to the blog and a Windows-only local bridge that runs the supplied Frida hook to convert `.mflac` to `.flac` and `.mgg` to `.ogg`.

**Architecture:** The Netlify-hosted React application owns routing, file selection, queue presentation, polling, and downloads. A new independent component under `bridge/qq-music/` binds only to `127.0.0.1:8765`, serializes Frida calls into `QQMusic.exe`, and is packaged as `qq-music-bridge.exe`; it does not import or copy implementation from the Ventriloc repository.

**Tech Stack:** React 19, Vite 6, Node built-in test runner, Python 3.12, `unittest`, Frida 16.6.6, PyInstaller 6.15.0, GitHub Actions, Netlify

**Spec:** `docs/superpowers/specs/2026-08-23-qq-music-toolbox-design.md`

## Global Constraints

- The browser application must never attempt to execute the Frida hook directly.
- The bridge must bind exactly to `127.0.0.1:8765`, never `0.0.0.0`.
- Allowed source extensions are exactly `.mflac` and `.mgg`; outputs are exactly `.flac` and `.ogg`.
- The bridge may only allow `https://gugugaga-blog.netlify.app`, `http://127.0.0.1:5173`, and `http://localhost:5173` as web origins.
- The maximum upload size is 1 GiB.
- Native conversions run serially and remove the uploaded encrypted copy after completion or failure.
- The supplied hook at `C:/Users/14564/Downloads/decrypt-mflac-frida-main/hook_qq_music.js` is the source of truth; its SHA-256 is `EB99931C457C767AF510DE7E1D01D71B13DF1FB21184110CBB8F7A97AEA6AE97`.
- Do not import, vendor, or refer to source files from the Ventriloc repository.
- Do not bundle or redistribute QQ Music.
- First release target is Windows x64 only.
- Preserve the unrelated untracked files `.npmrc`, `AGENTS.md`, and `design-qa.md`.

---

## File Map

### Bridge

- `bridge/qq-music/hook_qq_music.js` — exact supplied Frida RPC script.
- `bridge/qq-music/bridge/__init__.py` — package boundary and version.
- `bridge/qq-music/bridge/converter.py` — filename validation, output planning, Frida session, hook invocation.
- `bridge/qq-music/bridge/jobs.py` — serial queue, task state, cleanup.
- `bridge/qq-music/bridge/server.py` — loopback-only HTTP API, CORS, upload and download handling.
- `bridge/qq-music/main.py` — packaged-process entry point, lifecycle, optional browser opening.
- `bridge/qq-music/requirements-build.txt` — exact build dependencies.
- `bridge/qq-music/build.ps1` — reproducible PyInstaller build.
- `bridge/qq-music/tests/` — converter, hook, queue, API, and launcher tests.

### Blog

- `src/toolbox/qqMusic.js` — pure format, size, URL, and status helpers.
- `src/toolbox/ToolboxPage.jsx` — toolbox index page.
- `src/toolbox/QQMusicConverterPage.jsx` — upload queue and bridge interaction.
- `src/components/SiteHeader.jsx` — shared site navigation used by blog and toolbox pages.
- `src/components/ArrowLink.jsx` — shared internal/external arrow link control.
- `src/App.jsx` — route parsing, navigation, SEO integration, homepage entry.
- `src/styles.css` — toolbox styling using existing tokens and breakpoints.
- `tests/qq-music-toolbox.test.mjs` — pure frontend tests.
- `scripts/generate-site-assets.mjs` — toolbox sitemap routes.
- `README.md` — user and maintainer instructions.
- `.github/workflows/qq-music-bridge-release.yml` — Windows build and release artifact.

---

### Task 1: Establish the hook contract and bridge domain model

**Files:**
- Create: `bridge/qq-music/hook_qq_music.js`
- Create: `bridge/qq-music/bridge/__init__.py`
- Create: `bridge/qq-music/bridge/converter.py`
- Create: `bridge/qq-music/tests/__init__.py`
- Create: `bridge/qq-music/tests/test_hook_script.py`
- Create: `bridge/qq-music/tests/test_converter.py`

**Interfaces:**
- Produces: `safe_source_name(name: str) -> str`
- Produces: `target_name(name: str) -> str`
- Produces: `ConversionPlan.create(source_path, source_name, output_dir, runtime_dir) -> ConversionPlan`
- Produces: `ConversionError`
- Consumes: the exact user-supplied hook file and its `decrypt(srcFileName, tmpFileName)` RPC contract

- [ ] **Step 1: Add failing hook-contract tests**

```python
from pathlib import Path
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]

class HookContractTests(unittest.TestCase):
    def test_preserves_supplied_hook_and_rpc_contract(self):
        source = (ROOT / "hook_qq_music.js").read_text(encoding="utf-8")
        self.assertIn('const TARGET_DLL = "QQMusicCommon.dll"', source)
        for symbol in [
            "??0EncAndDesMediaFile@@QAE@XZ",
            "??1EncAndDesMediaFile@@QAE@XZ",
            "?Open@EncAndDesMediaFile@@QAE_NPB_W_N1@Z",
            "?GetSize@EncAndDesMediaFile@@QAEKXZ",
            "?Read@EncAndDesMediaFile@@QAEKPAEK_J@Z",
        ]:
            self.assertIn(symbol, source)
        self.assertIn('"thiscall"', source)
        self.assertIn("rpc.exports", source)
        self.assertIn("decrypt: function", source)
        digest = hashlib.sha256((ROOT / "hook_qq_music.js").read_bytes()).hexdigest().upper()
        self.assertEqual(digest, "EB99931C457C767AF510DE7E1D01D71B13DF1FB21184110CBB8F7A97AEA6AE97")
```

- [ ] **Step 2: Add failing filename and plan tests**

```python
import sys
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.converter import ConversionError, ConversionPlan, safe_source_name, target_name

class ConverterNamingTests(unittest.TestCase):
    def test_maps_supported_extensions_case_insensitively(self):
        self.assertEqual(target_name("demo.mflac"), "demo.flac")
        self.assertEqual(target_name("DEMO.MGG"), "DEMO.ogg")

    def test_reduces_upload_name_to_basename(self):
        self.assertEqual(safe_source_name("../../music/song.mflac"), "song.mflac")

    def test_rejects_unsupported_extension(self):
        with self.assertRaisesRegex(ConversionError, "仅支持"):
            safe_source_name("song.mp3")

    def test_creates_isolated_temporary_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "song.mflac"
            source.write_bytes(b"encrypted")
            plan = ConversionPlan.create(source, source.name, root / "output", root / "runtime")
            self.assertEqual(plan.output_path.name, "song.flac")
            self.assertEqual(plan.temporary_path.suffix, ".decrypting")
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `python -m unittest discover -s bridge/qq-music/tests -p "test_hook_script.py" -v`

Expected: FAIL because `hook_qq_music.js` does not exist in the bridge directory.

Run: `python -m unittest discover -s bridge/qq-music/tests -p "test_converter.py" -v`

Expected: FAIL because `bridge.converter` does not exist.

- [ ] **Step 4: Add the supplied hook and minimal domain implementation**

Copy the supplied hook byte-for-byte as a user-provided source asset, then verify the SHA-256 from Step 1:

```powershell
Copy-Item -LiteralPath "C:\Users\14564\Downloads\decrypt-mflac-frida-main\hook_qq_music.js" -Destination "bridge\qq-music\hook_qq_music.js"
```

Implement these exact constants and signatures:

```python
SUPPORTED_EXTENSIONS = {".mflac": ".flac", ".mgg": ".ogg"}

class ConversionError(RuntimeError):
    pass

def safe_source_name(source_name: str) -> str:
    raw_name = str(source_name or "").strip()
    basename = PurePosixPath(raw_name.replace("\\", "/")).name
    if basename in {"", ".", ".."}:
        raise ConversionError("文件名无效")
    if Path(basename).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ConversionError("仅支持 .mflac 和 .mgg 文件")
    return basename

def target_name(source_name: str) -> str:
    clean = safe_source_name(source_name)
    path = Path(clean)
    return f"{path.stem}{SUPPORTED_EXTENSIONS[path.suffix.lower()]}"
```

`ConversionPlan.create()` must create `output_dir`, create `runtime_dir` only when conversion is needed, and choose a UUID-based `.decrypting` temporary filename.

- [ ] **Step 5: Run the focused tests**

Run: `python -m unittest discover -s bridge/qq-music/tests -p "test_*.py" -v`

Expected: all Task 1 tests PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add bridge/qq-music/hook_qq_music.js bridge/qq-music/bridge bridge/qq-music/tests
git commit -m "feat: add independent QQ music bridge core"
```

---

### Task 2: Implement the Frida converter behind a mockable boundary

**Files:**
- Modify: `bridge/qq-music/bridge/converter.py`
- Modify: `bridge/qq-music/tests/test_converter.py`

**Interfaces:**
- Consumes: `ConversionPlan`, `ConversionError`
- Produces: `FridaConverter(hook_path: Path, runtime_dir: Path, frida_api=None)`
- Produces: `FridaConverter.convert(source_path, source_name, output_dir, progress=None) -> Path`
- Produces: `FridaConverter.is_qq_music_running() -> bool`
- Progress callback: `Callable[[int, str], None]`

- [ ] **Step 1: Add failing mock-Frida tests**

Create fake `attach`, `create_script`, `load`, `exports_sync.decrypt`, and `detach` objects. Assert the converter:

```python
def test_converter_attaches_loads_hook_and_moves_output(self):
    result = converter.convert(source, "song.mflac", output, lambda value, stage: updates.append((value, stage)))
    self.assertEqual(result, output / "song.flac")
    self.assertEqual(fake_frida.attached_process, "QQMusic.exe")
    self.assertTrue(fake_session.detached)
    self.assertEqual(result.read_bytes(), b"decoded")
    self.assertEqual(updates[-1], (100, "转换完成"))

def test_converter_reports_missing_qq_music(self):
    fake_frida.attach_error = RuntimeError("process not found")
    with self.assertRaisesRegex(ConversionError, "QQ 音乐正在运行"):
        converter.convert(source, source.name, output)

def test_process_probe_reports_qq_music(self):
    fake_frida.process_names = ["explorer.exe", "QQMusic.exe"]
    self.assertTrue(converter.is_qq_music_running())
```

Also assert that an existing output is reused without calling Frida and that a missing hook raises `找不到 hook_qq_music.js`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `python -m unittest discover -s bridge/qq-music/tests -p "test_converter.py" -v`

Expected: FAIL because `FridaConverter` is not defined.

- [ ] **Step 3: Implement the converter**

Implement lazy Frida import and this exact conversion sequence:

```python
session = frida_api.attach("QQMusic.exe")
script = session.create_script(self.hook_path.read_text(encoding="utf-8"))
script.load()
script.exports_sync.decrypt(str(plan.source_path), str(plan.temporary_path))
os.replace(plan.temporary_path, plan.output_path)
```

Emit `(10, "正在连接 QQ 音乐")`, `(30, "已连接 QQ 音乐，开始解密")`, `(70, "正在写入目标格式")`, and `(100, "转换完成")`. Detach in `finally` and delete an unfinished temporary file. Convert native errors into user-safe `ConversionError` messages without including tracebacks or full system paths.

`is_qq_music_running()` must call `frida_api.get_local_device().enumerate_processes()` and return true only when a process name equals `QQMusic.exe` case-insensitively. Catch probe errors and return false so `/api/health` remains available.

- [ ] **Step 4: Run converter and hook tests**

Run: `python -m unittest discover -s bridge/qq-music/tests -v`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add bridge/qq-music/bridge/converter.py bridge/qq-music/tests/test_converter.py
git commit -m "feat: connect bridge to QQ Music with Frida"
```

---

### Task 3: Add the serial job manager and loopback HTTP API

**Files:**
- Create: `bridge/qq-music/bridge/jobs.py`
- Create: `bridge/qq-music/bridge/server.py`
- Create: `bridge/qq-music/tests/test_jobs.py`
- Create: `bridge/qq-music/tests/test_server.py`

**Interfaces:**
- Consumes: converter callable `(Path, str, Path, ProgressCallback) -> Path`
- Produces: `Job.to_dict() -> dict`
- Produces: `JobManager.submit(source_name, source_path) -> Job`
- Produces: `create_server(host, port, data_root, hook_path=None, converter=None, process_probe=None) -> ThreadingHTTPServer`
- API: `/api/health`, `/api/convert`, `/api/jobs/{jobId}`, `/api/download/{jobId}`

- [ ] **Step 1: Write failing queue tests**

```python
def test_worker_completes_job_and_removes_uploaded_source(self):
    manager = JobManager(fake_converter, output_dir, incoming_dir)
    job = manager.submit("song.mflac", source)
    self.assertTrue(wait_until(lambda: job.status == "completed"))
    self.assertEqual(job.progress, 100)
    self.assertFalse(source.exists())
    manager.shutdown()

def test_worker_serializes_native_calls(self):
    # Submit two jobs; fake_converter records active call count.
    self.assertEqual(max_active_calls, 1)
```

- [ ] **Step 2: Write failing HTTP and CORS tests**

Start `create_server("127.0.0.1", 0, root, converter=fake_converter, process_probe=lambda: False)` in a test thread and assert:

```python
def test_health_upload_job_and_download(self):
    health = self.request("GET", "/api/health")
    health_payload = json.load(health)
    self.assertTrue(health_payload["ok"])
    self.assertFalse(health_payload["qqMusicRunning"])
    upload = self.request("POST", "/api/convert", b"encrypted", {
        "Content-Type": "application/octet-stream",
        "X-File-Name": quote("测试.mflac"),
    })
    job_id = json.load(upload)["jobId"]
    self.assertEqual(self.wait_for_job(job_id)["status"], "completed")
    self.assertEqual(self.request("GET", f"/api/download/{job_id}").read(), b"decoded")

def test_preflight_allows_only_blog_origin(self):
    allowed = self.request("OPTIONS", "/api/convert", headers={
        "Origin": "https://gugugaga-blog.netlify.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-file-name",
        "Access-Control-Request-Private-Network": "true",
    })
    self.assertEqual(allowed.headers["Access-Control-Allow-Origin"], "https://gugugaga-blog.netlify.app")
    self.assertEqual(allowed.headers["Access-Control-Allow-Private-Network"], "true")
```

Also test unknown origins, unsupported extensions, empty bodies, files over 1 GiB, traversal names, unknown jobs, unfinished downloads, and downloads outside the output root.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `python -m unittest discover -s bridge/qq-music/tests -v`

Expected: FAIL because `JobManager` and `create_server` do not exist.

- [ ] **Step 4: Implement the queue model**

Use `queue.Queue`, one daemon worker, a lock-protected job dictionary, and a lock on each `Job`. `Job.to_dict()` must return camelCase API properties:

```python
{
    "jobId": self.job_id,
    "sourceName": self.source_name,
    "targetName": self.target_name,
    "status": self.status,
    "progress": self.progress,
    "stage": self.stage,
}
```

Only add `error` when present and `downloadUrl` when completed.

- [ ] **Step 5: Implement the HTTP handler**

Use `BaseHTTPRequestHandler` and `ThreadingHTTPServer`. Validate `Content-Length` before reading. Save each upload to `runtime/incoming/{jobId}/source-name`. Add response headers only when `Origin` is in the exact allowed-origin set. Return JSON encoded as UTF-8 and use HTTP 202 for accepted conversion jobs.

The health response must be:

```json
{"ok": true, "service": "qq-music-bridge", "version": "1.0.0", "qqMusicRequired": true, "qqMusicRunning": false}
```

When no fake converter is supplied, construct `FridaConverter(hook_path, data_root / "runtime" / "decrypting")` and use its `is_qq_music_running` method as the default health probe. Store incoming files and outputs under the writable `data_root`; never write beside a PyInstaller bundled hook.

- [ ] **Step 6: Run all bridge tests**

Run: `python -m unittest discover -s bridge/qq-music/tests -v`

Expected: PASS with no remaining files under test `runtime/incoming` directories.

- [ ] **Step 7: Commit Task 3**

```powershell
git add bridge/qq-music/bridge/jobs.py bridge/qq-music/bridge/server.py bridge/qq-music/tests/test_jobs.py bridge/qq-music/tests/test_server.py
git commit -m "feat: add loopback conversion API"
```

---

### Task 4: Create the one-click Windows launcher and package build

**Files:**
- Create: `bridge/qq-music/main.py`
- Create: `bridge/qq-music/requirements-build.txt`
- Create: `bridge/qq-music/build.ps1`
- Create: `bridge/qq-music/tests/test_launcher.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `create_server("127.0.0.1", 8765, data_root(), hook_path=resource_path("hook_qq_music.js"))`
- Produces: `resource_path(relative: str) -> Path`
- Produces: `data_root() -> Path`
- Produces: `build_server() -> ThreadingHTTPServer`
- Produces: `main(open_browser: bool = True) -> None`
- Produces: `dist/qq-music-bridge.exe`

- [ ] **Step 1: Write failing launcher tests**

```python
def test_resource_path_uses_pyinstaller_bundle(self):
    original = getattr(sys, "_MEIPASS", None)
    try:
        sys._MEIPASS = r"C:\bundle"
        self.assertEqual(resource_path("hook_qq_music.js"), Path(r"C:\bundle\hook_qq_music.js"))
    finally:
        if original is None:
            del sys._MEIPASS
        else:
            sys._MEIPASS = original

def test_launcher_binds_only_to_loopback(self):
    with patch("main.create_server") as create:
        build_server()
        create.assert_called_once_with(
            "127.0.0.1", 8765, data_root(),
            hook_path=resource_path("hook_qq_music.js"),
        )
```

Use `unittest.mock`; do not add pytest as a dependency. Set and remove `sys._MEIPASS` explicitly inside `try/finally`.

- [ ] **Step 2: Run launcher test and verify failure**

Run: `python -m unittest discover -s bridge/qq-music/tests -p "test_launcher.py" -v`

Expected: FAIL because `main.py` does not exist.

- [ ] **Step 3: Implement launcher lifecycle**

`main.py` must resolve packaged resources through `sys._MEIPASS`. `data_root()` must use `%LOCALAPPDATA%/Gugugaga/QQMusicBridge` and create it before server startup. Create the server on loopback, print a short Chinese status message, and open `https://gugugaga-blog.netlify.app/tools/qq-music-converter` after the health endpoint is available. Parse `--no-browser` with `argparse` for development and smoke tests. Handle Ctrl+C and always call `server.shutdown()`, `server.server_close()`, and `server.job_manager.shutdown()`.

- [ ] **Step 4: Add reproducible package configuration**

`requirements-build.txt`:

```text
frida==16.6.6
pyinstaller==6.15.0
```

`build.ps1` must run:

```powershell
python -m pip install -r bridge/qq-music/requirements-build.txt
python -m PyInstaller --noconfirm --clean --onefile --name qq-music-bridge --collect-all frida --add-data "bridge/qq-music/hook_qq_music.js;." --paths "bridge/qq-music" bridge/qq-music/main.py
```

Add `/build/`, `/dist/`, and `*.spec` to `.gitignore` without changing existing ignore rules.

- [ ] **Step 5: Run tests and build the executable**

Run: `python -m unittest discover -s bridge/qq-music/tests -v`

Expected: PASS.

Run: `powershell -ExecutionPolicy Bypass -File bridge/qq-music/build.ps1`

Expected: `dist/qq-music-bridge.exe` exists and exits cleanly after Ctrl+C.

- [ ] **Step 6: Smoke-test the packaged health endpoint**

Start `dist/qq-music-bridge.exe`, request `http://127.0.0.1:8765/api/health`, verify `service` is `qq-music-bridge`, then stop the process. Do not submit a real encrypted file in this automated step.

- [ ] **Step 7: Commit Task 4**

```powershell
git add .gitignore bridge/qq-music/main.py bridge/qq-music/requirements-build.txt bridge/qq-music/build.ps1 bridge/qq-music/tests/test_launcher.py
git commit -m "build: package QQ music bridge for Windows"
```

---

### Task 5: Add tested frontend toolbox helpers and route metadata

**Files:**
- Create: `src/toolbox/qqMusic.js`
- Create: `tests/qq-music-toolbox.test.mjs`
- Modify: `package.json`
- Modify: `src/App.jsx`

**Interfaces:**
- Produces: `QQ_MUSIC_BRIDGE_ORIGIN = "http://127.0.0.1:8765"`
- Produces: `targetFor(name: string) -> ".flac" | ".ogg" | null`
- Produces: `formatBytes(bytes: number) -> string`
- Produces: `bridgeUrl(pathname: string) -> string`
- Produces: `statusLabel(status: string, stage?: string) -> string`
- Produces parsed route metadata for `/tools` and `/tools/qq-music-converter`

- [ ] **Step 1: Add failing frontend helper tests**

```javascript
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
  assert.equal(statusLabel("processing", "正在连接 QQ 音乐"), "正在连接 QQ 音乐");
  assert.equal(statusLabel("completed"), "已完成");
});

test("formats queue file sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
});
```

- [ ] **Step 2: Add the test script and verify failure**

Add `"test": "node --test tests/qq-music-toolbox.test.mjs"` to `package.json`.

Run: `npm test`

Expected: FAIL because `src/toolbox/qqMusic.js` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Use a frozen extension map, lower-case only the extracted suffix, cap `formatBytes` at GB, and normalize `bridgeUrl` to one slash between the origin and path.

- [ ] **Step 4: Extend route parsing and SEO metadata**

`readLocation()` must parse `toolSlug` from `/tools/:slug`. `applySeo()` must set distinct titles and descriptions for the toolbox index and converter page. Do not add render branches yet; Task 6 adds them together with the concrete page components so this task keeps a buildable application.

- [ ] **Step 5: Run frontend tests and production build**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS; no unresolved imports.

- [ ] **Step 6: Commit Task 5**

```powershell
git add package.json src/App.jsx src/toolbox/qqMusic.js tests/qq-music-toolbox.test.mjs
git commit -m "feat: add toolbox routing and bridge helpers"
```

---

### Task 6: Build the homepage-matched toolbox experience

**Files:**
- Create: `src/toolbox/ToolboxPage.jsx`
- Create: `src/toolbox/QQMusicConverterPage.jsx`
- Create: `src/components/SiteHeader.jsx`
- Create: `src/components/ArrowLink.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `bridgeUrl`, `formatBytes`, `statusLabel`, `targetFor`
- Produces: reusable `SiteHeader` and `ArrowLink` components
- Produces: `ToolboxPage({ onNavigate })`
- Produces: `QQMusicConverterPage({ onNavigate })`
- Bridge request option: `{ mode: "cors", targetAddressSpace: "loopback" }`

- [ ] **Step 1: Extract reusable blog components without changing behavior**

Move `SiteHeader` to `src/components/SiteHeader.jsx` and `ArrowLink` to `src/components/ArrowLink.jsx`, then import them into `src/App.jsx` and the two toolbox pages. Pass `onNavigate` through props exactly as today; `SiteHeader` keeps its current menu state and section-scrolling behavior. Run `npm run build` and verify the homepage and article routes still compile before adding toolbox markup.

- [ ] **Step 2: Implement the toolbox index page**

Render the existing fixed glass navigation, a serif `工具箱` hero, one QQ Music converter card, format tags, local-only copy, and a button navigating to `/tools/qq-music-converter`. Use existing `eyebrow`, `primary-button`, and `border-trace` classes where their semantics match.

Import both page components into `src/App.jsx` and add these branches before the 404 branch:

```jsx
if (location.pathname === "/tools") return <ToolboxPage onNavigate={navigate} />;
if (location.toolSlug === "qq-music-converter") return <QQMusicConverterPage onNavigate={navigate} />;
```

- [ ] **Step 3: Implement bridge health detection**

On converter-page mount, request `/api/health` immediately and every 12 seconds. Store `checking`, `online`, or `offline`, plus the returned `qqMusicRunning` boolean. Cleanup the interval on unmount. When online, render the returned version and show either “QQ 音乐已运行” or “请先启动 QQ 音乐”; when offline, show the GitHub Release download link:

```text
https://github.com/Ouy5517/gugugaga-blog/releases/latest/download/qq-music-bridge.exe
```

- [ ] **Step 4: Implement the upload queue**

Queue items use this shape:

```javascript
{
  id, file, target, status: "ready", progress: 0,
  stage: "等待转换", error: "", jobId: "", downloadUrl: ""
}
```

Support file input, drag-and-drop, keyboard activation, duplicate filtering by `name:size`, removal of ready/failed items, and clearing completed items. Reject unsupported files before network activity.

- [ ] **Step 5: Implement submission, polling, and download**

POST each ready/failed item to `/api/convert` with `Content-Type: application/octet-stream` and URL-encoded `X-File-Name`. Poll `/api/jobs/{jobId}` every 650 ms until completed or failed. Use `Promise.allSettled` so one failed file does not stop other queue items. Render downloads from the returned `downloadUrl` using the loopback origin.

- [ ] **Step 6: Add homepage and navigation entry points**

Add `工具箱` between `文章` and `项目` in desktop/mobile navigation. Add one homepage section after projects with `data-reveal`, a concise local-tool description, the format mapping, and a button to the converter page.

- [ ] **Step 7: Add homepage-consistent CSS**

Use existing variables only. Add focused classes for `.toolbox-page`, `.tool-page`, `.tool-card`, `.tool-layout`, `.tool-dropzone`, `.tool-queue-item`, `.tool-progress`, `.tool-status`, and `.tool-instructions`. Desktop uses a flexible converter-plus-sidebar grid; at 900 px it becomes one column; at 640 px cards use reduced padding and long filenames use ellipsis. Add no fixed widths that can exceed `calc(100vw - 28px)`.

- [ ] **Step 8: Run tests and build**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```powershell
git add src/App.jsx src/styles.css src/components/SiteHeader.jsx src/components/ArrowLink.jsx src/toolbox/ToolboxPage.jsx src/toolbox/QQMusicConverterPage.jsx
git commit -m "feat: build homepage-matched conversion toolbox"
```

---

### Task 7: Add SEO, documentation, and automated Windows releases

**Files:**
- Modify: `scripts/generate-site-assets.mjs`
- Modify: `public/sitemap.xml`
- Modify: `README.md`
- Create: `bridge/qq-music/README.md`
- Create: `.github/workflows/qq-music-bridge-release.yml`

**Interfaces:**
- Consumes: `/tools`, `/tools/qq-music-converter`
- Produces: sitemap entries for both routes
- Produces: GitHub Release asset named exactly `qq-music-bridge.exe`

- [ ] **Step 1: Add toolbox URLs to generated site assets**

Insert these static entries before article-detail URLs:

```javascript
`${siteUrl}/tools`,
`${siteUrl}/tools/qq-music-converter`,
```

Run `npm run build`, then assert both routes appear in `public/sitemap.xml`.

- [ ] **Step 2: Document user operation and maintenance**

The root README must explain the two new routes, that the bridge stays local, and that QQ Music must be running. `bridge/qq-music/README.md` must include exact source-test-build commands:

```powershell
python -m unittest discover -s bridge/qq-music/tests -v
powershell -ExecutionPolicy Bypass -File bridge/qq-music/build.ps1
dist\qq-music-bridge.exe
```

It must also explain the incompatible-DLL error and how to update the hook symbols after a QQ Music release.

- [ ] **Step 3: Add the Windows release workflow**

Create a workflow triggered by `workflow_dispatch` and tags matching `qq-music-bridge-v*`. It must use `windows-latest`, `actions/checkout@v4`, `actions/setup-python@v5` with Python `3.12`, install `requirements-build.txt`, run bridge tests, run `build.ps1`, upload `dist/qq-music-bridge.exe`, and attach it to a GitHub Release on tag builds.

```yaml
name: QQ Music Bridge Release
on:
  workflow_dispatch:
  push:
    tags:
      - "qq-music-bridge-v*"
jobs:
  build:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install -r bridge/qq-music/requirements-build.txt
      - run: python -m unittest discover -s bridge/qq-music/tests -v
      - shell: powershell
        run: ./bridge/qq-music/build.ps1
      - uses: actions/upload-artifact@v4
        with:
          name: qq-music-bridge
          path: dist/qq-music-bridge.exe
      - uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/qq-music-bridge-v')
        with:
          files: dist/qq-music-bridge.exe
```

- [ ] **Step 4: Validate generated assets and workflow syntax**

Run: `npm run build`

Expected: PASS and sitemap contains both tool routes.

Run: `python -m unittest discover -s bridge/qq-music/tests -v`

Expected: PASS.

Inspect the workflow to confirm the uploaded asset path and public download filename are both exactly `qq-music-bridge.exe`.

- [ ] **Step 5: Commit Task 7**

```powershell
git add scripts/generate-site-assets.mjs public/sitemap.xml README.md bridge/qq-music/README.md .github/workflows/qq-music-bridge-release.yml
git commit -m "docs: publish QQ music toolbox workflow"
```

---

### Task 8: Complete end-to-end and visual verification

**Files:**
- Modify only files required by defects found during this task.

**Interfaces:**
- Consumes: all bridge, frontend, packaging, and release outputs
- Produces: verified Netlify build and verified Windows bridge artifact

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm test
npm run build
python -m unittest discover -s bridge/qq-music/tests -v
git diff --check
```

Expected: every command exits 0. The existing Vite large-chunk warning is acceptable; new errors are not.

- [ ] **Step 2: Start both local processes**

Start the blog with `npm run dev -- --host 127.0.0.1`. Start the source bridge with `python bridge/qq-music/main.py --no-browser`. Confirm `GET http://127.0.0.1:8765/api/health` returns HTTP 200.

- [ ] **Step 3: Verify browser behavior with the bridge offline and online**

Open `/tools` and `/tools/qq-music-converter`. With the bridge stopped, verify the offline state and download link. Start the bridge, reload, and verify the state changes to online. Inspect browser console errors after each state.

- [ ] **Step 4: Verify responsive layout**

Capture the default desktop layout and a 390 × 844 viewport. Confirm the header, hero, dropzone, queue, buttons, and instructions fit without horizontal scrolling. Confirm the reduced-motion media query remains present.

- [ ] **Step 5: Exercise the queue without copyrighted media**

Use a temporary dummy `.mflac` file to verify selection, duplicate filtering, upload, job failure display, removal, and retry while QQ Music is absent. Do not claim real conversion success from this test.

- [ ] **Step 6: Perform the Windows manual conversion acceptance test**

With QQ Music running and a user-owned test file, convert one `.mflac` and one `.mgg`. Verify target extensions, non-empty output, playable media, unchanged source files, correct progress states, and successful downloads. This is the only step that may mark native conversion as verified.

- [ ] **Step 7: Build and smoke-test the packaged executable**

Run `build.ps1`, start `dist/qq-music-bridge.exe`, check `/api/health`, close it, and confirm port 8765 is released. Record the executable SHA-256 in the release notes, not in the repository.

- [ ] **Step 8: Fix only verified defects and rerun affected checks**

For every defect, first add or strengthen the smallest automated test that reproduces it, run the test to see it fail, apply the focused fix, and rerun the focused test plus the complete suite from Step 1.

- [ ] **Step 9: Commit verification fixes**

```powershell
git add -- bridge/qq-music src/toolbox src/components src/App.jsx src/styles.css scripts/generate-site-assets.mjs public/sitemap.xml README.md .github/workflows/qq-music-bridge-release.yml
git commit -m "fix: complete QQ music toolbox verification"
```

Skip this commit when Step 8 produces no code changes.
