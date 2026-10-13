# Data Model

P0 先定义最小可追踪对象：

- `asset` / `asset_revision`；
- `operation` / `job`；
- `approval` / `audit_event`；
- `distribution_target` / `distribution_installation`；
- `profile` / `run`；
- `feedback` / `review_task`。

最小追踪链：

```text
actor → operation → job → asset revision → Git/MR/CI
→ release/index/distribution installation → profile + installed revision
→ run → knowledge refs + skill digest + tool calls → feedback
```

敏感正文和凭据不进入长期 trace；运行记录只保存必要的引用、版本和结果摘要。
