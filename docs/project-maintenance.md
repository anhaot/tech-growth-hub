# 项目产物清理

项目源代码位于 `api/`、`web/`、`mobile/`。Android 构建脚本、APK 校验与隔离预览服务集中在 `mobile/scripts/`；不再需要旧版 `output/android/` 中的重复构建脚本。

清理清单预览：

```bash
python3 scripts/cleanup-project.py
```

生成并校验当前版本 APK 后清理：

```bash
python3 scripts/cleanup-project.py --apply --keep-apk 1.2.6
```

脚本删除旧安装包、旧候选镜像的本地构建目录、浏览器临时截图/脚本与报告、Android/Gradle/CMake 中间目录及依赖里的原生编译缓存。下一次 Android 构建会重新生成这些产物。

保留当前和 `--keep-apk` 指定版本的 APK、对应版本日志及浏览器产物，便于覆盖安装或回退；省略该参数时自动保留本机已有安装包中最近的较早版本。当前版本号从 `mobile/package.json` 读取，不固定为 1.2.7。`tech-growth-hub-preview-arm64.apk` 是当前 APK 的链接，避免存两份相同的安装包。历史签名、校验 JSON、校验和、题库审计与数据库备份仍保留。源码、依赖的源文件、配置、签名密钥、题库与备份不在清理清单中。

应用清理前必须存在当前 APK 及匹配的版本 / SHA-256 校验记录，Python 优化模式也不会跳过检查；生成路径及祖先目录若为符号链接则跳过，避免误删链接指向的数据。清理记录按执行当天的上海日期保存为 `output/cleanup-YYYY-MM-DD.json`。

维护脚本回归使用临时目录模拟项目，不清理实际工作区：

```bash
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
```

累计文件尺寸可能重复计入硬链接，实际释放空间以文件系统的前后差值为准。
