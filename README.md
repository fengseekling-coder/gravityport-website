# MOSA Website

这是一个和主项目 `mosa/` 完全分离的静态官网目录，不依赖主项目运行时，也不引用主项目内部文件。

## 本地预览

在当前目录启动任意静态文件服务器，例如：

```bash
python3 -m http.server 8080
```

然后打开 `http://127.0.0.1:8080`。

## 配置下载地址

下载按钮统一在 `site-config.js` 配置：

```js
window.MOSA_SITE_CONFIG = Object.freeze({
  mac: {
    version: "0.1.0",
    url: "./downloads/MOSA-macOS-arm64.zip",
    label: "Mac 版下载",
  },
  extension: {
    version: "0.11.1",
    url: "./downloads/MOSA-Web-Capture-0.11.1.zip",
    label: "浏览器包下载",
  },
});
```

也可以把 `url` 改成 GitHub Release、对象存储或 CDN 的完整下载地址。

如果 `url` 为空，按钮不会跳转到不存在的文件，而是提示“尚未配置下载地址”。这是为了避免官网出现假下载链接。

## 目录

- `index.html`：官网页面结构与文案
- `styles.css`：独立视觉样式和响应式布局
- `script.js`：下载配置、滚动动效和轻交互
- `site-config.js`：版本号与下载地址
- `browser-extension/`：浏览器扩展的私密源码快照和发布说明
- `downloads/`：正式安装包/扩展包放置位置，不属于主应用目录

## 发布

整个 `mosa-website/` 都是纯静态文件，可以直接部署到 Nginx、Cloudflare Pages、GitHub Pages、Vercel 静态托管或任意对象存储。

## 自动部署

本仓库的 `main` 分支配置了 GitHub Actions。推送到 `main` 后，Actions 会通过专用 SSH 部署账号把网站和 `downloads/` 下载包同步到 DMIT 的 `/var/www/mosa-website/`，并执行 HTTPS 冒烟检查；`browser-extension/` 只保存在私密仓库，不发布源码目录；不会启动 Node.js，也不会反向代理 MOSA 本地服务。

更新官网的常用流程：

```bash
git add -A
git commit -m "Update MOSA website"
git push origin main
```

仓库 Actions 需要以下 Secrets：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_REMOTE_DIR`、`DEPLOY_SSH_KEY` 和 `DEPLOY_KNOWN_HOSTS`。其中私钥只保存在 GitHub Secrets，不放入仓库。

正式包按以下约定保存：`downloads/MOSA-Web-Capture-版本.zip`、`downloads/MOSA-版本.dmg` 或 `downloads/MOSA-版本.pkg`。提交到仓库的包会被同步；服务器 `downloads/` 中仅存在于服务器的旧包也会保留，不会被自动删除。
