---
slug: typed-content-model
date: 2026.08.09
category: 技术实践
tags:
  - TypeScript
  - 内容管理
  - Vite
title: 用 TypeScript 约束内容数据：给个人博客加一层类型安全
excerpt: 把文章和项目从 JSX 中抽离出来，用统一的数据结构管理标题、标签、封面和发布状态。
image: /assets/card-periwinkle.png
readingTime: 5
draft: false
---

## 内容为什么不应该写死在组件里

当文章数量变多时，直接在组件里维护数组会让展示逻辑和内容编辑互相干扰。将内容拆成独立文件，可以让每次更新都变成一次小而明确的提交。

~~~ts
type Post = {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  draft?: boolean;
};
~~~

## Front Matter 的作用

Front Matter 适合保存需要被列表读取的元数据，例如标题、日期、摘要、标签和草稿状态。正文仍然用 Markdown 编写，阅读和迁移都很方便。

## 后续可以怎么扩展

可以在构建阶段校验字段，也可以接入 Decap CMS，让浏览器编辑器自动提交 Markdown 到 GitHub。
