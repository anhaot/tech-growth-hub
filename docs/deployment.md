# 部署说明

公开部署支持两条路径：从源码构建 Docker Compose 服务，或构建 API / Web 产物后用 Node.js 和 Nginx 运行。API 产物是 JavaScript 与生产依赖，Web 产物是静态文件；产物部署仍需 Node.js 22，包含 SQLite 原生模块的依赖还须匹配构建平台。

## 1. Docker Compose 源码部署

准备 Docker Engine、Docker Compose 插件、Git 和 OpenSSL。首次构建需要联网下载基础镜像及 npm 依赖；服务器需要能够访问 Docker Hub 和 npm registry。

```bash
git clone https://github.com/anhaot/tech-growth-hub.git
cd tech-growth-hub
cp .env.example .env
```

以上复制仅用于首次安装。升级时保留原 `.env`。分别生成四个独立随机值，填写 `JWT_SECRET`、`AI_CONFIG_ENCRYPTION_KEY`、`MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`：

```bash
openssl rand -hex 32
```

每个变量单独执行一次。加密密钥须为 64 位十六进制字符；JWT 密钥至少 32 个字符。替换所有必填占位符，再配置：

| 变量 | 用途 |
| --- | --- |
| `APP_VERSION` | 本次本地构建的镜像标签，例如 `v261014-1`；后续构建使用新标签 |
| `WEB_PORT` | Web 对外端口，默认 `10089`；端口被占用时可修改 |
| `ALLOWED_ORIGINS` | 浏览器实际访问来源，包含协议、域名或 IP、非默认端口；多个来源以逗号分隔 |
| `AUTH_COOKIE_SECURE` | 默认 `auto`，按 HTTPS / HTTP 设置 Cookie；`true` 要求通过 HTTPS 登录 |
| `JWT_EXPIRES_IN` | 默认 `7d`；支持 `1m` 至 `365d`，或 `forever`；站内登录有效期设置优先 |
| `MYSQL_USER` / `MYSQL_DATABASE` | 应用数据库账号和库名，默认 `tech_growth_hub` |
| `INIT_ADMIN_*` | 首次创建管理员的账号、邮箱和密码；已有同名账号不会被重置 |
| `AI_ENABLED` | 未设置站内开关时的默认 AI 开关；凭据可在网页中添加 |

例如通过 `http://服务器IP:10089` 访问时，将 `ALLOWED_ORIGINS` 改为该地址。使用域名 HTTPS 时填 `https://study.example.com`；修改 `WEB_PORT` 后也要同步端口来源配置。

```bash
docker compose config --quiet
docker compose build api web
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:10089/api/health/ready
```

若修改了端口，将 `curl` 中的 `10089` 一并替换。就绪检查返回 `{"status":"ready",...}`；默认管理员为 `admin / admin`，首次登录必须修改密码。也可在首次初始化前设置自己的管理员密码。

Compose 默认使用 MariaDB 12.3.2，API 和数据库只在项目网络内访问，Web 将 `/api` 转发给 API。`compose.yaml` 的项目名为 `tech-growth-hub`，服务通过 `api`、`db` 名称互通，无需固定容器 IP。

该 Compose 同时定义 MariaDB 服务、数据库密码和启动依赖；把 `DATABASE_TYPE` 改成 `sqlite` 不会取消数据库容器。轻量 SQLite 运行可采用下文的产物部署或本地开发方式。

## 2. Docker 数据与 HTTPS

### 持久化

- `app-data` 卷挂载到 API 的 `/app/data`，保存 SQLite 文件和站内数据库连接配置。
- `db-data` 卷挂载到 MariaDB 的 `/var/lib/mysql`，保存正式题库与账号等数据。
- 相同 Compose 项目名会继续使用原卷。保持原部署目录和项目名；不要用新的空卷替代旧卷。
- `docker compose down` 保留命名卷；`docker compose down -v` 会删除数据卷，不能用于日常升级。

API 使用 `node` 用户，UID/GID 为 `1000:1000`。命名卷会按镜像目录权限初始化；改用宿主机目录绑定时，先创建目录并让该用户可读写。仅调整 API 的应用数据目录，不要对 MariaDB 目录套用 API 的 UID。已有 `database-runtime.json` 若选择了站内连接，其配置优先于环境变量；切换数据库后需核对当前实际连接。

旧数据目录中的数据库密码不会因修改 `.env` 自动更新，详见 [MariaDB 初始化变量说明](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/mariadb-server-docker-official-image-environment-variables)。升级保持 JWT、AI 加密密钥及数据库凭据不变。

### HTTPS 反向代理

把域名指向服务器，并在外层 Nginx 或其他网关配置有效证书。以下是 Nginx 示例，替换域名、证书路径和 Web 端口：

```nginx
server {
    listen 443 ssl;
    server_name study.example.com;
    ssl_certificate /etc/nginx/certs/study/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/study/privkey.pem;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:10089;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout 200s;
        proxy_send_timeout 200s;
    }
}
```

外层代理必须覆盖并转发 `X-Forwarded-Proto`，API 默认信任紧邻的 Web 代理。修改 `.env` 为 `ALLOWED_ORIGINS=https://study.example.com` 后，用 `docker compose up -d api` 重建 API 容器，再检查登录、Cookie 和 AI 调用。不要只执行 `restart` 来应用新的环境变量。

PWA 安装、Service Worker 和离线页面在 HTTPS 或浏览器认可的 localhost 安全上下文中工作；通过普通远程 HTTP IP 访问时，浏览器可能不启用这些能力。

## 3. 编译产物部署（Node.js + Nginx）

### 构建产物

在与目标服务器相同的操作系统 / libc、CPU 架构和 Node.js 主版本上构建。建议 Node.js 22.13.0 或更新的 22.x、npm 10+。SQLite 依赖包含原生模块，不要把 Alpine 容器依赖直接复制到普通 Linux 服务器，或跨架构复用 `node_modules`。

在源码根目录执行：

```bash
cd api
npm ci
npm run build
npm prune --omit=dev
cd ../web
npm ci
npm run build
cd ..
tar -czf tech-growth-hub-v261014-1-linux-amd64.tar.gz \
  LICENSE api/dist api/node_modules api/package.json api/package-lock.json \
  api/.env.example web/dist
```

文件名应匹配自己的版本和构建架构。产物不包含真实 `.env`、数据库或用户数据。恢复开发环境时在 `api/` 重新运行 `npm ci`，因为 `prune` 已移除开发依赖。

### 安装和配置

目标服务器安装相同主版本的 Node.js、Nginx、OpenSSL。以下以 Linux / systemd 为例，先解压到 `/opt/tech-growth-hub`：

```bash
sudo mkdir -p /opt/tech-growth-hub
sudo tar -xzf tech-growth-hub-v261014-1-linux-amd64.tar.gz -C /opt/tech-growth-hub
sudo useradd --system --home-dir /opt/tech-growth-hub --shell /usr/sbin/nologin tech-growth-hub
sudo install -d -o tech-growth-hub -g tech-growth-hub /opt/tech-growth-hub/api/data /opt/tech-growth-hub/api/uploads
sudo install -d -m 750 -o root -g tech-growth-hub /etc/tech-growth-hub
sudo cp /opt/tech-growth-hub/api/.env.example /etc/tech-growth-hub/api.env
sudo chown root:tech-growth-hub /etc/tech-growth-hub/api.env
sudo chmod 640 /etc/tech-growth-hub/api.env
sudoedit /etc/tech-growth-hub/api.env
```

账号已存在时跳过 `useradd`。将配置中的 `NODE_ENV` 改为 `production`，分别生成并填写 `JWT_SECRET` 和 `AI_CONFIG_ENCRYPTION_KEY`，填写实际 `ALLOWED_ORIGINS`，并设置 `TRUST_PROXY=1`。轻量单机使用：

```env
PORT=3001
NODE_ENV=production
TRUST_PROXY=1
DATABASE_TYPE=sqlite
SQLITE_PATH=/opt/tech-growth-hub/api/data/tech-growth-hub.db
ALLOWED_ORIGINS=http://study.example.com
AUTH_COOKIE_SECURE=auto
```

JWT 与加密密钥从前面的配置文件填写，这段示例不替代它们。首次管理员账号来自 `INIT_ADMIN_*`。使用 MySQL 时改为 `DATABASE_TYPE=mysql`，填写服务器可访问的 `MYSQL_HOST`、端口、账号、密码及库名，先创建数据库并授予应用用户该库的读写与表结构更新权限。

API 端口默认监听所有网卡；通过防火墙或安全组限制 `3001` 的外部访问，只公开 Nginx 服务端口。

### systemd 服务

先执行 `command -v node`，将下面 `ExecStart` 中的 `/usr/bin/node` 替换为实际可供服务账号执行的 Node.js 绝对路径。把文件保存为 `/etc/systemd/system/tech-growth-hub.service`：

```ini
[Unit]
Description=Tech Growth Hub API
After=network.target

[Service]
Type=simple
User=tech-growth-hub
Group=tech-growth-hub
WorkingDirectory=/opt/tech-growth-hub/api
EnvironmentFile=/etc/tech-growth-hub/api.env
ExecStart=/usr/bin/node /opt/tech-growth-hub/api/dist/index.js
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tech-growth-hub
sudo systemctl status tech-growth-hub
curl --fail http://127.0.0.1:3001/api/health/ready
```

### Nginx 静态站点与 API

将以下配置加入 Nginx，域名替换为自己的地址。Docker 内置 `web/nginx.conf` 使用 Compose 服务名，产物部署使用下面的本机 API 地址：

```nginx
server {
    listen 80;
    server_name study.example.com;
    root /opt/tech-growth-hub/web/dist;
    index index.html;
    client_max_body_size 12m;

    location = /index.html { add_header Cache-Control "no-cache"; }
    location = /sw.js { add_header Cache-Control "no-cache"; try_files $uri =404; }
    location /assets/ { expires 1y; try_files $uri =404; }
    location / { try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 200s;
        proxy_send_timeout 200s;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

访问自己的域名，检查首次改密和题库操作。启用 HTTPS 时添加证书与 `listen 443 ssl`，同步修改 `ALLOWED_ORIGINS` 并重启 API 服务。不要把 Vite `preview` 当作正式静态站点服务。

## 4. 升级、备份和回滚

### Docker 升级

升级前记录当前 Git 提交、`APP_VERSION`、Compose 项目名，并保存环境、数据库和 `/app/data`。下面针对仓库默认 Compose，短暂停止应用写入后备份：

```bash
umask 077
mkdir -p backups
git rev-parse HEAD > backups/source-revision.txt
cp .env backups/deploy.env
cp compose.yaml backups/compose.yaml
docker compose stop api web
docker compose exec -T db sh -c 'exec mariadb-dump -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" --single-transaction "$MARIADB_DATABASE"' > backups/database.sql
docker compose cp --archive api:/app/data backups/app-data
docker compose start api web
```

仅在备份成功后继续。`backups/` 已被 Git 忽略，仍应把备份与密钥分别妥善保存到仓库之外。也可以先在设置页导出管理员完整备份，但它不包含宿主机环境文件和站内连接配置文件。

```bash
git pull --ff-only
# 编辑 .env：保持原密钥和数据库密码，只更新 APP_VERSION 等需要变化的值
docker compose config --quiet
docker compose up -d --build api web
docker compose ps
curl --fail http://127.0.0.1:10089/api/health/ready
```

按实际端口调整验证命令。检查登录、题目数量、分类、版本历史和 AI 配置。API 启动会补齐数据库表结构，应用数据库用户须有对应 DDL 权限；大库升级可能需要更长启动时间。

升级失败时先停止 API / Web 写入，切回记录的 Git 提交与原 `.env`、Compose，再恢复升级前数据库和应用配置。默认数据库恢复命令：

```bash
docker compose stop api web
docker compose exec -T db sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' < backups/database.sql
docker compose cp --archive backups/app-data/. api:/app/data
```

恢复前确认当前项目、容器和卷是原部署的资源。恢复配置文件后，使用原版本重新构建并启动 API / Web，再检查就绪状态。仅把镜像切回旧标签不能完整撤销数据库结构或数据变化；保留升级前完整备份。

### 产物部署升级

保留上一版产物包、`/etc/tech-growth-hub/api.env`、`api/data` 和数据库备份。在替换文件前停止 `tech-growth-hub` 服务，分别更新 `api/dist`、完整的 `api/node_modules` 和 `web/dist`，避免混用新旧依赖或静态文件；不覆盖环境和数据目录。重新启动 API、检查就绪状态、刷新网页。回滚时恢复上一版产物及与其一致的数据库 / 应用数据，再启动服务。

## 5. 本地开发与排障

本地开发见 [开发指南](development.md)。API 示例默认使用 SQLite；复制 `api/.env.example` 后须替换 JWT 与加密密钥占位符。Web 开发端口 `3000`，API `3001`，Vite 已配置 `/api` 代理。

- `/api/health` 与 `/api/health/live` 只检查进程存活；`/api/health/ready` 检查数据库就绪。
- Docker 日志：`docker compose logs --tail 200 api db web`。
- 产物服务日志：`sudo journalctl -u tech-growth-hub -n 200 --no-pager`。
- AI 超时检查模型权限、服务器出口和全部代理的 200 秒等待上限；凭据在设置中添加。
- 改密撤销旧登录；更换 JWT 密钥撤销全部旧令牌；丢失 AI 加密密钥会导致已有加密凭据无法解密。
- MariaDB `create_uring failed` 后正常就绪时属于 I/O 降级；认证失败优先核对旧数据中的账号密码与当前配置。
- 前端旧资源先核对新产物是否已部署，再强制刷新；PWA 可关闭全部页面后重新打开。

环境变量来源与自定义配置文件用法见 [Docker Compose 变量插值](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。使用不同名称的环境文件时，为相关 Compose 命令显式传入 `--env-file 路径`；容器的 `env_file` 与 Compose 插值文件用途不同。
