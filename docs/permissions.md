# 权限模型说明

## 1. 角色

系统当前有两种角色：

- `admin`
- `user`

管理员默认拥有全部权限。

---

## 2. 用户模式

除了角色外，还有两种用户模式：

- `independent`
- `integrated`

### independent

- 自己维护自己的题库
- 适合个人或独立维护者

### integrated

- 接入某个题库所有者的题库
- 可叠加分类范围限制
- 适合团队协作

---

## 3. 权限分类

### 题库权限

- `question_view`
- `question_create`
- `question_edit_content`
- `question_edit_meta`
- `question_delete`
- `question_batch_edit`
- `question_export`
- `import_manage`

### 分类与治理

- `category_view`
- `category_manage`
- `tag_manage`
- `duplicate_manage`

### AI 权限

- `ai_use`
- `ai_generate`
- `ai_polish`
- `ai_chat`
- `ai_config_manage`

### 系统权限

- `backup_export`
- `backup_restore`
- `system_manage`
- `user_manage`

---

## 4. 兼容权限

后端有一层兼容映射，部分权限会自动包含基础能力。

例如：

- `ai_generate` 包含 `ai_use`
- `ai_config_manage` 包含 `ai_use`
- `ai_chat` 包含 `ai_use`
- `backup_restore` 视作包含 `backup_export`

这层逻辑在：

- [auth.ts](../api/src/middleware/auth.ts)

---

## 5. 分类范围限制

对 `integrated` 用户，系统还会额外判断分类范围：

- 如果题目分类不在授权范围内，则即使功能权限存在，也不能访问
- 这个边界已经补到 AI 路由和题库路由里
- 已收藏的题目和学习进度也会重新校验当前授权，撤销分类授权后不再返回对应内容

注意：当前空分类授权数组表示“全部分类”，不是“无权访问”；未分类题目的单题权限检查允许访问，而分类过滤列表只包含指定分类。需要禁止题库访问时应撤销 `question_view` 等基础及兼容权限。后续应统一未分类题目的访问规则。

适合场景：

- 团队成员只能维护某几个分类
- 不同业务线分开管理

---

## 6. AI 配置权限

当前策略：

- 普通用户可以使用已有的安全 AI 配置
- 普通用户不能新增或修改自定义 `baseUrl`
- 管理员可以管理自定义地址

这样做是为了兼顾：

- 正常业务使用
- SSRF 风险控制

---

## 7. 备份权限

备份导出 / 恢复 当前是管理员专属。

普通用户即使拥有 `system_manage` 或备份权限标记，也不能调用完整备份导出和恢复接口。登录有效期设置允许具有 `system_manage` 的用户修改。该权限还允许数据库管理，因此应只授予可信系统维护人员。

原因：

- 备份中包含全量题库数据
- 也可能包含敏感配置
- 一旦权限放错，影响是整库级别

---

## 8. 推荐权限配置

### 管理员

- 全权限

### 题库维护者

- `question_view`
- `question_create`
- `question_edit_content`
- `question_edit_meta`
- `question_batch_edit`
- `tag_manage`
- `duplicate_manage`
- `import_manage`
- `ai_use`
- `ai_generate`
- `ai_polish`

### 学习用户

- `question_view`
- `ai_use`
- `ai_chat`

---

## 9. 调整权限时的建议

- 先按最小权限分配
- AI 配置管理不要随便下放
- 备份恢复只给管理员
- 集成用户尽量配合分类范围一起使用

## 版本回退与查重

查看版本历史需 `question_view`，同时遵守题库归属和当前/历史分类范围；回退必须同时具备 `question_edit_content` 和 `question_edit_meta`。目标分类不存在或越权时拒绝回退。

查重任务需 `duplicate_manage`，任务结果仅可由发起人读取，并重新检查题库与分类范围。删除重复题另需 `question_delete`；合并同时需要两项编辑权限。集成用户非空分类范围排除无分类题，空范围表示共享题库全部分类。
