# Pinterest 令牌转发服务运维说明

## 服务职责

这个服务只做一件事：转发 GravityPort 桌面应用的令牌请求到 Pinterest API，并附上 App Secret。

**服务器不保存任何令牌、授权码或用户数据。** 日志里只记录请求时间、grant 类型和结果状态码，不记录 code、access_token、refresh_token 或密钥。

## 安装步骤

### 1. 创建密钥文件目录

```bash
sudo mkdir -p /etc/gravityport
sudo chown root:www-data /etc/gravityport
sudo chmod 750 /etc/gravityport
```

### 2. 写入 Pinterest App Secret

**重要：密钥从 Pinterest 开发者后台复制，不要贴到聊天里或任何日志里。**

运行以下命令，按提示粘贴密钥（终端不会显示输入内容）：

```bash
echo "请粘贴 Pinterest App Secret，然后按回车："
read -rs PINTEREST_SECRET
echo -n "$PINTEREST_SECRET" | sudo tee /etc/gravityport/pinterest-app-secret > /dev/null
sudo chown root:www-data /etc/gravityport/pinterest-app-secret
sudo chmod 640 /etc/gravityport/pinterest-app-secret
unset PINTEREST_SECRET
echo "密钥已写入"
```

验证文件权限和所有者：

```bash
ls -la /etc/gravityport/pinterest-app-secret
# 应显示：-rw-r----- 1 root www-data <size> <date> pinterest-app-secret
```

### 3. 安装 systemd 服务

编辑 `ops/pinterest-token.service.example`，替换占位符：

- `__MOSA_NODE_BIN__`：Node.js 可执行文件路径（例如 `/usr/bin/node`）
- `__MOSA_SITE_ROOT__`：官网仓库根目录（例如 `/var/www/mosa.azhuilab.com`）
- `__PINTEREST_CLIENT_ID__`：Pinterest 应用 ID（默认 `1624448`）
- `__PINTEREST_TOKEN_PORT__`：服务监听端口（默认 `39128`）
- `__PINTEREST_ALLOWED_REDIRECTS__`：允许的回调地址（默认 `http://localhost:43517/api/pinterest/callback`）

然后安装：

```bash
sudo cp ops/pinterest-token.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pinterest-token.service
sudo systemctl start pinterest-token.service
```

检查状态：

```bash
sudo systemctl status pinterest-token.service
```

### 4. 配置 Nginx

**第一步**：在 Nginx 的 `http {}` 块里（通常在 `/etc/nginx/nginx.conf` 或 `/etc/nginx/conf.d/rate-limit.conf`）添加限流区：

```nginx
limit_req_zone $binary_remote_addr zone=pinterest_token:1m rate=10r/m;
```

**第二步**：在 `mosa.azhuilab.com` 的 HTTPS `server {}` 块里，添加 `ops/nginx-pinterest-token.conf.example` 的内容。

测试配置：

```bash
sudo nginx -t
```

如果显示 `syntax is ok` 和 `test is successful`，重新加载：

```bash
sudo systemctl reload nginx
```

### 5. 自检

用一个假的 `code` 调用服务，应该返回 502 pinterest_rejected（说明服务能连到 Pinterest，且密钥被正确读取）：

```bash
curl -X POST https://mosa.azhuilab.com/api/pinterest/token \
  -H "Content-Type: application/json" \
  -d '{"grant":"authorization_code","code":"fake_code_for_test","redirect_uri":"http://localhost:43517/api/pinterest/callback"}'
```

预期输出：

```json
{"error":"pinterest_rejected","status":401}
```

或者 Pinterest 返回的其他错误状态码。

如果返回 `pinterest_unreachable` (504)，检查服务器能否访问 `https://api.pinterest.com`。

如果返回 400 或 405，检查 Nginx 配置是否正确。

## 日常维护

查看日志：

```bash
sudo journalctl -u pinterest-token.service -f
```

日志格式示例：

```
2026-10-14T12:34:56.789Z grant=authorization_code status=200
2026-10-14T12:35:01.234Z grant=refresh_token status=200
2026-10-14T12:35:15.678Z grant=authorization_code status=502
```

重启服务（密钥文件更新后需要重启）：

```bash
sudo systemctl restart pinterest-token.service
```

## 故障排查

### 服务启动失败

检查日志：

```bash
sudo journalctl -u pinterest-token.service -n 50
```

常见原因：

- 密钥文件不存在或为空：确认 `/etc/gravityport/pinterest-app-secret` 存在且有内容
- 密钥文件权限不对：`www-data` 用户需要读权限（640，root:www-data）
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
- 该 location 的访问日志已关闭（`access_log off`）
- systemd 服务以 `www-data` 用户运行，有多层沙箱限制（NoNewPrivileges、ProtectSystem 等）
- 密钥文件只有 root 和 www-data 可读
