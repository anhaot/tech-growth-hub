# 技术成长站 App

Expo SDK 57 + React Native 安卓客户端，连接现有技术成长站 API，支持 HTTP / HTTPS、背题、收藏、离线题库、AI 答疑及 Markdown 导出。使用与构建说明见 [安卓 App 开发与使用](../docs/android-app.md)。

使用 Node.js 22 LTS，版本至少为 `22.13.0`：

```bash
npm ci
npm start
```

首次登录填写自己的题库服务地址，与网页共用账号。原生键盘控制器需开发构建或独立 APK；浏览器预览和普通 Expo Go 不能替代安卓设备验证。

本地构建需先配置 Android SDK、Java 21 并生成原生目录。`bash scripts/build-android-local.sh package` 提供 ARM64 串行构建；也可使用 `npm run build:apk` 运行 EAS 内部 APK 构建。

本地 ARM64 APK 校验使用 `python3 scripts/verify-apk.py --apk <APK文件> --sdk <SDK目录>`，需保留同次构建生成的 bundle 与 sourcemap。SDK 也可通过 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 设置。升级签名验证要求保留此前版本的校验记录；首次发布基线可明确传入 `--allow-first-release`。校验失败不生成成功结果，`python3 -O` 也会执行全部校验。

隔离预览题库可在安装 API 依赖后，用 `npx tsx scripts/preview-server.mts` 启动。虚拟测试账号为 `preview / Preview12345`，数据保存在临时目录，停止服务后清理，仅用于本机流程预览。

代码验证使用 `npm run typecheck`、`npm run lint`、`npm test`；`npm run test:integration` 使用临时 API 验证登录、学习、AI 与权限隔离；`npm run test:scripts` 用模拟 Android 工具验证 APK 校验脚本。`npm run export:android` 和 `npm run export:web` 检查 JavaScript 打包，不生成可安装 APK。
