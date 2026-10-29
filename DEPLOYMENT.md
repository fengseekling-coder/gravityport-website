# GravityPort 官网部署说明

旧服务器已于 2026-10-29 停用，官网、下载、软件内更新和反馈全部在 Cloudflare 上。本文只讲现在的结构和日常操作。

## 1. 结构总表

| 地址 | 由谁供应 | 说明 |
| --- | --- | --- |
| `gravityport.azhuilab.com` 的官网页面 | Cloudflare Pages 项目 `gravityport-site` | `pages/build.mjs` 按白名单打包，合并到 `main` 后由 Actions 部署 |
| `/releases/*`、`/downloads/*`（两个域名） | Worker `gp-edge`（`workers/edge/`） | 读 R2 桶 `gravityport-releases`；下载和访问计数写 D1 `gp-stats` |
| `/api/*`（两个域名） | Worker `gp-api`（`workers/api/`） | 反馈 `/api/feedback`，Pinterest 中转；反馈存 D1 `gp-feedback` |
| `mosa.azhuilab.com` 的其余路径 | Worker `gp-edge` | 旧域名首页显示域名迁移说明 |
| `mosa.azhuilab.com/admin/*` 后台 | Worker `gp-edge` 加 Cloudflare Access | Access 只放开发者本人邮箱；反馈接口 `/admin/feedback*.json` 由 `gp-api` 处理，同样套 Access |
| 桌面包和更新清单 | R2 桶 `gravityport-releases` | `downloads/` 放安装包，`releases/gravityport/latest.json` 是更新清单 |

## 2. 改官网文字、样式或脚本

1. 改仓库根目录下的文件，开 PR，合并到 `main`。Actions 会自动部署到 Pages。
2. 新增根目录文件或目录时，必须在 `pages/build.mjs` 的白名单（公开）或不发布名单（仓库内）里登记。登记不了的根目录条目会让打包失败。
3. 响应头（包括 CSP）写在 `pages/_headers`。官网有 CSP，不要写内联脚本和内联样式。
4. 本仓库是公开的，合并即上线。提交内容按公开对待。
5. 测试：`npm test --prefix pages`。

## 3. 改 Worker（gp-edge、gp-api）

Worker 不随 Actions 部署。合并后要手动部署，令牌只放在本机环境变量 `CLOUDFLARE_API_TOKEN` 里，不写进仓库。

```bash
cd workers/edge
npm ci
npm run build:assets
npx wrangler deploy
```

```bash
cd workers/api
npm ci
npx wrangler deploy
```

- `gp-api` 的 Pinterest App Secret 用 `npx wrangler secret put PINTEREST_APP_SECRET` 设置，不进仓库。
- `wrangler.toml` 的 `[vars]` 里有 Access 的两项配置（团队域名和应用受众），任一为空时后台会拒绝所有请求，这是有意设计，不要留空。
- 测试：`npm test --prefix workers/edge`、`npm test --prefix workers/api`。

## 4. 发桌面版

发版脚本是 `scripts/publish-desktop-release.sh`，只发布到 R2。

- 本机监控由 `scripts/install-release-monitor.sh` 安装（launchd）。它读取本机的 `~/.config/mosa/release.env`，这个文件不进仓库。
- R2 相关配置：`MOSA_RELEASE_TARGETS` 不设或设为 `r2`；`MOSA_RELEASE_R2_ENDPOINT`、`MOSA_RELEASE_R2_BUCKET`（默认 `gravityport-releases`）、`MOSA_RELEASE_R2_ACCESS_KEY_ID`。密钥从 `MOSA_RELEASE_R2_SECRET_ACCESS_KEY` 或钥匙串条目 `gravityport-r2-release` 读取。`MOSA_RELEASE_TARGETS` 设成其他值会直接报错，因为旧服务器已停用。
- 产品：`MOSA_RELEASE_PRODUCT=GravityPort`（不设也是 GravityPort）。`MOSA` 是冻结的旧更新源，不再发布。
- 新版本必须带发版说明：`MOSA_RELEASE_NOTES_ZH` 和 `MOSA_RELEASE_NOTES_EN` 都要有内容，缺一个就直接失败。同版本重跑是空操作，降级会被跳过。
- 只校验不上传：`scripts/publish-desktop-release.sh --dry-run`。

发布顺序：先把安装包传到 R2 并核对大小，再确认清单里引用的文件都已存在，然后把旧清单备份到 `releases/gravityport/history/`，最后替换 `releases/gravityport/latest.json`。R2 上只保留最新四个完整的桌面版本，扩展包和不成对的文件不会被清理。

浏览器扩展包（`downloads/GravityPort-Web-Capture-*.zip`）随仓库提交。Actions 的 “Sync extension packages to R2” 步骤把它们同步到 R2，只增不删。

## 5. 统计和反馈

- 统计：D1 `gp-stats`，记录安装、日活、下载和网页访问计数。`gp-edge` 每天 UTC 11:17 运行一次维护任务。
- 反馈：D1 `gp-feedback`（表 `feedback`），由 `gp-api` 写入，不保存连接 IP。
- 删除单条反馈（不可恢复，先确认 `id`）：

```bash
cd workers/api
npx wrangler d1 execute gp-feedback --remote --command "DELETE FROM feedback WHERE id = '替换为目标 id'"
```

- 后台：`https://mosa.azhuilab.com/admin/` 由 Cloudflare Access 放行，只允许开发者本人邮箱。反馈页是 `/admin/feedback.html`。后台只读，接口只接受 GET。

## 6. 回退

- 官网：在 Cloudflare 后台打开 Pages 项目 `gravityport-site`，回滚到上一次部署。也可以 revert 那次提交再合并。
- 更新清单：在 R2 的 `releases/gravityport/history/` 里找到要恢复的备份，再把它写回 `releases/gravityport/latest.json`：

```bash
npx wrangler r2 object put gravityport-releases/releases/gravityport/latest.json --file 备份文件路径 --remote
```

- Worker：在对应目录下用 `npx wrangler rollback` 回到上一版本。
