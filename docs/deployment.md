# 部署说明

当前工作区部署详情见 [2026-10-08 部署记录](deployment-2026-10-08.md)。

## 1. 运行方式

项目支持两种主要运行方式：

- Docker / Docker Compose
- 本地前后端分别启动

推荐正式环境优先使用 Docker Compose。

---

## 2. Docker 部署

### 镜像版本

项目不使用 `latest` 作为应用镜像版本。`APP_VERSION` 使用 `vYYMMDD-N` 格式，同一天重复构建时递增末尾序号，例如：

```env
APP_VERSION=v260805-1
```

Compose 会把 API 和 Web 构建为相同版本；未设置 `APP_VERSION` 时会直接报错，避免误用浮动标签。

### 启动

```bash
cp .env.example .env
openssl rand -hex 32  # 为 JWT、AI 加密、数据库用户和 root 分别生成不同的值
docker compose up -d --build
```

默认服务：

- 前端：`http://127.0.0.1:10089`
- 健康检查：`http://127.0.0.1:10089/api/health`
- 默认管理员：`admin` / `admin`（首次登录必须修改密码）

### 查看状态

```bash
docker compose ps
docker compose logs api
docker compose logs web
```

### 重建服务

```bash
docker compose up -d --build api web
```

只重建后端：

```bash
docker compose up -d --build api
```

只重建前端：

```bash
docker compose up -d --build web
```

---

## 3. 本地开发

### 后端

```bash
cd api
cp .env.example .env
# 最简单的本地方案：在 .env 中设置 DATABASE_TYPE=sqlite
npm ci
npm run dev
```

### 前端

```bash
cd web
npm ci
npm run dev
```

默认开发地址为 Web `http://127.0.0.1:3000`、API `http://127.0.0.1:3001`。Vite 会把 `/api` 请求代理到 API。

---

## 4. 环境变量

常用变量：

```env
PORT=3001
NODE_ENV=production

JWT_SECRET=your-super-secret-jwt-key-change-in-production
AI_CONFIG_ENCRYPTION_KEY=replace-with-output-of-openssl-rand-hex-32
JWT_EXPIRES_IN=7d

DATABASE_TYPE=mysql
MYSQL_HOST=db
MYSQL_PORT=3306
MYSQL_USER=tech_growth_hub
MYSQL_PASSWORD=replace-with-a-random-database-password
MYSQL_ROOT_PASSWORD=replace-with-a-different-random-root-password
MYSQL_DATABASE=tech_growth_hub

AI_ENABLED=true
DEFAULT_AI_PROVIDER=deepseek
AUTH_COOKIE_SECURE=auto
```

`JWT_EXPIRES_IN` 是未设置站内登录有效期时的默认值；源码部署和发布镜像部署都会传入该变量。支持 `1m`、`12h`、`30d` 等正整数加单位（`s/m/h/d`），范围 1 分钟至 365 天；`forever` 表示不设置 JWT 过期时间。非法环境变量会阻止服务启动。

`设置 → 系统管理 → 登录有效期` 保存的设置优先于环境变量，并存入数据库及完整备份。保存时更新当前登录；其他已有登录维持签发时的期限，下次登录采用新设置。只修改 `.env` 需要重建容器环境并重新登录才能改变现有登录期限。

无限期 JWT 配合可续期的 400 天 Cookie；每次认证请求都会续期 Cookie，浏览器仍可能清理长期未使用的站点数据。[Chrome Cookie 有效期限制](https://developer.chrome.com/blog/cookie-max-age-expires)说明了浏览器端的上限。生产升级保持 `JWT_SECRET` 稳定，避免每次重启使所有账号退出；更换密钥会立即撤销所有既有令牌。

当前 `compose.yaml` 固定使用 MariaDB 12.3.2（兼容 MySQL 协议），需要配置：

```env
MYSQL_HOST=db
MYSQL_PORT=3306
MYSQL_USER=tech_growth_hub
MYSQL_PASSWORD=replace-with-a-random-database-password
MYSQL_ROOT_PASSWORD=replace-with-a-different-random-root-password
MYSQL_DATABASE=tech_growth_hub
```

只有使用 AI 功能时，才需要在系统的“API 凭据”中配置有效 Key，再让一个或多个模型配置引用该凭据。

---

## 5. 数据库说明

### MariaDB / MySQL

- Docker Compose 默认方案
- 数据保存在独立的 `db-data` 卷中
- 适合个人和多用户部署

### SQLite

- 作为本地开发和轻量单机部署的可选方案
- 设置 `DATABASE_TYPE=sqlite` 后使用 `SQLITE_PATH` 指定文件位置

---

## 6. 正式环境建议

- 分别生成并妥善保管 `JWT_SECRET` 与 `AI_CONFIG_ENCRYPTION_KEY`
- 不要在仍有加密 AI 配置时丢失或随意替换 `AI_CONFIG_ENCRYPTION_KEY`
- 开启 HTTPS
- 明确配置 `ALLOWED_ORIGINS`
- 定期导出备份
- 保留容器日志
- 定期更新依赖

---

## 7. 健康检查

后端提供：

```text
/api/health        # 综合状态
/api/health/live   # 进程存活
/api/health/ready  # 数据库就绪
```

可用于：

- 反向代理健康检查
- 容器编排健康检查
- 发布后自检

---

## 8. 常见问题

### 前端更新后看起来没变化

先强制刷新浏览器：

- Windows/Linux：`Ctrl + F5`
- Mac：`Cmd + Shift + R`

### AI 功能不能用

优先检查：

- AI Key 是否配置
- 当前用户是否有 AI 相关权限
- 当前激活模型是否有效
- 模型配置是否关联了正确的 API 凭据
- 后端日志是否有模型调用错误

模型列表可以正常读取但推理超时或返回无权限时，应检查提供商账户权限、地区访问限制和服务器出口网络；这类问题不等同于本地 API 未启动。

### Docker 服务是 healthy，但页面有旧资源

通常是浏览器缓存导致，先强制刷新。

### MariaDB 提示 `create_uring failed`

这是宿主机内核或容器安全策略不允许 io_uring 时的降级提示。MariaDB 会自动改用 Linux native AIO；只要后续出现 `ready for connections`，就不属于启动故障，不建议为了消除提示而放宽容器安全策略。

### MariaDB 内部 `healthcheck` 用户认证失败

旧数据卷或中断过的初始化可能导致 MariaDB 镜像生成的 `.my-healthcheck.cnf` 与内部用户密码不一致。`v260805-2` 起，Compose 健康检查改用 `.env` 中配置的应用数据库用户执行 `SELECT 1`，不再依赖内部 `healthcheck` 用户。

如果新检查仍失败，说明数据卷中的应用用户密码与当前 `.env` 的 `MYSQL_PASSWORD` 不一致。应恢复原密码或在数据库中更新用户密码，不要直接删除仍有数据的 `db-data` 卷。

## 9. Release 与离线镜像

每个 GitHub Release 提供预构建程序包，以及 API、Web、MariaDB 的 amd64/arm64 独立镜像压缩包。镜像可以直接使用 `docker load` 导入，详细文件名和命令见 [release-assets.md](release-assets.md)。
