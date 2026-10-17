# 公开技术题库 · 2026-10-17

共 **178 道、16 个分类**，由 221 道原题逐题复核、合并 44 道重复题并拆分 1 道混合题整理而成。适用于运维、容器、网络、数据库、可观测性及面试准备。

本目录是可移植公开版，分类分文件仅包含题干、标题、答案、解析、难度和空分类 ID；单文件版另含分类名称及文件内引用 ID；不包含账号、个人经历原文、旧分类 UUID、私有服务地址、学习记录或 AI 凭据。个人经历题保留待填写模板，不能当作自己的经历使用。题库使用仓库的 [MIT License](../../LICENSE)，官方依据见 [SOURCES.md](./SOURCES.md)。

## 一次导入全部分类和题目

下载 [tech-growth-hub-question-bank-20261017.json](./tech-growth-hub-question-bank-20261017.json)，这是带分类的单文件版，包含完整的 16 个分类和 178 道题。需要 API/Web **v261017-1 或更新版本**；旧版本不能自动创建分类，必须先升级网页和 API。安卓 App 不需要重新安装。

1. 导入前导出完整备份。若已导入过旧题，不要重复追加；分类删除不等于题目删除。
2. 在网页题库中点击“导入题目”，选择“JSON格式”，上传这一个 JSON。
3. “导入到分类”保留默认的“按文件分类自动导入”，无需手工创建分类。
4. 点击“解析预览”，应显示 178 道有效题目，并列出缺失分类；空题库应提示自动创建 16 个分类。
5. 点击“确认导入 178 道题目”。确认后自动创建缺失分类、保存题目归属；已有同名顶层分类会复用。
6. 核对题目与分类数量；App 在“我的 → 离线题库”手动更新。

预览不会修改分类或题目，只有确认后写入。仅创建实际选中且成功导入的题目所需分类。自动创建需要分类管理权限，受限集成账号不能借导入扩大分类范围；多个同名顶层分类会提示先整理。文件内分类 ID 只是本文件的引用键，导入器会生成或解析目标账号的真实 ID。

**导入是新增操作，不会覆盖同标题旧题，也不会自动删除已合并题。** 若仅删除了原分类，旧题可能仍在未分类中；请先备份并检查题目总数，不要将重复追加当作替换。本轮没有修改部署数据库。

## 兼容旧版本的分类文件

下面的 `categories/` 文件继续保留，供旧版本手工创建并逐分类导入。新版本推荐直接使用上面的单文件 JSON；两种方式选一种，不能重复导入。

这些分文件中的 `categoryId` 为 `null`，需要在页面指定已有目标分类。`categories.json` 是分类清单，不是题目导入文件；[阅读版.md](./阅读版.md) 用于阅读，不是产品的 Markdown 导入格式。

| 分类 | 题目数 | 导入文件 |
| --- | ---: | --- |
| 服务网格与Envoy | 7 | [01-服务网格与Envoy.json](./categories/01-服务网格与Envoy.json) |
| MLOps与Kubeflow | 5 | [02-MLOps与Kubeflow.json](./categories/02-MLOps与Kubeflow.json) |
| Kubernetes网络与CNI | 24 | [03-Kubernetes网络与CNI.json](./categories/03-Kubernetes网络与CNI.json) |
| Kubernetes基础与工作负载 | 24 | [04-Kubernetes基础与工作负载.json](./categories/04-Kubernetes基础与工作负载.json) |
| Docker与容器 | 7 | [05-Docker与容器.json](./categories/05-Docker与容器.json) |
| 操作系统与主机运维 | 12 | [06-操作系统与主机运维.json](./categories/06-操作系统与主机运维.json) |
| 网络与安全 | 11 | [07-网络与安全.json](./categories/07-网络与安全.json) |
| 数据库与MySQL | 14 | [08-数据库与MySQL.json](./categories/08-数据库与MySQL.json) |
| 中间件与分布式系统 | 10 | [09-中间件与分布式系统.json](./categories/09-中间件与分布式系统.json) |
| 日志与Elasticsearch | 9 | [10-日志与Elasticsearch.json](./categories/10-日志与Elasticsearch.json) |
| 监控与可观测性 | 13 | [11-监控与可观测性.json](./categories/11-监控与可观测性.json) |
| DevOps与自动化 | 13 | [12-DevOps与自动化.json](./categories/12-DevOps与自动化.json) |
| 云计算与虚拟化 | 10 | [13-云计算与虚拟化.json](./categories/13-云计算与虚拟化.json) |
| Python基础 | 3 | [14-Python基础.json](./categories/14-Python基础.json) |
| 面试表达与职业发展 | 10 | [15-面试表达与职业发展.json](./categories/15-面试表达与职业发展.json) |
| Web服务与负载均衡 | 6 | [16-Web服务与负载均衡.json](./categories/16-Web服务与负载均衡.json) |

## 本次复核修正

在 2026-10-14 的 178 道修订版基础上，继续修正四道题：

- kube-proxy：将题干限定到 Service 转发与代理模式，使问题与答案一致。
- Deployment 镜像更新：补齐 ReplicaSet/Pod 的控制关系、更新策略条件、发布验证和手动回滚；说明超时不会自动回滚，以及数据库回退边界。
- Pod 重启策略：区分 Pod 级策略、普通 init、原生 sidecar 和受版本/特性门控影响的容器级规则。
- TCP 连接统计：补上实际计数命令、socket 与应用会话的口径差异，以及 TIME_WAIT 通常不能按存活进程归属的限制。

## 验证与适用范围

从仓库根目录执行 `cd api && npm ci && npm run test:bank`，在没有任何分类的临时 SQLite 中，上传单文件 JSON 执行真实导入预览与提交，自动创建全部分类，再核对保存内容和 JSON 导出回读。不会使用已有部署数据库；结束后删除临时数据。

`SHA256SUMS` 覆盖本目录中除自身外的公开文件。可在本目录执行 `sha256sum -c SHA256SUMS` 校验。代码示例经过格式与语法检查；生产运行前需按实际版本替换资源名、地址、权限并验证，不代表所有示例已在真实集群执行。
