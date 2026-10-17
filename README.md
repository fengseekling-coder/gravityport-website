# MOSA Website

这是一个和主项目 `mosa/` 完全分离的静态官网目录，不依赖主项目运行时，也不引用主项目内部文件。

## 本地预览

在当前目录启动任意静态文件服务器，例如：

```bash
python3 -m http.server 8080
```

然后打开 `http://127.0.0.1:8080`。

## 配置下载地址

桌面下载按钮只读取 `releases/latest.json`：页面不会内置旧桌面包地址，因此只会提供当前清单中的最新 macOS / Windows 成对版本。`site-config.js` 只保留浏览器扩展的静态下载地址：

```js
window.MOSA_SITE_CONFIG = Object.freeze({
  desktop: {
    feedUrl: "./releases/latest.json",
  },
  mac: {
    version: "",
    url: "",
    label: "下载 macOS 包",
  },
  windows: {
    version: "",
    url: "",
    label: "下载 Windows 包",
  },
  extension: {
    version: "0.15.3",
    url: "./downloads/MOSA-Web-Capture-0.15.3.zip",
    label: "浏览器包下载",
  },
});
```

桌面清单无法读取时，桌面下载按钮不会跳转到旧包或不存在的文件；用户会看到重试提示。这确保官网始终只提供最新版本。

## 目录

- `index.html`：官网页面结构与文案
- `styles.css`：独立视觉样式和响应式布局
- `script.js`：下载配置、滚动动效和轻交互
- `site-config.js`：版本号与下载地址
- `demo/`：独立的 MOSA 交互产品演示；使用静态示例数据复刻当前桌面端三栏信息架构，不读取真实用户素材
- `guide/`：MOSA Web Capture 独立安装教程，避免技术步骤挤占官网首页主叙事
- `robots.txt` / `sitemap.xml`：搜索引擎抓取与站点地图
- `releases/latest.json`：桌面版本、校验值和平台包清单
- `browser-extension/`：浏览器扩展当前版本的源码快照和发布说明
- `downloads/`：正式安装包/扩展包放置位置，不属于主应用目录
- `scripts/`：桌面包校验、上传和自动监控脚本
- `ops/`：macOS `launchd` 监控模板

## 发布

官网主体是纯静态文件，可以直接部署到 Nginx、Cloudflare Pages、GitHub Pages、Vercel 静态托管或任意对象存储。私有统计页额外需要一个只监听服务器回环地址的轻量登录服务。

## 自动部署

本仓库的 `main` 分支配置了 GitHub Actions。推送到 `main` 后，Actions 会通过专用 SSH 部署账号把网站和 `downloads/` 下载包同步到 DMIT 的 `/var/www/mosa-website/`，并执行 HTTPS 冒烟检查；`browser-extension/` 只放在仓库里，不发布到网站；不会启动 Node.js，也不会反向代理 MOSA 本地服务。

桌面包约 128–154 MB，超过 GitHub 单文件限制，不提交到 Git。macOS 本机的监控任务会观察 `<mosa 仓库>/out/make/dmg/darwin/arm64/` 与 `<mosa 仓库>/out/make/zip/win32/x64/`：当 macOS arm64 DMG 和 Windows x64 ZIP 的同版本包都写完后，自动校验包、计算 SHA-256，通过受限的部署账号上传到网站，并原子更新 `releases/latest.json`。服务器仅保留最新四个完整桌面版本（当前版本加三个历史版本）；扩展 ZIP 与不成对文件不会被这项清理触及。

首次启用监控：

```bash
./scripts/install-release-monitor.sh
```

手动只做本地校验（不上传）：

```bash
./scripts/publish-desktop-release.sh --dry-run
```

监控日志在 `~/Library/Logs/MOSA/desktop-release-monitor.{out,err}.log`，状态文件在 `~/.config/mosa/desktop-release-monitor.state`。如果只生成了一个平台，或两个包版本不一致，任务会等待，不会推进桌面更新清单。

完整的发布、更新、扩展包和 macOS 安装包操作说明见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

私有使用统计面板位于 `admin/`。生产环境由 Nginx `auth_request` 加只监听回环地址的 Node.js 登录服务保护 `/admin/`，首次登录后用安全 Cookie 保持 30 天会话；`scripts/install-private-stats.sh` 每 5 分钟增量读取当前及轮转后的 Nginx access log，并把私有累计状态保存在 Web 根目录之外的 `/var/lib/mosa-stats/usage-state.json`，再生成未提交到 Git 的 `admin/stats.json`。因此日志轮转不会让历史安装/下载总数回退，重复执行统计也不会重复累计同一批日志。安装和 Nginx 配置步骤见 `DEPLOYMENT.md` 的“私有统计面板”。
页面访问同样来自这份 Nginx 日志：只统计 MOSA 公开页的成功 GET，首页还按响应体长度过滤，避免把同机其他站点的 `GET /` 算进来。这是近似 PV，不是按钮点击事件，也不使用第三方 Analytics。

渠道链接可以使用 `?ref=`，例如 `https://mosa.azhuilab.com/?ref=reddit_codex`。下载按钮会保留这个短标签到下载请求，便于从 Nginx 日志区分渠道。桌面端的匿名安装/活跃统计同样复用现有更新检查请求，不需要 MOSA 账号；统计字段和关闭方式见主项目 `PRIVACY.md`。

更新官网的常用流程：

```bash
git add -A
git commit -m "Update MOSA website"
git push origin main
```

仓库 Actions 需要以下 Secrets：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_REMOTE_DIR`、`DEPLOY_SSH_KEY` 和 `DEPLOY_KNOWN_HOSTS`。其中私钥只保存在 GitHub Secrets，不放入仓库。

正式包按以下约定保存：`downloads/MOSA-Web-Capture-版本.zip`、`downloads/MOSA-darwin-arm64-版本.dmg` 或 `downloads/MOSA-版本.pkg`。浏览器扩展 ZIP 可以提交并由 Actions 同步；桌面 DMG/ZIP 由本机监控程序直接发布。服务器只保留最新四组完整的桌面包，旧包不出现在官网页面。
