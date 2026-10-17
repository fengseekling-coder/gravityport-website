# GravityPort 反馈收集服务运维说明

## 服务职责

这个服务接收 GravityPort 桌面应用「设置 → 反馈」提交的用户反馈，校验后存成 JSON 文件，供开发者登录官网后台后在 `/admin/feedback.html` 查看。

**隐私边界（对用户承诺过，运维时也要遵守）：**

- 服务器只保存用户主动提交的内容：反馈正文、可选联系方式、App 版本 / 系统 / 芯片类型 / 界面语言、用户勾选时的诊断日志。
- 不保存安装 ID、素材、提示词、素材库位置。
- **IP 地址不落盘、不进日志**：只在内存里做当天防刷计数（每 IP 每天默认 20 条），定时清理。
- 服务日志（stdout）每请求一行：时间、方法、路径、状态码、请求体字节数，没有内容。
- 存储目录 `/var/lib/gravityport-feedback`（0700）在 Web 根目录之外，Nginx 不提供静态访问；后台接口靠 `auth_request` 会话挡住。

## 安装步骤

### 1. 创建存储目录

```bash
sudo install -d -o www-data -g www-data -m 0700 /var/lib/gravityport-feedback
```

验证：

```bash
ls -ld /var/lib/gravityport-feedback
# 应显示：drwx------ 2 www-data www-data … /var/lib/gravityport-feedback
```

### 2. 安装 systemd 服务

编辑 `ops/feedback-service.service.example`，替换占位符：

- `__MOSA_NODE_BIN__`：Node.js 可执行文件路径（例如 `/usr/bin/node`）
- `__MOSA_SITE_ROOT__`：官网仓库根目录（例如 `/var/www/mosa-website`）
- `__GRAVITYPORT_FEEDBACK_PORT__`：监听端口（默认 `39129`）
- `__GRAVITYPORT_FEEDBACK_MAX_FILES__`：最多存多少条反馈（默认 `10000`）
- `__GRAVITYPORT_FEEDBACK_MAX_TOTAL_BYTES__`：存储总字节上限（默认 `1073741824`，即 1 GB）
- `__GRAVITYPORT_FEEDBACK_PER_IP_DAILY__`：每 IP 每天最多提交次数（默认 `20`）

然后安装并启动：

```bash
sudo cp ops/feedback-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now feedback-service.service
```

检查状态：

```bash
sudo systemctl status feedback-service.service
```

### 3. 配置 Nginx

**第一步**：在 Nginx 的 `http {}` 块里（通常在 `/etc/nginx/nginx.conf` 或 `/etc/nginx/conf.d/rate-limit.conf`）添加限流区：

```nginx
limit_req_zone $binary_remote_addr zone=gravityport_feedback:1m rate=5r/m;
```

**第二步**：在官网 HTTPS `server {}` 块里，添加 `ops/nginx-feedback.conf.example` 的内容（三个 location：`/api/feedback`、`/admin/feedback.json`、`/admin/feedback-item.json`）。反馈 API 继续保留在 `mosa.azhuilab.com`，兼容已经发布的桌面版；官方后台从 `https://gravityport.azhuilab.com/admin/` 访问。

测试配置：

```bash
sudo nginx -t
```

如果显示 `syntax is ok` 和 `test is successful`，重新加载：

```bash
sudo systemctl reload nginx
```

### 4. 自检

**发一条合格的测试反馈**（应返回 `201` 和一个 `id`）：

```bash
curl -i -X POST https://mosa.azhuilab.com/api/feedback \
  -H "Content-Type: application/json" \
  -H "X-GravityPort-Client: desktop" \
  -d '{"schema":1,"kind":"other","message":"部署自检测试反馈，可删除","locale":"zh","app":{"product":"GravityPort","version":"selftest","platform":"other","osVersion":"selftest","arch":"x64"}}'
```

**发一条不合格的**（缺客户端请求头，应返回 `400` 和 `"field":"headers"`）：

```bash
curl -i -X POST https://mosa.azhuilab.com/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"schema":1,"kind":"other","message":"bad","locale":"zh","app":{"product":"GravityPort","version":"selftest","platform":"other","osVersion":"selftest","arch":"x64"}}'
```

**去后台看**：浏览器打开 `https://gravityport.azhuilab.com/admin/`，登录后点头部「反馈」链接（或直接访问 `/admin/feedback.html`），应能看到「部署自检测试反馈」这一条。点「查看诊断日志」的入口只在有日志的条目上出现，测试这条没有。

**删掉测试文件**（把 `<YYYY-MM>` 和 `<id>` 换成上一步 201 返回的 id：前 4 位-再 2 位是月份目录）：

```bash
sudo rm /var/lib/gravityport-feedback/<YYYY-MM>/<id>.json
```

删完刷新后台页面，确认那条消失了。数据文件没有索引，删除即时生效，不需要重启服务。

## 日常维护

### 看服务日志

```bash
sudo journalctl -u feedback-service.service -f
```

日志格式示例（没有 IP、没有内容）：

```
2026-10-16T08:15:02.123Z POST /api/feedback 201 1856
2026-10-16T08:15:41.000Z POST /api/feedback 400 0
2026-10-16T08:16:10.500Z GET /admin/feedback.json 200 0
```

### 删除某条反馈

先在后台页面找到那条反馈，复制它的 id（列表每条都显示），然后：

```bash
ID=<粘贴反馈的id>
sudo rm "/var/lib/gravityport-feedback/${ID:0:4}-${ID:4:2}/${ID}.json"
```

用户来信要求删除自己的反馈时：让用户写出大致发送时间，在后台按时间找到对应条目（列表按时间倒序），删文件即可。Nginx 的访问日志和错误日志都不记反馈接口（`access_log off`、`error_log /dev/null crit`），无法也没有必要反查 IP。服务连不上时，到服务自己的日志里查（见上文「看服务日志」）。

### 存满了怎么办

服务返回 `503 {"code":"FEEDBACK_UNAVAILABLE"}` 且日志出现 `POST /api/feedback 503` 时，说明达到了条数上限（默认 10000 条）或总字节上限（默认 1 GB）。处理办法：

```bash
# 看一下现状：条数和占用
sudo find /var/lib/gravityport-feedback -name '*.json' | wc -l
sudo du -sh /var/lib/gravityport-feedback
```

- **清理旧的**：把处理过的旧反馈按上面「删除某条反馈」的方式删掉即可，服务内存里的计数是增量的——**删文件后需要重启服务让它重新扫描**：
  ```bash
  sudo systemctl restart feedback-service.service
  ```
- **调大上限**：改 `/etc/systemd/system/feedback-service.service` 里的 `GRAVITYPORT_FEEDBACK_MAX_FILES` / `GRAVITYPORT_FEEDBACK_MAX_TOTAL_BYTES`，然后：
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl restart feedback-service.service
  ```

### 备份与导出

反馈就是普通 JSON 文件，按月放在 `/var/lib/gravityport-feedback/<YYYY-MM>/` 下，直接 `scp` / `rsync` 拉回本机即可。注意里面可能有用户的联系方式和诊断日志，不要放到 Web 根目录。

## 故障排查

### 服务起不来

```bash
sudo journalctl -u feedback-service.service -n 50
```

常见原因：

- 存储目录不存在或属主不对：确认 `/var/lib/gravityport-feedback` 存在且属于 `www-data`（0700）
- 端口被占用：`sudo ss -ltnp | grep 39129`
- 仓库路径或 Node 路径占位符没替换

### App 端收到 502 / 504

feedback-service 没在跑：`sudo systemctl status feedback-service.service`，必要时 `sudo systemctl restart feedback-service.service`。

### App 端收到 429

触发了限流。两层限流都会返回 429：Nginx（每 IP 每分钟 5 个、burst 3）和服务（每 IP 每天 20 条）。正常用户几乎不可能触发；连续出现时在服务器上排查异常流量。

### 后台列表打不开（401 / 跳登录页）

`/admin/feedback.json` 和 `/admin/feedback-item.json` 走 `auth_request` 会话，和统计后台同一套登录。先登录 `/admin/`；如果登录后仍 401，检查 Nginx 里 `/_mosa_admin_auth` 那段配置是否还在。

## 安全说明

- 服务只监听 `127.0.0.1`，不对外暴露
- 反馈数据在 Web 根目录之外，Nginx 无静态路由指向它
- 后台接口由 `auth_request` + 登录会话保护，页面自身带 `noindex` 和 `X-Robots-Tag`
- systemd 服务以 `www-data` 运行，`ProtectSystem=strict` + `ReadWritePaths` 只开放存储目录，`NoNewPrivileges` 等沙箱项齐全
- 所有响应带 `Cache-Control: no-store`
