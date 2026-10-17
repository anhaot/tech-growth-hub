# 公开技术题库 · 2026-10-17

共 **178 道、16 个分类**，由 221 道原题逐题复核、合并 44 道重复题并拆分 1 道混合题整理而成。适用于运维、容器、网络、数据库、可观测性及面试准备。

本目录是可移植公开版，JSON 仅包含题干、标题、答案、解析、难度和空分类 ID；不包含账号、个人经历原文、旧分类 UUID、私有服务地址、学习记录或 AI 凭据。个人经历题保留待填写模板，不能当作自己的经历使用。题库使用仓库的 [MIT License](../../LICENSE)，官方依据见 [SOURCES.md](./SOURCES.md)。

## 导入

1. 导入前导出完整备份。推荐先用一个新的独立账号或空题库验证。
2. 在网页的分类管理中逐一创建或选好下表分类。
3. 在题库页选择 JSON 导入，上传对应分类文件，并在页面指定目标分类。
4. 核对解析预览的题目数、答案及分类，确认后导入。每个文件只导入一次。
5. 全部完成后核对 178 道、16 个分类；App 在“我的 → 离线题库”手动更新。

**导入是新增操作，不会覆盖同标题旧题，也不会自动删除已合并题。** 已有 221 道的题库不要直接追加整个公开版；如需替换，应在备份后由维护者处理旧题及关联收藏/学习记录。此次文件整理没有修改任何部署数据库。

所有 `categoryId` 均为 `null`，便于跨账号和新数据库导入。页面不指定目标分类时会成为未分类题，不会自动创建这 16 个分类。`categories.json` 是分类清单，不是题目导入文件；[阅读版.md](./阅读版.md) 也不是产品的 Markdown 导入格式。

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

从仓库根目录执行 `cd api && npm ci && npm run test:bank`，在临时 SQLite 中创建分类，逐文件执行真实导入预览与提交，再核对保存内容和 JSON 导出回读。不会使用已有部署数据库；结束后删除临时数据。

`SHA256SUMS` 覆盖本目录中除自身外的公开文件。可在本目录执行 `sha256sum -c SHA256SUMS` 校验。代码示例经过格式与语法检查；生产运行前需按实际版本替换资源名、地址、权限并验证，不代表所有示例已在真实集群执行。
