# 咕咕嘎嘎的个人博客

这是一个使用 React、Vite 和 Markdown 内容文件构建的个人技术博客，支持文章详情、分类、标签、搜索、归档、目录和代码复制。

博客作者：咕咕嘎嘎（[GitHub/Ouy5517](https://github.com/Ouy5517)）。

## 运行项目

```powershell
cd C:\Users\14564\Desktop\web_blog\blog-site
npm install
npm run dev
```

## 部署成正式网站

当前项目是 Vite 单页应用，推荐使用 Netlify：它能自动监听 GitHub 提交、部署 `dist`，并且和当前 Decap CMS 的 Git Gateway 配置直接匹配。Netlify 对 Vite 项目的常用设置是 `npm run build` 和 `dist` 发布目录（[官方说明](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/)）。

### 1. 创建博客仓库

当前本地目录还没有 Git 仓库。先在 GitHub 的 `Ouy5517` 账号下新建一个博客仓库，例如 `gugu-blog`，不要复用 `vibe-coding-web-frontend-test` 项目仓库。然后在 PowerShell 执行：

```powershell
cd C:\Users\14564\Desktop\web_blog\blog-site
git init
git branch -M main
git add .
git commit -m "chore: initial personal blog"
git remote add origin https://github.com/Ouy5517/gugu-blog.git
git push -u origin main
```

### 2. 在 Netlify 部署

1. 登录 Netlify，选择 **Add new project → Import an existing project → GitHub**。
2. 选择刚创建的博客仓库。
3. 构建命令填写 `npm run build`，发布目录填写 `dist`。
4. 添加环境变量 `SITE_URL`，先填 Netlify 分配的域名，例如 `https://gugu-blog.netlify.app`。
5. 点击 Deploy site。

项目已经包含 [`netlify.toml`](./netlify.toml) 和 [`public/_redirects`](./public/_redirects)，文章详情页、`/admin/` 等前端路由不会因为刷新而 404。

### 3. 绑定自己的域名

在 Netlify 的 **Domain management** 中添加域名，按页面提示在域名服务商处配置 DNS。绑定完成后，把 `SITE_URL` 改成正式域名并重新部署，这样 RSS、sitemap 和 SEO Canonical 才会使用正式地址。

### 4. 开启 Decap CMS 登录

在 Netlify 项目中依次开启 **Identity** 和 **Git Gateway**，个人博客建议把注册方式设为 **Invite only**。然后访问：

```text
https://你的域名/admin/
```

登录后可以直接新增或修改文章、项目，保存后 Decap 会提交 Markdown 到 GitHub，Netlify 再自动构建发布。Git Gateway 的认证步骤见 [Decap 官方文档](https://decapcms.org/docs/git-gateway-backend/)。

### 5. 之后如何更新

- 写文章：在 `/admin/` 中创建，或直接修改 `src/content/posts/*.md`。
- 改项目：在 `/admin/` 中编辑，或修改 `src/content/projects/*.md`。
- 每次 GitHub commit 都会触发 Netlify 自动部署。
- 本地发布前可运行 `npm run build` 检查构建结果。

打开 `http://localhost:5173/`。生产构建使用 `npm run build`。

## 目录结构

```text
blog-site/
├─ public/assets/                    图片资源
├─ src/content/posts/*.md            文章 Markdown 文件
├─ src/content/projects/*.md         项目 Markdown 文件
├─ src/content/content.js            Front Matter 解析和内容加载
├─ src/App.jsx                       页面、路由、搜索和交互
├─ src/styles.css                    视觉样式、响应式布局和动效
└─ index.html                        网页标题和 SEO 描述
```

## 增加或修改文章

在 `src/content/posts/` 新建 Markdown 文件，例如 `2026-09-01-tcp-notes.md`：

```md
---
slug: tcp-notes
date: 2026.09.01
category: 计算机网络
tags:
  - TCP
  - 课程笔记
title: TCP 拥塞控制学习笔记
excerpt: 记录慢启动、拥塞避免和快速重传的核心思路。
image: /assets/tcp-notes.png
readingTime: 8
draft: false
---

## 正文标题

这里写文章内容。
```

字段说明：

| 字段 | 作用 |
| --- | --- |
| `slug` | 文章 URL，例如 `/articles/tcp-notes` |
| `date` | 发布日期，用于排序和归档 |
| `category` | 文章分类 |
| `tags` | 标签数组，用于筛选和搜索 |
| `title` | 文章标题 |
| `excerpt` | 首页和文章列表摘要 |
| `image` | 封面路径，从 `/assets/` 开始 |
| `readingTime` | 阅读时间，单位为分钟 |
| `draft` | 设置为 `true` 时不会显示 |

保存后，文章会自动出现在首页、`/articles`、分类筛选、标签筛选、年度归档和搜索结果中。

文章详情地址为：

```text
http://localhost:5173/articles/你的-slug
```

## 技术文章支持

正文使用 GitHub Flavored Markdown，支持标题、列表、引用、表格、代码高亮、代码复制、文章目录、外部链接和 KaTeX 数学公式。

代码示例：

~~~tsx
const progress = Math.min(Math.max(scrollY / height, 0), 1);
~~~

文章中的二级和三级标题会自动生成目录锚点。

行内公式使用单个美元符号，独立公式使用单独成行的双美元符号：

```md
机器人受到的外力为 $\mathbf{F}_{\text{ext}}$。

$$
\mathbf{F}_{\text{ext}} =
\begin{bmatrix} 0 \\ 0 \\ F_z \end{bmatrix}
$$
```

独立公式的 `$$` 起止标记需要各自占一行，这样才能正确识别为块级公式。

## 搜索、分类和归档

访问 `/articles` 可以使用关键词搜索标题、摘要、正文和标签，也可以按分类、标签和年份浏览。按 `Ctrl + K`、`⌘ + K` 或 `/` 可以快速聚焦搜索框。

## 增加或修改项目

在 `src/content/projects/` 新建 Markdown 文件：

```md
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
---

这里可以写项目补充说明。
```

当前已加入：[vibe-coding-web-frontend-test](https://github.com/Ouy5517/vibe-coding-web-frontend-test)。项目区会自动读取 `projects` 文件夹中的内容，不需要修改 JSX。

## 添加图片

将图片放入 `public/assets/`，然后在 Front Matter 中使用：

```yaml
image: /assets/tcp-notes.png
```

不要写成 `public/assets/tcp-notes.png`。图片建议使用小写英文和连字符命名，并尽量压缩体积。

## 页面地址

| 地址 | 页面 |
| --- | --- |
| `/` | 首页、精选文章、项目和关于博客 |
| `/articles` | 文章索引、搜索、分类、标签和归档 |
| `/articles/:slug` | 文章详情页 |

## GitHub 更新方式

当前最简单的更新流程是：

1. 在 GitHub 网页中打开 `src/content/posts/` 或 `src/content/projects/`。
2. 新建或修改 `.md` 文件。
3. 提交 Commit。
4. 部署平台重新构建后，网站自动更新。

后续可以接入 Decap CMS 或 Outstatic，为 Markdown 文件增加可视化编辑后台。

## 第二阶段：发布与项目同步

### SEO、RSS 和站点地图

页面会根据当前路由更新标题、描述、Canonical、Open Graph、Twitter Card 和 JSON-LD 结构化数据。文章页会使用 `TechArticle` schema，首页会使用 `WebSite` schema。

构建时会自动生成三类发布文件：

- `/feed.xml`：RSS 订阅源，文章新增后随构建更新。
- `/sitemap.xml`：首页、文章索引和全部文章详情页的站点地图。
- `/robots.txt`：允许搜索引擎抓取，并指向 sitemap。

生产环境部署前，将 `.env.example` 复制为 `.env`，把 `SITE_URL` 改成博客正式域名。构建命令会读取这个地址生成正确的绝对链接：

```powershell
npm run build
```

`.env` 已加入 `.gitignore`，不要把 GitHub Token 提交到仓库。

项目 Front Matter 增加 `githubSync: true` 后，可以手动从 GitHub 刷新仓库描述、地址、状态、Star、Fork 和最近更新时间：

```yaml
githubSync: true
```

然后执行：

```powershell
npm run sync:github
```

脚本默认同步 GitHub 用户 `Ouy5517` 的公开仓库；如遇 API 限流，可在 `.env` 中配置 `GITHUB_TOKEN`。只有标记了 `githubSync: true` 的项目会被更新，项目正文和自定义标题不会被覆盖。

### Decap CMS 内容管理

管理后台已经放在 `/admin/`，配置文件为 `public/admin/config.yml`。它包含“技术文章”和“项目”两个集合，字段与 `src/content/` 的 Front Matter 对齐，支持上传 `public/assets/` 图片。

Decap CMS 使用 Git Gateway 提交 Git 仓库变更。正式部署到 Netlify 时，需要在站点控制台开启 Netlify Identity 和 Git Gateway，然后访问：

```text
https://你的域名/admin/
```

本地开发可以保留 `local_backend: true`，并额外运行 Decap 本地代理；如果暂时没有配置代理，直接编辑 Markdown 文件不会受影响。CMS 配置遵循 Decap 的 `/admin/config.yml`、folder collection 和 Git Gateway 约定（[官方配置文档](https://decapcms.org/docs/configure-decap-cms/)）。

## 修改博客信息和动效

博客名称和 SEO 描述主要位于 `src/App.jsx`、`index.html`。颜色、字体、响应式布局和动效位于 `src/styles.css`。

主要动效包括：`heroReveal`、`headerReveal`、`atmosphere`、`borderTurn` 和 `[data-reveal]`。

## 当前未接入的功能

- 订阅表单目前只显示本地成功状态，不会真正发送邮件。
- 评论区和真正的邮件订阅服务尚未接入。
- 内容解析目前使用轻量 Front Matter 解析器，字段格式需要遵循示例。

下一阶段可以继续接入 Giscus 评论和邮件订阅服务。
