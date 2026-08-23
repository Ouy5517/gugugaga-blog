import { MusicNotes } from "@phosphor-icons/react";
import { ArrowLink } from "../components/ArrowLink.jsx";
import { SiteHeader } from "../components/SiteHeader.jsx";

export function ToolboxPage({ onNavigate }) {
  return <main className="toolbox-page">
    <SiteHeader onNavigate={onNavigate} />
    <div className="page-shell tool-shell">
      <section className="toolbox-hero">
        <p className="eyebrow">LOCAL UTILITIES · PRIVATE BY DESIGN</p>
        <h1>工具箱</h1>
        <p>一些直接在你的电脑上运行的小工具，保持文件和使用过程只留在本地。</p>
      </section>
      <section className="toolbox-grid" aria-label="工具列表">
        <article className="tool-card border-trace">
          <div className="tool-card-icon"><MusicNotes size={30} weight="light" aria-hidden="true" /></div>
          <p className="eyebrow">LOCAL CONVERTER</p>
          <h2>QQ 音乐缓存转换</h2>
          <p>将 QQ 音乐缓存中的 MFLAC 和 MGG 文件转换为可播放的 FLAC 或 OGG 格式。</p>
          <div className="tool-tags" aria-label="支持的格式"><span>MFLAC → FLAC</span><span>MGG → OGG</span></div>
          <p className="tool-local-note">仅在你的电脑本地处理，不上传音乐文件。</p>
          <button className="primary-button" type="button" onClick={() => onNavigate("/tools/qq-music-converter")}>开始转换</button>
        </article>
      </section>
      <ArrowLink onClick={() => onNavigate("/")}>返回首页</ArrowLink>
    </div>
  </main>;
}
