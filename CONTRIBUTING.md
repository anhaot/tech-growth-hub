# 贡献指南

感谢你关注技术成长站。

本项目面向 IT 知识管理、学习训练和 AI 辅助内容生产场景，欢迎修复缺陷、补充测试、优化文档和提出功能改进。

## 贡献方式

- 提交 Bug 报告
- 提交功能建议
- 改进文档
- 修复代码问题
- 补充测试和安全检查

## 开始之前

请先阅读以下文件：

- [README.md](./README.md)
- [LICENSE](./LICENSE)

## 本地开发

### 1. 安装依赖

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

### 2. 启动开发环境

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

### 3. Docker 方式

先按 [README 的快速部署](./README.md#快速部署) 准备根目录 `.env`，再启动：

```bash
docker compose up -d --build
```

## 提交规范

建议每次提交聚焦单一主题，避免将 UI 微调、权限改造、数据库变更混在同一个提交中。

推荐提交标题风格：

- `feat: add AI polishing preview editor`
- `fix: restrict question access by assigned categories`
- `docs: refresh README for Tech Growth Hub branding`
- `test: add e2e coverage for backup restore`

## 代码要求

- 不要提交 `dist`、测试报告、运行日志和本地数据库文件
- 新增后端接口时，优先考虑权限、范围隔离和异常返回
- 新增前端交互时，优先考虑手机浏览器访问体验
- 涉及导入、备份、权限、数据库切换的功能，必须考虑误操作保护
- 涉及 AI 输出展示的改动，必须考虑 Markdown 兼容和内容清洗

## 提交前检查

后端：

```bash
cd api
npm run lint
npm run build
npm run test
```

前端：

```bash
cd web
npm run lint
npm run build
npm run e2e
```

## Pull Request 建议

- 描述改动目标和范围
- 列出验证步骤
- UI 改动附截图
- 权限或数据结构改动说明兼容性影响
- 如果改动会影响现有数据，请明确写出迁移或回滚方式

## 安全问题

如果发现鉴权、数据泄露、上传链路、备份恢复或 AI 输出注入相关问题，请不要只提交模糊描述，尽量附带：

- 影响范围
- 复现步骤
- 触发条件
- 建议修复方向

## 文档改进

如果功能已经变更，请同步更新：

- [README.md](./README.md)
- 相关页面文案
- 环境变量说明
- 测试说明

保持文档与实际行为一致，比单纯“补一句说明”更重要。
