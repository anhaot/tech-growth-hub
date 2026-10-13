# Changelog

## 2026-10-13 — 权限与可靠性修复

- 用户管理响应移除密码哈希，限制委托管理者提升权限、管理管理员及修改自身角色；集成题库校验所有者和分类，事务保护最后一个管理员。
- MySQL 自动扩容撤销标记键长及长中文题目正文，密码撤销、默认 AI 模型和共享凭据更新使用事务；补齐请求体错误和标签处理边界。
- 网页 AI 模型按 ID 选择，答案按编辑权限保存；草稿逐批保存并保留部分失败结果，IndexedDB 草稿按账户隔离，异步请求及 PWA 缓存补齐保护。
- App 会话持久化与退出串行处理，保留非 JSON 鉴权状态并验证离线缓存；APK 校验在 Python 优化模式下仍生效。
- 维护清理按实际版本保留 APK 和记录，防止符号链接与校验失败误删；发布工作流禁用自动 latest，发布 Compose 补齐 Cookie 配置，同步使用、开发与权限文档。

## 2026-10-12 — App 1.2.7 / 服务镜像 v261012-2

- App 与网页学习页编辑表单增加参考答案、思路解析的 AI 图标，读取尚未保存的完整草稿，提供补充预览和独立字段采用；保存仍校验题目版本。
- 新增 AI 字段补充接口，检查权限、题目归属和全局开关，保留 Markdown 与长草稿，返回输出截断状态，生成不直接写入题库。
- 本地 Android 构建和 APK 校验脚本集中到 `mobile/scripts/`；提供项目清理脚本，保留当前/上一版安装包与题库备份，删除旧安装包、临时构建脚本和可重新生成的缓存。

## 2026-10-12 — App 1.2.6 / 服务镜像 v261012-1

- App 答疑记录支持选择单条或多条删除，失败保留原记录，删除后从当前对话和本机归档移除。
- App 与网页收藏页支持多选、全选、批量取消收藏；按用户和学习模式处理，保留题目、学习次数及最近学习时间。
- App 当前题目菜单支持修改答案和解析、删除题目；同步离线缓存，保存校验题目版本。网页背题、答题页新增直接删除，保留原有编辑与版本历史。
- API/Web 新镜像包含此前尚未激活的 AI 修复：8192 输出预算、推理空正文重试、截断续写及 200 秒 Web 代理等待。

## 2026-10-11 — App 1.2.5

- 背题正文、代码和解析关闭长按选字，减少上下滑动误触；分类、难度及收藏放入顶部导航栏，不再占正文一整行。
- 离线题库默认首次下载、之后满 24 小时后台更新，可切换仅手动更新；冷启动和回到前台不再重复下载整库，学习记录和收藏仍自动补传。
- AI 快捷提示分别调用解析、扩展和推荐接口，失败重试保留原动作与模型；空正文提供实际服务、模型和接口诊断。
- 在既有远端复现 DeepSeek 推理用满旧版 4000 输出预算后正文为空；同题 8192 预算返回完整正文。服务端候选修复尚待部署确认。

## 2026-10-11 — App 1.2.4

- 模型设置改为简洁列表，编辑、调用检查、设默认及删除收进底部菜单；提供商单独选择，常用连接地址默认收起。
- 答疑页显示实际选中的模型并支持直接切换；空回答不会入库，失败保留输入，支持结构化正文块并过滤推理块。
- 服务端支持推理空正文的有限重试，NVIDIA MiniMax M3 按官方参数关闭重试中的推理模式，HTTP 410 返回明确的模型不可用提示。
- 题目标题支持 Markdown，空答案显示占位、空解析隐藏；缩进代码可横向滚动，三位编号留足间距，长段落完整换行；命令示例保留英文直引号和选项符号。
- 客户端、接口合约与服务端共 72 项测试通过；真实题库内容复制到隔离预览进行展示核对，不改动原题库。

## 2026-10-11 — App 1.2.3 / AI 服务修复

- App“我的 → AI 模型”支持新增、编辑、读取模型列表、切换默认、检查调用和删除配置；编辑时密钥留空保留原值，不再跳转网页。
- AI 默认输出预算由 4000 增至 8192，检测供应商的输出上限，最多自动续写两次；后续请求失败保留已生成内容并标记未完成。App 支持续写、补全、失败重试及草稿保留。
- Markdown 列表独立布局并统一文字测量尺寸，识别同一行中的连续编号，避免编号与正文挤在一起；答案原文和导出内容保留。
- AI 接口总等待上限 180 秒，客户端及 Web 代理为 200 秒；反向代理也应设置相同或更长的等待上限。
- 增加输出上限、推理预算、配置接口与答案排版回归验证；Android 延用单核、分阶段和内存受限构建。

## 2026-10-11 — App 1.2.2

- 移除“我的”中的 Expo UI / Compose 容器与依赖，改用 React Native 设置行，消除该页原生容器调用路径。
- 切题请求期间保持按钮外观与位置，继续阻止重复请求；标签页后台刷新保留列表，仅主动下拉显示刷新状态。
- 重做无阴影底栏与选中状态，统一背景、安全区、首页和设置页布局，标签页保持挂载。
- AI 回复按账号和服务保存，支持单条与跨题目多选批量导出 Markdown，保留完整代码块和表格；旧离线缓存兼容升级。
- AI 对话独立处理键盘与导航栏高度，窄屏输入和发送按钮保持可见；长回复从开头显示，保留失败输入与重试能力。
- 新增导出、记录恢复、账号隔离、旧缓存、写入失败重试与跨题并发保存回归测试；构建按阶段串行限制资源。

## 2026-10-10 — App 1.2.1

- 修复“我的”设置容器向 Android 原生宽度参数传入百分比字符串的问题，改用实际测量的数值宽度。
- 移除底部与首页独立 AI 入口，在背题复习中打开同页 AI 答疑；题目上下文、选定模型和连续追问保持可用。
- 题目标题恢复整行，收藏移到信息栏，答案标题旁提供收起 / 展开；底部整合前后切题、随机与 AI。
- 增加左右滑动切题，纵向滚动保留阅读行为；切题期间保留内容，避免加载图标引起页面跳动，并防止重复请求。
- 首页题库和收藏改为带图标、数量及跳转提示的入口卡片。

## 2026-10-10 — App 1.2.0

- 精简首页与背题布局，学习题库和默认 AI 模型集中到“我的”，去除重复引导文案。
- 答案和思路解析默认展开；题目侧边小按钮控制收起、收藏和问 AI，Markdown 代码块可独立横向滚动。
- AI 助手直接打开对话，用题目解析、答案扩展和知识推荐作为开聊提示；支持带题或不选题对话。
- 增加 SQLite 离线题库、断网重启恢复、离线搜索与切题、收藏 / 最近浏览队列和重连同步，按账号与服务隔离。
- 修复局域网无外网时客户端错误拦截 HTTP/IP 服务；服务端 AI 对话支持可选题目与输入校验。
- 修正“我的”设置行宽度并统一页面滚动；Metro 和客户端测试默认单 worker / 串行执行，低内存构建分阶段复用缓存。

## 2026-10-09

- 新增独立 Expo / React Native 安卓客户端：首页、分类背题、题目搜索、背题收藏与账户 / 服务切换；手机端专注背题，不提供答题和记题入口。
- 1.1.0 支持同一安装包通过 HTTP / HTTPS 域名、IP 与自定义端口登录；重做登录页和首页，使用键盘感知滚动避免输入框遮挡。
- 接入题目解析、答案扩展、知识推荐、精简速记、通俗讲解、结构化记忆、相似题目与 AI 追问，复用服务端模型与权限。
- 复用登录、分类、学习进度与收藏 API；首次改密后获取新令牌，原生令牌使用 SecureStore 保存。
- 增加移动端 CI、HTTP / AI 合约测试、手动 APK 预览构建及安卓开发文档。


## [Unreleased] - 2026-10-08

- Fixed MySQL/MariaDB backup restores altering timestamp-shaped question text and truncating version timestamps; added a real MariaDB round-trip regression to CI.

- 增加 CSV/JSON/Markdown/AI 粘贴导入预览，分页核对、跨页排除、错误明细与确认导入；重复确认返回原结果，预览和提交均检查题库授权。

- Added question version history, difference preview, rollback as a new version, optimistic revision checks, and history-preserving backups/migrations.
- Removed 1000-question learning/navigation and 5000-question duplicate-scan limits; added paged learning, global position restoration, indexed background duplicate scans and paged results.
- Added dense duplicate compaction, explicit top-10000 result limits, scoped history access and atomic permission-checked merges.
- Fixed MariaDB JSON/date handling and MySQL index initialization, learning bookmark retention/counts, persistent AI settings, offline transaction completion, stale requests and page update recovery.
- Fixed restoration of unordered category hierarchies and rejected cyclic category backups.
- Added JSON export alongside Markdown and private atomic database configuration writes; updated implementation and audit documentation.

### Added

- Configurable login lifetimes, custom durations and unlimited sessions in system settings, with immediate application to the current session and persistent browser session restoration.
- Regression coverage for authentication lifetimes, revoked category access, import/export, category cycles, backup rollback, and AI request boundaries.

### Fixed

- JWT and cookie durations now follow persisted settings or `JWT_EXPIRES_IN`; both Compose variants pass the environment fallback.
- Password changes revoke old tokens; expired tokens report the correct error, and Bearer precedence matches CSRF validation.
- Full backups require an administrator role; empty restores are rejected and failed restores roll back in SQLite and MySQL.
- Category parents cannot cross libraries or form cycles; bookmarks and learning progress respect revoked access.
- JSON exports can be reimported with tags, categories, empty answers and null explanations; Markdown imports retain multiline question bodies.
- Pagination inputs are bounded, self-merges are rejected, and question exports no longer silently stop at 10,000 records.
- AI URLs require HTTPS, private mapped IPv6 addresses are blocked, redirects are refused, and inference timeouts cover response body reads.
- Homepage view counts are labeled as view counts instead of learning hours; vulnerable dependencies were updated.
- Upgraded React Router to 7.18.4 to resolve production dependency advisories while retaining the existing declarative routing setup; documented remaining development-tool advisories.

All notable changes to Tech Growth Hub will be documented in this file.

The format loosely follows Keep a Changelog, with sections grouped by release.

## [Unreleased]

### Added

- Interview capture inbox with multi-question offline drafts, batch AI answer generation, manual review, and explicit import into the official question bank.
- Responsive study and quiz modes with saved browsing progress, filtering, bookmarks, and mobile controls.
- Installable PWA shell, mobile bottom navigation, safe-area layout, offline interview drafts, browser tests, and real README screenshots.
- Source-build Docker Compose deployment, CI, and health probes.
- AES-256-GCM encryption for persisted AI credentials and exported backups.

- AI model configuration maintenance: model availability checks, invalid-model status badges, and one-click cleanup for invalid model configs.
- Dynamic custom API address templates for saved OpenAI-compatible providers, including template naming and NVIDIA address recognition.
- Reuse of saved custom provider API keys when adding additional models for the same API address.
- Dedicated encrypted API credential management, with model configurations referencing reusable credentials instead of displaying keys.
- Progressive multi-model checks: up to four checks run concurrently, each result is shown immediately, and a final dialog summarizes available, unavailable, unconfirmed, and timed-out models.

### Changed

- AI generation and study assistants now list every configured model while defaulting to the active model.
- Project documentation now presents the product as an AI question-bank, knowledge-governance, and learning platform; browser capture is documented as a supporting input workflow.
- Application images now require date-sequence versions such as `v260805-1`; Compose and release automation no longer use `latest`.
- GitHub Releases now attach a runnable prebuilt bundle, checksum manifest, and separately importable API, Web, and MariaDB Docker archives for amd64 and arm64.

### Fixed

- Fixed model selection paths that could resolve a provider name to its first configuration instead of the selected configuration ID.
- Improved NVIDIA-compatible upstream error handling, long-message layout, and timeout diagnostics.
- Replaced MariaDB's generated internal healthcheck credential with an application-user `SELECT 1` check, avoiding unhealthy containers when an imported or reused data volume contains stale healthcheck credentials.

## [1.1.0] - 2026-04-07

### Added

- `AI答案` workflow for generating answer-only drafts, explanations, and tag suggestions without changing question stem, title, or difficulty
- `AI润色` mode split with `轻润色 / 深润色`, preview-first editing, and selectable tags before save
- AI batch tag generation and tag recommendation workflows for question maintenance
- Shared `AIAnswerDraftModal` component and richer AI text formatting helpers
- Dedicated documentation set under `docs/`, including deployment, operations, development, permissions, AI guide, and user guide

### Changed

- Renamed and reorganized the repository as `tech-growth-hub` with concise `api/`, `web/`, and `compose.yaml` paths.
- Question answers are optional at creation time and can be generated by AI before saving.
- Authentication now keeps the session in an HttpOnly cookie with double-submit CSRF protection; the web app no longer persists bearer tokens.
- Upgraded the build runtime to Node.js 22 and Vite 8, with route-level code splitting and non-root runtime containers.

- Promoted HttpOnly cookie based authentication flow, with web session restore and session-scoped storage fallback
- Reworked README into a full project landing document with product, workflow, operations, and documentation navigation
- Refined AI answer generation to support `速记版 / 练习版 / 教学版` with answer quality, tag selection, and manual tag input
- Improved AI output rendering and formatting for Markdown, numbered lists, and bullet lists
- Updated system settings visibility so backup operations are treated as administrator-only functionality

### Fixed

- Fixed AI route permission boundaries so integrated users cannot bypass category scopes through AI endpoints
- Fixed custom AI provider runtime handling so admins and normal users can use existing safe custom providers correctly
- Fixed AI batch generation parsing to tolerate more model JSON response shapes
- Fixed login throttling behavior so `/auth/me` probing no longer consumes login rate-limit capacity
- Fixed login IP handling to use trusted proxy aware request IPs instead of blindly trusting forwarded headers
- Fixed AI specific rate limiting by mounting the dedicated limiter on `/api/ai`
- Fixed Markdown emphasis parsing so `* ` bullet lists no longer lose list semantics during rendering

## [1.0.0] - 2026-03-12

### Added

- Initial public-ready release of Tech Growth Hub
- Question management, learning modes, bookmarks, AI assistant, AI generation, AI polishing
- User management, permission management, database management, backup and restore
