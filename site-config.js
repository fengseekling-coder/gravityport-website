window.MOSA_SITE_CONFIG = Object.freeze({
  downloadsEnabled: true,
  desktop: {
    feedUrl: "./releases/latest.json",
  },
  // 显式兜底（explicit fallback）。首页脚本优先读取 releases/latest.json 的
  // platforms.macos / platforms.windows，两个平台独立判断；某平台在当前
  // release 缺失时才回落到这里，且 UI 必须显示明确的版本号——Windows 包
  // 兜底到 rc.14 时会以 "Windows Preview 0.2.1-rc.14" 呈现，绝不伪装成
  // 最新版。URL 指向真实存在的第一方下载文件。
  mac: {
    version: "v0.2.1-rc.15",
    url: "./downloads/MOSA-darwin-arm64-0.2.1-rc.15.zip",
    label: "下载 macOS 包",
  },
  windows: {
    version: "v0.2.1-rc.14",
    url: "./downloads/MOSA-win32-x64-0.2.1-rc.14.zip",
    label: "下载 Windows 包",
  },
  extension: {
    version: "v0.15.3",
    url: "./downloads/MOSA-Web-Capture-0.15.3.zip",
    label: "浏览器包下载",
  },
});
