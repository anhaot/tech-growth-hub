# 依赖检查 · 2026-10-17

本次使用当前三个锁文件运行 npm audit。以下是受影响依赖节点数，包含由依赖链传播的告警，不等于独立漏洞数量。

| 范围 | high | moderate | 总数 |
| --- | ---: | ---: | ---: |
| API 全部依赖 | 0 | 0 | 0 |
| Web 生产依赖（`--omit=dev`） | 0 | 0 | 0 |
| Web 全部依赖 | 5 | 2 | 7 |
| App 全部依赖 | 18 | 8 | 26 |

Web 告警来自 Tailwind/PostCSS/glob 构建链；App 告警涉及 Expo CLI、Metro、预构建和签名工具依赖。Expo 把部分工具作为自身依赖发布，npm 的生产/开发分类不能直接判断某个包是否进入 APK。此次重新校验的 1.2.9 APK 对应 sourcemap 未包含下表四个问题包的源文件；这只是该 JavaScript 产物的范围核对，不能替代原生依赖审计或设备测试。

| 依赖 | 公开通告 | 当前处置 |
| --- | --- | --- |
| braces 3.0.3 | [深层模式导致栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | 通告未列修复版，当前 npm 正式版为 3.0.3；跟踪上游 |
| postcss-selector-parser | [选择器解析 CPU 耗尽](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | 已有 7.1.6，但当前 Tailwind 3 的部分父依赖仍要求 6.x；需要独立验证构建链升级 |
| node-forge 1.4.0 | [RSA 签名验证](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | 当前 npm 正式版为 1.4.0，通告影响该版本；跟踪上游 |
| uuid | [可选 buffer 边界检查](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | 通告列出的修复版为 11.1.1、12.0.1、13.0.1，Expo 的 xcode 工具仍依赖旧主版本；需随工具链验证升级 |

此轮没有执行 `npm audit fix --force`：其自动建议包含 Expo 57 → 44、React Native 0.86 → 0.72 等跨版本替换，不能视为兼容修复。也没有用任意主版本覆盖来隐藏告警。保留现有锁文件，后续应在隔离分支完成工具链升级和全部构建、APK/设备验证。

构建时仅使用可信源码、配置、glob 和 CSS 输入；开发/打包服务限制在可信环境中。生产使用构建后的静态 Web 和独立 APK，避免将 Vite、Metro、Expo 开发服务暴露到公网。上述措施不能消除依赖本身的问题。本次结果不能表述为“全依赖零漏洞”或完整安全认证。

复查：分别在 `api/`、`web/`、`mobile/` 运行 `npm audit`；另在 `web/` 运行 `npm audit --omit=dev`。通告和修复状态可能变化，以复查结果为准。
