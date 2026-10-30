# Workflow 到 Skill 的生成、测试与发布

> 本文说明用户如何把自然语言描述的固定工作方式，逐步完善为可测试、可发布的 Skill。Workflow 是工作台中的业务建模对象，Skill 是交给下游 DeepSeek Harness 消费的能力包；本项目不负责发布后的任务执行。

## 1. 为什么不能只生成一段 Prompt

用户说“我平时会先找资料、再按规则判断、最后写一份报告”，这还不是可发布 Skill。至少需要明确输入、输出、稳定步骤、判断依据、例外、确有需要时的知识查询、能力需求、人工确认点以及成功、失败和边界测试。

因此工作台先形成 Workflow Draft，再由平台和 Agent 生成 Skill Draft。

## 2. 从用户描述到 Workflow Draft

用户在「打磨可复用的技能」核对指定候选/版本并确认需要正式创作或修订，或从材料第五步确定有稳定可测的 Skill 缺口后，平台才创建独立的 `Skill Creation Session`、`Workflow Draft` 和 `draft_revision_id`，并绑定当前团队的 `team_id`、`asset_space_id`、Git repository；仅在确有知识查询需求时记录拟查询范围。仅浏览、核证候选或决定沿用旧版不建立会话。进入创作后，用户可以描述工作流、提供获准的 SOP/模板与历史产物，或从已分流 Feedback Candidate fork 修订会话。Agent 按阶段追问目标和触发、输入、步骤和判断、例外和风险、输出和成功标准。每个候选答案都要标明来源、假设和待确认状态。

```yaml
id: <workflow-id>
version: draft
purpose: <工作目标>
trigger: <触发条件>
inputs:
  - name: <字段>
    required: true
steps:
  - id: <步骤>
    kind: retrieve|transform|judge|human_gate|tool|produce
    description: <步骤说明>
    depends_on: []
    knowledge_profile: <可选依赖>
    capability_request: <可选能力需求>
exceptions:
  - condition: <条件>
    action: ask|stop|escalate
outputs:
  - name: <产物>
    schema: <结构>
success_criteria:
  - <可验证条件>
```

这是工作台中的中间表示。具体 Skill schema 和 loader 约定必须以目标 SkillHub/DeepSeek Harness 能力验证结果为准。

### Skill Creation Session 的隔离

同一用户可以并行创建多个 Skill 会话，也可以与知识会话并行。每个会话隔离对话、Workflow/Skill Draft、测试 fixture、评测结果、pending approval、异步 job 和 provider callback。所有生成、试跑、提交和发布操作都带 `session_id` 与 `draft_revision_id`。

如果会话基于正式 Skill revision 进行修改，必须记录 `base_asset_id` 和 `base_revision`。提交时若正式 revision 已变化，停止发布并进入 `revision_conflict`；由 Skill owner 人工合并或 fork，不能静默覆盖。

## 3. 从 Workflow Draft 生成 Skill Draft

| 对象 | 作用 |
|---|---|
| Workflow Draft | 描述业务工作如何推进，包含步骤、判断、例外和人工节点 |
| Skill Draft | 把可复用任务能力包装成可发布文件包 |
| Knowledge dependency（可选） | 确需查询时声明知识 ID/固定版本、查询目的及使用条件，不复制正文、不授予检索权限；零结果/无权/失效时向用户说明并请求核实 |
| Capability request | 声明需要的知识、工具或 profile 能力，不授予运行时权限 |
| Test Case | 证明 Skill 在代表性输入上的行为 |
| Evaluation Result | 保存一次样例或测试集的评测证据 |

一个 Workflow 可以生成一个 Skill，也可以拆成多个 Skill 节点。首期优先支持一个 Workflow 对应一个主 Skill，避免过早建设复杂编排。

### Skill 包内容

```text
skills/<domain>/<name>/
├── SKILL.md
├── skill.yaml
├── contract/
│   ├── input.schema.json
│   ├── output.schema.json
│   └── effects.yaml
├── scripts/
│   └── <可选确定性脚本>
├── references/
│   └── <模板、格式和示例>
├── tests/
│   ├── golden/
│   ├── boundary/
│   ├── exception/
│   ├── regression/
│   └── security/
├── dependencies.lock
└── CHANGELOG.md
```

以上路径相对于当前 `asset_repository` 的 repository root；`skills/<domain>/<name>/` 是 Git canonical source path，`contract/` 是源码中的规范契约目录。若 SkillHub 或 DSH loader 使用不同的外部布局，由 package builder 映射，并在 manifest 中记录 `asset_repository_id`、source repository、source path 和 approved merge commit，不在 Git 中并行维护 `schemas/` 和 `contract/` 两套 canonical 目录。

`SKILL.md` 说明使用边界、输入输出、推荐步骤、确需时的知识查询对象/条件/用途、能力需求和失败处理；查不到、无权、版本不可用或时效不明时应说明未核实并向用户请求核实，停止依赖该知识的结论，不能绕权或编造事实。`skill.yaml` 记录 id、version、owner、风险等级、schema、可选的固定知识引用、effects/能力声明、兼容目标、测试集和发布策略。确定性处理优先放入脚本；脚本和资源必须经过依赖、secret、权限和安全检查。

## 4. 交互式生成体验

本节双栏与底部动作是**进入正式 Skill Creation Session 后**的交互示意，不能取代现行「引入 Skill → 自动校验 → 具体修改与复测 → 审核提交」页内流程，也不表示每个页内步骤均已由目标 DSH 实现。会话内可采用“对话 + 结构化工作区”双栏模式：

```text
左侧：Agent 追问、解释、发现冲突和提出修改
右侧：Workflow/Skill 草稿、字段、文件树、差异和待确认项
底部：保存草稿、生成测试、静态校验、受控试跑（隔离门通过后才开放）、提交审核、发布状态查看
```

每轮对话结束后列出新增字段、修改步骤、新增假设、待确认边界和可生成测试例。不能让 Agent 在聊天中静默覆盖整个 Skill 包。

## 5. 测试集与评测

测试至少包含 Golden、Boundary、Exception、Regression 和 Security cases。首个 Skill 准备 3–5 个覆盖正常、边界和失败路径的脱敏样例，不以“模型看起来回答不错”代替测试集。

**未批准 Draft 的执行边界（R-03 已裁决，隔离能力待实测）**：生成测试、检查 schema/依赖/secret/effects 声明与执行候选代码、脚本或 Tool 是两类不同动作，分别记录 `static_checked` 与 `execution_blocked|runner_tested`，不能把前者显示为真实试跑通过。隔离 Runner 的安全与平台准入未完成前，只开放不执行候选代码、不发外部调用的静态校验；浏览器固定虚构规则演练只标演示，不成为送审五门中的真实测试证据。受控试跑须由服务端针对固定 `session_id/draft_revision_id`、包/依赖版本、获准脱敏 fixture 和受限 tester 权限重新鉴权；仅在经负向测试的隔离非生产 Runner 中按批准动作运行，不带生产凭据，不允许跨团队读取或默认网络、文件、进程权限，实施 CPU/内存/时间/并发/成本配额、超时强制终止、清理和最小化审计。Runner 不可用、权限撤销、配额超限或隔离证据不足时 fail-closed，不能借 DSH 原生对话、通用 Tool 或 CI 绕过；此时保持真实测试门禁未满足，暂停送审而非伪造 `tested`。可执行范围及具体隔离机制以目标环境 Spike 决定，不预设已具备。

一次测试记录 Skill version/digest、Workflow revision、input fixture、确需时的知识引用版本与查询结果/不可用原因、能力需求声明、输出、期望与实际差异、断言、人工纠正、延迟/成本和失败分类。知识零结果、无权、过期或指定版本不可用的脱敏 fixture 应断言 Skill 告知用户并请求核实，不据此完成依赖知识的判断；未依赖知识的 Skill 不强制此类测试。测试只产生工作台评测证据，不改变正式知识、SkillHub release 或 Harness profile。

评测结果至少包括 contract、deterministic script、golden/regression、citation、output completeness、safety/permission 和 human review。评测失败时 Agent 可以提出修改，用户决定是否接受。

## 6. 提交到 canonical asset repository Git

```text
Skill Draft
  → 规范化文件包
  → secret/dependency/schema/security 检查
  → 创建分支或变更请求
  → commit / MR
  → CI
  → owner/reviewer 审核（canonical protected main 合并前仍审核中）
  → canonical protected main 经审合并（Skill 已发布）
```

平台展示变更摘要、文件差异、测试和门禁、审核意见、commit/MR 链接以及失败原因。默认由 Workbench Git service identity 创建分支、commit 和 MR；`created_by`/`submitted_by`/`approved_by` 仍记录真实 DSH 用户及责任角色。模型不能直接 push protected `main`，也不能用 Hook 绕过审核。

## 7. 从固定 Git 版本打包、候选 SkillHub 发布与下游交接

本节给出既有推荐拓扑的**条件性路径**，不是目标环境已经具备 SkillHub/TeamAI API 的结论。最终是否采用 SkillHub 注册与 TeamAI 分发，或等价实现/限期管理员固定包 fallback，须先通过[工程设计选型门](11-开发工程设计与集成基线.md#7-skillhub-与-teamai-的角色评估及选择门)并记录 ADR；无论何种路径，DSH loader/真实装载与业务结果均独立读回。

Skill 属于当前团队的 `team-knowledge-asset`。Git 正式发布记录须绑定 `team_id`、`asset_space_id`、`asset_repository_id`、`repository_identity`、`repo_path`、source repository、经审合入 canonical protected main 的 Git revision、`skill_owner`、`approved_by`、`released_by` 和 `executed_by`；此时不要求已有发布后的 package digest 或 Registry 读回。后续 Skill package 另记固定源 commit 与 package digest，选用 Registry 时再记真实 release read-back。Skill 在核实该 merge commit 后才为 `已发布`，合并前即使 CI/人审通过仍为 `审核中`；Workbench Plugin 是否已安装在 DSH Desktop、后续是否打包或走管理员 fallback 均不改变此判定：

```text
Git 已发布 commit（经 MR/CI/指定审核人批准并合入 canonical protected main）
  → package root: skills/<domain>/<name>/
  → package
  → SkillHub release request（若通过选型；否则等价 Registry 或管理员固定包 fallback）
  → release/version/digest read-back（真实 Registry 路径）或 fallback 操作证据（非 release）
  → pinned digest
  → TeamAI distribution/read-back（仅启用时）
  → DSH handoff/discovery/load 验证
```

工作台分别确认 Git 已发布版本、package/version/digest、知识依赖、兼容目标和选用时的 Registry 状态；若选 SkillHub，它负责真实注册、版本、release read-back 和 pinned digest，但不能决定 Skill Git 发布状态；TeamAI（如启用）只负责消费 pinned digest 并完成目标安装读回；DeepSeek Harness 负责实际 handoff、discovery/load、session 消费、工具策略、运行时人工批准和运行结果。未选用相应 Provider 时不写其 release/install 事实；工作台不把目标 profile“可用”、Skill“loaded”或任务“succeeded”写成自己的发布成功状态。Registry 失败/未知只保持该步骤待核/失败，不抹除已经核实的 Git 已发布；未核实 Git merge 时即使有管理员固定包回执也仍不得称 Skill 已发布。

**TeamAI 下发补充**：上游文档描述的贡献路径是 `teamai push→PR/MR→审核 merge`，成员首次在目标机/工作区 `teamai init` 后，受支持客户端的 SessionStart Hook 才会在**下一次会话**执行 `pull`；既有会话、未初始化或离线目标不会因仓库 merge 即时收到更新。Workbench 提交只进入 canonical Git 的受审链；如 TeamAI 使用另一个团队仓库，固定包的复制还须在镜像仓经审查合并，不允许绕过首个受审版本。必须分别展示“canonical Git Skill 已发布 → 源包已打包/Registry 已读回（或 fallback）→ TeamAI 仓库版本可拉取→指定目标已 pull/安装且 digest 读回→DSH profile 已 loaded”，不把前一步冒称后一步。目标配置、成员引导、同仓/受审镜像和设备撤回条件见[工程设计 3.2、5.4](11-开发工程设计与集成基线.md#32-teamai-配置与成员设备引导仅选用时拟议)；这些是目标版本待测集成契约，不是 TeamAI 已在 DSH Desktop 无感运行的证据。

如果选定的 Registry 暂时不可用，允许有期限的管理员固定包 fallback，但必须保持 Git、审核、digest、目标、操作人和回滚语义，并将实际路径标为 `release_mode=admin,fallback_only`；不能把它写为 SkillHub release。

## 8. 版本和晋升

```text
draft → tested → 审核中（含批准未合并） → 已发布（canonical protected main 经审 merge）
                                               └→ packaged → registry_released（选用且读回）/ fallback_only（非 Registry release）
                                                   → distributed/installed → loaded → consumed（各自独立取证）
```

- `draft`：工作台中可编辑；
- `tested`：契约和测试有证据；
- `审核中`：等待 owner/reviewer，或虽已批准但尚未合入 canonical protected main；
- `approved`：Git/CI/人工审核批准的证据，不是正式发布状态；
- `已发布`：核实指定 Skill 版本经 MR/CI/指定审核人批准并合入 canonical Git protected main；
- `packaged`：从该固定 merge commit 构建不可变 package/digest；不是发布门槛的替代；
- `registry_released`：仅选定的真实 Registry 对 release/version/digest 作最终读回；管理员路径另记 `fallback_only`，不标记为 Registry released，也不因此推进 Git 已发布；
- `distributed/installed`：所选目标按 pinned digest 安装并读回；只有选用 TeamAI 且目标读回通过时才记 TeamAI installed；
- `loaded`：DSH profile 实际装载并读回相同 digest；
- `deprecated`：不再推荐新会话消费；
- `rollback`：固定回到已知可用 digest。

Skill 的 `success_criteria` 应至少定义技术完成、契约成功和业务成功的判定方式；确认的 Badcase 必须能关联实际 version/digest，并可转为回归样例或新的 Creation Session。

一次样例成功不能自动晋升，也不能把下游一次运行成功当成 stable 依据。是否可供指定 Harness profile 消费，要由发布和下游运行治理共同决定。

## 9. 失败和反馈

| 问题 | 处理 |
|---|---|
| 输入或输出契约错误 | 修改 Skill schema 或 Workflow 输入 |
| 步骤/判断不正确 | 修改 Skill/Workflow 并增加回归样例 |
| 知识事实或引用错误 | 生成知识复核候选 |
| 能力需求或权限声明不当 | 修改声明并由下游 owner 复核 |
| Git/CI 失败或批准后未合并 | 修订文件/门禁问题或等待受保护 main 合并；保持审核中，不显示 Skill 已发布 |
| 合并事件丢失或审核/commit 归属未知 | 按受保护 main 与审核证据对账；未核实前保持 unknown/reconciling，不凭 webhook 或固定包回执标已发布 |
| SkillHub 发布失败 | 该 Registry release 标失败/待对账，不能显示 Registry 已发布；已核实的 Git Skill 已发布不回退 |
| 交接版本或 digest 不一致 | 停止交接并进入分发对账 |
| Harness 运行效果不稳定 | 接收结构化反馈，回归测试后再发布 |

反馈不会自动覆盖当前版本，也不会把运行记忆直接写入 Skill 包。

## 10. MVP 交付边界

首期做：

- 一个工作流到一个主 Skill；
- 对话追问 + 结构化草稿；
- 说明、schema、少量脚本/资源；
- 3–5 个测试例和样例试跑；
- Git MR/CI/指定审核人批准及 canonical protected main merge 的 Skill 已发布证据；
- 一个已验证的真实候选 Registry release，或标明 `fallback_only` 的管理员固定包路径（均非 Git 发布的替代）；
- package/version/digest/依赖的 DSH 交接记录；
- 结构化反馈引用和回归候选。

首期不做：

- 本项目自己的任务执行入口或通用 Runtime；
- DeepSeek Harness 的 Session、Skill loader、Tool Call、运行时人工 gate 和完整运行追踪；
- 通用可视化 DAG 编排器；
- 自动从任意聊天批量生成 stable Skill；
- 未经审批的生产工具写入；
- 独立业务 Skill 分发市场（Skill marketplace）；
- 独立业务 Plugin Marketplace；
- 复杂跨 Skill 动态规划；
- 把 SkillHub 当成测试、权限和运行遥测的唯一系统。
