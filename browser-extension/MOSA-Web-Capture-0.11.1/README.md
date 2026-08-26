# MOSA Web Capture 0.11.1

这是 MOSA 的 Chrome / Chromium Manifest V3 扩展包。

## 安装

1. 解压下载的 ZIP。
2. 打开 `chrome://extensions` 并开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择直接包含 `manifest.json` 的目录。
4. 打开扩展选项，填写本机 MOSA 地址和与 MOSA 服务一致的随机 Token。

公共默认地址为 `http://127.0.0.1:43517`。扩展只向本机 MOSA 服务发送数据；不要把该端口或 Token 暴露到公网、Issue、日志或截图中。

更新扩展代码后，在 `chrome://extensions` 点击扩展卡片上的刷新，并硬刷新正在使用的网页。

许可条款见 `LICENSE`，数据处理说明见 `PRIVACY.md`。
