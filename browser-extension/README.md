# MOSA Web Capture 发布目录

这里保存浏览器扩展的版本化源码快照和发布说明。当前版本是 `MOSA Web Capture 0.14.0`，源码位于 `MOSA-Web-Capture-0.14.0/`。

可下载的公开文件不放在本目录，而放在仓库根目录的 `downloads/`：

```text
downloads/MOSA-Web-Capture-0.14.0.zip
```

官网按钮使用 `site-config.js` 中的 `extension.url`，当前地址为：

```text
/downloads/MOSA-Web-Capture-0.14.0.zip
```

## 安装

1. 从官网下载安装 ZIP 并解压。
2. Chrome / Chromium 打开 `chrome://extensions`，开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选择解压后、直接包含 `manifest.json` 的目录。
4. 先启动 MOSA Desktop，再打开扩展选项。扩展会自动发现本机服务并完成安全配对，用户无需填写地址或 Token；点击“测试连接”确认即可。

这个 ZIP 是开发者模式用的扩展包，不是签名的 CRX；MOSA Web Capture 仍然只连接本机 `127.0.0.1` 或 `localhost`，不要把 MOSA 的 `43517` 端口暴露到公网。

## 发布新版本

1. 在本目录新建版本文件夹，保持 `manifest.json` 的版本号与目录名一致。
2. 将该版本文件夹内的扩展文件压缩到 `downloads/`，压缩包根目录应直接包含 `manifest.json`。
3. 在 `site-config.js` 更新 `extension.version` 和 `extension.url`。
4. 提交并推送到 `main`，GitHub Actions 会自动同步官网和下载包到 DMIT。

每个新包都保留在仓库中；服务器上的旧下载包不会被 Actions 自动删除，便于回滚。
