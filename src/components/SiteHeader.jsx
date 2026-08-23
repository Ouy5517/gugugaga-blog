import { GithubLogo, List, X } from "@phosphor-icons/react";
import { useState } from "react";

export function SiteHeader({ onNavigate, animate = false }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const navigate = (path) => {
    setMenuOpen(false);
    onNavigate(path);
  };

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
    <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><img className="site-avatar" src="/assets/avatar-cat.png" alt="" /><span>咕咕嘎嘎的个人博客</span></a>
    <nav className={menuOpen ? "nav-links is-open" : "nav-links"} aria-label="主导航">
      <button type="button" onClick={() => navigate("/articles")}>文章</button>
      <button type="button" onClick={() => navigate("/tools")}>工具箱</button>
      <button type="button" onClick={() => goSection("projects")}>项目</button>
      <button type="button" onClick={() => goSection("about")}>关于</button>
      <a className="nav-github" href="https://github.com/Ouy5517" target="_blank" rel="noreferrer"><GithubLogo size={16} weight="regular" /> GitHub</a>
    </nav>
    <button className="subscribe-nav" type="button" onClick={() => goSection("subscribe")}>订阅</button>
    <button className="menu-toggle" type="button" aria-label={menuOpen ? "关闭菜单" : "打开菜单"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <List size={22} />}</button>
  </header>;
}
