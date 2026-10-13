# Team Knowledge Workbench

面向业务团队的 Knowledge + Skill 双资产 AI 工作台。

本仓库负责工作台控制面、领域模型、任务 worker、外部系统适配器、审核审计和运行反馈；不作为业务知识与 Skill 正式资产的唯一仓库。正式资产由配套的 [`team-ai-assets`](../team-ai-assets) 仓库管理。

## 当前阶段

**P0：工程边界与能力侦察。** 当前先建立可测试的模块化单体和 provider contract，不把未经目标环境验证的 WeKnora、DSH、SkillHub、TeamAI 或 Plugin runtime 描述为已集成。

## 仓库边界

```text
team-knowledge-workbench  工作台代码、控制面、worker、adapter、审计和测试
team-ai-assets            Knowledge、Skill、Agent Manifest、profile、golden cases 和回归资产
```

权威关系：

- `team-ai-assets` 保存业务资产的正式源、版本、owner 和审核 metadata；
- 本仓库保存如何创建、校验、审核、发布、装载、运行和反馈这些资产的产品与代码；
- WeKnora 只接收批准后的 Knowledge 索引；
- DSH 只装载批准 profile 中的固定 Skill/工具版本；
- TeamAI 是后续可替换的分发适配层，不是 canonical source；
- Plugin 管理、数字员工和经营项目任务流不属于 P1 硬依赖。

## 本地开发

```bash
npm install
npm run typecheck
npm test
```

当前脚手架尚未接入真实 provider。优先使用 fake provider 和脱敏 fixture 完成 contract test，再进入真实环境验证。

## 目录

- `apps/`：API、worker 和未来 Console 的运行入口；
- `packages/domain/`：Knowledge、Skill、Operation、Approval、Run、Feedback 等领域类型；
- `packages/contracts/`：provider 和外部边界 contract；
- `packages/validation/`：schema、权限和确定性门禁；
- `packages/audit/`：actor/job/asset/revision/run 追踪；
- `packages/*-adapter/`：Git、WeKnora、DSH、分发等适配器；
- `docs/`：执行版产品、架构和运维设计；
- `tests/`：unit、integration、contract 和 e2e 测试；
- `infra/`：本地、CI 和后续部署配置。

## 安全底线

不提交生产 Token、Cookie、密码、业务原文或个人敏感信息。任何高风险写入、权限扩展、对外发送和不可逆动作都必须保留人工确认与可回滚路径。
