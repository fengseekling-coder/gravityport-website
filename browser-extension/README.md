# GravityPort Web Capture（浏览器扩展）

这个目录保存扩展的发布说明。

- 当前扩展的源码在 App 仓库：[extensions/chatgpt-web-capture](https://github.com/fengseekling-coder/gravityport/tree/main/extensions/chatgpt-web-capture)。
- 隐私说明：App 仓库的 [PRIVACY.md](https://github.com/fengseekling-coder/gravityport/blob/main/PRIVACY.md) 和[官网隐私页](https://gravityport.azhuilab.com/privacy/)。

可下载的公开文件不放在本目录，而放在仓库根目录的 `downloads/`，例如 `downloads/GravityPort-Web-Capture-0.15.47.zip`。官网按钮使用的版本号和地址在 `site-config.js` 的 `extension` 段。

## 安装

0.3.11 起 GravityPort 自带扩展，从 App 的文件夹加载一次，以后跟随 App 自动更新：

1. 打开 GravityPort，在「设置 → 连接」里点「复制位置」。
2. Chrome / Chromium 打开 `chrome://extensions`，开启「开发者模式」。
3. 选择「加载已解压的扩展程序」，选这个文件夹（Mac 上在选择窗口按 ⌘⇧G，粘贴位置）。
4. 扩展会自动连接 GravityPort，第一次连接时在 GravityPort 里点「允许连接」。在扩展设置里打开「自动收录」，点「保存」，再点「测试连接」确认。

也可以从官网下载 GravityPort-Web-Capture-*.zip，解压到一个固定的文件夹再按第 2～4 步加载；这样装的扩展不会自动更新。这个 ZIP 是开发者模式用的扩展包，不是签名的 CRX；扩展只连接本机 `127.0.0.1` 或 `localhost`，不要把 GravityPort 的 `43517` 端口暴露到公网。

## 发布新版本

扩展包随官网仓库发布：把打包好的 `downloads/GravityPort-Web-Capture-版本.zip` 随 PR 提交合并后，GitHub Actions 的 “Sync extension packages to R2” 步骤会把它同步到 R2，只增不删；同时更新 `site-config.js` 的 `extension.version` 和 `extension.url`。详见 [`DEPLOYMENT.md`](../DEPLOYMENT.md) 第 4 节。
