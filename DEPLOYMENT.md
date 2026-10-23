# GravityPort 官网发布与更新说明

本文件是 `mosa-website` 的操作手册。官网是独立的纯静态项目，不依赖或修改主项目 `mosa/`。

## 1. 当前结构

```text
mosa-website/
├── index.html                         官网首页
├── privacy/                           隐私政策
├── site/                              共用样式、脚本和中英文文案
├── assets/                            标志、字体、页面用图
├── guide/  demo/                      旧地址，跳转到首页
├── site-config.js                     版本号和正式下载地址
├── releases/                          （不进仓库）服务器上的桌面更新清单，由发布脚本生成
├── scripts/                            桌面包校验、上传和监控脚本
├── ops/                                macOS launchd 监控模板
├── browser-extension/                 当前扩展版本的源码快照和说明（不发布到网站）
│   └── MOSA-Web-Capture-0.15.3/
└── downloads/                         会发布到官网的安装包和扩展包
    └── GravityPort-Web-Capture-0.15.38.zip
```

公开下载地址统一使用：

```text
https://gravityport.azhuilab.com/downloads/文件名
```

`browser-extension/` 只保存在 GitHub 仓库，不会同步到网站；`downloads/` 中的文件会同步到 DMIT，并由 Nginx 作为附件下载。

桌面 ZIP 是大文件发布物，不进入 GitHub 仓库。它们从主项目的 `out/make/zip/` 直接上传到 DMIT；仓库只保存页面、清单和发布脚本。普通官网 Actions 会保留服务器上已经由桌面发布器上传的 `downloads/` 和 `releases/` 内容。

### 官网域名切换

正式官网域名是 `https://gravityport.azhuilab.com/`。`azhuilab.com` 整个 DNS 区域由 Cloudflare 管理，域名注册仍由 Spaceship 管理。当前 Cloudflare 名称服务器是 `holly.ns.cloudflare.com` 和 `tim.ns.cloudflare.com`。Cloudflare 中的 `browser`、`dev`、`mosa`、`gravityport` 四条 A 记录均指向 `179.253.232.244` 并保持 DNS only；`mosa` 另有一条 Google 验证 TXT 记录。新增子域或改 DNS 时只改 Cloudflare 区域，不要在 Spaceship 的非活动记录里改。

服务器继续从 `/var/www/mosa-website/` 提供静态文件。更新 `/etc/nginx/stream-conf.d/tokenkey-sni.conf`，将 `gravityport.azhuilab.com` 路由到现有官网上游 `127.0.0.1:9444`；再更新 `/etc/nginx/sites-available/mosa.azhuilab.com.conf`，让 HTTP 与 HTTPS 两个 server 块都包含新域名。扩展现有 Let's Encrypt 证书，使其同时覆盖两个域名。旧域名的网页请求显示仓库中的 `domain-changed.html`；`/releases/`、`/downloads/` 和 `/api/` 路径继续兼容已发布的桌面客户端。Nginx 变更片段见 [`ops/nginx-domain-migration.conf.example`](./ops/nginx-domain-migration.conf.example)。

DNS 生效后扩展证书：

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name mosa.azhuilab.com --expand \
  -d mosa.azhuilab.com -d gravityport.azhuilab.com
```

证书成功后执行 `sudo nginx -t`，确认通过后再 `sudo systemctl reload nginx`。静态文件仍由本仓库 `main` 分支的 Actions 发布。

## 2. 更新官网文字、样式或脚本

在本目录修改 `index.html`、`site/` 下的样式、脚本、文案或其他官网文件，然后执行：

```bash
cd <官网仓库>
git diff --check
git add -A
git commit -m "Update GravityPort website"
git push origin main
```

推送到 `main` 会触发 `.github/workflows/deploy.yml`。Actions 会：

1. 通过受限的部署 SSH 账号（非 root）连接 DMIT。
2. 同步官网文件到 `/var/www/mosa-website/`。
3. 同步 `downloads/` 中的正式包。
4. 检查 GravityPort 首页、MOSA 旧域名迁移页、更新清单、CSS、JS、HTTPS 和 HTTP→HTTPS 路由。

静态文件更新不需要启动 Node.js，也不需要重启或 reload Nginx。`index.html` 和 `site-config.js` 配置为不缓存；页面启动时还会读取 `releases/gravityport/latest.json`，因此桌面包更新后不需要再修改页面文案。

已发布桌面客户端仍从 `https://mosa.azhuilab.com/releases/latest.json` 或 `https://mosa.azhuilab.com/releases/gravityport/latest.json` 读取更新清单，并从旧域名的 `/downloads/` 下载。官网页面和分享链接统一使用 `gravityport.azhuilab.com`。发布器会同步写入 `version`、`publishedAt`、双语 `notes`、两个平台的文件名、大小和 SHA-256；客户端只读取版本和说明，不接受清单里的任意跳转 URL。

## 3. 发布桌面安装包（macOS DMG + Windows ZIP 和安装程序）

截图中的两个真实包对应：

```text
<mosa 仓库>/out/make/dmg/darwin/arm64/MOSA-darwin-arm64-0.2.1-rc.5.dmg
<mosa 仓库>/out/make/zip/win32/x64/MOSA-win32-x64-0.2.1-rc.5.zip
```

Windows 还有一个安装程序（`<产品>-win32-x64-<版本>.exe`，一个文件，双击安装），和同版本的 Windows ZIP 一起发布。发布器先在 `<mosa 仓库>/out/make/installer/win32/x64/` 找它，再在 ZIP 旁边找（解压 CI 产物时它可能和 ZIP 放在一起）；也可以用 `MOSA_RELEASE_WINDOWS_INSTALLER` 指定文件。找到后用 `--windows-installer` 交给清单生成器，写进签名清单的 `platforms.windows.installer`（`file`、`size`、`sha256`），再和其他包一样上传、核对 SHA-256。官网的 Windows 下载按钮在清单带安装程序时给 `.exe`，否则给 ZIP；已经装好的应用照旧从 ZIP 更新。没有同版本 ZIP 的安装程序不会单独发布。

服务器地址和部署账号不写进仓库，放在本机的 `~/.config/mosa/release.env`（权限 600，一行一个 `KEY=value`）：

```text
MOSA_RELEASE_SSH_HOST=<服务器地址>
MOSA_RELEASE_SSH_USER=<部署账号>
```

发布脚本启动时读这个文件；环境变量里已经设了的值优先。私钥默认用 `~/.ssh/mosa_website_release_monitor`，要换路径也写在这个文件里（`MOSA_RELEASE_SSH_KEY=…`）。

本机首次启用自动发布（官网仓库和 `mosa` 仓库要放在同一个父目录下；`ops/` 里的 launchd 配置是模板，安装脚本会填入本机路径）：

```bash
cd <官网仓库>
./scripts/install-release-monitor.sh
```

监控任务由 macOS `launchd` 在登录后运行，并同时使用目录变更触发和 5 分钟兜底轮询。每次候选发布必须满足：

1. 两个平台存在相同版本的桌面包。
2. 文件大小连续稳定后，macOS DMG 通过 `hdiutil verify`，Windows ZIP 通过 `unzip -t` 且包含对应的启动文件；有 Windows 安装程序时，它必须是 Windows 程序（文件头 `MZ`）。
3. 上传到服务器临时目录后，服务器端 SHA-256 与本机一致。
4. 两个包先进入 `downloads/`，最后才原子替换 `releases/gravityport/latest.json`。

因此只有一个平台、正在生成中的包、损坏包或低于已发布版本的包都不会推进线上版本。每次替换前的旧清单会备份到服务器 `releases/gravityport/history/`，便于回滚。桌面包会保留最新四个完整版本（当前版本加三个历史版本）：发布器在新包与 `releases/gravityport/latest.json` 原子切换完成后，才删除更旧的 macOS / Windows 成对包（那个版本有 Windows 安装程序的话一起删）；浏览器扩展 ZIP 和不成对文件不会被删除。

手动只校验、不上传：

```bash
./scripts/publish-desktop-release.sh --dry-run
```

监控日志：

```text
~/Library/Logs/MOSA/desktop-release-monitor.out.log
~/Library/Logs/MOSA/desktop-release-monitor.err.log
```

桌面包大于 GitHub 单文件限制，所以不要把它们复制到仓库后提交；发布器直接从主项目输出目录上传。若需要人工发布，确保文件名保持 `GravityPort-darwin-arm64-版本.dmg`、`GravityPort-win32-x64-版本.zip` 和 `GravityPort-win32-x64-版本.exe`。

## 4. 发布浏览器扩展包

当前浏览器扩展源码快照在：

```text
browser-extension/MOSA-Web-Capture-0.15.3/
```

新版本先新建一个版本目录，并确保目录名与 `manifest.json` 的 `version` 一致，目录和 ZIP 都用 `GravityPort-Web-Capture-` 前缀。例如下一版 `0.15.38`：

```text
browser-extension/GravityPort-Web-Capture-0.15.38/
```

把扩展运行文件放入该目录。扩展包至少应包含 `manifest.json`、`background.js`、`content.js`、`content.css`、`page-hook.js`、`provider-sites.js`、`options.html` 和 `options.js`。然后从版本目录内部打包，保证 ZIP 根目录直接包含 `manifest.json`：

```bash
cd browser-extension/GravityPort-Web-Capture-0.15.38
rm -f ../../downloads/GravityPort-Web-Capture-0.15.38.zip
zip -qr -X ../../downloads/GravityPort-Web-Capture-0.15.38.zip .
cd <官网仓库>
unzip -t downloads/GravityPort-Web-Capture-0.15.38.zip
unzip -l downloads/GravityPort-Web-Capture-0.15.38.zip | grep 'manifest.json'
```

再编辑 `site-config.js`，把扩展配置切换到新包：

```js
extension: {
  version: "v0.15.38",
  url: "./downloads/GravityPort-Web-Capture-0.15.38.zip",
  label: "浏览器包下载",
},
```

最后提交并推送：

```bash
git add -A
git commit -m "Publish GravityPort Web Capture 0.15.38"
git push origin main
```

用户下载 ZIP 后解压，在 Chrome / Chromium 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”。这个包不是签名 CRX，扩展仍然只连接用户本机的 `127.0.0.1` 或 `localhost` GravityPort 服务。

## 5. 发布 macOS 安装包

当前标准桌面发布会自动把 macOS DMG 与 Windows ZIP 成对上传，并更新 `releases/gravityport/latest.json`；不需要再手动修改 `site-config.js`。若只拿到一个独立的 macOS `.dmg`，才使用下面的单包发布方式：

```text
downloads/GravityPort-darwin-arm64-0.3.4.dmg
```

然后在 `site-config.js` 填写真实版本和地址：

```js
mac: {
  version: "v0.3.4",
  url: "./downloads/GravityPort-darwin-arm64-0.3.4.dmg",
  label: "下载 macOS 包",
},
```

确认文件是真实安装包后，再执行：

```bash
git add -A
git commit -m "Publish GravityPort macOS 0.3.4"
git push origin main
```

没有正式安装包时，保持 `mac.version` 和 `mac.url` 为空，官网会继续显示“即将上线”，不要创建占位文件或假下载链接。超大的安装包不要强行提交 Git；可以放到 GitHub Release、对象存储或 CDN，并把完整 URL 写进 `site-config.js`。

只有安装包已经真实可下载时才提升 `releases/gravityport/latest.json` 的版本号，避免客户端提示一个尚未提供下载的新版本。例如发布 `0.3.4`：

```json
{
  "version": "0.3.4",
  "publishedAt": "2026-10-24T10:00:00Z",
  "notes": {
    "zh": "修复素材收录稳定性并优化性能。",
    "en": "Improves capture reliability and performance."
  }
}
```

## 6. 文件命名约定

建议使用带版本号的稳定文件名：

```text
downloads/GravityPort-Web-Capture-0.15.38.zip
downloads/GravityPort-darwin-arm64-0.3.4.dmg
downloads/GravityPort-win32-x64-0.3.4.zip
downloads/GravityPort-win32-x64-0.3.4.exe
```

不要覆盖旧版本文件。服务器保留最新四组完整桌面包，便于回滚；桌面当前版本和官网下载地址都只由 `releases/gravityport/latest.json` 驱动。清单暂时不可用时，官网不会回退到旧包，而是提示稍后重试。

## 7. 发布后检查

推送后在 GitHub Actions 页面确认 `Deploy GravityPort website` 为绿色，然后检查：

```bash
curl -fI https://gravityport.azhuilab.com/
curl -fI https://gravityport.azhuilab.com/downloads/GravityPort-darwin-arm64-0.3.4.dmg
curl -fI https://gravityport.azhuilab.com/downloads/GravityPort-win32-x64-0.3.4.zip
curl -fsS https://mosa.azhuilab.com/ | rg 'gravityport.azhuilab.com'
```

DMG/ZIP 应返回 `200`、`Content-Disposition: attachment`，且清单中的大小与 SHA-256 与发布包一致。若下载地址返回 `404`，先检查文件名大小写、`releases/gravityport/latest.json` 和发布器日志。

## 8. 回滚

如果新版本有问题，使用最近三份服务器保留包之一重新发布对应的 `releases/gravityport/latest.json` 即可；也可以使用 Git 的 `git revert` 回滚页面变更。不要直接删除服务器上的桌面包；发布器会在下一次成功发布后按四版本策略自动清理超出的完整包对。

## 9. 安全边界

- 不要把 Token、密码、SSH 私钥、`.env` 或用户素材提交到仓库。
- 不要把 MOSA 的 `127.0.0.1:43517` 改成公网监听或加入反向代理。
- GitHub Actions 使用受限的部署账号，不是 root；该账号只写 `/var/www/mosa-website/`。
- 自动发布也使用这个部署账号，不把 root SSH 密钥写进监控模板；本机发布密钥只保存在 `~/.ssh/`，不进入仓库或日志。
- Nginx 配置和证书不需要随官网仓库提交，域名切换继续使用 `/etc/nginx/sites-available/mosa.azhuilab.com.conf`；以服务器上的生产配置为准。
- `scripts/`、`ops/` 和本文件会随部署同步到网站根目录（反馈和登录两个 systemd 服务以 `www-data` 从 `/var/www/mosa-website/scripts/` 启动，不能在 rsync 里排除；以 root 运行的统计 cron 不读这里，见第 10 节），外网访问由 Nginx 返回 404，片段见 `ops/nginx-private-paths.conf.example`。部署最后一步会检查这几个路径是否仍是 404。新增不该公开的根目录文件或目录时，要同时加进这个片段和部署检查。

## 10. 匿名安装 / 活跃与渠道统计

GravityPort 桌面端不会要求用户注册账号。正式桌面版每天最多一次向 `releases/gravityport/latest.json` 发送独立的无响应体匿名使用请求，附带：`event`、随机且持久化的 `install_id`、`platform`、`arch` 和 `version`。它与安装包下载渠道解耦，因此从官网、GitHub 或直接分享获得的正式安装包都会使用同一上报机制。这些字段不会包含素材、Prompt、文件路径或用户账号数据；应用设置中不提供关闭该最小匿名统计的开关。

官网支持 `?ref=` 渠道标签。例如：

```text
https://gravityport.azhuilab.com/?ref=bilibili_makerjackie
https://gravityport.azhuilab.com/?ref=reddit_codex
```

页面会把经过校验的短标签继续附在下载请求上（`site/download-links.js`），因此 Nginx 日志可以统计每个渠道带来的下载点击。渠道标签只允许字母、数字、点、下划线和短横线，最长 64 个字符。下载统计保留“成功 GET 请求数”口径，不把它误称为独立下载用户；同一设备重复下载、重试或断点续传都可能形成多个请求。私有面板会另外拆分桌面安装包与 Web Capture 扩展包，避免把扩展下载混入桌面安装包指标。

手机和平板装不了桌面版，所以在这些设备上点下载按钮不会直接下载，而是弹出「到电脑上下载」，给出本页网址让人复制、到电脑上打开（弹窗里仍可选择在这台设备上下载）。复制出的网址带 `ref=phone`；页面本身已经带了渠道标签时沿用原来的标签。所以私有面板渠道分布里的 `phone`，就是在手机上复制网址、后来到电脑上下载的请求数。

服务器已有标准 Nginx access log 时，可以直接复制日志到安全的运维环境后运行一次性汇总：

```bash
node scripts/report-usage.mjs /path/to/nginx/access.log
```

输出包含：匿名安装 ID 总数、已报告首次启动数、24 小时 DAU、7 天 WAU、30 天 MAU、平台/版本请求分布、桌面包/扩展包下载请求、下载文件分布和 `ref` 渠道分布。一次性模式只读取当前日志，不修改服务器或应用数据。
同一份日志也会给出官网公开页的近似 PV、首页访问，以及首页访问到下载请求的比值。首页只计体长足够的 GravityPort `GET /`；`/guide/`、`/demo/`、`/privacy/` 按路径统计。这不是按钮点击率，也不会把 `/admin/`、静态资源或下载请求算成页面访问。

生产环境应使用持久化增量模式：

```bash
node scripts/report-usage.mjs /var/log/nginx/access.log \
  --state /var/lib/mosa-stats/usage-state.json \
  --output /var/www/mosa-website/admin/stats.json
```

此模式会自动发现同目录下常见的 `access.log.1`、`access.log.2.gz` 和日期式轮转文件，用文件游标与内容指纹识别已经处理过的部分。日志重命名、压缩或普通轮转后不会重复累计；历史总数保存在私有 state 文件中，也不会因为旧日志被 Nginx 删除而回退。state 文件必须放在 Web 根目录之外，不应通过 Nginx 暴露。

若希望进一步减少日志中的网络元数据，生产 Nginx 可为更新清单路径（`/releases/latest.json` 与 `/releases/gravityport/latest.json`）单独配置不含 `$remote_addr`、User-Agent 和 Referer 的 usage log，只保留时间与 `$request_uri`；修改 Nginx 配置后需要单独执行 `nginx -t` 再 reload，这不属于静态网站 Actions 的职责。

### 私有统计面板

仓库内提供了一个静态私有统计页，以及只负责登录会话的轻量 Node.js 服务：

```text
admin/index.html
admin/login.html
admin/styles.css
admin/app.js
scripts/admin-auth.mjs
```

统计后台继续使用旧的私有地址；`mosa.azhuilab.com/admin/` 从旧域名迁移说明页中豁免，登录与数据请求仍通过同一 Nginx 会话认证。`gravityport.azhuilab.com` 不提供 `/admin/` 路径。

生产地址：

```text
https://mosa.azhuilab.com/admin/
```

页面读取同目录下由服务器生成的 `stats.json`，并显示匿名安装实例、首次启动、自然日 DAU、最近 7 个统计日活跃、最近 30 个统计日活跃、桌面下载请求、扩展下载请求、官网页面访问、首页访问、首页→下载转化、近 30 个统计日趋势、平台、版本、渠道与下载文件分布。统计日统一使用 `America/Los_Angeles`，避免服务器 UTC 日期与后台查看日期错位。下载数字明确表示成功 HTTP GET / Range 请求数，不等同于独立下载人数或安装人数；桌面下载包括更新 ZIP、macOS DMG 和 Windows 安装程序（以前计入「其他」的 DMG 下载，下次生成时会归回桌面下载）。页面访问来自 Nginx 日志近似 PV，不是点击事件；首页→下载是下载请求除以首页访问。`admin/stats.json` 已加入 `.gitignore`，官网 Actions 也会在 `rsync --delete` 时显式排除它，因此部署静态网站不会删除服务器上的实时统计文件。

服务器部署完成后，先确保 Node.js、`apache2-utils` 和现有密码文件已经准备好，再以 root 执行一次：

```bash
apt-get install -y apache2-utils
if [ ! -f /etc/nginx/.htpasswd-mosa-stats ]; then
  htpasswd -c /etc/nginx/.htpasswd-mosa-stats mosa-admin
fi
cd /var/www/mosa-website
bash scripts/install-private-stats.sh
```

脚本会创建权限为 `0700` 的 `/var/lib/mosa-stats/`，把 `scripts/report-usage.mjs` 拷进 root 自己的 `/usr/local/lib/gravityport-stats/`（会打印它的 SHA-256，装前和仓库核对一下），再写一个 `run.sh`。接着先把当前及可见的轮转日志增量写入 `usage-state.json`，生成一次 `admin/stats.json`，最后安装 `/etc/cron.d/mosa-private-stats`，每 5 分钟运行一次 `run.sh`，从上次游标处继续读取。

统计以 root 运行，所以既不直接执行部署账号能改的 `/var/www/mosa-website/` 里的文件，也不在那里创建临时文件：报告先写在 `/var/lib/mosa-stats/`，再整份改名到 `admin/stats.json`。改了 `report-usage.mjs` 以后，部署不会更新 root 那份，要再运行一次本脚本。若日志、Node 或私有状态目录不同，可在执行前指定：

```bash
MOSA_ACCESS_LOG=/实际/nginx/access.log MOSA_NODE_BIN=/usr/bin/node MOSA_STATS_STATE_DIR=/实际/私有目录 bash scripts/install-private-stats.sh
```

同一个密码文件也用于登录会话校验；如果文件已经存在，不要再次使用 `-c`，直接保留它即可。脚本还会安装并启动 `mosa-private-stats-auth.service`，它只监听 `127.0.0.1:39127`，状态文件位于 Web 根目录之外的 `/var/lib/mosa-stats-auth/sessions.json`，只保存会话 token 的 SHA-256 摘要。

统计页不使用 MOSA 用户账号。访问保护交给 Nginx `auth_request`，示例配置在 `ops/nginx-private-stats.conf.example`。locations 片段由 MOSA HTTPS `server {}` 提供，后台地址为 `mosa.azhuilab.com`：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

此后访问 `https://mosa.azhuilab.com/admin/` 会进入网页登录页；登录成功后 Cookie 有效 30 天，浏览器不会再反复弹出原生认证框。页面右上角提供“退出”，会立即撤销当前会话。`/admin/stats.json` 仍由同一会话保护，不能绕过页面直接公开访问。页面自身还带 `noindex` 与 `X-Robots-Tag`，但真正的访问边界仍以 Nginx `auth_request` 和服务端会话校验为准。

## 11. 两种产品、两条更新源

桌面 App 正在从 MOSA 改名为 GravityPort。过渡期里官网发布链路同时认两种产品，由环境变量 `MOSA_RELEASE_PRODUCT` 一次指定，**每次发布只能是一种产品**（不设该变量等价于 `MOSA`，行为与历史版本完全一致；设成其他值脚本直接报错退出）：

```bash
# MOSA（默认；旧源，过渡版发布后冻结）
./scripts/publish-desktop-release.sh --dry-run

# GravityPort（新源）
MOSA_RELEASE_PRODUCT=GravityPort MOSA_RELEASE_NOTES_ZH=… MOSA_RELEASE_NOTES_EN=… \
  ./scripts/publish-desktop-release.sh
```

两种产品各自读写的文件：

| | MOSA | GravityPort |
|---|---|---|
| 安装包文件名前缀 | `MOSA-darwin-arm64-<版本>.zip/.dmg`、`MOSA-win32-x64-<版本>.zip/.exe` | `GravityPort-darwin-arm64-<版本>.zip/.dmg`、`GravityPort-win32-x64-<版本>.zip/.exe` |
| 更新清单 | `releases/latest.json` | `releases/gravityport/latest.json` |
| 清单备份 | `releases/history/latest-<时间戳>.json` | `releases/gravityport/history/latest-<时间戳>.json` |
| 包内容校验 | `MOSA.app/Contents/MacOS/MOSA`、`MOSA.exe` | `GravityPort.app/Contents/MacOS/GravityPort`、`GravityPort.exe` |
| 旧包清理 | 只清理 `MOSA-…` 成对版本 | 只清理 `GravityPort-…` 成对版本 |
| 本机「上次发布」记录 | `~/.config/mosa/desktop-release-monitor.state` | `~/.config/mosa/desktop-release-monitor.gravityport.state` |

两条更新源是分开的两份文件，客户端查更新、下载、遥测都禁止跳转，所以新源必须在同一域名的最终路径上直接可访问。可选环境变量 `MOSA_RELEASE_MAC_TEAM_IDENTIFIER` 和 `MOSA_RELEASE_WINDOWS_SIGNER_THUMBPRINT` 会原样传给清单生成器（写入 `platforms.macos.teamIdentifier` / `platforms.windows.signerThumbprint`），不设就不传。

**旧源冻结**：过渡版发布之后，`releases/latest.json` 不再更新，它引用的 `MOSA-…` 安装包永远留在服务器上（发布 GravityPort 时的旧包清理不会碰它们，反之亦然）。

### 上线切换 GravityPort 当天要手动做的事（只列步骤，当天执行）

1. 服务器上创建目录：`install -d -m 0755 /var/www/mosa-website/releases/gravityport /var/www/mosa-website/releases/gravityport/history`（发布器也会自动建，但提前建好便于配 Nginx）。
2. Nginx 里凡是给 `/releases/latest.json` 单独配置过的规则（不缓存、`X-Robots-Tag`、匿名使用上报的精简 access log 格式等，见第 10 节），给 `/releases/gravityport/latest.json` 配一份同样的；改完执行 `nginx -t` 再 reload。
3. 把 `site-config.js` 的 `desktop.feedUrl` 切到 `./releases/gravityport/latest.json`，同时把 `mac` / `windows` 兜底直链换成 GravityPort 的真实包（这一步合进 main 即上线，会同时改变首页下载按钮的来源）。
4. `.github/workflows/deploy.yml` 里校验首页含「MOSA」字样的冒烟检查要跟着改名后的首页调整，否则部署会失败。
5. 用 `MOSA_RELEASE_PRODUCT=GravityPort … ./scripts/publish-desktop-release.sh --dry-run` 核对一遍生成的清单，再正式发布第一版。

## 12. 用户反馈收集服务

GravityPort 桌面版「设置 → 反馈」会把用户主动提交的反馈 POST 到官网 `POST /api/feedback`；服务端是 `scripts/feedback-service.mjs`（只监听 `127.0.0.1:39129`，反馈存为 `/var/lib/gravityport-feedback/` 下的 JSON 文件，不存 IP、不存安装 ID），后台在 `/admin/feedback.html` 查看（沿用统计后台的登录会话）。安装、Nginx 配置、自检和日常维护（看日志、删单条反馈、存储满了的处理）见 `ops/FEEDBACK.md`，Nginx 片段在 `ops/nginx-feedback.conf.example`，systemd 模板在 `ops/feedback-service.service.example`。隐私承诺见隐私政策「反馈」一节；对用户的承诺（不落盘 IP 等）与运维操作必须保持一致。
