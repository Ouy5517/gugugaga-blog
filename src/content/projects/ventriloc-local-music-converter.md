---
name: ventriloc-local-music-converter
title: Ventriloc 本地音乐转换器
description: "基于 Frida 的 QQ 音乐加密音频本地转换工具，支持 .mflac → .flac、.mgg → .ogg，并提供浏览器网页界面。"
detail: 使用 Python、Frida、JavaScript 和原生 HTTP 服务构建，支持浏览器上传、任务队列、转换进度与结果下载。
stack:
  - Python
  - Frida
  - JavaScript
  - HTML/CSS
url: https://github.com/Ouy5517/ventriloc-local-music-converter
status: 进行中
featured: true
githubSync: true
githubStars: 0
githubForks: 0
githubUpdated: 2026-08-22
---

这个项目将原本依赖命令行的 QQ 音乐加密音频转换流程封装为本地网页工具，支持 `.mflac → .flac` 和 `.mgg → .ogg`。文件始终在本机处理，不上传云端；使用前需要运行 QQ 音乐并确保相关音频组件已加载。

项目借鉴了 [yllhwa/decrypt-mflac-frida](https://github.com/yllhwa/decrypt-mflac-frida) 的 QQ 音乐 Frida 解密思路，并在此基础上独立实现网页界面、任务队列、文件校验、中文文件名兼容和测试体系。
