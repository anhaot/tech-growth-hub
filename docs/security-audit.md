# 安全审查记录

最近复核：2026-10-08。范围：Web、API、认证、权限、离线存储、依赖、Docker/CI 与备份链路。详细功能检查与测试边界见 [项目检查报告](project-audit-2026-10-08.md)。

## 当前结论

本次修复认证优先级和 CSRF 不一致、改密后旧登录仍有效、授权撤销后收藏内容可见、系统管理用户越权访问完整备份，以及全量恢复缺少事务等问题。推送前将 React Router 升级至 7.18.4，后端与前端生产依赖审计均为 0 漏洞。API 回归使用 SQLite，MariaDB 已完成报告所列专项往返；Oracle MySQL 和真实模型服务尚未完成本次全套验收。

## 已实施的边界

| 范围 | 实现与验证 |
| --- | --- |
| Cookie / CSRF | Web 使用 HttpOnly 登录 Cookie；写请求携带匹配的 CSRF Cookie/Header，比较使用 Buffer 字节长度；显式非空 Bearer 优先认证，无效 Bearer 不回退到 Cookie |
| 登录有效期 | 数据库设置优先于环境默认值；无限期 JWT 不带 exp，持久 Cookie 在认证时续期；密码修改撤销旧令牌，旧版令牌在首次改密后也拒绝 |
| 浏览器存储 | Web 不持久化 Bearer token；用户快照在 sessionStorage，在线启动重新检查服务端权限；IndexedDB 草稿按用户归属读取；Service Worker 不缓存 API 响应 |
| 用户与分类 | 题目、AI 和进度执行用户归属与分类校验；已收藏内容在授权撤销后不再返回；分类父级不得跨题库或形成环 |
| 完整备份 | 导出/恢复显式要求管理员角色；拒绝无管理员的空数据集；SQLite 和 MySQL 全量替换使用事务，跨表一致性快照、版本历史随备份迁移；SQLite 回归验证失败回滚，MariaDB 实测往返 |
| AI Key | 独立凭据表、AES-256-GCM 加密，查询接口不返回 Key；备份保持密文，生产要求独立加密密钥 |
| AI 出口 | 强制 HTTPS、管理员管理自定义主机；拒绝 URL 认证字段和私网映射 IPv6；请求前 DNS 检查；模型目录与推理请求禁用自动重定向，推理超时覆盖正文读取 |
| 上传与展示 | 上传限制扩展名和 10 MB 大小，随机文件名，处理后清理临时文件；当前未做 MIME 独立校验。Markdown 先 HTML 转义再生成受控标签 |
| HTTP / 容器 | Helmet、CORS、请求体和速率限制、生产弱密钥拒绝；容器非 root、多阶段构建、探针与优雅停机 |

本次对 [Multer](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm)、[proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) 等生产依赖的安全更新已写入锁文件，CSV 解析器升级后补充导入回归。

## 剩余风险

1. 退出登录清除本地 Cookie，尚无逐设备会话撤销台账；已复制的永久令牌需通过改密或更换 JWT 密钥撤销。计划增加设备列表和强制退出。
2. AI 开关已持久化且统一限制内容生成；配置与可用性诊断保留，诊断仍可能调用最小推理。
3. AI DNS 结果校验与实际连接没有绑定同一解析地址；仍需出口网络策略限制 DNS rebinding。URL/地址检测不等于完整网络隔离。
4. 空分类范围表示全部共享题库；非空范围统一排除无分类题及未授权历史快照，已补边界测试。
5. 完整备份已有一致性快照和恢复事务，但迁移校验仍只核对数量，需要内容摘要核对。
6. React Router 7.18.4 已消除 [路径跳转](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) 和 [SSR hydration](https://github.com/advisories/GHSA-337j-9hxr-rhxg) 相关生产依赖告警。前端完整依赖审计仍报告 11 个高危、2 个中危包，来自 Tailwind / ESLint 的构建工具依赖链；[braces 深层模式递归告警](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 暂无补丁。当前扫描模式来自仓库固定配置，线上容器只分发静态构建产物，API 不使用这些依赖；这是本项目的可达性评估，并不表示告警已修复。开发环境仍须避免处理不可信扫描模式，后续跟踪上游修复及工具链迁移。
7. 数据库运行时 JSON 保存连接密码；AI Key 加密密钥尚不支持在线轮换。配置文件已采用 0600 权限原子写入，仍需完善连接密码加密与凭据迁移。
8. GitHub Actions 使用版本标签；可考虑提交 SHA 固定。浏览器草稿未加密，共享设备需按使用情况清理。

## 验证

```bash
cd api
npm run lint
npm run typecheck
npm test
npm audit --omit=dev

cd ../web
npm run lint
npm run build
E2E_API_PORT=43102 E2E_WEB_PORT=44173 npm run e2e
npm audit --omit=dev

cd ..
docker compose config --quiet
docker compose -f compose.release.yaml config --quiet
```

浏览器 Cookie 有效期受浏览器限制，“一直有效”通过持续使用时续期实现，参见 [Chrome 官方说明](https://developer.chrome.com/blog/cookie-max-age-expires)。
