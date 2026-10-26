window.MOSA_SITE_CONFIG = Object.freeze({
  downloadsEnabled: true,
  desktop: {
    feedUrl: "./releases/gravityport/latest.json",
  },
  // 显式兜底（explicit fallback）。首页脚本优先读取 releases/gravityport/latest.json 的
  // platforms.macos / platforms.windows，两个平台独立判断；某平台在当前
  // release 缺失时才回落到这里，且 UI 必须显示明确的版本号——Windows 包
  // 兜底到 rc.14 时会以 "Windows Preview 0.2.1-rc.14" 呈现，绝不伪装成
  // 最新版。URL 指向真实存在的下载文件。
  // 这里的链接只在版本号和清单相同时代替清单的链接（mac 用它指向 DMG）。
  // Windows：清单带 platforms.windows.installer 时按钮给安装程序（.exe），
  // 否则给 ZIP。从 0.3.4 起每个版本都带安装程序，下面填那个版本的 .exe，
  // 不要再填 ZIP。
  // 桌面安装包从 0.3.7 起由 GitHub Release（v<版本>）分发：url 填 Release 附件
  // 的完整地址，size 填字节数（跨站链接查不到大小）。软件内更新仍从
  // 本站 downloads/ 下载，那边的包照常由发布脚本上传。
  mac: {
    version: "v0.3.7",
    url: "https://github.com/fengseekling-coder/gravityport/releases/download/v0.3.7/GravityPort-darwin-arm64-0.3.7.dmg",
    size: 146753491,
    label: "下载 macOS 包",
  },
  windows: {
    version: "v0.3.7",
    url: "https://github.com/fengseekling-coder/gravityport/releases/download/v0.3.7/GravityPort-win32-x64-0.3.7.exe",
    size: 112358039,
    label: "下载 Windows 包",
  },
  extension: {
    version: "v0.15.43",
    url: "./downloads/GravityPort-Web-Capture-0.15.43.zip",
    label: "浏览器包下载",
  },
});
