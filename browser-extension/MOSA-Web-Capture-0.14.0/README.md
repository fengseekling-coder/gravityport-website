# MOSA Web Capture 0.14.0

这是 MOSA 的 Chrome / Chromium Manifest V3 扩展包，支持从已声明的 ChatGPT、Gemini、Flow 和 Google AI Studio 页面采集内容到本机 MOSA。

## 安装

1. 解压下载的 ZIP。
2. 打开 `chrome://extensions` 并开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择直接包含 `manifest.json` 的目录。
4. 先启动 MOSA Desktop，再打开扩展选项。扩展会自动发现本机服务并完成安全配对，用户无需填写地址或 Token；点击“测试连接”确认即可。

扩展只向用户本机的 `127.0.0.1` 或 `localhost` MOSA 服务发送数据。不要把 MOSA 的 `43517` 端口或 Token 暴露到公网、Issue、日志或截图中。

这个包是开发者模式用的 ZIP，不是签名 CRX。更新扩展代码后，在 `chrome://extensions` 点击扩展卡片上的刷新，并硬刷新正在使用的网页。

扩展 ID 保持在清单的公钥字段中；重新打包时不要删除或修改 `manifest.json` 的 `key`。

许可条款见 `LICENSE`，数据处理说明见 `PRIVACY.md`。
