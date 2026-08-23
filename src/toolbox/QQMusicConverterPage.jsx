import { ArrowLeft, ArrowClockwise, CheckCircle, DownloadSimple, FileArrowUp, MusicNotes, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "../components/SiteHeader.jsx";
import { bridgeUrl, formatBytes, statusLabel, targetFor } from "./qqMusic.js";

const HEALTH_INTERVAL_MS = 12_000;
const JOB_INTERVAL_MS = 650;
const releaseUrl = "https://github.com/Ouy5517/gugugaga-blog/releases/latest/download/qq-music-bridge.exe";
const bridgeRequestOptions = { mode: "cors", targetAddressSpace: "loopback" };

function queueItemFor(file) {
  return {
    id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    file,
    target: targetFor(file.name),
    status: "ready",
    progress: 0,
    stage: "等待转换",
    error: "",
    jobId: "",
    downloadUrl: "",
  };
}

function jobDownloadUrl(downloadUrl) {
  return downloadUrl ? bridgeUrl(downloadUrl) : "";
}

export function QQMusicConverterPage({ onNavigate }) {
  const [health, setHealth] = useState({ state: "checking", qqMusicRunning: false, version: "" });
  const [queue, setQueue] = useState([]);
  const [notice, setNotice] = useState("");
  const inputRef = useRef(null);
  const pollTimers = useRef(new Map());

  const updateItem = useCallback((id, patch) => {
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const clearPoll = useCallback((id) => {
    const timer = pollTimers.current.get(id);
    if (timer) window.clearInterval(timer);
    pollTimers.current.delete(id);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(bridgeUrl("/api/health"), bridgeRequestOptions);
      if (!response.ok) throw new Error("桥接服务没有响应");
      const data = await response.json();
      setHealth({ state: "online", qqMusicRunning: Boolean(data.qqMusicRunning), version: data.version || "" });
    } catch {
      setHealth({ state: "offline", qqMusicRunning: false, version: "" });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = window.setInterval(checkHealth, HEALTH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkHealth]);

  useEffect(() => () => {
    pollTimers.current.forEach((timer) => window.clearInterval(timer));
    pollTimers.current.clear();
  }, []);

  const pollJob = useCallback((item) => {
    clearPoll(item.id);
    const poll = async () => {
      try {
        const response = await fetch(bridgeUrl(`/api/jobs/${encodeURIComponent(item.jobId)}`), bridgeRequestOptions);
        if (!response.ok) throw new Error("无法读取转换进度");
        const data = await response.json();
        const status = data.status || "converting";
        const patch = { status, progress: Number.isFinite(data.progress) ? data.progress : 0, stage: statusLabel(status, data.stage), error: data.error || "" };
        if (status === "completed") patch.downloadUrl = jobDownloadUrl(data.downloadUrl);
        updateItem(item.id, patch);
        if (status === "completed" || status === "failed") clearPoll(item.id);
      } catch (error) {
        updateItem(item.id, { status: "failed", stage: "转换失败", error: error.message || "无法读取转换进度" });
        clearPoll(item.id);
      }
    };
    poll();
    pollTimers.current.set(item.id, window.setInterval(poll, JOB_INTERVAL_MS));
  }, [clearPoll, updateItem]);

  const submitItem = useCallback(async (item) => {
    updateItem(item.id, { status: "queued", progress: 0, stage: "等待转换", error: "", downloadUrl: "" });
    try {
      const response = await fetch(bridgeUrl("/api/convert"), {
        ...bridgeRequestOptions,
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(item.file.name) },
        body: item.file,
      });
      if (!response.ok) throw new Error("桥接服务拒绝了该文件");
      const data = await response.json();
      const jobId = data.jobId || data.id;
      if (!jobId) throw new Error("桥接服务没有返回任务编号");
      const queuedItem = { ...item, jobId };
      updateItem(item.id, { status: data.status || "queued", stage: statusLabel(data.status || "queued", data.stage), jobId });
      pollJob(queuedItem);
    } catch (error) {
      updateItem(item.id, { status: "failed", stage: "转换失败", error: error.message || "无法提交转换" });
    }
  }, [pollJob, updateItem]);

  const submitQueue = () => {
    const eligible = queue.filter((item) => item.status === "ready" || item.status === "failed");
    if (!eligible.length) return;
    Promise.allSettled(eligible.map(submitItem));
  };

  const addFiles = (files) => {
    const selected = Array.from(files || []);
    const supported = selected.filter((file) => targetFor(file.name));
    const unsupported = selected.length - supported.length;
    setQueue((items) => {
      const known = new Set(items.map((item) => `${item.file.name}:${item.file.size}`));
      return [...items, ...supported.filter((file) => {
        const key = `${file.name}:${file.size}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }).map(queueItemFor)];
    });
    if (unsupported) setNotice("仅支持 .mflac 和 .mgg 文件，其他文件没有加入队列。");
    else setNotice("");
  };

  const removeItem = (item) => {
    if (item.status !== "ready" && item.status !== "failed") return;
    clearPoll(item.id);
    setQueue((items) => items.filter((candidate) => candidate.id !== item.id));
  };

  const retryItem = (item) => {
    clearPoll(item.id);
    updateItem(item.id, { status: "ready", progress: 0, stage: "等待转换", error: "", jobId: "", downloadUrl: "" });
  };

  const clearCompleted = () => setQueue((items) => items.filter((item) => item.status !== "completed"));

  const onDrop = (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };

  const readyCount = queue.filter((item) => item.status === "ready" || item.status === "failed").length;
  const completedCount = queue.filter((item) => item.status === "completed").length;

  return <main className="tool-page">
    <SiteHeader onNavigate={onNavigate} />
    <div className="page-shell tool-shell">
      <button className="back-link" type="button" onClick={() => onNavigate("/tools")}><ArrowLeft size={17} aria-hidden="true" /> 返回工具箱</button>
      <section className="tool-page-hero">
        <p className="eyebrow">LOCAL QQ MUSIC CONVERTER</p>
        <h1>QQ 音乐缓存转换</h1>
        <p>选择 QQ 音乐缓存文件，通过本地桥接服务完成格式转换；音乐文件不会离开你的电脑。</p>
      </section>

      <section className={`tool-status is-${health.state}`} aria-live="polite">
        {health.state === "checking" && <><MusicNotes size={20} aria-hidden="true" /><div><strong>正在检查桥接服务</strong><span>正在连接本机 127.0.0.1:8765…</span></div></>}
        {health.state === "online" && <><CheckCircle size={20} aria-hidden="true" /><div><strong>桥接服务已启动{health.version ? ` · v${health.version}` : ""}</strong><span>{health.qqMusicRunning ? "QQ 音乐已运行" : "请先启动 QQ 音乐"}</span></div></>}
        {health.state === "offline" && <><WarningCircle size={20} aria-hidden="true" /><div><strong>桥接服务未启动</strong><span>请下载并启动本地桥接服务后，再重新打开此页面。</span></div><a href={releaseUrl}>下载 QQ Music Bridge</a></>}
      </section>

      <div className="tool-layout">
        <section className="tool-card tool-converter-card" aria-labelledby="dropzone-title">
          <h2 id="dropzone-title">添加缓存文件</h2>
          <p className="tool-muted">支持 MFLAC → FLAC、MGG → OGG。重复的同名同大小文件会自动忽略。</p>
          <input ref={inputRef} id="qq-music-files" className="sr-only" type="file" accept=".mflac,.mgg" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          <div className="tool-dropzone" role="button" tabIndex="0" aria-describedby="dropzone-help" onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <FileArrowUp size={34} weight="light" aria-hidden="true" />
            <strong>拖放 QQ 音乐缓存文件到这里</strong>
            <span id="dropzone-help">或按 Enter / 空格选择文件</span>
            <label className="tool-file-button" htmlFor="qq-music-files" onClick={(event) => event.stopPropagation()}>选择文件</label>
          </div>
          {notice && <p className="tool-notice" role="alert"><XCircle size={17} aria-hidden="true" /> {notice}</p>}
          <div className="tool-queue-header"><h3>转换队列{queue.length ? ` · ${queue.length}` : ""}</h3>{completedCount > 0 && <button className="tool-text-button" type="button" onClick={clearCompleted}>清除已完成</button>}</div>
          {queue.length === 0 ? <p className="tool-empty">还没有文件。选择或拖放 MFLAC、MGG 缓存文件开始。</p> : <ul className="tool-queue" aria-label="转换队列">{queue.map((item) => <li className="tool-queue-item" key={item.id}>
            <div className="tool-file-meta"><MusicNotes size={20} aria-hidden="true" /><div><strong title={item.file.name}>{item.file.name}</strong><span>{formatBytes(item.file.size)} · {item.target?.slice(1).toUpperCase()}</span></div></div>
            <div className="tool-job-meta"><span>{statusLabel(item.status, item.stage)}</span>{(item.status === "queued" || item.status === "converting") && <div className="tool-progress" aria-label={`${item.file.name} 转换进度`}><span style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></div>}{item.error && <small>{item.error}</small>}</div>
            <div className="tool-item-actions">{item.status === "completed" && item.downloadUrl && <a href={item.downloadUrl} download><DownloadSimple size={18} aria-hidden="true" /> 下载</a>}{item.status === "failed" && <button type="button" onClick={() => retryItem(item)} aria-label={`重试 ${item.file.name}`}><ArrowClockwise size={18} aria-hidden="true" /> 重试</button>}{(item.status === "ready" || item.status === "failed") && <button type="button" onClick={() => removeItem(item)} aria-label={`移除 ${item.file.name}`}><Trash size={18} aria-hidden="true" /></button>}</div>
          </li>)}</ul>}
          <button className="primary-button tool-submit" type="button" onClick={submitQueue} disabled={!readyCount || health.state !== "online"}>转换 {readyCount ? `${readyCount} 个文件` : "文件"}</button>
        </section>
        <aside className="tool-instructions">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>本地处理说明</h2>
          <ol><li>启动 QQ 音乐并保持登录。</li><li>启动 QQ Music Bridge，然后确认上方状态变为在线。</li><li>选择缓存文件，转换完成后下载结果。</li></ol>
          <p>仅在你的电脑本地处理，页面只会请求本机桥接服务。</p>
        </aside>
      </div>
    </div>
  </main>;
}
