import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { ArrowLeft, ArrowRight, Check, Clock, GithubLogo, List, MagnifyingGlass, X } from "@phosphor-icons/react";
import { categories, findPost, posts, projects, tags } from "./content/content.js";

function readLocation() {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  const articleMatch = pathname.match(/^\/articles\/([^/]+)$/);
  const toolMatch = pathname.match(/^\/tools\/([^/]+)$/);
  return {
    pathname,
    articleSlug: articleMatch ? decodeURIComponent(articleMatch[1]) : null,
    toolSlug: toolMatch ? decodeURIComponent(toolMatch[1]) : null,
  };
}

function slugify(value) {
  return value.toString().toLowerCase().trim().replace(/[^\w\u4e00-\u9fa5 -]/g, "").replace(/\s+/g, "-");
}

function childrenToText(children) {
  return Array.isArray(children) ? children.map(childrenToText).join("") : typeof children === "string" ? children : children?.props?.children ? childrenToText(children.props.children) : "";
}

function setMeta(attribute, key, content) {
  let node = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function applySeo(location) {
  const post = location.articleSlug ? findPost(location.articleSlug) : null;
  const isLibrary = location.pathname === "/articles" || location.pathname === "/archive";
  const isToolboxIndex = location.pathname === "/tools";
  const isQqMusicConverter = location.pathname === "/tools/qq-music-converter";
  const title = post ? `${post.title} · 咕咕嘎嘎的个人博客` : isLibrary ? "文章索引 · 咕咕嘎嘎的个人博客" : isToolboxIndex ? "工具箱 · 咕咕嘎嘎的个人博客" : isQqMusicConverter ? "QQ 音乐本地转换工具 · 咕咕嘎嘎的个人博客" : "咕咕嘎嘎的个人博客";
  const description = post?.excerpt || (isLibrary ? "浏览咕咕嘎嘎关于计算机学习、技术实践与个人项目的文章。" : isToolboxIndex ? "浏览咕咕嘎嘎整理的本地实用工具。" : isQqMusicConverter ? "通过本地桥接服务转换 QQ 音乐缓存文件。" : "分享计算机学习、技术文章与个人项目。");
  const canonicalUrl = new URL(location.pathname || "/", window.location.origin).toString();
  const imageUrl = post?.image ? new URL(post.image, window.location.origin).toString() : new URL("/assets/card-periwinkle.png", window.location.origin).toString();
  document.title = title;
  setMeta("name", "description", description);
  setMeta("property", "og:type", post ? "article" : "website");
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", canonicalUrl);
  setMeta("property", "og:image", imageUrl);
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", imageUrl);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl;
  let schema = document.head.querySelector('script[data-seo-schema="true"]');
  if (!schema) {
    schema = document.createElement("script");
    schema.type = "application/ld+json";
    schema.dataset.seoSchema = "true";
    document.head.appendChild(schema);
  }
  schema.textContent = JSON.stringify(post ? {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: post.title,
    description: post.excerpt,
    datePublished: String(post.date).replace(/\./g, "-"),
    author: { "@type": "Person", name: "咕咕嘎嘎", url: "https://github.com/Ouy5517" },
    mainEntityOfPage: canonicalUrl,
  } : {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "咕咕嘎嘎的个人博客",
    description,
    url: window.location.origin,
  });
}

function normalizeMathBlocks(source) {
  let inFence = false;
  return source.split(/\r?\n/).flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return [line];
    }
    if (inFence) return [line];
    const match = line.match(/^(\s*)\$\$(.+)\$\$\s*$/);
    if (!match) return [line];
    const [, indent, expression] = match;
    return [`${indent}$$`, `${indent}${expression.trim()}`, `${indent}$$`];
  }).join("\n");
}

function ArrowLink({ children, onClick, href }) {
  if (href) return <a className="arrow-link" href={href} target="_blank" rel="noreferrer"><span>{children}</span><ArrowRight size={18} aria-hidden="true" /></a>;
  return <button className="arrow-link" type="button" onClick={onClick}><span>{children}</span><ArrowRight size={18} aria-hidden="true" /></button>;
}

function SiteHeader({ onNavigate, animate = false }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const goSection = (id) => {
    setMenuOpen(false);
    if (window.location.pathname !== "/") {
      onNavigate("/");
      window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <header className={animate ? "site-header header-enter" : "site-header"}>
    <a className="brand" href="/" onClick={(event) => { event.preventDefault(); setMenuOpen(false); onNavigate("/"); }}><img className="site-avatar" src="/assets/avatar-cat.png" alt="" /><span>咕咕嘎嘎的个人博客</span></a>
    <nav className={menuOpen ? "nav-links is-open" : "nav-links"} aria-label="主导航">
      <button type="button" onClick={() => onNavigate("/articles")}>文章</button>
      <button type="button" onClick={() => goSection("projects")}>项目</button>
      <button type="button" onClick={() => goSection("about")}>关于</button>
      <a className="nav-github" href="https://github.com/Ouy5517" target="_blank" rel="noreferrer"><GithubLogo size={16} weight="regular" /> GitHub</a>
    </nav>
    <button className="subscribe-nav" type="button" onClick={() => goSection("subscribe")}>订阅</button>
    <button className="menu-toggle" type="button" aria-label={menuOpen ? "关闭菜单" : "打开菜单"} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <List size={22} />}</button>
  </header>;
}

function MarkdownCode({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const value = String(children).replace(/\n$/, "");
  const language = className?.replace("language-", "") || "text";
  const isBlock = inline === false || Boolean(className?.includes("language-")) || String(children).includes("\n");

  if (!isBlock) return <code className="inline-code" {...props}>{children}</code>;

  const copyCode = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return <div className="code-block">
    <div className="code-toolbar"><span>{language}</span><button type="button" onClick={copyCode}>{copied ? <><Check size={14} /> 已复制</> : "复制代码"}</button></div>
    <pre><code className={className} {...props}>{children}</code></pre>
  </div>;
}

function MarkdownArticle({ body }) {
  const components = {
    code: MarkdownCode,
    h2: ({ children }) => <h2 id={slugify(childrenToText(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={slugify(childrenToText(children))}>{children}</h3>,
    a: ({ href, children }) => <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noreferrer" : undefined}>{children}</a>,
  };
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={components}>{normalizeMathBlocks(body)}</ReactMarkdown></div>;
}

function TableOfContents({ post }) {
  const headings = useMemo(() => [...post.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => ({ level: match[0].startsWith("###") ? 3 : 2, title: match[1].trim(), id: slugify(match[1]) })), [post.body]);
  if (!headings.length) return null;
  return <aside className="article-sidebar">
    <p className="eyebrow">ON THIS PAGE</p>
    <nav className="article-toc" aria-label="文章目录">
      {headings.map((heading) => <a className={heading.level === 3 ? "toc-sub" : ""} href={`#${heading.id}`} key={heading.id}>{heading.title}</a>)}
    </nav>
    <div className="article-tip"><p className="meta">CS NOTES</p><p>把概念、代码和复盘放在同一篇文章里，方便以后快速回看。</p></div>
  </aside>;
}

function ArticleVideos({ post }) {
  const videos = [
    post.trainingVideo && {
      label: "训练过程",
      title: "外力课程与起身策略训练",
      description: "记录策略在 GPU 并行仿真中的训练过程，观察起身动作从探索到稳定收敛的变化。",
      src: post.trainingVideo,
    },
    post.resultVideo && {
      label: "训练结果",
      title: "全向跌倒恢复训练结果",
      description: "展示当前策略在不同跌倒姿态与扰动下的自主起身效果。",
      src: post.resultVideo,
    },
  ].filter(Boolean);

  if (!videos.length) return null;

  return <section className="article-media" aria-label="文章视频演示">
    <div className="article-media-heading">
      <p className="eyebrow">SIMULATION PLAYBACK</p>
      <h2>训练过程与结果</h2>
      <p>用两个视频快速了解策略如何训练，以及当前阶段能够达到的恢复效果。</p>
    </div>
    <div className="article-video-grid">
      {videos.map((video) => <figure className="article-video-card" key={video.src}>
        <div className="article-video-frame">
          <video controls preload="metadata" playsInline>
            <source src={video.src} type="video/mp4" />
            你的浏览器暂不支持 HTML5 视频播放。
          </video>
        </div>
        <figcaption>
          <p className="article-video-label">{video.label}</p>
          <strong>{video.title}</strong>
          <p>{video.description}</p>
        </figcaption>
      </figure>)}
    </div>
  </section>;
}

function ArticleCard({ post, onNavigate }) {
  return <article className="post-card library-card">
    <button type="button" className="post-card-hit" onClick={() => onNavigate(`/articles/${post.slug}`)} aria-label={`阅读：${post.title}`}>
      <div className="post-image-wrap"><img src={post.image} alt="山野风景文章配图" /></div>
      <div className="post-content">
        <p className="meta">{post.date}&nbsp;&nbsp;·&nbsp;&nbsp;{post.category}</p>
        <h3>{post.title}</h3>
        <p>{post.excerpt}</p>
        <span className="card-read">阅读全文 <ArrowRight size={17} aria-hidden="true" /></span>
      </div>
    </button>
  </article>;
}

function ArticleLibrary({ onNavigate }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [tag, setTag] = useState("全部");
  const searchRef = useRef(null);

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const filteredPosts = useMemo(() => posts.filter((post) => {
    const haystack = [post.title, post.excerpt, post.category, ...post.tags, post.body].join(" ").toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (category === "全部" || post.category === category) && (tag === "全部" || post.tags.includes(tag));
  }), [category, query, tag]);

  const years = [...new Set(filteredPosts.map((post) => post.date.slice(0, 4)))];

  return <main className="library-page">
    <SiteHeader onNavigate={onNavigate} />
    <div className="page-shell library-shell">
      <section className="library-hero"><p className="eyebrow">TECHNICAL ARCHIVE · {posts.length} POSTS</p><h1>文章索引</h1><p>按主题、标签和关键词，找到关于计算机学习与项目实践的记录。</p></section>
      <section className="library-tools" aria-label="文章筛选">
        <label className="search-box"><MagnifyingGlass size={19} aria-hidden="true" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章、标签或正文…" aria-label="搜索文章" /><kbd>⌘ K</kbd></label>
        <div className="filter-row"><div className="filter-group"><span>分类</span>{categories.map((item) => <button className={category === item ? "filter-chip is-active" : "filter-chip"} type="button" onClick={() => setCategory(item)} key={item}>{item}</button>)}</div><div className="filter-group"><span>标签</span>{tags.map((item) => <button className={tag === item ? "filter-chip is-active" : "filter-chip"} type="button" onClick={() => setTag(item)} key={item}>{item}</button>)}</div></div>
      </section>
      <section className="library-results"><div className="section-heading split-heading"><div><p className="eyebrow">{query || category !== "全部" || tag !== "全部" ? "FILTERED RESULTS" : "LATEST NOTES"}</p><h2>{filteredPosts.length} 篇文章</h2></div><span className="archive-count">按日期倒序</span></div>{filteredPosts.length ? <div className="library-grid">{filteredPosts.map((post) => <ArticleCard post={post} onNavigate={onNavigate} key={post.slug} />)}</div> : <div className="empty-state"><MagnifyingGlass size={28} /><p>没有找到匹配的文章。</p><button type="button" onClick={() => { setQuery(""); setCategory("全部"); setTag("全部"); }}>清除筛选</button></div>}</section>
      <section className="archive-section"><div className="section-heading"><p className="eyebrow">ARCHIVE</p><h2>按年份浏览</h2></div>{years.map((year) => <div className="archive-group" key={year}><h3>{year}</h3>{filteredPosts.filter((post) => post.date.startsWith(year)).map((post) => <button className="archive-row" type="button" onClick={() => onNavigate(`/articles/${post.slug}`)} key={post.slug}><span>{post.date.slice(5)}</span><strong>{post.title}</strong><em>{post.category}</em><ArrowRight size={18} /></button>)}</div>)}</section>
    </div>
  </main>;
}

function ArticlePage({ post, onNavigate }) {
  const index = posts.findIndex((item) => item.slug === post.slug);
  const previous = posts[index + 1];
  const next = posts[index - 1];
  return <main className="article-page">
    <SiteHeader onNavigate={onNavigate} />
    <div className="page-shell article-shell">
      <button className="back-link" type="button" onClick={() => onNavigate("/articles")}><ArrowLeft size={17} /> 返回文章索引</button>
      <header className="article-header"><p className="eyebrow">{post.category} · TECH NOTE</p><h1>{post.title}</h1><p className="article-lede">{post.excerpt}</p><div className="article-meta"><span>{post.date}</span><span><Clock size={15} /> {post.readingTime} 分钟阅读</span><span>{post.tags.join(" · ")}</span></div></header>
      <img className="article-cover" src={post.image} alt="文章封面" />
      <ArticleVideos post={post} />
      <div className="article-layout"><article><MarkdownArticle body={post.body} /></article><TableOfContents post={post} /></div>
      <nav className="article-neighbors" aria-label="相邻文章">{previous ? <button type="button" onClick={() => onNavigate(`/articles/${previous.slug}`)}><span>上一篇</span><strong>{previous.title}</strong></button> : <span />}{next ? <button type="button" onClick={() => onNavigate(`/articles/${next.slug}`)}><span>下一篇</span><strong>{next.title}</strong></button> : <span />}</nav>
    </div>
  </main>;
}

function NotFound({ onNavigate }) {
  return <main className="not-found"><SiteHeader onNavigate={onNavigate} /><div className="not-found-content"><p className="eyebrow">404 · NOT FOUND</p><h1>这篇内容还没有找到。</h1><button className="primary-button" type="button" onClick={() => onNavigate("/articles")}>返回文章索引 <ArrowRight size={18} /></button></div></main>;
}

function HomePage({ onNavigate }) {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const featured = posts[0];

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add("is-visible"); }), { threshold: 0.14 });
    document.querySelectorAll("[data-reveal]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const handleSubscribe = (event) => { event.preventDefault(); if (!email.trim()) return; setSubscribed(true); setEmail(""); };

  return <main>
    <section className="hero" id="top"><div className="hero-image" aria-hidden="true" /><SiteHeader onNavigate={onNavigate} animate /><div className="hero-content hero-enter hero-enter-two"><p className="eyebrow">TECH NOTES · PROJECTS · 2026</p><h1>记录代码，<br />也记录思考。</h1><p className="hero-copy">分享计算机学习、前端实践，以及做项目时遇到的问题。</p><button className="primary-button" type="button" onClick={() => onNavigate("/articles")}>阅读技术文章 <ArrowRight size={18} aria-hidden="true" /></button></div></section>
    <div className="page-shell">
      <section className="section" id="articles" data-reveal><div className="section-heading split-heading"><h2>精选技术文章</h2><ArrowLink onClick={() => onNavigate(`/articles/${featured.slug}`)}>阅读全文</ArrowLink></div><article className="featured-card border-trace" onClick={() => onNavigate(`/articles/${featured.slug}`)} role="link" tabIndex="0" onKeyDown={(event) => event.key === "Enter" && onNavigate(`/articles/${featured.slug}`)}><img src={featured.image} alt="文章封面" /><div className="featured-shade" /><div className="featured-content"><p className="meta">{featured.date}&nbsp;&nbsp;·&nbsp;&nbsp;{featured.category}</p><h3>{featured.title}</h3><p>{featured.excerpt}</p><span className="card-read">阅读全文 <ArrowRight size={18} /></span></div></article></section>
      <section className="section" id="recent" data-reveal><div className="section-heading split-heading"><h2>最近文章</h2><ArrowLink onClick={() => onNavigate("/articles")}>查看全部文章</ArrowLink></div><div className="post-grid">{posts.map((post) => <ArticleCard post={post} onNavigate={onNavigate} key={post.slug} />)}</div></section>
      <section className="projects-section" id="projects" data-reveal><div className="section-heading split-heading"><div><p className="eyebrow">BUILDING IN PUBLIC</p><h2>项目</h2></div><ArrowLink href="https://github.com/Ouy5517">查看 GitHub</ArrowLink></div><div className="project-grid">{projects.map((project, index) => <article className="project-card border-trace" key={project.name}><div className="project-card-top"><GithubLogo size={32} weight="regular" /><span className="project-status">{project.status} · PROJECT {String(index + 1).padStart(2, "0")}</span></div><h3>{project.title}</h3><p className="project-name">{project.name}</p><p className="project-description">{project.description}</p><p className="project-detail">{project.detail}</p>{project.githubUpdated && <p className="project-stats">★ {project.githubStars || 0} · Fork {project.githubForks || 0} · 最近更新 {project.githubUpdated}</p>}<div className="project-footer"><div className="stack-list">{project.stack.map((item) => <span key={item}>{item}</span>)}</div><a href={project.url} target="_blank" rel="noreferrer">查看仓库 <ArrowRight size={17} aria-hidden="true" /></a></div></article>)}</div></section>
      <section className="about-card" id="about" data-reveal><img src="/assets/about-forest.png" alt="雾气中的针叶林" /><div className="about-content"><div className="about-profile"><img src="/assets/avatar-cat.png" alt="咕咕嘎嘎的头像" /><span>咕咕嘎嘎</span></div><p className="eyebrow dark-label">ABOUT THIS BLOG</p><h2>关于这个博客</h2><p>这里主要分享计算机学习、技术文章和个人项目，也记录那些值得复盘的实现过程。</p><ArrowLink onClick={() => onNavigate("/articles")}>浏览文章索引</ArrowLink></div></section>
      <section className="subscribe-section" id="subscribe"><div><p className="eyebrow">TECH NOTES · PROJECT LOG</p><h2>订阅技术更新</h2><p>有新的技术文章或项目进展时，我会通过邮件通知你。</p></div>{subscribed ? <div className="success-message" role="status"><Check size={20} weight="bold" /> 已成功订阅，感谢你的关注。</div> : <form onSubmit={handleSubscribe}><label className="sr-only" htmlFor="email">邮箱地址</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="输入你的邮箱地址" required /><button type="submit">订阅</button><small>我们尊重你的隐私，不会发送垃圾邮件。</small></form>}</section>
      <footer><span>© 2026 咕咕嘎嘎的个人博客</span><div className="footer-links"><a href="/feed.xml" target="_blank" rel="noreferrer">RSS</a><a href="https://github.com/Ouy5517" target="_blank" rel="noreferrer"><GithubLogo size={17} /> GitHub</a><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>返回顶部</button></div></footer>
    </div>
  </main>;
}

export function App() {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => { const handlePopState = () => setLocation(readLocation()); window.addEventListener("popstate", handlePopState); return () => window.removeEventListener("popstate", handlePopState); }, []);
  useEffect(() => { if (location.pathname === "/admin" || location.pathname === "/admin/") window.location.replace("/admin/index.html"); }, [location.pathname]);
  useEffect(() => { applySeo(location); }, [location]);

  const navigate = (path) => {
    if (path === window.location.pathname) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    window.history.pushState({}, "", path);
    setLocation(readLocation());
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  if (location.articleSlug) {
    const post = findPost(location.articleSlug);
    return post ? <ArticlePage post={post} onNavigate={navigate} /> : <NotFound onNavigate={navigate} />;
  }
  if (location.pathname === "/articles" || location.pathname === "/archive") return <ArticleLibrary onNavigate={navigate} />;
  if (location.pathname !== "/") return <NotFound onNavigate={navigate} />;
  return <HomePage onNavigate={navigate} />;
}
