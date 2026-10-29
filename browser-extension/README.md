# GravityPort Web Capture（浏览器扩展）

这个目录保存扩展的历史源码快照和发布说明。

- 当前扩展的源码在 App 仓库：[extensions/chatgpt-web-capture](https://github.com/fengseekling-coder/gravityport/tree/main/extensions/chatgpt-web-capture)。
- 隐私说明：App 仓库的 [PRIVACY.md](https://github.com/fengseekling-coder/gravityport/blob/main/PRIVACY.md) 和[官网隐私页](https://gravityport.azhuilab.com/privacy/)。
- `MOSA-Web-Capture-0.15.3/` 是产品还叫 MOSA 时的历史源码快照，不是当前版本，不要从这里安装扩展。

可下载的公开文件不放在本目录，而放在仓库根目录的 `downloads/`，例如 `downloads/GravityPort-Web-Capture-0.15.43.zip`。官网按钮使用的版本号和地址在 `site-config.js` 的 `extension` 段。

## 安装

1. 从官网下载 GravityPort-Web-Capture-*.zip 并解压。
2. Chrome / Chromium 打开 `chrome://extensions`，开启「开发者模式」。
3. 选择「加载已解压的扩展程序」，选择解压后、直接包含 `manifest.json` 的目录。
4. 先启动 GravityPort Desktop，再打开扩展选项。扩展会自动发现本机服务并完成安全配对，无需填写地址或 Token；点击「测试连接」确认即可。

这个 ZIP 是开发者模式用的扩展包，不是签名的 CRX；扩展只连接本机 `127.0.0.1` 或 `localhost`，不要把 GravityPort 的 `43517` 端口暴露到公网。

## 发布新版本

扩展包随官网仓库发布：把打包好的 `downloads/GravityPort-Web-Capture-版本.zip` 随 PR 提交合并后，GitHub Actions 的 “Sync extension packages to R2” 步骤会把它同步到 R2，只增不删；同时更新 `site-config.js` 的 `extension.version` 和 `extension.url`。详见 [`DEPLOYMENT.md`](../DEPLOYMENT.md) 第 4 节。
