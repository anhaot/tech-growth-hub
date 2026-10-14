# 安卓 App

`mobile/` 是技术成长站的 Expo SDK 57 / React Native 安卓客户端。当前源码版本为 `1.2.7`，包名为 `com.techgrowthhub.mobile`，本地版本代码为 `10`。App 连接现有 API，与网页共用账号、题库、权限、背题进度和收藏。

## 使用与安装

从自己的构建渠道获取 APK，按手机提示安装。设备需要符合该 APK 的最低 Android 版本和处理器架构；下面的本地构建示例使用 ARM64。独立 APK 内置程序代码，无需连接 Metro 开发服务。覆盖升级须使用相同包名和签名，正式分发时应保存自己的签名密钥。

登录时填写手机可以访问的题库服务地址，支持 HTTP / HTTPS、域名或 IP 加端口，也支持服务子路径。例如：

```text
http://tiku.example.com:3001
https://tiku.example.com
https://tiku.example.com/hub
```

地址末尾的 `/api` 会自动去除；协议和端口保持原样。地址不能包含账户密码、查询参数或锚点。Android 配置允许 HTTP 请求，HTTPS 服务需要有效证书。实体手机和模拟器应使用各自可以访问开发机的地址；手机里的 `localhost` 指向手机本身。

使用已有账号登录。账号要求改密时，先设置新密码，App 再获取新的登录令牌。密码不会保存，原生令牌使用 SecureStore 保存。网络故障可重试或使用已下载内容；登录失效时返回登录，权限不足时显示错误。

## 背题与题目管理

| 入口 | 功能 |
| --- | --- |
| 首页 | 查看当前题库，开始或继续背题，进入题库和收藏 |
| 背题 | 关键词搜索、难度筛选、分页浏览，从头或继续复习 |
| 收藏 | 温习背题收藏，联网批量取消收藏 |
| 我的 | 选择学习题库、AI 模型，管理答疑记录、离线题库与账号 |

阅读页与网页一致，直接显示题干，不重复显示简短标题；题干与标题相同时也只显示一次。背题默认展示答案和解析，可收起或展开。底部提供上一题、下一题、随机题和 AI 答疑；左右滑动可切题，代码块和宽表格可独立横向滚动。“我的 → 学习题库”决定顺序背题范围，列表搜索和难度筛选用于查找单题。没有题库访问权限时隐藏背题、收藏入口。

有相应权限时，题目右上角“…”可联网修改答案与解析，或确认删除题目。修改会更新本机离线内容；删除会移除本机题目、进度与收藏。批量取消收藏只移除收藏状态。其他设备可手动更新离线题库以获取变化。

## AI 答疑与字段补充

AI 功能需要服务端启用并具备 `ai_use` 权限。从题目页进入“AI 答疑”，请求自动携带当前题目。可使用题目解析、答案扩展、知识推荐，或输入问题连续追问。返回题目时保留当前对话和草稿；切题后读取该题已保存的答疑记录。对话和追问还需要 `ai_chat` 权限。

“我的 → AI 模型”可选择服务默认模型或账户配置。有 `ai_config_manage` 权限时可新增、编辑、检查、删除配置，读取模型列表并设置服务默认模型。支持内置提供商和自定义 OpenAI 兼容地址；编辑时密钥留空可保留原密钥，已有密钥不会回显或写入离线缓存。

在“修改答案和解析”界面，两个字段标题旁的 AI 按钮读取当前未保存草稿，生成对应字段的补充全文。此功能需要服务支持字段补充接口、联网和 `ai_polish` 权限。可以预览、重新生成或放弃；采用结果只更新表单，仍需点击“保存修改”。取消、失败或未完整生成时保留原草稿。

AI 请求可停止，发送失败保留输入。空回复显示错误；未完成回复保留已有正文，可继续补全。客户端停止等待不能保证供应商已经开始的推理同步终止。普通请求默认超时为 20 秒，答疑与字段补充请求为 200 秒。

成功答疑按服务地址和账号保存在本机。单条回复可导出；AI 页和“我的 → 答疑记录”支持跨题目选择、批量导出及确认删除。导出为 UTF-8 Markdown，保留提问、完整正文、代码块、表格、模型和时间；Android 使用系统分享面板，浏览器直接下载文件。新对话只清空当前讨论，删除归档记录需在记录列表确认。

## 离线题库

首次登录需要连接题库服务，首次联网自动下载账户有权访问的题目。默认在距上次完整下载满 24 小时后，于打开 App、回到前台或恢复网络时检查并更新；也可选择“仅手动更新”。“我的 → 离线题库”的按钮随时可更新。下载失败保留此前完整题库，损坏的本地缓存可重新下载。

原生题目、答案、解析、分类、收藏和答疑记录保存在 SQLite，浏览器预览使用 localStorage。下载完成后可离线搜索、筛选、切题、收藏，并读取和导出已保存的答疑；AI 生成仍需联网。学习记录和收藏恢复连接后自动同步，同一道题的待同步记录合并为最新状态。

缓存按账号和服务地址隔离。退出登录会清除该账号的本机题库、答疑和未同步记录，已导出到其他应用的文件不受影响。仅连接局域网时仍尝试访问内网题库。外链图片等资源不包含在离线文本保障范围内。

## 格式展示

题干、答案和解析使用一致的 Markdown 规则：支持换行、分段、标题、加粗、斜体、嵌套列表、引用、围栏代码和表格。命令引号、代码缩进与 HTML 实体按原文保留；代码和宽表格独立横向滚动，正文和长链接在可用宽度内换行。空答案显示“暂无答案”，空解析不展示。

显示时可将同一行的连续编号答案拆成列表，代码与表格中的编号不参与处理。处理不改写数据库或 Markdown 导出文件。网页与 App 分别保留独立依赖与构建，通过共享样例检查解析结构一致。

## 开发与预览

使用 Node.js 22 LTS，版本至少为 `22.13.0`。移动端依赖独立安装，不改变网页端的 React 版本：

```bash
cd mobile
npm ci
npm start
# 浏览器预览
npm run web
# 已配置的安卓模拟器或已连接设备
npm run android
```

可复制 `mobile/.env.example` 为 `mobile/.env`，用 `EXPO_PUBLIC_API_URL` 设置默认服务地址。公开环境变量会进入客户端包，不能放入密码或密钥。浏览器预览跨域访问时，服务端 `ALLOWED_ORIGINS` 需包含预览地址；原生客户端不受浏览器 CORS 限制。

隔离预览服务可在安装 `api/` 和 `mobile/` 依赖后，从 `mobile/` 运行 `npx tsx scripts/preview-server.mts`。虚拟测试账号为 `preview / Preview12345`，数据位于临时目录，停止服务后清理。它仅用于本机流程预览。

键盘控制器需要包含原生模块的开发构建或独立 APK，普通 Expo Go 不足以验证原生键盘行为。浏览器预览可检查布局和接口流程；安卓键盘、返回键、手势、安全区域、离线恢复及系统分享须在模拟器或真机上验证。

## 构建

本地构建需要 Android SDK、Java 21，并设置 `ANDROID_HOME` 和 `JAVA_HOME`：

```bash
cd mobile
npm ci
npx expo prebuild --platform android --no-install
cd android
NODE_ENV=production ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=1 --no-daemon -Dorg.gradle.parallel=false
```

APK 位于 `mobile/android/app/build/outputs/apk/release/app-release.apk`。生成的原生目录不提交到仓库；修改原生配置或依赖后重新生成，配置应维护在 `app.config.ts` 或配置插件中。本地预览默认使用生成的调试签名，正式分发应配置自己的签名。需要其他架构时调整 `reactNativeArchitectures`。

已有原生目录时，可从 `mobile/` 使用 `bash scripts/build-android-local.sh package` 进行 ARM64 串行构建。此脚本限制 Gradle、Metro 和 C++ 编译并发；运行前应配置自己的 SDK 与 Java 环境，堆大小可用 `TGH_GRADLE_HEAP` 调整。内存受限时串行运行测试、导出和原生构建。

也可使用 EAS Build。`eas.json` 提供内部 APK 配置和正式 AAB 配置：

```bash
cd mobile
npm run build:apk
npx eas-cli build --platform android --profile production
```

首次使用需登录 Expo、关联项目并按 CLI 提示配置 `extra.eas.projectId` 和签名。正式发布前确定包名、版本与签名策略。

## 验证

```bash
cd mobile
npm run typecheck
npm run lint
npm test
npm run test:scripts
npm run export:android
npm run export:web
# 需先安装 api/ 依赖
npm run test:integration
```

集成测试使用独立临时 SQLite 数据库，验证登录、改密、令牌撤销、学习、收藏、切题、权限隔离和 AI 接口。AI 推理使用测试返回值，不连接已有题库或付费供应商。JavaScript 导出检查打包，不等于生成可安装 APK，也不能替代真机验证。

本地 ARM64 APK 可在完成同一次原生构建、保留生成的 bundle 和 sourcemap 后校验：

```bash
cd mobile
python3 scripts/verify-apk.py --apk android/app/build/outputs/apk/release/app-release.apk --sdk "$ANDROID_HOME"
```

脚本验证版本、升级签名、权限、原生模块、Hermes 和内置代码，并在成功后生成校验结果与校验和。`--sdk` 接受 SDK 根目录或具体 build-tools 目录。升级验证需在 APK 同目录保留自己此前版本的签名校验记录；首次建立发布基线时可明确加 `--allow-first-release`，此时不会声称已验证升级签名。使用 `python3 -O` 仍会执行校验。

该脚本依赖本地构建中间产物，不能直接用于任意下载的 APK 或 EAS APK。安装与发布前仍应在目标设备验证登录和改密、HTTP/HTTPS 连接、阅读与切题、键盘与返回键、离线同步、AI 取消与补全、文件分享和覆盖升级。
