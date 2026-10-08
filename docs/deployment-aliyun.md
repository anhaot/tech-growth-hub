# 阿里云镜像与外部固定 IP 网络部署

适用于原 `tech-growth-hub-offline` 项目、`mynetwork` 外部网络、`172.18.0.15/16/17` 地址及 `/data/tiku` 绑定目录。配置文件为 [compose.aliyun.yaml](../compose.aliyun.yaml)，环境变量模板为 [tech-growth-hub.env.example](../tech-growth-hub.env.example)。

## 镜像

本次在已通过 GitHub CI 的 `3d22f40` 基础上修复 MariaDB 备份恢复的日期内容转换与毫秒截断问题，构建 `v261008-3`，同时包含 React Router 7.18.4 安全更新。架构为 `linux/amd64`，与仓库原 `v260805-2` 相同；ARM64 主机不能直接使用此版本的原生镜像。

```text
registry.cn-beijing.aliyuncs.com/images-anhao/tech-growth-hub-api:v261008-3
registry.cn-beijing.aliyuncs.com/images-anhao/tech-growth-hub-web:v261008-3
```

## 原 Compose 的检查结论

原文件的依赖顺序、内部端口、绑定目录及健康检查与应用一致；MariaDB 支持 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_ROOT_PASSWORD` 别名，无须仅为变量名称改写正在运行的数据库。检查以下主机条件后可以升级：

- `mynetwork` 必须已存在，IPAM 子网覆盖 `172.18.0.15/16/17`，三个地址未被其他容器使用。新配置用 `extra_hosts` 将 `api` 和 `db` 固定到指定 IP，避免共享网络中同名服务导致 DNS 歧义；更改固定 IP 时须同步更改这些映射。
- Web 没有宿主机端口映射。现有代理或路由应能够访问 `172.18.0.15:8080`；普通 bridge 网络不能保证其他主机直连此容器地址。需要通过服务器 IP 访问时，在 Web 服务增加 `ports: ["10089:8080"]`，再使用 `http://服务器IP:10089`。
- API 以 `node` 用户运行，UID/GID 为 `1000:1000`；`/data/tiku/app-data` 必须允许该用户读写，已有 `database-runtime.json` 也必须可读。新配置设置 `create_host_path: false`，目录写错或缺失时直接失败，避免意外使用新空目录。
- `tech-growth-hub.env` 应包含原 JWT / AI 加密密钥、实际数据库账户与密码、`ALLOWED_ORIGINS` 和 AI 设置；升级时保留原密钥。`ALLOWED_ORIGINS` 填浏览器实际访问的来源（协议、主机及非默认端口），`AUTH_COOKIE_SECURE=auto` 适合同时支持内网 HTTP 和代理 HTTPS。HTTPS 外层代理应覆盖并转发 `X-Forwarded-Proto`。
- 若环境文件同时设置 `MYSQL_*` 与 `MARIADB_*`，两者必须一致；MariaDB 优先使用 `MARIADB_*`。已有数据目录的账户密码不会因修改环境变量而自动改变。
- 持久化的 `/app/data/database-runtime.json` 若选择了站内数据库配置，该配置优先于 `MYSQL_HOST` 等环境变量；先在站内数据库页面核对当前连接，再升级。不要删除此文件来强制切换数据库。

官方依据：[MariaDB 环境变量](https://mariadb.com/docs/server/server-management/automated-mariadb-deployment-and-administration/docker-and-mariadb/mariadb-server-docker-official-image-environment-variables.md)、[Compose 网络](https://docs.docker.com/compose/how-tos/networking/)。目标主机的网络、目录权限和环境文件没有从当前主机远程验证。

## 升级现有主机

先备份数据库与应用配置。已有 Compose 项目名保持 `tech-growth-hub-offline`，保留现有 `tech-growth-hub.env` 和 `/data/tiku` 目录；不要把环境变量模板覆盖到已有配置。数据库镜像继续使用 `mariadb:12.3.2`。

原 Compose 已运行时，用原文件停服务后在数据库停止状态备份数据目录（期间服务不可用）：

```bash
docker compose -f compose.yaml stop
backup_dir="/data/tiku-backups/pre-v261008-3-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup_dir"
sudo tar -czf "$backup_dir/app-data.tar.gz" -C /data/tiku app-data
sudo tar -czf "$backup_dir/db-data.tar.gz" -C /data/tiku db-data
sudo install -m 600 tech-growth-hub.env "$backup_dir/tech-growth-hub.env"
sudo chmod 600 "$backup_dir/app-data.tar.gz" "$backup_dir/db-data.tar.gz"
```

原文件名不同则替换 `compose.yaml`。下载新版 `compose.aliyun.yaml` 到原 Compose 所在目录，使 `./tech-growth-hub.env` 继续指向已有环境文件，然后执行：

```bash
docker network inspect mynetwork
test -d /data/tiku/app-data && test -d /data/tiku/db-data
docker compose -f compose.aliyun.yaml config --quiet
docker compose -f compose.aliyun.yaml pull api web
docker compose -f compose.aliyun.yaml up -d --wait --wait-timeout 300
docker compose -f compose.aliyun.yaml ps
docker compose -f compose.aliyun.yaml exec api sh -c 'id; test -w /app/data && echo app-data-writable'
```

可在停服务前先拉取镜像，缩短停机时间。绑定目录不可写时，先核对挂载是否正确，再由管理员调整应用目录的所有权或 ACL；不要对数据库目录套用 API 的 UID。不要删除数据目录或使用空目录覆盖已有挂载。

新版 API 会自动增加题目版本字段和版本表。升级后检查登录、原题目数量、题目历史及 JSON 导入预览。若需回滚，停止服务并使用升级前镜像及一致的备份数据恢复；仅改回旧镜像不能完整撤销数据库结构变化。

首次安装时才复制模板为 `tech-growth-hub.env`，生成有效的 JWT / AI 加密密钥和随机密码，并提前创建应用及数据库目录。只通过 `env_file:` 给容器传变量的当前配置不依赖 Compose `${...}` 插值；以后若加入插值，需要显式 `--env-file tech-growth-hub.env` 或提供同名 shell / `.env` 变量，见 [Docker 插值说明](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。
