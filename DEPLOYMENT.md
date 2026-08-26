# MOSA 官网发布与更新说明

本文件是 `mosa-website` 的操作手册。官网是独立的纯静态项目，不依赖或修改主项目 `mosa/`。

## 1. 当前结构

```text
mosa-website/
├── index.html                         官网页面
├── styles.css                         页面样式
├── script.js                          页面交互和下载按钮
├── site-config.js                     版本号和正式下载地址
├── browser-extension/                 私密仓库中的扩展源码快照和说明
│   └── MOSA-Web-Capture-0.11.1/
└── downloads/                         会发布到官网的安装包和扩展包
    └── MOSA-Web-Capture-0.11.1.zip
```

公开下载地址统一使用：

```text
https://mosa.azhuilab.com/downloads/文件名
```

`browser-extension/` 只保存在私密 GitHub 仓库，不会同步到网站；`downloads/` 中的文件会同步到 DMIT，并由 Nginx 作为附件下载。

## 2. 更新官网文字、样式或脚本

在本目录修改 `index.html`、`styles.css`、`script.js` 或其他官网文件，然后执行：

```bash
cd /Users/azhuilab/codex_aigc/mosa-website
git diff --check
git add -A
git commit -m "Update MOSA website"
git push origin main
```

推送到 `main` 会触发 `.github/workflows/deploy.yml`。Actions 会：

1. 通过受限的 `mosa-deploy` SSH 账号连接 DMIT。
2. 同步官网文件到 `/var/www/mosa-website/`。
3. 同步 `downloads/` 中的正式包。
4. 执行首页、CSS、JS、HTTPS 和 HTTP→HTTPS 冒烟检查。

静态文件更新不需要启动 Node.js，也不需要重启或 reload Nginx。`index.html` 和 `site-config.js` 配置为不缓存，修改下载地址后会及时生效。

## 3. 发布浏览器扩展包

当前浏览器扩展源码快照在：

```text
browser-extension/MOSA-Web-Capture-0.11.1/
```

新版本先新建一个版本目录，并确保目录名与 `manifest.json` 的 `version` 一致。例如 `0.11.2`：

```text
browser-extension/MOSA-Web-Capture-0.11.2/
```

把扩展运行文件放入该目录。扩展包至少应包含 `manifest.json`、`background.js`、`content.js`、`content.css`、`page-hook.js`、`provider-sites.js`、`options.html` 和 `options.js`。然后从版本目录内部打包，保证 ZIP 根目录直接包含 `manifest.json`：

```bash
cd /Users/azhuilab/codex_aigc/mosa-website/browser-extension/MOSA-Web-Capture-0.11.2
rm -f ../../downloads/MOSA-Web-Capture-0.11.2.zip
zip -qr -X ../../downloads/MOSA-Web-Capture-0.11.2.zip .
cd /Users/azhuilab/codex_aigc/mosa-website
unzip -t downloads/MOSA-Web-Capture-0.11.2.zip
unzip -l downloads/MOSA-Web-Capture-0.11.2.zip | grep 'manifest.json'
```

再编辑 `site-config.js`，把扩展配置切换到新包：

```js
extension: {
  version: "v0.11.2",
  url: "./downloads/MOSA-Web-Capture-0.11.2.zip",
  label: "浏览器包下载",
},
```

最后提交并推送：

```bash
git add -A
git commit -m "Publish MOSA Web Capture 0.11.2"
git push origin main
```

用户下载 ZIP 后解压，在 Chrome / Chromium 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”。这个包不是签名 CRX，扩展仍然只连接用户本机的 `127.0.0.1` 或 `localhost` MOSA 服务。

## 4. 发布 macOS 安装包

拿到真实的 `.dmg` 或 `.pkg` 后，直接放进 `downloads/`，例如：

```text
downloads/MOSA-0.2.0-arm64.dmg
```

然后在 `site-config.js` 填写真实版本和地址：

```js
mac: {
  version: "v0.2.0",
  url: "./downloads/MOSA-0.2.0-arm64.dmg",
  label: "下载 MOSA",
},
```

确认文件是真实安装包后，再执行：

```bash
git add -A
git commit -m "Publish MOSA macOS 0.2.0"
git push origin main
```

没有正式安装包时，保持 `mac.version` 和 `mac.url` 为空，官网会继续显示“即将上线”，不要创建占位文件或假下载链接。超大的安装包不要强行提交 Git；可以放到 GitHub Release、对象存储或 CDN，并把完整 URL 写进 `site-config.js`。

## 5. 文件命名约定

建议使用带版本号的稳定文件名：

```text
downloads/MOSA-Web-Capture-0.11.2.zip
downloads/MOSA-0.2.0-arm64.dmg
downloads/MOSA-0.2.0-universal.pkg
```

不要覆盖旧版本文件。服务器会保留旧下载包，便于回滚；切换官网当前版本只需要修改 `site-config.js`。

## 6. 发布后检查

推送后在 GitHub Actions 页面确认 `Deploy MOSA website` 为绿色，然后检查：

```bash
curl -fI https://mosa.azhuilab.com/
curl -fI https://mosa.azhuilab.com/downloads/MOSA-Web-Capture-0.11.1.zip
```

ZIP 应返回 `200`、`Content-Type: application/zip` 和 `Content-Disposition: attachment`。若下载地址返回 `404`，先检查文件名大小写、`site-config.js` 路径和 Actions 运行结果。

## 7. 回滚

如果新版本有问题，把 `site-config.js` 的地址改回旧包并推送即可；也可以使用 Git 的 `git revert` 回滚对应提交。旧包不会被自动删除，因此不需要直接登录服务器清理文件。

## 8. 安全边界

- 不要把 Token、密码、SSH 私钥、`.env` 或用户素材提交到仓库。
- 不要把 MOSA 的 `127.0.0.1:43517` 改成公网监听或加入反向代理。
- GitHub Actions 使用 `mosa-deploy`，不是 root；该账号只写 `/var/www/mosa-website/`。
- Nginx 配置和证书不需要随官网仓库提交，服务器配置位置是 `/etc/nginx/sites-available/mosa.azhuilab.com.conf`。
