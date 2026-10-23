window.MOSA_SITE_CONFIG = Object.freeze({
  downloadsEnabled: true,
  desktop: {
    feedUrl: "./releases/gravityport/latest.json",
  },
  // 显式兜底（explicit fallback）。首页脚本优先读取 releases/gravityport/latest.json 的
  // platforms.macos / platforms.windows，两个平台独立判断；某平台在当前
  // release 缺失时才回落到这里，且 UI 必须显示明确的版本号——Windows 包
  // 兜底到 rc.14 时会以 "Windows Preview 0.2.1-rc.14" 呈现，绝不伪装成
  // 最新版。URL 指向真实存在的第一方下载文件。
  // 这里的链接只在版本号和清单相同时代替清单的链接（mac 用它指向 DMG）。
  // Windows：清单带 platforms.windows.installer 时按钮给安装程序（.exe），
  // 否则给 ZIP。0.3.3 还没有安装程序，所以下面仍是 ZIP；发布带安装程序的
  // 版本后，改成那个版本的 .exe，不要再填 ZIP。
  mac: {
    version: "v0.3.3",
    url: "./downloads/GravityPort-darwin-arm64-0.3.3.dmg",
    label: "下载 macOS 包",
  },
  windows: {
    version: "v0.3.3",
    url: "./downloads/GravityPort-win32-x64-0.3.3.zip",
    label: "下载 Windows 包",
  },
  extension: {
    version: "v0.15.38",
    url: "./downloads/GravityPort-Web-Capture-0.15.38.zip",
    label: "浏览器包下载",
  },
});
