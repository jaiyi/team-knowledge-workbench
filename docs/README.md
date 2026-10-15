# 团队知识工程

> 一个面向团队的 AI 工作台：把会议、资料和日常工作方式变成可确认、可测试、可版本化、可发布的知识与 Skill。

## 产品定位

本项目是**知识与 Skill 的创作发布工作台**，以可进入 DSH Desktop Workbench 市场的 `team-knowledge-workbench` 作为产品交付形态；它不是通用任务运行器，也不是 DeepSeek Harness 的替代品。

`team-knowledge-workbench` 自身是 Workbench product package；P0 的安装验证只证明这个产品包在 DSH Desktop 宿主中的安装、启动、健康检查和卸载契约。未来用户通过 Workbench 创建的 User-authored Plugin 是后续独立资产类型，不属于 P0 强制交付；用户 Plugin 的创建、发布、运行和安全审查必须在后续阶段独立设计和验收。验证文档中的 User-authored Plugin contract 不能被理解为 P0 已经实现用户 Plugin 能力。

`team-knowledge-workbench` 与 `team-knowledge-asset` 是两个分离的边界：前者是可被多个团队安装的 Workbench product package，后者是某个团队自己的知识、Skill、Git、WeKnora 空间、权限和治理资产域。同一个 Workbench 安装不能跨团队共享可变资产或授权。

## 产品边界与部署形态

```text
DSH Desktop / Workbench Market
  └─ team-knowledge-workbench
       └─ 多个团队分别安装和配置
            ├─ team-knowledge-asset-A → Git-A + WeKnora space-A
            └─ team-knowledge-asset-B → Git-B + WeKnora space-B
```

Workbench 的市场安装、版本和重启状态不等于团队资产发布。每个团队必须独立绑定 `team_id`、`asset_space_id`、资产 Git 仓库、WeKnora space、steward、review policy 和下游分发目标。DSH Desktop 的本地 state、Session ownership 和 market install record 不是共享团队控制面，也不是正式知识/Skill 的权威来源。

P0 需要在腾讯云建立脱敏、非生产的 Team Knowledge 验证环境。部署对象包括 Team Knowledge Backend、worker、PostgreSQL、对象存储和现有 WeKnora 的独立测试空间；DSH/Harness、SkillHub 和 TeamLab 若目标版本具备可部署制品则纳入部署验证，否则明确保留管理员/fake provider fallback，不把“可访问”写成“已集成”。Workbench 当前复用 DSH Desktop 的认证上下文，不以公司统一身份系统接入作为 P0 前提；后端仍必须验证身份、团队/asset-space ACL 和服务身份。Git、WeKnora、SkillHub、TeamLab 可以复用内部组件接入配置，但不能共享团队资产、可变草稿或授权。

身份与执行责任：当前用户通过 DSH Desktop 认证上下文进入 Workbench，后端映射 `principal_id`、团队成员和角色并重新校验 asset-space ACL。真实用户承担确认、审核和发布责任；Workbench Git bot、WeKnora adapter、SkillHub/TeamLab publisher 和 Worker 负责技术执行，分别记录 `approved_by`、`released_by`、`executed_by` 和 service identity。Git、WeKnora、SkillHub、TeamLab 可复用受控内部接入，但不共用用户 Token、团队资产授权或审计上下文。

```text
资料入口：会议纪要/资料 → 梳理讨论 → 知识草稿 → Git/MR/CI → protected main merge
  → Git merge event → Workbench outbox/worker → WeKnora ingest/read-back → published knowledge
能力入口：工作流描述 → 追问建模 → Skill + 测试 → Git/MR/CI → protected main merge
  → package/digest → SkillHub release/read-back → pinned digest
发布交接：SkillHub pinned digest →（TeamAI distribution/read-back，仅当 `in_scope: true`）→ DSH discovery/load/read-back；`in_scope: false` 时走管理员/fake fallback 或直接进入目标 DSH 验证，不把 TeamAI readiness 当作阶段门禁
反馈回流：Harness/业务反馈 → 知识复核或 Skill 回归 → 新的变更与发布
```

`merge` 只是触发事实，不等于知识已 `published` 或 Skill 已 `released`。WeKnora 的索引读回、SkillHub 的 release/digest 读回、TeamAI（仅当 `in_scope: true`）的安装读回和 DSH 的 loaded/profile 读回分别证明不同阶段；任何一个启用环节状态未知，都必须进入对账或人工 fallback，不能显示为最终成功。

工作台使用 PostgreSQL outbox 和持久 worker 编排上述异步操作，负责事件去重、租约、重试、读回、补偿和审计，但不成为知识或 Skill 的 canonical source。TeamAI 只消费 SkillHub 已确认的固定 `package_digest`，管理员流程只是 provider 不可用时的 fallback。

## 两种核心体验

首页只有两个创作入口，点击后会创建独立的 Creation Session；用户在会话内完成梳理、确认、测试、提交和发布，而不是在多个系统状态页面之间跳转。

### 1. 资料变知识

```text
拖入会议纪要/资料
  → Agent 摘要、拆解、定位来源和发现冲突
  → 用户逐条讨论、修订和确认
  → 生成知识资产草稿
  → 提交 knowledge-assets Git 仓库
  → WeKnora 建立 Wiki/索引
  → 后续 Harness 会话中的 Agent 可检索并引用
```

原始材料、模型推断、待确认事项和正式知识必须分开。未经人工确认、Git/CI 和审核的候选不得进入正式知识库。

### 2. 工作方式变 Skill

```text
描述一个重复的工作流
  → Agent 追问输入、步骤、判断、例外和输出
  → 生成 Skill 草稿、脚本/资源、契约和测试集
  → 用脱敏样例试跑、比较和修改
  → 用户确认并提交 Git
  → 审核通过后发布到 SkillHub
  → 交给 DeepSeek Harness 的 Skill Provider 消费
```

Skill 不只是 Prompt，而是可阅读、可测试、可版本化、可发布的能力包。工作台负责证明它可以发布；Harness 负责在自己的会话中发现、加载并运行它。

## 系统边界

| 系统 | 主要职责 | 本项目如何交接 |
|---|---|---|
| 团队知识/Skill 工作台 | 资料收件、知识/Workflow/Skill 草稿、测试、审核、Git/MR、发布状态、反馈候选 | 生成经过批准的版本、digest、package metadata 和引用 |
| knowledge-assets Git | 知识、Skill、契约、测试和审核后的 canonical source | 由工作台发起变更，不绕过分支保护和审核 |
| WeKnora | 已批准知识的 Wiki、索引、权限过滤、检索和来源引用 | 工作台展示 ingest/index/read-back 状态 |
| SkillHub | Skill package 的注册、版本和发布分发 | 工作台展示 release、version、digest 和真实状态 |
| DeepSeek Harness | Workspace、Session、Skill discovery/load、Agent 对话、工具、权限、运行时人工批准、恢复和运行观测 | 工作台只提供已发布资产并接收结构化反馈引用 |
| 业务系统/SPC 后端 | 业务事实、动态状态、计算、告警、工单和生产运行 | 工作台不复制业务运行状态机 |

发布后的 Skill 进入任务执行，是 DeepSeek Harness 会话工作台的职责，不是本项目的主要产品模块。

## 核心对象关系

```text
Workspace
└─ Creation Session
   ├─ Knowledge Draft / Workflow Draft / Skill Draft
   ├─ Draft Revision / Test / Evaluation
   └─ Asset Revision → Release → Handoff

Feedback Candidate → 新的 Creation Session

Harness session / 业务系统
  └─ 消费已发布版本并返回 feedback reference
```

- **Creation Session**：一次独立、可暂停、可恢复、可并行的知识或 Skill 创作上下文，不是正式资产，也不是 Harness Session。
- **Knowledge**：Agent 应该知道什么，以及依据、范围和复核条件。
- **Workflow**：用户实际如何完成一类工作，是生成 Skill 的中间建模对象。
- **Skill**：从工作流抽象出的可复用任务能力包。
- **Release**：经 Git/CI/人工审核并带固定版本和 digest 的可交付资产。
- **Feedback reference**：来自下游运行的结构化引用，不是本项目复制的完整运行记录。
- **Consumption summary**：按团队、Skill/version/digest 聚合的调用次数、活跃用户数、分层成功次数和 Badcase；工作台只接收最小消费事件和反馈引用，不复制 Harness Runtime。

## 首个垂直切片

1. 上传一份脱敏会议纪要；
2. 生成摘要、决策、规则、行动项、冲突和知识候选；
3. 用户讨论、修改并确认；
4. 提交 Git，并同步 WeKnora；
5. 描述一个相关的重复工作流；
6. 生成 Skill 草稿、资源和 3–5 个测试例；
7. 用样例试跑、比较并修改；
8. 确认后提交 Git、发布 SkillHub；
9. 生成交接记录，供目标 DeepSeek Harness 环境验证发现和加载。

首期不做本项目自己的任务执行入口、通用 Runtime、完整 Session/Run 控制面、运行时工具调用追踪、独立业务 Plugin Marketplace 或通用 SaaS 多租户控制面；但 P0 必须完成非生产部署验证，P1 必须验证至少两个团队/asset space 安装同一 Workbench 后的隔离。Workbench 多团队安装不等于建设一个共享可变资产的 SaaS 控制面。

## 文档阅读顺序

1. [方案总览与关键决策](./方案/00-方案总览与关键决策.md)
2. [问题、用户与产品范围](./方案/01-问题、用户与产品范围.md)
3. [端到端工作台工作流](./方案/02-端到端知识工作流.md)
4. [知识与 Skill 资产模型](./方案/03-知识资产与生命周期.md)
5. [角色、治理与运营机制](./方案/04-角色、治理与运营机制.md)
6. [系统架构与权威边界](./方案/05-系统架构与权威边界.md)
7. [数据、状态与可追溯性](./方案/06-数据、状态与可追溯性.md)
8. [发布、安全与故障处置](./方案/07-发布、安全与故障处置.md)
9. [MVP 实施、验证与验收](./方案/08-MVP实施、验证与验收.md)
10. [工作台信息架构与核心对象](./方案/09-工作台信息架构与核心对象.md)
11. [Workflow 到 Skill 的生成、测试与发布](./方案/10-Workflow到Skill的生成、测试与发布.md)
12. [整体工程开发阶段划分](./工程设计/00-整体工程开发阶段划分.md)
13. [P0 详细工程设计](./工程设计/01-P0详细工程设计.md)
14. [DeepSeek Harness 能力验证](./验证/03-DeepSeek%20Harness能力验证.md)
15. [验证材料总览](./验证/README.md)
16. [平台与 Provider 能力验证](./验证/01-平台与Provider能力验证.md)
17. [DSH Desktop Workbench 落地与多团队部署验证](./验证/04-DSH%20Desktop%20Workbench落地与多团队部署验证.md)
18. [DSH Plugin 开发与安装契约验证](./验证/05-DSH%20Plugin开发与安装契约验证.md)

验证材料只回答“外部能力实际证明了什么”，工程设计文档回答“我们准备如何实现和验收”。两者都不能把未验证的发布、索引、装载或运行显示为成功。

## 不可绕过的原则

- 模型不能直接发布知识或 Skill，也不能推送 protected `main`；
- Git/MR/CI/人工审核是正式发布门禁；
- WeKnora 只接收批准后的知识；SkillHub 不替代质量评测和审核；
- Skill 只能声明能力需求，不能自行扩大工具权限或数据范围；
- 不把聊天 Memory、运行日志或业务原文直接当正式资产；
- `approved`、`published`、`loaded`、`running` 和 `succeeded` 属于不同系统状态；
- 没有真实系统证据时，不声称已经发布、索引、装载或运行成功；
- 不提交生产 Token、Cookie、密码、业务原文或个人敏感信息。
