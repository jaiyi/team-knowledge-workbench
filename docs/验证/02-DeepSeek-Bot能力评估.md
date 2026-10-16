# DeepSeek Bot 能力评估

> 本文是外部源码和能力验证材料，不是团队知识工程的核心架构。它只说明 DeepSeek Bot 能做什么、不能做什么，以及何时值得做 PoC。

## 1. 当前结论

基于已核验的 DeepSeek Bot 预览版本，DeepSeek Bot 是建立在 DeepSeek Harness 插件接口之上的多 Bot 组织、协作、长生命周期 Session 和本地记忆插件。

已确认的能力包括：Bot roster、角色化 Agent、Bot-to-Bot 消息、Group Chat、异步交接、Markdown Memory、Team Memory、定时任务、连接器和本地 usage ledger。

未确认它具备：组织知识索引和版本、Skill 注册/审核/分发、企业级 RBAC、多租户、统一审计、WeKnora/SkillHub 原生适配和 OTel/Phoenix/Langfuse 原生导出。

因此它只能作为 DSH 执行面之上的**可选协作层**，不能替代 Git、WeKnora、SkillHub、审批或企业控制面。

## 2. 能力边界

| DeepSeek Bot 能力 | 在本项目中的正确归属 | 结论 |
|---|---|---|
| Bot roster、Session、群聊和交接 | Agent 协作层 | 可候选 PoC |
| Bot/Team Memory | 运行时记忆/反馈候选 | 可用，但不能当正式知识 |
| 正式知识源文件和评审 | Git/CI | 不替代 |
| 知识索引、ACL、版本引用 | WeKnora | 需要外部适配 |
| Skill 注册、审核、digest 和晋升 | SkillHub + Git/CI | 未发现原生能力 |
| Plugin/tool 注册、安装、权限和健康 | Plugin registry/runtime + DSH profile | 需要外部适配和验证 |
| 工具权限和人工确认 | DSH profile/policy | 可复用，但需身份映射 |
| 统一 trace 和业务反馈 | 观测/反馈系统 | 需要适配器 |

## 3. Memory 的边界

Bot Memory 是本地运行时上下文，即使有自动 review，也不能证明事实经过领域责任人确认、跨场景验证或适合进入 WeKnora。Team Memory 的写权限也不等于正式知识审批。

Memory、群聊结论和 Bot-to-Bot 结果只能：

- 作为当前运行上下文；
- 生成反馈或候选记录；
- 由人确认后进入 Git MR；
- 经审核和索引确认后成为正式知识。

不得直接写入正式知识空间。

## 4. 推荐验证 PoC

选择一个低风险、只读、可回放任务，例如研究资料初筛和证据卡片整理：

```text
Main Bot
  → Researcher Bot：检索并列出引用
  → Reviewer Bot：检查证据、范围和冲突
  → Editor Bot：生成 Git MR 草稿
  → 领域 owner：审核并合并
  → WeKnora：索引批准版本
```

验收不看“群聊是否能完成”，而看：

- 每个 Bot 使用的 Skill 和知识版本是否可追溯；
- 结论能否区分事实、推断和未验证建议；
- Memory 是否严格停留在运行时；
- 失败和人工纠正能否生成候选；
- 是否真的减少交接和重复说明。

## 5. 进入条件和退出条件

只有在 P1/P2 稳定后，才做 Bot 协作 PoC。若需要多用户共享 roster、企业目录、集中任务队列、HA、限流、SLA、统一审计或服务端多租户，才重新评估服务端化；在此之前按本地 DSH 插件处理。

任何 Secret 都必须使用受控 Secret Manager，不能进入模型请求、工具结果、Git、Memory 或 trace。Bot、Room、Session、Exchange 和工具调用必须能关联到统一 run/correlation 链。Bot 不提供 Plugin registry、权限授予或外部系统健康的企业控制面。
