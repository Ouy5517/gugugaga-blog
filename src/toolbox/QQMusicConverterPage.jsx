import { ArrowLeft, ArrowClockwise, CheckCircle, DownloadSimple, FileArrowUp, MusicNotes, Trash, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "../components/SiteHeader.jsx";
import { createJobPoller } from "./jobPolling.js";
import { bridgeUrl, formatBytes, selectQQMusicFiles, statusLabel, targetFor } from "./qqMusic.js";

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

export function BridgeStatus({ health, onRetry }) {
  return <section className={`tool-status is-${health.state}`} role="status" aria-live="polite" aria-atomic="true">
    {health.state === "checking" && <><MusicNotes size={20} aria-hidden="true" /><div><strong>正在检查桥接服务</strong><span>正在连接本机 127.0.0.1:8765…</span></div></>}
    {health.state === "online" && <><CheckCircle size={20} aria-hidden="true" /><div><strong>桥接服务已启动{health.version ? ` · v${health.version}` : ""}</strong><span>{health.qqMusicRunning ? "QQ 音乐已运行" : "请先启动 QQ 音乐"}</span></div></>}
    {health.state === "offline" && <><WarningCircle size={20} aria-hidden="true" /><div><strong>桥接服务未启动</strong><span>启动 QQ Music Bridge 后可点“重新检测”，页面也会自动重检。</span></div><nav className="tool-status-actions" aria-label="桥接服务操作"><button className="tool-text-button" type="button" onClick={onRetry}>重新检测</button><a href={releaseUrl}>下载 QQ Music Bridge</a></nav></>}
  </section>;
}

export function QueueJobStatus({ item }) {
  const progress = Math.max(0, Math.min(100, Number.isFinite(item.progress) ? item.progress : 0));
  const isActive = item.status === "queued" || item.status === "converting";
  const announceStage = isActive || item.status === "completed";

  return <div className="tool-job-meta">
    <span role={announceStage ? "status" : undefined} aria-live={announceStage ? "polite" : undefined} aria-atomic={announceStage ? "true" : undefined}>{statusLabel(item.status, item.stage)}</span>
    {isActive && <div className="tool-progress" role="progressbar" aria-label={`${item.file.name} 转换进度`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
    {item.error && <small role="alert">{item.error}</small>}
  </div>;
}

export function ConversionInstructions({ online }) {
  if (online) {
    return <aside className="tool-instructions is-compact">
      <p className="eyebrow">LOCAL PROCESSING</p>
      <h2>本地处理</h2>
      <p>桥接服务已就绪；所选文件只在你的电脑本地处理。</p>
    </aside>;
  }

  return <aside className="tool-instructions">
    <p className="eyebrow">HOW IT WORKS</p>
    <h2>首次使用</h2>
    <ol><li>启动 QQ 音乐并保持登录。</li><li>启动 QQ Music Bridge，然后确认上方状态变为在线。</li><li>选择缓存文件，转换完成后下载结果。</li></ol>
    <p>仅在你的电脑本地处理，页面只会请求本机桥接服务。</p>
  </aside>;
}

export function QQMusicConverterPage({ onNavigate }) {
  const [health, setHealth] = useState({ state: "checking", qqMusicRunning: false, version: "" });
  const [queue, setQueue] = useState([]);
  const [notice, setNotice] = useState("");
  const inputRef = useRef(null);
  const pollers = useRef(new Map());
  const submittingIds = useRef(new Set());
  const mountedRef = useRef(true);

  const updateItem = useCallback((id, patch) => {
    if (!mountedRef.current) return;
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const clearPoll = useCallback((id) => {
    pollers.current.get(id)?.stop();
    pollers.current.delete(id);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(bridgeUrl("/api/health"), bridgeRequestOptions);
      if (!response.ok) throw new Error("桥接服务没有响应");
      const data = await response.json();
      if (!mountedRef.current) return;
      setHealth({ state: "online", qqMusicRunning: Boolean(data.qqMusicRunning), version: data.version || "" });
    } catch {
      if (!mountedRef.current) return;
      setHealth({ state: "offline", qqMusicRunning: false, version: "" });
    }
  }, []);

  const retryHealth = useCallback(() => {
    setHealth({ state: "checking", qqMusicRunning: false, version: "" });
    checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    mountedRef.current = true;
    checkHealth();
    const interval = window.setInterval(checkHealth, HEALTH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [checkHealth]);

  useEffect(() => () => {
    pollers.current.forEach((poller) => poller.stop());
    pollers.current.clear();
    submittingIds.current.clear();
  }, []);

  const pollJob = useCallback((item) => {
    clearPoll(item.id);
    const poller = createJobPoller({
      fetchJob: async () => {
        const response = await fetch(bridgeUrl(`/api/jobs/${encodeURIComponent(item.jobId)}`), bridgeRequestOptions);
        if (!response.ok) throw new Error("无法读取转换进度");
        return response.json();
      },
      onUpdate: (data) => {
        const status = data.status || "converting";
        const patch = { status, progress: Number.isFinite(data.progress) ? data.progress : 0, stage: statusLabel(status, data.stage), error: data.error || "" };
        if (status === "completed") patch.downloadUrl = jobDownloadUrl(data.downloadUrl);
        updateItem(item.id, patch);
        if (status === "completed" || status === "failed") {
          pollers.current.delete(item.id);
          submittingIds.current.delete(item.id);
        }
      },
      onError: (error) => {
        updateItem(item.id, { status: "failed", stage: "转换失败", error: error.message || "无法读取转换进度" });
        clearPoll(item.id);
        submittingIds.current.delete(item.id);
      },
      intervalMs: JOB_INTERVAL_MS,
    });
    pollers.current.set(item.id, poller);
    poller.start();
  }, [clearPoll, updateItem]);

  const submitItem = useCallback(async (item) => {
    if (submittingIds.current.has(item.id)) return;
    clearPoll(item.id);
    submittingIds.current.add(item.id);
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
      if (!mountedRef.current) {
        submittingIds.current.delete(item.id);
        return;
      }
      const queuedItem = { ...item, jobId };
      updateItem(item.id, { status: data.status || "queued", stage: statusLabel(data.status || "queued", data.stage), jobId });
      pollJob(queuedItem);
    } catch (error) {
      updateItem(item.id, { status: "failed", stage: "转换失败", error: error.message || "无法提交转换" });
      submittingIds.current.delete(item.id);
    }
  }, [clearPoll, pollJob, updateItem]);

  const submitQueue = () => {
    const eligible = queue.filter((item) => item.status === "ready" || item.status === "failed");
    if (!eligible.length) return;
    Promise.allSettled(eligible.map(submitItem));
  };

  const addFiles = (files) => {
    const selection = selectQQMusicFiles(files);
    setQueue((items) => {
      const known = new Set(items.map((item) => `${item.file.name}:${item.file.size}`));
      return [...items, ...selection.files.filter((file) => {
        const key = `${file.name}:${file.size}`;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }).map(queueItemFor)];
    });
    setNotice(selection.notice);
  };

  const removeItem = (item) => {
    if (item.status !== "ready" && item.status !== "failed") return;
    clearPoll(item.id);
    submittingIds.current.delete(item.id);
    setQueue((items) => items.filter((candidate) => candidate.id !== item.id));
  };

  const retryItem = (item) => {
    clearPoll(item.id);
    submittingIds.current.delete(item.id);
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

      <BridgeStatus health={health} onRetry={retryHealth} />

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
            <QueueJobStatus item={item} />
            <div className="tool-item-actions">{item.status === "completed" && item.downloadUrl && <a href={item.downloadUrl} download><DownloadSimple size={18} aria-hidden="true" /> 下载</a>}{item.status === "failed" && <button type="button" onClick={() => retryItem(item)} aria-label={`重试 ${item.file.name}`}><ArrowClockwise size={18} aria-hidden="true" /> 重试</button>}{(item.status === "ready" || item.status === "failed") && <button type="button" onClick={() => removeItem(item)} aria-label={`移除 ${item.file.name}`}><Trash size={18} aria-hidden="true" /></button>}</div>
          </li>)}</ul>}
          <button className="primary-button tool-submit" type="button" onClick={submitQueue} disabled={!readyCount || health.state !== "online"}>转换 {readyCount ? `${readyCount} 个文件` : "文件"}</button>
        </section>
        <ConversionInstructions online={health.state === "online"} />
      </div>
    </div>
  </main>;
}
