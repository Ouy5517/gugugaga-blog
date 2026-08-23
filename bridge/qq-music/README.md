# QQ 音乐本地桥接服务

该桥接服务为博客中的 `/tools/qq-music-converter` 页面提供本机转换能力。它只监听本机地址并直接读取本机的 QQ 音乐进程；缓存文件和转换结果不会上传到博客或第三方服务器。

使用前请启动 QQ 音乐客户端并保持其运行。桥接服务需要附加到 QQ 音乐进程，客户端未运行时无法读取缓存。

## 开发、测试和构建

从仓库根目录执行以下命令：

```powershell
python -m unittest discover -s bridge/qq-music/tests -v
powershell -ExecutionPolicy Bypass -File bridge/qq-music/build.ps1
dist\qq-music-bridge.exe
```

`build.ps1` 会安装 `requirements-build.txt` 中的构建依赖，并以 PyInstaller 生成 Windows 可执行文件。发布工作流会将公开下载资产固定命名为 `qq-music-bridge.exe`。

## QQ 音乐更新后的维护

若桥接服务报告 DLL 不兼容、找不到 `QQMusicCommon.dll` 的导出符号，或附加后转换失败，通常意味着 QQ 音乐更新改变了 DLL 或 `EncAndDesMediaFile` 的符号名/调用约定。

1. 确认 QQ 音乐正在运行，并记录当前客户端版本及 DLL 路径。
2. 使用可信的 Windows DLL 导出查看工具核对 `QQMusicCommon.dll` 中 `EncAndDesMediaFile` 的构造、析构、`Open`、`GetSize` 和 `Read` 符号。
3. 按新版本导出更新 `hook_qq_music.js` 里的 `TARGET_DLL` 和 hook symbols，同时核对 `NativeFunction` 的参数、返回值与调用约定。
4. 重新执行测试与构建命令，并仅在本机、可控的测试缓存上验证转换结果后再发布新的可执行文件。

不要把桥接服务暴露到局域网或公网；它的设计用途仅是本机工具箱页面与本机 QQ 音乐客户端之间的桥接。
