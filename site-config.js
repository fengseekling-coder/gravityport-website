window.MOSA_SITE_CONFIG = Object.freeze({
  downloadsEnabled: true,
  desktop: {
    feedUrl: "./releases/latest.json",
  },
  // 静态兜底：更新清单要求 mac/windows 两个条目同版本才会被首页脚本采用。
  // rc.15 只有 macOS 包（Windows 暂缓），清单校验必然失败，因此回退到这里的真实文件。
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
