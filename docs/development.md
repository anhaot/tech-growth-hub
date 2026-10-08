# 开发指南

MariaDB 备份恢复回归使用 `cd api && npm run test:mysql`。须提供 `MYSQL_TEST_HOST`、`MYSQL_TEST_PORT`（默认 3306）、`MYSQL_TEST_USER`、`MYSQL_TEST_PASSWORD` 和专用的 `MYSQL_TEST_DATABASE`（名称以 `tgh_test_` 开头）。测试会对该数据库做完整备份和替换，不能指向正式数据库；CI 使用临时 MariaDB 12.3.2 服务验证日期格式正文、设置值与版本时间的毫秒精度。

## 1. 目标

这份文档面向继续开发这个项目的人，重点说明：

- 代码结构
- 本地开发方式
- 常用脚本
- 测试策略
- 当前几个关键业务流的实现边界

---

## 2. 项目结构

### API 服务

目录：[api](../api)

主要分层：

- `src/routes`
  - API 路由入口
- `src/middleware`
  - 鉴权、权限、限流、错误处理
- `src/database`
  - 数据访问与数据库抽象
- `src/services`
  - AI 等服务层逻辑
- `src/utils`
  - 标签、Markdown、AI 安全等工具
- `tests`
  - 后端安全与回归测试

### Web 应用

目录：[web](../web)

主要分层：

- `src/pages`
  - 页面级逻辑
- `src/components`
  - 可复用组件
- `src/api`
  - Axios 请求封装
- `src/store`
  - Zustand 状态管理
- `src/lib`
  - 渲染、格式化、权限辅助逻辑
- `e2e`
  - Playwright 浏览器级测试

---

## 3. 本地开发

### 安装依赖

后端：

```bash
cd api
cp .env.example .env
# 无本地 MySQL 时，将 .env 中的 DATABASE_TYPE 改为 sqlite
npm ci
```

前端：

```bash
cd web
npm ci
```

### 启动开发环境

后端：

```bash
cd api
npm run dev
```

前端：

```bash
cd web
npm run dev
```

默认情况下：

- 前端由 Vite 运行在 `http://127.0.0.1:3000`
- 后端由 `tsx watch` 运行在 `http://127.0.0.1:3001`
- Vite 把 `/api` 代理到 API；可用 `VITE_API_PROXY_TARGET` 覆盖目标地址

---

## 4. 常用脚本

### 后端

```bash
cd api
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
```

说明：

- `build`：TypeScript 编译
- `lint`：ESLint 检查
- `typecheck`：只做类型检查
- `test`：运行后端安全回归测试

### 前端

```bash
cd web
npm run dev
npm run build
npm run lint
npm run preview
npm run e2e
npm run e2e:headed
```

说明：

- `build`：TypeScript + Vite 构建
- `e2e`：Playwright 无头测试
- `e2e:headed`：Playwright 有头模式，便于本地观察

---

## 5. 测试策略

当前项目主要有三层测试：

### 后端安全回归

文件：

- [security-regression.test.ts](../api/tests/security-regression.test.ts)

目前覆盖重点：

- 默认管理员首次登录改密
- 注册开关
- 批量删除越权
- AI 配置越权
- AI 题目接口越权
- Cookie 写操作 CSRF 防护
- AI Key 数据库与备份加密
- 集成题库权限与首页统计
- 登录有效期配置、Cookie/JWT 一致性、无限期登录续期与改密撤销
- Bearer/Cookie 认证优先级与 CSRF 边界
- 分类归属和循环引用、授权撤销后的收藏与进度过滤
- CSV、JSON、Markdown、文本导入，以及题库 JSON 导出回导
- 分页参数、自合并拒绝、管理员备份权限和恢复失败回滚
- AI 地址协议、IPv4 映射 IPv6、重定向限制和响应体读取超时

### 前端 E2E

文件：

- [login.spec.ts](../web/e2e/login.spec.ts)
- [questions.spec.ts](../web/e2e/questions.spec.ts)
- [backup.spec.ts](../web/e2e/backup.spec.ts)
- [database-migration.spec.ts](../web/e2e/database-migration.spec.ts)
- [first-login.spec.ts](../web/e2e/first-login.spec.ts)
- [mobile-layout.spec.ts](../web/e2e/mobile-layout.spec.ts)
- [mobile-offline.spec.ts](../web/e2e/mobile-offline.spec.ts)
- [study.spec.ts](../web/e2e/study.spec.ts)

目前覆盖重点：

- 登录
- 登录有效期保存、自定义时长、无限期登录与新浏览器会话恢复
- 新建题目
- AI 润色预览并保存
- 备份导出与恢复
- 数据库迁移与校验
- 手机端核心布局、滑动切题和离线记题草稿
- 背题页题目、答案和浏览位置

### 构建校验

推荐至少执行：

```bash
cd api && npm run build
cd ../web && npm run build
```

---

## 6. 关键业务流

### 题库

主要入口：

- [questions.ts](../api/src/routes/questions.ts)
- [Questions.tsx](../web/src/pages/Questions.tsx)

注意点：

- 题库权限和分类范围限制要一起考虑
- 批量操作更容易出现越权问题，改动时优先补回归验证

### 记题草稿

主要入口：

- [InterviewCapture.tsx](../web/src/pages/InterviewCapture.tsx)
- [offlineStorage.ts](../web/src/lib/offlineStorage.ts)
- [ai.ts](../api/src/routes/ai.ts)

草稿只存浏览器 IndexedDB，批量 AI 接口处理未入库的原始题干；正式入库必须经过用户明确确认。

### AI答案

定位：

- 只生成答案、解析和标签建议
- 不动题干、标题、难度

主要文件：

- [ai.ts](../api/src/routes/ai.ts)
- [AIAnswerDraftModal.tsx](../web/src/components/AIAnswerDraftModal.tsx)

改动时注意：

- 不要重新引入“参考原答案”逻辑
- 输出格式要兼顾展示，不要为了格式化牺牲内容准确性

### AI润色

定位：

- 处理整题优化
- 当前分为 `轻润色` 和 `深润色`

改动时注意：

- `轻润色` 默认优先，避免不必要的慢请求
- 前端要保留预览后保存，不要直接无确认覆盖

### AI批量生题

定位：

- 扩题工具
- 生成后再导入题库

改动时注意：

- 模型返回格式波动很大
- 解析逻辑必须容错，兼容 JSON 数组、代码块、带包装对象的结果

---

## 7. 鉴权与权限

鉴权逻辑主要在：

- [auth.ts](../api/src/middleware/auth.ts)
- [auth.ts](../api/src/routes/auth.ts)

当前要点：

- 登录态优先走 `HttpOnly Cookie`
- 仍兼容 `Authorization: Bearer`
- Cookie 写请求必须携带匹配的 CSRF 令牌
- 明确提供非空 Bearer 时优先认证该令牌；无效 Bearer 不会回退到 Cookie
- 有效期取站内 `login_session_duration`，未设置时取 `JWT_EXPIRES_IN`
- 新令牌绑定密码版本；改密撤销旧令牌并给当前设备签发新 Cookie
- 权限有兼容映射关系
- 集成用户要额外受分类范围限制

改动这部分时，重点防止：

- 越权访问别人的题目
- AI 路由绕过分类范围
- 普通用户越权管理 AI 配置

`POST /api/auth/session` 重新签发当前用户的登录 Cookie，用于显式应用新有效期。`forever` 不写入 JWT `exp`，认证请求续期 Cookie。旧版令牌在原期限内兼容；第一次改密后，旧版令牌也会被拒绝。

E2E 默认使用 API `3102` 和 Web `4173`；端口冲突时可执行 `E2E_API_PORT=43102 E2E_WEB_PORT=44173 npm run e2e`。测试数据库和运行时配置按 API 端口隔离，测试不使用部署数据库。产品截图用例默认跳过，只有显式设置 `CAPTURE_README=1` 才会重拍文档图片。

---

## 8. AI 配置与安全边界

当前安全策略：

- 普通用户可以使用已有的安全 AI 配置
- 普通用户不能新增或修改自定义 `baseUrl`
- 管理员可以管理自定义地址

相关文件：

- [ai.ts](../api/src/routes/ai.ts)
- [ai.ts](../api/src/services/ai.ts)
- [aiConfigSecurity.ts](../api/src/utils/aiConfigSecurity.ts)
- [secretEncryption.ts](../api/src/utils/secretEncryption.ts)

AI Key 在数据库和完整备份中使用 AES-256-GCM 加密。生产环境必须提供独立的 `AI_CONFIG_ENCRYPTION_KEY`。改这块时，不要为了“能用”把 SSRF 防护或加密降级重新放开。

---

## 9. 前端展示约束

当前 AI 生成内容经常包含：

- Markdown
- 编号列表
- `- ` 项目符号
- `* ` 项目符号

相关文件：

- [renderMarkdown.ts](../web/src/lib/renderMarkdown.ts)
- [aiDraftFormatting.ts](../web/src/lib/aiDraftFormatting.ts)

改动原则：

- 以答案准确、完整为优先
- 展示修正只能做轻量整理，不能篡改原意
- 不要为了强制格式化，破坏原始内容结构

---

## 10. 推荐开发流程

每次改动建议按这个顺序：

1. 先确认影响的是页面、API、权限还是存储
2. 改最小闭环代码
3. 跑对应构建
4. 涉及权限或安全边界时，补测试
5. 本地或 Docker 冒烟验证
6. 更新 README 或专项文档

---

## 11. 提交前检查

至少执行：

```bash
cd api && npm run build && npm run test
cd ../web && npm run build
```

如果改了页面关键交互，最好再补：

```bash
cd web && npm run e2e
```

---

## 12. 文档入口

更多信息见：

- [README.md](../README.md)
- [deployment.md](deployment.md)
- [operations.md](operations.md)
- [ai.md](ai.md)
- [permissions.md](permissions.md)

## 题目版本与大题库接口

- `GET /api/questions/:id/versions?page=1`：每页 20 个版本，可查看题目且历史分类在授权范围内才返回。
- `POST /api/questions/:id/versions/:version/restore`：请求体 `{ "expectedRevision": 2 }`；需要内容和属性编辑权限，成功生成新版本。并发冲突返回 409。
- `PUT /api/questions/:id`：支持 `expectedRevision` 与 `source`（`edit`、`ai-polish`、`ai-answer`），Web 保存均携带当前版本。
- `GET /api/questions/position/:id?categoryId=...&tags[]=...`：返回筛选题集内从零开始的位置，不可见或不匹配时为 null。
- `POST /api/questions/duplicates/scan`：启动整个授权题库扫描，返回任务 ID。
- `GET /api/questions/duplicates/scan/:jobId?page=1&memberPage=1`：进度与结果；结果页每页 20 条，同标题组成员另按 20 道分页。
- 旧 `/duplicates/similar` 接口保留，但新页面使用后台任务和轮询。

`questions.revision` 在启动时为旧数据库补齐默认值 1；`question_versions` 保存 JSON 快照、版本、操作者和来源，参与备份与迁移。所有业务内容写入经过版本事务，删除题目级联删除版本；修订脚本同样保留快照。

列表与学习按 `created_at DESC, id DESC` 排序。Web 学习保留当前 100 道，全库后台扫描每批读 1000 道且不设题目总量上限。查重候选索引与穷举评分对照验证，最多保留 10,000 个最高分结果，匹配总数单独统计。任务为进程内状态，部署多个实例时需要会话固定或改用持久队列。

新增 API 回归覆盖版本冲突、回退、分类历史权限、旧备份、合并故障回滚、6005 道题跨页/全库扫描、万题密集重复、学习进度和持久 AI 开关。人工界面检查使用隔离题库；结果见[检查报告](project-audit-2026-10-08.md)。


### 导入预览接口

`POST /api/import/preview/csv|json|markdown` 使用 multipart 的 `file` 和可选 `categoryId`；`POST /api/import/preview/text` 使用 `{questions, categoryId}`。响应含预览 ID、到期时间、总数/有效数/错误数及当前 20 条数据。`GET /api/import/preview/:id?page=N` 读取后续页；`POST /api/import/preview/:id/commit` 的 `{excludedRows: number[]}` 按原始条号排除题目，其余有效条目导入。CSV 条号包含表头偏移。

预览属于发起账号，授权变化要求重建，提交重新检查分类。相同 ID 的成功提交结果保留 15 分钟以便重试，不重复写入。预览队列保存在进程内，全局最多 8 个，每账号新预览会替换之前已就绪或完成的预览；多实例需要固定到同一实例。共享解析器同时用于兼容导入接口，避免预览与导入解析规则漂移。
