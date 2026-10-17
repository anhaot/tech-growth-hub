# 核对依据

本题库用自己的表述整理技术要点。以下链接供核对版本和接口边界；外部资料按其原作者条款提供，不作为本仓库授权的内容。检索时应匹配实际部署版本。

- [Service 转发、IPVS 弃用与 nftables](https://v1-35.docs.kubernetes.io/docs/reference/networking/virtual-ips/)
- [Pod 中断与 PDB 边界](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)
- [NetworkPolicy 范围与节点流量](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Nginx upstream 动态解析及 1.27.3 版本说明](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [MySQL GTID 等待函数](https://dev.mysql.com/doc/refman/8.4/en/gtid-functions.html)
- [MySQL 复制线程](https://dev.mysql.com/doc/refman/8.4/en/replication-threads.html)
- [Linux TCP 参数的作用](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)
- [Calico IPPool 与封装参数](https://docs.tigera.io/calico/latest/reference/resources/ippool)
- [Flannel 后端、端口与网络条件](https://raw.githubusercontent.com/flannel-io/flannel/master/Documentation/backends.md)
- [KServe 0.18 canary rollout](https://kserve.github.io/website/docs/0.18/model-serving/predictive-inference/rollout-strategies/canary)
- [Kubeflow Trainer 现行 API](https://www.kubeflow.org/docs/components/trainer/overview/)
- [Kubeflow Pipelines 元数据](https://www.kubeflow.org/docs/components/pipelines/concepts/metadata/)
- [Kubeflow 架构与可选组件](https://www.kubeflow.org/docs/started/architecture/)
- [OpenTelemetry Collector 架构](https://opentelemetry.io/docs/collector/architecture/)
- [Envoy xDS API](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol.html)
- [Kafka 4.0 移除 ZooKeeper 模式](https://kafka.apache.org/blog/2025/03/18/apache-kafka-4.0.0-release-announcement/)
- [Elasticsearch 小集群韧性](https://www.elastic.co/docs/deploy-manage/production-guidance/availability-and-resilience/resilience-in-small-clusters)
- [Elasticsearch 7+ 选主机制](https://www.elastic.co/blog/a-new-era-for-cluster-coordination-in-elasticsearch)
- [Prometheus 存储要求](https://prometheus.io/docs/prometheus/latest/storage/)
- [Promtail 维护状态](https://grafana.com/docs/loki/latest/send-data/promtail/)
- [Python copy 语义与例外](https://docs.python.org/3/library/copy.html)
- [CPython 3.14 GC 变更](https://docs.python.org/3/whatsnew/3.14.html)
- [Docker containerd image store](https://docs.docker.com/engine/storage/containerd/)
- [KVM 内核与用户态 API](https://docs.kernel.org/virt/kvm/api.html)
- [Oracle 诊断工具许可说明](https://docs.oracle.com/en/database/oracle/oracle-database/19/dblic/Licensing-Information.html)
- [Deployment 更新策略与回滚](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Pod 与容器重启策略、原生 sidecar](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-restarts)
- [ss socket 查询工具](https://man7.org/linux/man-pages/man8/ss.8.html)

2026-10-17 复核重点：IPVS/nftables 的版本边界、PDB 与滚动更新、KServe 灰度、Nginx 动态解析、MySQL GTID 屏障、Promtail 维护状态和 Prometheus 本地存储要求。代码样例检查不等同于对全部产品版本进行运行验证。
