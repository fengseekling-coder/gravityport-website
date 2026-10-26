# Pinterest 令牌转发服务运维说明

## 服务职责

这个服务只做一件事：转发 GravityPort 桌面应用的令牌请求到 Pinterest API，并附上 App Secret。

**服务器不保存任何令牌、授权码或用户数据。** 日志里只记录请求时间、grant 类型和结果状态码，不记录 code、access_token、refresh_token 或密钥。

## 安装步骤

服务器上的布局（和反馈、统计两个服务一致）：

| 东西 | 位置 |
|---|---|
| 密钥文件 | `/etc/gravityport/pinterest-app-secret`（`root:www-data 0640`，目录 0750） |
| 服务脚本 | `/usr/local/lib/gravityport-pinterest/pinterest-token.mjs`（root 自己的拷贝，部署账号改不了；**官网部署不会更新它**，脚本改了要重跑安装） |
| systemd | `/etc/systemd/system/pinterest-token.service`，以 `www-data` 运行，只监听 `127.0.0.1:39128` |
| Nginx 限流区 | `/etc/nginx/conf.d/gravityport-pinterest-token-zone.conf`（每 IP 每分钟 10 次） |
| Nginx location | `/etc/nginx/snippets/gravityport-pinterest-token.conf`，由 `sites-available/mosa.azhuilab.com.conf` 的 HTTPS server 块 include（这个块同时服务 `gravityport.azhuilab.com`） |

### 1. 写入 Pinterest App Secret（只能由操作的人自己粘贴）

**密钥从 Pinterest 开发者后台复制，不要贴到聊天、工单、日志或仓库里。** 以 root 登录服务器后运行下面这一条（`read -s` 不回显；`printf` 是 shell 内建命令，密钥不会出现在进程列表里）：

```bash
install -d -o root -g www-data -m 0750 /etc/gravityport && read -rsp "粘贴 Pinterest App Secret 后按回车（不会显示）: " S && echo && [ -n "$S" ] && (umask 027; printf '%s' "$S" > /etc/gravityport/pinterest-app-secret) && unset S && chown root:www-data /etc/gravityport/pinterest-app-secret && chmod 0640 /etc/gravityport/pinterest-app-secret && echo "已写入，$(wc -c < /etc/gravityport/pinterest-app-secret) 个字符"
```

换密钥（在 Pinterest 后台重置过）也是这一条，写完 `systemctl restart pinterest-token.service`。

### 2. 安装或更新服务和 Nginx

官网部署把最新的 `scripts/`、`ops/` 同步到 `/var/www/mosa-website/` 之后，以 root 运行：

```bash
MOSA_NODE_BIN=/opt/node-v22/bin/node bash /var/www/mosa-website/scripts/install-pinterest-token.sh
```

脚本会：把服务脚本复制成 root 的拷贝并打印 sha256（和仓库里的对一下）、按 `ops/pinterest-token.service.example` 生成 systemd 单元、写限流区和 location 片段、在站点配置里 feedback 那行 include 后面加一行 include（改的是 `sites-available` 里的真文件，不碰 `sites-enabled` 的软链接）、`nginx -t`（失败就把三个 Nginx 文件恢复原样并退出）、密钥文件在就启动服务并 reload Nginx。可以重复运行。

可用环境变量覆盖：`PINTEREST_CLIENT_ID`（默认 `1628239`）、`PINTEREST_TOKEN_PORT`（默认 `39128`）、`PINTEREST_ALLOWED_REDIRECTS`（默认 `http://localhost:43517/api/pinterest/callback`）。

### 3. 自检

用一个假的 `code` 调用，应返回 502 `pinterest_rejected`（说明服务在跑、读到了密钥、能连到 Pinterest）：

```bash
curl -s -w '\n%{http_code}\n' -X POST https://gravityport.azhuilab.com/api/pinterest/token \
  -H "Content-Type: application/json" \
  -d '{"grant":"authorization_code","code":"fake_code_for_test","redirect_uri":"http://localhost:43517/api/pinterest/callback"}'
```

预期输出 `{"error":"pinterest_rejected","status":4xx}` 和 `502`。

- 返回 `pinterest_unreachable` (504)：服务器连不上 `https://api.pinterest.com`。
- 返回 Nginx 的 502 页面：服务没在跑，看 `journalctl -u pinterest-token.service -n 50`。
- 返回 400 或 405：检查请求和 Nginx 片段。

再确认 GET 是 405、旧域名同样可用、Nginx 访问日志里没有这个路径：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://gravityport.azhuilab.com/api/pinterest/token
grep -c '/api/pinterest/token' /var/log/nginx/access.log
```

## 日常维护

查看日志：

```bash
journalctl -u pinterest-token.service -f
```

日志格式示例：

```
2026-10-14T12:34:56.789Z grant=authorization_code status=200
2026-10-14T12:35:01.234Z grant=refresh_token status=200
2026-10-14T12:35:15.678Z grant=authorization_code status=502
```

重启服务（密钥文件更新后需要重启）：

```bash
systemctl restart pinterest-token.service
```

## 故障排查

### 服务启动失败

检查日志：

```bash
journalctl -u pinterest-token.service -n 50
```

常见原因：

- 密钥文件不存在或为空：确认 `/etc/gravityport/pinterest-app-secret` 存在且有内容
- 密钥文件权限不对：`www-data` 用户需要读权限（文件 0640、目录 0750，都是 root:www-data）
- 端口被占用：检查 39128 端口是否被其他进程占用

### 客户端收到 502 或 504

- 502 pinterest_rejected：Pinterest 拒绝了请求（code 无效、已使用、密钥错误等），这是正常的业务错误
- 504 pinterest_unreachable：服务器无法连接 Pinterest API，检查网络和防火墙

### 客户端收到 400

- `invalid_redirect_uri`：`redirect_uri` 不在白名单里，检查 systemd 服务文件的 `PINTEREST_ALLOWED_REDIRECTS`
- 其他 400：请求格式错误，检查客户端代码

### 客户端收到 429

触发了限流（每 IP 每分钟 10 次），检查是否有异常流量。

## 安全说明

- 服务只监听 `127.0.0.1`，不对外暴露
- 通过 Nginx 转发，有限流保护
- 日志不记录任何敏感信息（code、token、密钥）
- 该 location 的访问日志和错误日志都关了（`access_log off`、`error_log /dev/null crit`）
- systemd 服务以 `www-data` 用户运行，有多层沙箱限制（NoNewPrivileges、ProtectSystem 等）
- 密钥文件只有 root 和 www-data 可读
- 服务跑的是 root 拥有的脚本拷贝，不是 `/var/www/mosa-website/scripts/` 里部署账号能改的那份，部署账号出事也拿不到密钥
