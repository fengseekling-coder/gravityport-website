# GravityPort Website

这是一个和主项目 `mosa/` 完全分离的静态官网目录，不依赖主项目运行时，也不引用主项目内部文件。

## 本地预览

在当前目录启动任意静态文件服务器，例如：

```bash
python3 -m http.server 8080
```

然后打开 `http://127.0.0.1:8080`。

## 配置下载地址

桌面下载按钮只读取 `releases/gravityport/latest.json`：页面不会内置旧桌面包地址，因此只会提供当前清单中的最新 macOS / Windows 成对版本。`site-config.js` 只保留浏览器扩展的静态下载地址：

```js
window.MOSA_SITE_CONFIG = Object.freeze({
  desktop: {
    feedUrl: "./releases/gravityport/latest.json",
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
    version: "v0.15.38",
    url: "./downloads/GravityPort-Web-Capture-0.15.38.zip",
    label: "浏览器包下载",
  },
});
```

桌面清单无法读取时，桌面下载按钮不会跳转到旧包或不存在的文件；用户会看到重试提示。这确保官网始终只提供最新版本。

## 目录

- `index.html`：官网首页（12 张「印张」，演示和扩展安装步骤都在首页）
- `site/press.css`、`site/press.js`：全站共用的样式和脚本
- `site/strings.js`、`site/privacy-strings.js`：中英文文案
- `assets/work/`：页面用到的作者本人作品（`work.js` 是它们的来源信息）
- `assets/fonts/`：自托管字体；改了大标题或手写批注后运行 `python3 -I scripts/fetch-site-fonts.py`
- `privacy/`：隐私政策
- `site-config.js`：版本号与下载地址
- `guide/`、`demo/`：旧地址，自动跳到首页对应的那一屏
- `robots.txt` / `sitemap.xml`：搜索引擎抓取与站点地图
- `releases/gravityport/latest.json`：桌面版本、校验值和平台包清单
- `browser-extension/`：浏览器扩展当前版本的源码快照和发布说明
- `downloads/`：正式安装包/扩展包放置位置，不属于主应用目录
- `scripts/`：桌面包校验、上传和自动监控脚本
- `ops/`：macOS `launchd` 监控模板

## 发布

官网由 Cloudflare Pages 托管；Worker、R2 和 D1 的结构与操作见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

## 自动部署

本仓库的 `main` 分支配置了 GitHub Actions。推送到 `main` 后，Actions 把网站部署到 Cloudflare Pages，并把 `downloads/` 里的扩展包同步到 R2；`browser-extension/` 只放在仓库里，不发布到网站。Worker 不随 Actions 部署，需要手动执行 `wrangler deploy`。

桌面包约 128–154 MB，超过 GitHub 单文件限制，不提交到 Git。macOS 本机的监控任务会观察 `<gravityport 仓库>/out/make/dmg/darwin/arm64/` 与 `<gravityport 仓库>/out/make/zip/win32/x64/`（Windows 安装程序在 `<gravityport 仓库>/out/make/installer/win32/x64/`）：当 macOS arm64 DMG 和 Windows x64 ZIP 的同版本包都写完后，自动校验包、计算 SHA-256，上传到 R2，并替换 `releases/gravityport/latest.json`。R2 上只保留最新四个完整桌面版本（当前版本加三个历史版本）；扩展 ZIP 与不成对文件不会被这项清理触及。

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

私有使用统计面板位于 `admin/`，由 Cloudflare Access 保护，只允许开发者本人访问。安装、下载和访问计数存在 D1 `gp-stats` 里。页面访问是近似 PV，不是按钮点击事件，也不使用第三方 Analytics。统计和反馈的存放与后台入口见 `DEPLOYMENT.md`。

官网域名为 `https://gravityport.azhuilab.com/`。渠道链接可以使用 `?ref=`，例如 `https://gravityport.azhuilab.com/?ref=reddit_codex`。下载按钮会保留这个短标签到下载请求，便于在统计中区分渠道。旧域名 `mosa.azhuilab.com` 的首页显示域名迁移说明；为兼容已发布的桌面客户端，旧域名上的 `/releases/`、`/downloads/` 和 `/api/` 服务路径继续保留。

更新官网的常用流程：

```bash
git add -A
git commit -m "Update GravityPort website"
git push origin main
```

仓库 Actions 需要两个 Secrets：`CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。令牌只保存在 GitHub Secrets，不放入仓库。

正式包按以下约定保存：`downloads/GravityPort-Web-Capture-版本.zip`、`downloads/GravityPort-darwin-arm64-版本.dmg`、`downloads/GravityPort-win32-x64-版本.zip`，带安装程序的版本还有 `downloads/GravityPort-win32-x64-版本.exe`。浏览器扩展 ZIP 可以提交并由 Actions 同步；桌面 DMG/ZIP 由本机监控程序直接发布。R2 上只保留最新四组完整的桌面包，旧包不出现在官网页面。
