# 咕咕嘎嘎的个人博客

这是一个面向计算机科学本科生的个人技术博客，主要记录计算机基础学习、技术文章和个人项目。

- 博客作者：咕咕嘎嘎
- GitHub：<https://github.com/Ouy5517>
- 当前仓库：<https://github.com/Ouy5517/gugugaga-blog>
- 示例项目：<https://github.com/Ouy5517/vibe-coding-web-frontend-test>

项目不是把文章写死在 JSX 里的页面，而是把 Markdown 文件作为内容源，再由 React 在构建时加载、解析和渲染。新增文章或项目时只需要增加一个内容文件，不需要反复修改页面组件。

## 一、项目实现路线

整个项目按下面的链路实现：

~~~text
Markdown / Front Matter
        ↓
src/content/content.js 解析内容
        ↓
React 组件读取 posts / projects
        ↓
首页、文章索引、文章详情、项目卡片
        ↓
Vite 构建 dist
        ↓
Netlify 根据 GitHub commit 自动部署
~~~

实现过程分为五层：

1. 建立深色视觉系统、导航、首页 Hero、文章卡片和项目卡片。
2. 将文章和项目从页面代码中抽离为 Markdown 内容文件。
3. 加入文章索引、搜索、分类、标签、归档、目录和相邻文章导航。
4. 加入 Markdown 扩展、代码高亮、代码复制和 KaTeX 公式渲染。
5. 加入 SEO、RSS、站点地图、GitHub 项目数据同步和可选 CMS。

## 二、技术选型

| 模块 | 选型 | 用途 |
| --- | --- | --- |
| UI 框架 | React 19 | 页面组件、状态和交互 |
| 构建工具 | Vite 6 | 本地开发和生产构建 |
| 内容格式 | Markdown + Front Matter | 保存文章和项目 |
| Markdown 渲染 | react-markdown | 将正文转换为 React 节点 |
| Markdown 扩展 | remark-gfm | 表格、任务列表、删除线等 GFM 语法 |
| 数学公式 | remark-math + rehype-katex | 渲染行内公式和块级公式 |
| 代码高亮 | rehype-highlight | 为代码块添加语法高亮 |
| 图标 | @phosphor-icons/react | 导航、箭头、GitHub 等图标 |
| 发布 | Netlify | 构建 dist 并持续部署 |
| 内容管理 | Decap CMS（预留） | 在 /admin/ 中编辑 Markdown |

## 三、目录结构

~~~text
blog-site/
├─ public/
│  ├─ admin/                       Decap CMS 页面和配置
│  ├─ assets/                      首页背景、分类封面、文章媒体资源
│  ├─ _redirects                   SPA 路由刷新回退规则
│  ├─ feed.xml                     构建生成的 RSS
│  ├─ robots.txt                   构建生成的抓取规则
│  └─ sitemap.xml                  构建生成的站点地图
├─ scripts/
│  ├─ generate-site-assets.mjs     生成 RSS、sitemap、robots
│  └─ sync-github-projects.mjs     从 GitHub 同步项目元数据
├─ src/
│  ├─ App.jsx                      页面、路由、搜索和交互逻辑
│  ├─ main.jsx                     React 入口
│  ├─ styles.css                   颜色、排版、响应式和动效
│  └─ content/
│     ├─ content.js                Front Matter 解析和内容加载
│     ├─ posts/                    技术文章 Markdown
│     └─ projects/                 项目 Markdown
├─ index.html                      全局语言、标题和基础 SEO
├─ netlify.toml                    Netlify 构建配置
├─ package.json                    命令和依赖
└─ vite.config.mjs                 Vite 配置
~~~

## 四、核心功能的具体实现

### 4.1 用 Markdown 驱动内容

src/content/content.js 使用 Vite 的 import.meta.glob 读取两个目录中的 Markdown：

~~~js
const postModules = import.meta.glob("./posts/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});
~~~

随后代码完成三件事：

1. 找到文件顶部的 --- 区域。
2. 将 Front Matter 转成 JavaScript 对象。
3. 把正文和元数据合并为 posts、projects 数组。

页面只依赖这两个数组，因此文章列表、首页精选文章、搜索结果和文章详情使用的是同一份数据。

### 4.2 轻量路由

项目没有引入 React Router，而是使用 window.history.pushState 管理三个主要页面：

~~~text
/                         首页
/articles                 文章索引
/articles/:slug           文章详情
~~~

readLocation() 根据 pathname 判断当前页面，onNavigate() 修改地址并刷新 React 状态。这样可以保持依赖简单，同时保留干净的文章 URL。

由于这是单页应用，生产服务器需要把未知路径回退到 index.html。项目中的 netlify.toml 和 public/_redirects 已经配置了这条规则，直接刷新文章详情页不会出现 404。

### 4.3 文章索引、搜索和归档

ArticleLibrary 使用 useMemo 对文章做派生计算：

- 搜索标题、摘要、分类、标签和正文。
- 按分类筛选。
- 按标签筛选。
- 按年份生成归档分组。
- 使用文章 slug 跳转到详情页。

当前文章分类统一为三类：

- **技术实践**：前端实验、内容工程、机器人和强化学习等可复现的实现过程。
- **经验分享**：写作规范、学习方法和工程复盘等总结性内容。
- **杂项**：课程笔记和暂时无法归入前两类的探索记录。

分类封面位于 `public/assets/categories/`，新增文章时可以直接复用对应分类图片。

搜索框还监听 Ctrl + K、⌘ + K 和 /，方便在文章较多时快速定位内容。

### 4.4 Markdown、代码和公式渲染

文章正文由下面的插件链处理：

~~~jsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex, rehypeHighlight]}
>
  {normalizeMathBlocks(body)}
</ReactMarkdown>
~~~

- GFM 支持表格、任务列表和删除线。
- rehype-highlight 为 fenced code block 增加高亮。
- MarkdownCode 自定义代码组件，为代码块增加语言标签和复制按钮。
- rehype-katex 将 LaTeX 转为公式 DOM，并引入 KaTeX 样式。
- normalizeMathBlocks() 会把同一行的 $$...$$ 规范化为独立行，避免 Markdown 解析器把块级公式识别成普通文本。

推荐公式写法：

~~~md
行内公式：机器人受到的外力为 $\mathbf{F}_{\text{ext}}$。

$$
\mathbf{F}_{\text{ext}} =
\begin{bmatrix}
0 \\
0 \\
F_z
\end{bmatrix}
$$
~~~

块级公式的两个 $$ 必须各自单独占一行。公式较长时，样式中的 .katex-display 会允许横向滚动，避免移动端撑破页面。

### 4.5 文章目录和长目录处理

TableOfContents 从正文中提取二级和三级标题，并通过 slugify() 生成锚点。目录使用 sticky 布局：

- 桌面端：目录固定在文章右侧。
- 目录过长：侧栏使用 max-height 和 overflow-y: auto，可以独立滚动。
- 移动端：目录移动到正文上方，使用两列布局和最大高度滚动。

这样长文章不会把页面高度和布局撑坏，标题也可以直接通过锚点跳转。

### 4.6 动效实现

设计文件中的“暗色画廊”风格通过 CSS 变量和关键帧实现，主要动效集中在 src/styles.css：

- atmosphere：Hero 背景淡入并轻微缩放。
- headerReveal：顶部导航从下方淡入。
- heroReveal：Hero 文案和按钮进入。
- borderTurn：精选文章和项目卡片的边框描边。
- [data-reveal]：使用 IntersectionObserver，滚动到区块时淡入上移。
- prefers-reduced-motion：用户开启减少动态效果时，自动降低动画强度。

颜色和字体集中在 :root 中，后续改主题时只需要调整变量，不需要逐个修改组件。

### 4.7 SEO、RSS 和站点地图

applySeo() 会在路由变化时更新：

- document.title
- description
- Open Graph 和 Twitter Card
- canonical URL
- 首页 WebSite JSON-LD
- 文章页 TechArticle JSON-LD

构建前会执行 prebuild：

~~~text
npm run build
  └─ node scripts/generate-site-assets.mjs
       ├─ public/feed.xml
       ├─ public/sitemap.xml
       └─ public/robots.txt
~~~

脚本读取文章 Front Matter，根据 SITE_URL 生成绝对链接。正式部署前应设置：

~~~env
SITE_URL=https://你的正式域名
~~~

不要把真实 token 写进仓库，.env 已被 .gitignore 忽略。

### 4.8 GitHub 项目同步

项目文件中加入下面的字段后，脚本才会同步该仓库：

~~~yaml
githubSync: true
~~~

执行：

~~~powershell
npm run sync:github
~~~

脚本会读取 GitHub API，并更新项目的：

- 仓库地址
- 描述
- 项目状态
- Star 数
- Fork 数
- 最近更新时间

标题、技术栈和正文不会被覆盖。遇到 API 限流时，可以在本地 .env 中配置 GITHUB_TOKEN。

## 五、文章和项目如何增加

### 5.1 新增文章

在 src/content/posts/ 创建 Markdown 文件，例如 2026-09-01-tcp-notes.md：

~~~md
---
slug: tcp-notes
date: 2026.09.01
category: 技术实践
tags:
  - TCP
  - 课程笔记
title: TCP 拥塞控制学习笔记
excerpt: 记录慢启动、拥塞避免和快速重传的核心思路。
image: /assets/categories/technical-practice.png
readingTime: 8
draft: false
---

## 正文标题

这里写文章内容。
~~~

关键字段：

| 字段 | 作用 |
| --- | --- |
| slug | 文章 URL，建议只用小写英文、数字和连字符 |
| date | 排序和归档日期，格式为 YYYY.MM.DD |
| category | 文章分类 |
| tags | 标签数组 |
| title | 文章标题 |
| excerpt | 首页和索引页摘要 |
| image | 可选，必须从 /assets/ 开始；留空时按分类自动使用对应封面 |
| readingTime | 阅读时间，单位为分钟 |
| draft | true 时不会进入页面和 RSS |

### 5.2 新增项目

在 src/content/projects/ 创建 Markdown 文件：

~~~md
---
name: minidb
title: MiniDB：简易数据库实现
description: 使用 C++ 实现页式存储、B+ 树索引和基础 SQL 执行器。
detail: 记录项目目标、关键实现和调试过程。
stack:
  - C++
  - B+ Tree
url: https://github.com/你的用户名/minidb
status: 进行中
featured: true
githubSync: false
---

这里可以写项目补充说明。
~~~

页面会自动读取 projects 文件夹中的所有项目，不需要修改 App.jsx。

### 5.3 添加文章图片

将图片放入 public/assets/，Front Matter 使用：

~~~yaml
image: /assets/categories/technical-practice.png
~~~

不要写成 public/assets/tcp-notes.png。站点现有背景图位于 `public/assets/backgrounds/`，分类封面位于 `public/assets/categories/`。图片建议使用小写英文和连字符命名，并在提交前压缩体积。

## 六、本地开发和验证

~~~powershell
git clone https://github.com/Ouy5517/gugugaga-blog.git
cd gugugaga-blog
npm install
npm run dev
~~~

常用命令：

| 命令 | 用途 |
| --- | --- |
| npm run dev | 启动本地开发服务器 |
| npm run build | 生成生产构建并同步 RSS、sitemap、robots |
| npm run preview | 预览 dist 构建结果 |
| npm run sync:github | 同步勾选了 githubSync 的项目 |

提交前建议至少验证：

1. 首页、/articles 和一篇文章详情页可以打开。
2. 直接刷新 /articles/文章-slug 不出现 404。
3. 搜索、分类、标签和归档筛选正常。
4. 代码复制按钮和 KaTeX 公式正常显示。
5. 长目录可以滚动，移动端没有横向溢出。
6. npm run build 成功完成。

## 七、部署实现

项目使用 Netlify 的持续部署链路：

~~~text
本地修改 Markdown / React / CSS
        ↓ git commit + git push
GitHub main
        ↓ webhook
Netlify: npm run build
        ↓
发布 dist
~~~

Netlify 构建配置已经写入 netlify.toml：

~~~toml
[build]
  command = "npm run build"
  publish = "dist"
~~~

在 Netlify 导入 Ouy5517/gugugaga-blog 后确认：

- Branch：main
- Build command：npm run build
- Publish directory：dist
- Environment variable：SITE_URL=https://你的站点域名

当前仓库还包含 public/admin/，用于预留 Decap CMS。若启用后台，需要额外配置身份认证和 GitHub 写入权限；生产环境建议先使用 GitHub 提交 Markdown，确认部署稳定后再配置 CMS 登录。

## 八、如何更新线上内容

最稳定的更新流程是：

1. 修改或新增 src/content/posts/*.md、src/content/projects/*.md。
2. 本地执行 npm run build。
3. 检查 git diff，确认只包含预期文件。
4. 提交并推送到 main。
5. Netlify 自动构建，构建完成后线上内容更新。

也可以直接在 GitHub 网页编辑 Markdown 文件。提交后，Netlify 会走同样的自动部署流程。

## 九、当前限制和后续计划

- 订阅表单目前只显示本地成功状态，还没有接入真实邮件服务。
- 评论功能尚未接入，后续可以增加 Giscus。
- Front Matter 使用轻量解析器，字段格式需要遵循示例。
- Decap CMS 已预留页面和集合配置，但后台认证仍需要单独配置。
- 当前项目是客户端渲染的 Vite SPA，后续如果文章数量明显增长，可以迁移到 Astro、Hugo 或 Next.js 以获得更强的静态生成能力。

## License

博客内容和代码仅供学习与个人展示使用。文章转载请保留原作者信息和原文链接。
