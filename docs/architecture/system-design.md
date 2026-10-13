# System Design

首期采用模块化单体 + 持久化 worker，不提前拆微服务。

```text
Console/API
  → application services
  → domain + validation + audit
  → persistent jobs
  → Git / WeKnora / DSH / distribution adapters
```

所有 provider 都通过 contract 接口接入。真实 provider 未验证前，使用 fake provider 和隔离环境；adapter 的存在不代表外部能力已经接通。
