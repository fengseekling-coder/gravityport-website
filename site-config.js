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
  // 否则给 ZIP。从 0.3.4 起每个版本都带安装程序，下面填那个版本的 .exe，
  // 不要再填 ZIP。
  mac: {
    version: "v0.3.13",
    url: "./downloads/GravityPort-darwin-arm64-0.3.13.dmg",
    label: "下载 macOS 包",
  },
  // Intel 版和 Apple 芯片版是两个安装包。这个入口只在更新清单真的带
  // platforms.macosX64 时才生效：某版本没有 Intel 包时 Intel 按钮显示「暂无」，
  // 绝不指向 Apple 芯片的包，也不指向不存在的文件。
  macIntel: {
    version: "v0.3.13",
    url: "./downloads/GravityPort-darwin-x64-0.3.13.dmg",
    label: "下载 Intel 版",
  },
  windows: {
    version: "v0.3.13",
    url: "./downloads/GravityPort-win32-x64-0.3.13.exe",
    label: "下载 Windows 包",
  },
  extension: {
    version: "v0.15.47",
    url: "./downloads/GravityPort-Web-Capture-0.15.47.zip",
    label: "浏览器包下载",
  },
});
