---
slug: scroll-video-frontend
date: 2026.08.16
category: 前端
tags:
  - React
  - 交互
  - 前端实践
title: 从滚动视频到组件边界：一次前端实验的拆解
excerpt: 记录一个滚动视频可视化页面如何拆分为可维护的 React 组件，并复盘交互、性能和响应式布局的取舍。
image: /assets/card-violet.png
readingTime: 7
draft: false
---

## 为什么从滚动交互开始

滚动驱动的页面很容易变成一段难以维护的动画脚本。更稳妥的做法是先把页面拆成清晰的状态：当前章节、视频进度和内容可见性。

~~~tsx
const progress = Math.min(Math.max(scrollY / sectionHeight, 0), 1);
const frame = Math.round(progress * totalFrames);
~~~

## 组件边界

我会把视觉容器、数据状态和交互控制分开。这样修改 Hero 的视觉效果时，不需要同时修改项目索引和联系章节。

### 一个简单的拆分方式

- Hero：负责首屏信息和进入动效
- Chapter：负责滚动区间和视频帧
- ProjectIndex：负责项目数据和外链

## 这次实验的收获

动画并不是越多越好。对于个人博客，清晰的内容结构、稳定的移动端布局和可复用的数据模型比复杂的视觉效果更重要。
