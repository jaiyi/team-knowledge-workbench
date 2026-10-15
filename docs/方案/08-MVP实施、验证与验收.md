# MVP 实施、验证与验收

> 本文是唯一的实施路线和验收入口。首期交付知识与 Skill 创作发布闭环；DeepSeek Harness 的会话执行由下游能力验证和交接验证覆盖，不作为本工作台 Runtime 建设。

## 1. 交付方式

采用：**一个知识域、一个高频低风险工作流、一个 Git provider、一个 worker、一个知识 steward、一个 Skill owner、一个发布目标、一个下游 Harness 验证环境和一个腾讯云非生产部署环境**。

本文中的 `team-knowledge-workbench` 是本项目自身的 Workbench product package；未来用户通过工作台创建的 User-authored Plugin 是后续独立资产类型，不属于本期强制交付。P0 的宿主安装验证只能证明 Workbench product package 的安装契约，不能证明用户 Plugin 已可创建、发布或运行。

每个阶段留下版本、环境、fixture、运行命令、预期/实际结果、失败动作、owner、回滚方式和 Go/No-Go 决策。P0 的部署对象是 Team Knowledge Backend、worker、PostgreSQL、对象存储、现有 WeKnora 的独立测试空间，以及目标版本可确认时的 DSH/Harness、SkillHub 和 TeamLab 服务或 provider；DSH Desktop Electron 客户端通过本地/市场安装 Workbench product package，不作为腾讯云服务部署。当前用户认证复用 DSH Desktop 上下文，不以公司统一身份系统接入作为 P0 前提。

## 2. 实施路线推荐

本节规定从方案进入开发、验证和非生产上线的推荐顺序，不替业务侧决定首个具体试点场景，也不替业务侧指定第一推动者、第一用户和第一受益者。以下输入由业务侧确认后写入试点输入卡；未确认前只能进行技术验证，不能进入 Pilot Beta：

```yaml
pilot_scenario: <待确认的低风险、高频、边界清晰场景>
first_sponsor: <待确认的第一推动者>
first_user: <待确认的第一用户>
first_beneficiary: <待确认的第一受益者群体>
business_outcome_owner: <待确认的业务结果 Owner>
manual_baseline: <待确认的人工基线>
target_improvement: <待确认的目标改善>
pilot_stop_conditions: <待确认的停止条件>
```

Provider 不得只用一句“如启用”描述。阶段 0 需要建立并持续更新以下 readiness matrix；每次状态变化都必须关联证据 manifest、责任人和复审日期：

| Provider | 目标版本/环境 | provider_mode | integration_status | in_scope | 本阶段必需证据 | 允许 fallback 的阶段 | 阻塞条件 | 回滚路径 |
|---|---|---|---|---|---|---|---|---|
| Git | `<待确认>` | `fake \| admin \| real` | `pending \| blocked \| fallback_only \| contract_verified \| real_verified` | `true` | merge event 验签、protected ref、commit/path/read-back | 阶段 2–7 可使用 fake；真实试点前须明确 real 或受控 admin | 无法证明 canonical repository、签名或 merge commit | 保留旧 commit，撤销 MR/事件并人工对账 |
| WeKnora | `<待确认>` | `fake \| admin \| real` | 同上 | `true` | ingest、document/version/source/ACL、retrieval read-back | 阶段 2–4 可使用 fake；Knowledge-first 真实消费前须 read-back | 无法关联 source commit、ACL 或可检索状态 | 保留旧索引，停止 published 标记并重试/对账 |
| SkillHub | `<待确认>` | `fake \| admin \| real` | 同上 | `true` | package、release id、version/digest、撤回 read-back | 阶段 7 可使用 fake/admin；Pilot Beta/Stable 按声明范围判定 | release digest 不一致或无最终状态 | 固定旧 digest，撤回未确认 release |
| TeamAI | `<待确认>` | `fake \| admin \| real` | 同上 | `false`（除非纳入本期目标分发路径） | pinned digest、target、installed revision、文件清单/digest | `false` 时为 `readiness_only/non_blocking`；纳入后可在阶段 7–8 fallback，不阻塞 Knowledge MVP | 解析 `latest`、目标 workspace 错误或 digest 漂移 | 停止同步，恢复上一 pinned digest |
| DSH/Harness | `<待确认>` | `fake \| admin \| real` | 同上 | `true` | handoff、discovery、显式 load、profile/tool policy、loaded digest | 阶段 2–7 可使用 contract/fallback；真实 loaded 只在阶段 8验证 | 无法证明 loaded digest、权限策略或版本兼容 | 清理目标 profile，回退旧版本并重新对账 |
| TeamLab/其他分发 | `<待确认>` | `fake \| admin \| real` | 同上 | `false`（除非纳入本期目标分发路径） | target binding、固定 package、安装/撤回 read-back | `false` 时为 `readiness_only/non_blocking`，不阻塞 N5/P6；`true` 时执行阶段 8/N5 固定 digest 交接 | 目标绑定或撤回不可读回 | `false` 时管理员固定版本操作并记录审计；`true` 时按固定 digest 撤回/回滚 |

`fake` 或 `admin` 可以满足契约和受控技术验证，但不能单独满足真实 Provider、Pilot Beta 或 Stable 的证据要求；fallback 必须有有效期、操作人、原因、固定 package/digest、回滚路径和到期复审日期。

首期不是“先做完 Knowledge、以后再做 Skill”，而是 **Knowledge-first、Skill 同期进入 MVP**：Knowledge 作为首条业务闭环和 Skill 的固定知识依赖先行验证；Skill 在同一个 MVP 周期内完成创建、契约、测试、打包、安装/发布 fallback 和最小消费验证。SkillHub、TeamAI、DSH 的真实 Provider 能力可以分阶段验证，但不得因为 Provider 尚未 `real_verified` 而省略 Skill 本身的 MVP 交付。

实施路线采用“主链路顺序 + 节点性双资产验收”：先完成能支撑 Skill 固定依赖的 Knowledge 基础能力，但每个重要功能完成后，都必须同步验证 Workbench product package 的构建、打包、安装、重启和最小 read-back；涉及 Skill 的节点还必须验证 Skill package、digest、安装或 fallback release。这样既保持 Knowledge-first 的业务优先级，又避免 Skill 和产品安装契约拖到 MVP 末尾才暴露问题。

| 节点 | 重要功能完成标准 | Knowledge 验证 | Skill/Workbench package 验证 | 节点安装与回滚门禁 |
|---|---|---|---|---|
| N0 工程骨架 | Backend、Worker、Workbench client、配置和健康检查可启动 | 健康检查、身份上下文和 fake provider smoke | Workbench product package manifest、server/client entry 和宿主安装 contract | `build → package → digest → fresh-profile install → restart → boot/load report` |
| N1 控制面与隔离 | session、ACL、job、outbox、审计和双 asset-space 隔离可用 | 两个 asset-space 的 session/job/ACL 隔离 smoke | 同一 package 在两个 profile 安装，确认 enabled/UI/read-back，不能共享可变资产 | 固定 package digest、双 profile 安装、重启、隔离 smoke、disable/uninstall |
| N2 Knowledge 发布链 | Creation Session、Git merge、WeKnora read-back 和 retrieval smoke 可用 | `创建 → 确认 → MR → merge → ingest → read-back → 检索` | Skill fixture、Knowledge dependency 声明和 contract fixture 可随同测试 | 增量 package 安装、fixture contract/read-back、失败回滚 |
| N3 Skill MVP | Workflow、Skill contract、测试、package builder 和 fallback release 可用 | Skill 依赖的 Knowledge ID/version/source commit 可读回 | `Workflow → Skill → golden/regression/security → package/digest → install/load` | fresh-profile 安装、restart、load/read-back、digest 对账、rollback |
| N4 消费与反馈 | Knowledge/Skill 消费事件、反馈引用和三层指标最小闭环可用 | Knowledge 引用、修订任务和反馈分流可对账 | Skill version/digest、technical/contract/business status 和反馈引用可对账 | 消费版本对账；失败后 disable/uninstall 或回退上一版本 |
| N5 Provider 交接 | 外部 Provider 适配器和 read-back contract 可用 | 不改变 Git/WeKnora canonical source 和检索权威 | SkillHub →（TeamAI，仅当 `in_scope: true`）→（TeamLab，仅当 `in_scope: true`）→ DSH pinned digest/read-back | 每个纳入的真实 Provider 节点重复 `build/package/digest/install/restart/load/read-back/rollback` |
| N6 MVP 发布候选 | 双资产版本、ACL、旧版、指标和回滚证据齐全 | Knowledge 发布、消费和反馈闭环验收 | Skill package、digest、fallback/真实 release 和最小消费验收 | 发布候选 fresh-profile 安装、端到端 smoke、disable/uninstall/rollback |

每个节点必须记录目标版本、环境、package/artifact digest、fixture digest、实际命令和退出码、read-back、失败路径、回滚结果、执行人、复核人和证据自身 digest。未完成节点性打包和安装测试的功能，不得进入下一个 MVP 节点；节点测试失败时可以保留已通过的旧版本，但不得把失败功能标记为已发布或已安装。


### 阶段 0：方案冻结与实施输入

- **目标**：将产品边界转成可开发、可验收且不误解业务责任的实施基线。
- **输入**：已批准方案、验证计划、Provider 能力现状、目标环境，以及待确认的试点场景、三类角色、人工基线、目标指标和停止条件。
- **主要设计/开发项**：冻结只建设知识与 Skill 创作、测试、审核、发布和反馈控制面；明确不建设 Harness Runtime、通用任务运行器或完整业务状态机；统一术语和状态词典；建立风险登记表和依赖清单。
- **输出**：实施基线、试点输入卡、范围清单、状态词典、风险登记表、任务拆分表和阶段验收清单。
- **测试**：方案结构检查；状态/边界正反例评审；缺少试点输入时的阻塞测试；敏感数据和生产凭据扫描。
- **证据**：批准版本、评审记录、输入卡版本、风险 owner 和决策记录。
- **退出条件**：工程团队能明确做什么、不做什么、何时算成功；所有缺失业务输入都有 owner 和截止时间。
- **阻塞条件**：范围仍包含通用 Runtime 或高风险生产写入；没有业务结果 Owner 或人工基线；无法区分 fake/admin 与 real provider 证据。

### 阶段 1：领域模型、状态机与接口详细设计

- **目标**：在业务代码前冻结控制面数据模型、状态迁移、外部契约和错误语义。
- **输入**：阶段 0 基线、既有对象关系、Provider contract。
- **主要设计/开发项**：定义 `team`、`asset_space`、`asset_repository`、`creation_session`、`draft`、`draft_revision`、`asset_revision`、`knowledge`、`skill`、`release`、`handoff`、`outbox_operation`、`worker_attempt`、`reconciliation_record`、`feedback`、`consumption_event`、`metric_aggregate`、`audit_event`；绘制 Creation Session、Draft、Release、Handoff、Outbox 和 Provider Operation 状态机；设计 API schema、错误码、幂等键、`operation_id`、`correlation_id` 和 `expected_state_version`；设计 migration、唯一约束、乐观锁、索引、审计、soft delete、备份恢复和数据保留；定义 merge、read-back、package、release、handoff、consumption、feedback event。
- **输出**：领域模型图、状态机、OpenAPI/JSON Schema、ERD/migration、事件契约、错误码表、权限矩阵和 API examples。
- **设计冻结门**：必须同时冻结数据字典、合法/非法状态迁移、API request/response、错误模型、幂等和唯一约束、事务边界、并发策略、Provider callback/read-back、审批/发布/回滚授权、迁移兼容策略、审计事件、evidence manifest schema 及其正向/负向/故障测试矩阵；未形成这些设计物只能进入设计评审，不能进入控制面实现或真实 Provider 接入。
- **测试**：先写状态迁移和 schema contract tests；覆盖非法迁移、重复幂等、旧版本更新、跨团队访问和错误响应；数据库约束使用 integration test。
- **证据**：schema digest、migration checksum、测试结果、契约评审记录和权限矩阵版本。
- **退出条件**：核心对象和异步操作可以由测试独立创建、推进、查询和恢复；外部调用均可追踪；关键隔离和唯一性约束在数据库层生效。
- **阻塞条件**：状态只能由页面文案表达；异步接口无法查询最终状态；没有幂等/旧版本保护；权限依赖客户端 team 参数；事件无法关联 canonical commit 和 provider operation。

### 阶段 2：外部契约与技术 Spike

- **目标**：先证明身份、隔离和最短发布链可行，再决定真实 Provider 接入顺序。
- **输入**：阶段 1 契约、目标 DSH/Git/WeKnora/SkillHub/TeamAI 版本和非生产凭据。
- **主要设计/开发项**：完成 DSH auth context 到 `principal_id`、`team_id`、`asset_space_id` 的映射和后端重新授权；完成 Git webhook/merge event 的签名、重放、乱序、旧 SHA 和幂等 Spike；完成 Git → fake WeKnora → read-back 的 ID、路径、版本、source commit、ACL 和检索映射；完成 package/digest → fake SkillHub → release/read-back；为各 Provider 记录 `provider_mode`、`integration_status`、版本、环境、owner、阻塞原因和 fallback；注入 timeout、重复提交、响应丢失、read-back 不一致和迟到回调。
- **Spike 记录格式**：每个 Spike 单独登记 `hypothesis`、`timebox`、`fixture`、`expected_result`、`actual_result`、`decision`、`owner`、`evidence_digest` 和对后续阶段的影响；至少拆分为控制面/跨团队拒绝、Git → outbox → worker → WeKnora、Skill package/digest/fallback、Workbench product package 安装四类实验。失败时只能选择调整设计、保留 fallback 或阻断后续阶段，不得以“接口可访问”代替成功。
- **输出**：Provider capability matrix、Spike fixture、fake provider、真实 Provider blocker 清单、evidence manifest 模板和 read-back 字段映射。
- **测试**：contract、sandbox integration、签名/重放、故障注入和凭据扫描；真实 Provider 仅在非生产执行。
- **证据**：目标版本/环境、fixture digest、命令及退出码、provider read-back、失败/回滚结果、复核人及证据 digest。
- **退出条件**：身份/隔离通过；Git → WeKnora 最短链路有可重复证据；每个 Provider 有 real/fallback/blocked 状态和下一步；fake provider 足以支撑开发。
- **阻塞条件**：无法证明请求属于正确 asset-space；read-back 无法关联 source commit；只有 HTTP 成功没有业务状态；未验证能力被当作 P1 硬依赖。

### 阶段 3：工程基础与控制面

- **目标**：用模块化单体加持久 Worker 建立可测试、可恢复的最小运行骨架，避免过早微服务化。
- **输入**：migration/API/事件契约和 fake provider。
- **主要设计/开发项**：建立 backend、worker、Workbench client、provider adapter、domain/application/infrastructure 和 fixture 模块；实现配置分层、Secret Manager 引用、结构化日志、trace/correlation、审计、健康检查和脱敏；实现 PostgreSQL outbox、worker lease、retry backoff、retry budget、dead-letter、人工重试和 reconciliation；实现 operation 查询、provider operation id、state version 和迟到回调拒绝；建立 CI、migration check、依赖/SBOM、artifact digest 和可回滚部署。
- **输出**：可启动 Backend/Worker、migration、fake provider、CI、部署配置、日志审计基础和故障演练脚本。
- **测试**：outbox 原子性、crash recovery、lease 过期、重试上限、dead-letter、数据库恢复、日志脱敏、secret scan、Unit/Integration/Contract 和覆盖率。
- **证据**：CI run、coverage、migration/restore log、故障注入、artifact digest、部署和回滚记录。
- **退出条件**：重启不丢任务、不重复产生外部副作用；unknown/reconciling 可查询和人工接管；核心模块有自动化测试和观测。
- **阻塞条件**：依赖内存队列或单机进程状态；外部调用没有幂等/读回；日志泄露原始资料或凭据；只能手工部署且无法回滚。

### 阶段 4：身份、团队隔离与权限

- **目标**：在真实资产写入前完成主体、团队、asset-space、角色和服务身份的服务端隔离。
- **输入**：身份 Spike、权限矩阵、repository binding 和控制面骨架。
- **主要设计/开发项**：实现 principal、membership、role binding、ACL、service identity 和资源范围校验；实现 repository identity 唯一性、路径规范化及绝对路径、`..`、符号链接逃逸拒绝；拆分创建、编辑、审核、发布、对账、回滚和指标查看权限；为 Git bot、WeKnora adapter、publisher 和 Worker 使用独立 credential binding；记录 `approved_by`、`released_by`、`executed_by`、`reconciled_by` 和接管原因。所有查询、写入、session、job、outbox、callback 和 provider operation 都必须由服务端从认证上下文推导并绑定 `team_id`/`asset_space_id`；repository、WeKnora space 和 distribution target 不能由客户端覆盖；数据库约束、RLS 或等价 repository 层策略必须防止漏加隔离过滤。
- **输出**：身份/权限模块、ACL middleware、repository binding、审计事件、权限 API 和最小授权配置。
- **测试**：权限矩阵、两个 asset-space isolation、跨团队读写、路径逃逸、凭据复用、成员撤销和服务身份边界 security tests。
- **隔离硬门禁**：必须覆盖跨团队资源 ID、伪造/重放 merge event、旧 callback、客户端篡改 team/asset-space、权限撤销后的已有 session/异步任务/回调、repository path 穿越和 Worker 使用错误 service identity；任一负向测试失败，不得进入真实数据、真实 Provider 或试点。
- **证据**：隔离报告、授权日志、审计查询、credential binding 清单和 secret scan。
- **退出条件**：同一 Workbench 服务于两个 asset-space 时，草稿、检索、任务、发布、指标和审计完全隔离；客户端不能扩大授权。
- **阻塞条件**：隔离只在 UI；共享用户 Token；服务操作不可追溯；binding 可被客户端切换；越权没有自动化回归。

### 阶段 5：Knowledge-first 垂直切片与 Git 发布链

- **目标**：交付第一个可独立验收的 Knowledge 创作到发布闭环；业务场景和角色使用阶段 0 的待填配置。
- **输入**：已确认的 `<pilot_scenario>` 或脱敏 fixture、Creation Session 设计、Git/WeKnora contract、阶段 4 权限能力。
- **主要设计/开发项**：实现资料上传/脱敏、来源定位、候选卡片、冲突和待确认项；实现草稿、修订、确认、暂停/恢复、分叉/只读和并发 base revision；生成规范 knowledge path、metadata、sources、CHANGELOG 和变更包；通过 Git provider 创建分支/MR，执行格式、敏感信息、taxonomy、owner、链接和权限门禁；只接受 protected main merge event；由 outbox/Worker 调用 WeKnora ingest，读回 document/version/source/repo_path/ACL 并执行 retrieval smoke；只有 read-back 和检索通过才标记 `published`，失败保留旧版并进入 retry/reconciliation。
- **输出**：Knowledge-first E2E、页面/API、Git change package、merge event、WeKnora published/read-back、人工接管和回滚。
- **测试**：Creation Session、Git webhook、`创建 → 确认 → MR → merge → ingest → read-back → 检索` E2E；并发、重复、旧 SHA、半成功、敏感资料和 ACL 测试。
- **证据**：fixture digest、MR/merge commit、outbox/attempt、WeKnora read-back、检索结果、审计、失败和回滚记录。
- **退出条件**：第一用户无需直接操作 Git 完成确认和提交；知识在实际检索后才发布；消费和反馈可记录。
- **阻塞条件**：草稿未经确认进入 WeKnora；merge event 可伪造或重复副作用；索引未读回却显示 published；无法保留旧版或人工补偿；数据无法脱敏。

### 阶段 6：消费、反馈与三层指标

- **目标**：建立发布后的 Knowledge 和 Skill 消费、反馈与指标最小闭环，不从技术成功推断业务成功。
- **输入**：已发布 Knowledge 或 MVP 内已完成安装/read-back 的 Skill、消费入口、反馈分流规则和试点指标配置。
- **主要设计/开发项**：接收最小消费事件和 feedback reference，不复制完整 Prompt、输出、Token、Cookie、业务文件或 Tool Call trace；区分 invocation、attempt 和活跃主体并去重；分别记录 `technical_status`、`contract_status`、`business_status`，支持 `passed`、`failed`、`not_evaluable`、`unknown`；实现可靠性、采用、价值三层聚合和 team/asset-space/version/digest 隔离；将反馈分流为知识 MR、Skill regression、Provider/分发故障或平台问题；为 unknown、digest mismatch、handoff pending 和低反馈覆盖率提供下一步、责任人、超时和告警。
- **消费事件契约**：最小事件至少包含 `event_id`、`idempotency_key`、`invocation_id`、`attempt_no`、`team_id`、`asset_space_id`、asset/version/digest、actor type/ref、时间、三层状态、`outcome_reference`、`feedback_reference` 和 schema version；有效调用、执行尝试、重试、unknown 的分母规则必须可计算、可对账，未知 digest、跨团队事件、迟到/重复事件必须拒绝或进入 reconciliation。没有业务结果证据只能记为 `unknown`；低反馈覆盖率和小样本不得直接发布 Badcase 率或价值结论。
- **输出**：Consumption Event API、Feedback Candidate、指标聚合、最小报表、Badcase 分流和运营复核记录。
- **测试**：schema/idempotency、重复/重试/迟到事件、状态分母规则、ACL、敏感字段拒绝、反馈去重、小样本保护和事件对账。
- **证据**：事件样本、聚合查询、对账、脱敏报表、反馈处理、周/月复核和告警记录。
- **退出条件**：能按 Knowledge 或 Skill 的实际资产版本和固定 digest 查看调用、尝试、用户、分层成功、unknown、Badcase 和反馈覆盖率；Knowledge 按 `knowledge_id/version/source_commit` 归因，Skill 按 `skill_id/version/package_digest` 归因；无业务证据时为 `unknown`；反馈可进入修订任务。脱敏回放只可证明契约、可靠性、回归和故障恢复，不能替代 Pilot Beta 所需的真实用户、真实低风险流程、人工基线、业务结果 Owner 和价值指标。
- **阻塞条件**：把发布/安装/load 当消费；用单一 outcome 推断三层成功；重试重复计为调用；敏感数据进入长期指标；低覆盖率下直接解释 Badcase 率。

### 阶段 7：Skill 契约、测试与打包

- **目标**：在 Knowledge-first 的最小发布和消费链路通过后，仍在同一 MVP 内交付完整的 Skill 资产生产线；Skill 不是 P1 之外的后续功能，而是以 Knowledge-first 为前置顺序的第二条 MVP 资产路径。
- **节点依赖**：阶段 7 不要求阶段 8 的真实 SkillHub、TeamAI 或 DSH Provider 已 `real_verified`，但要求阶段 N3 的 package、digest、安装/read-back、fallback release 和最小消费测试通过。
- **输入**：工作流候选、Knowledge 依赖、Skill package layout、SkillHub contract 和指标配置。
- **主要设计/开发项**：实现 Workflow Draft 和 Skill Creation Session；生成 `skills/<domain>/<name>/`、`contract/` 和测试目录；固定 `knowledge_dependencies` 的 ID/version，声明 effects、网络/数据范围、能力需求、风险等级和 profile；建立 golden/boundary/regression/security fixture；从 approved merge commit 构建 package，计算 `package_digest`，禁止 `latest` 和未提交工作区；先用 fake/admin 验证 release、撤回、旧版本 pin 和 digest read-back。
- **输出**：Skill contract、测试集、package builder、digest、release metadata、回滚包和质量门禁。
- **测试**：contract/golden/regression/security；恶意输入、越权 effects、依赖漂移、不可复现构建、digest mismatch、资源限制和失败回滚。
- **证据**：merge commit、manifest、package/digest、测试报告、SBOM、release/read-back 或 fallback 记录。
- **退出条件**：固定 commit 可重复构建；契约、依赖、测试证据完整；release/read-back 与 digest 一致；至少完成一条与 Knowledge 固定版本依赖关联的 Skill MVP 路径，包括 Skill package、安装或管理员/fake fallback、load/read-back、最小消费和回滚；Provider 状态如实记录。
- **阻塞条件**：Skill 只有 Prompt；依赖 `latest`；构建不可复现；digest 不一致；能力声明绕过权限或人工确认。

### 阶段 8：SkillHub、TeamAI、TeamLab 与 DSH Provider 集成

- **目标**：在 Skill 包和控制面稳定后，按固定 digest 逐段验证真实发布、分发和 Harness load；不建设 Harness Runtime。
- **输入**：immutable package/digest、Provider 版本、目标 profile、非生产凭据和 handoff contract。
- **主要设计/开发项**：验证 SkillHub register/release/read-back；TeamAI（如启用）只消费 pinned digest 并读回 target、installed revision、文件清单和 digest；TeamLab 只有在 `in_scope: true` 时才执行 target binding、固定 package/digest、安装/撤回 read-back，`in_scope: false` 则只保留 `readiness_only/non_blocking` 证据；验证 DSH discovery、显式 load、profile/tool policy、loaded digest 和版本不兼容拒绝；统一 `requested → submitted → provider_pending → readback_verified → succeeded`，异常进入 `unknown → reconciling`；执行 `build → package → digest → fresh-profile install → restart → load report/read-back → 功能 smoke → disable/uninstall/rollback`。
- **输出**：Provider integration evidence、pinned digest chain、handoff/load read-back、故障恢复和回滚结果，或明确 fallback/blocked 结论。
- **测试**：非生产 contract/integration/E2E；版本漂移、目标错误、权限越界、安装失败、回滚、超时、read-back mismatch 和迟到回调；security review。
- **证据**：目标版本/环境、package/fixture digest、命令及退出码、各层 read-back、失败/回滚、执行/复核人及证据 digest。
- **退出条件**：同一 digest 贯穿 SkillHub、TeamAI（如启用）、TeamLab（仅当 `in_scope: true`）和 DSH loaded digest；失败可清理、回滚和对账；真实 Provider 未通过时仍可用 fallback 且状态如实展示；`in_scope: false` 的 TeamLab 不阻断 N5/P6。
- **阻塞条件**：把 HTTP 200、安装成功或 handoff request 当 loaded；重新解析 `latest`；没有最终 read-back；目标 profile/工具策略不明；证据缺少不可变版本或复核人。

### 阶段 9：非生产试点、复盘与成熟度决策

- **目标**：在业务侧确认的首个低风险场景中验证端到端价值，并决定 Contract Beta、Pilot Beta、Stable 或回退。
- **输入**：试点输入卡、阶段 5/6/8 证据、非生产环境、人工基线、目标指标、维护和回滚责任。
- **主要设计/开发项**：建立真实试点 roster；角色可兼任但必须分别记录创作/维护、审核/发布、业务结果确认、平台执行和 Go/No-Go 责任；执行固定周期 Knowledge-first 试点；每周检查采用、可靠性、反馈覆盖率、unknown、人工接管和维护负担；每月复盘价值指标和 Badcase；演练 Provider 故障、Worker 重启、数据库恢复、旧版回滚、权限撤销和敏感数据事件；形成继续、扩样、fallback、暂停、修复或退役决策。
- **输出**：试点报告、指标和对账数据、反馈闭环、故障演练、维护容量评估、成熟度决策和 backlog。
- **测试**：完整 E2E、业务结果抽样、用户可用性、故障恢复、安全权限回归、覆盖率/SLO/容量检查。
- **证据**：试点版本/环境、参与者授权、fixture/asset/package digest、消费事件、业务结果引用、反馈覆盖率、回滚、复盘和 evidence manifest。
- **退出条件**：Contract Beta 通过契约、权限、状态机、幂等、失败路径和可靠性证据；Pilot Beta 另需真实用户、业务结果 Owner、人工基线、采用指标和至少一个价值指标；Stable 仅对声明的 asset type、asset-space、provider mode、target、profile 和 digest 范围授予，并要求三层指标、真实 Provider read-back、安全治理、恢复和维护容量达标。
- **阻塞条件**：角色或基线未确认；没有业务证据却宣称价值成功；关键 unknown 未对账；回滚/恢复/权限撤销失败；把单一场景结果扩大为全局 Stable。

### 路线级依赖、并行和验收约束

- 阶段 0、1 先冻结边界和契约；阶段 2 可并行验证多个 Provider，但不得反向改变 canonical source 和控制面状态机。
- 阶段 3 可与阶段 2 并行开发 fake provider、fixture、CI 和部署基础；阶段 4 必须在真实团队资产写入前完成。
- 阶段 5 是首个 Knowledge 业务垂直切片；阶段 6 依赖其发布/read-back，并同时为 Knowledge 和 Skill 接入消费、反馈和指标；阶段 7 在同一 MVP 内完成 Skill contract、测试、打包、安装/read-back 和最小消费，不得延期为后续产品。
- 阶段 8 依赖 immutable digest 和 Provider evidence；TeamAI、DSH 的真实集成不得成为 Knowledge MVP 的硬阻塞，但 Skill MVP 本身的 package、安装/fallback 和最小消费不得省略。
- 阶段 9 不能用技术验收替代业务 Go/No-Go。任何 `blocked`、`unknown` 或 `manual_intervention` 都要保留责任人、超时和下一步。
- 每个实现任务至少提供可复制的 `format/lint/typecheck`、`unit`、`integration`、`contract`、`security/secret scan`、`migration/restore`、`failure injection`、`coverage` 和目标环境 `read-back` 命令；命令、版本、退出码、输出摘要和证据 digest 进入 evidence manifest。

## 3. 交付视图 A：双资产边界与能力侦察（对应工程 P0）

### 交付

- 一个真实但脱敏、可回放的知识样本集和任务样本集；
- 腾讯云非生产 Team Knowledge Backend、worker、PostgreSQL、对象存储、网络/TLS、DSH auth context 映射、日志脱敏、备份恢复和监控基础；
- 已有 WeKnora 的独立测试 space，以及 Git↔WeKnora mapping 的验证数据；
- DSH/Harness、SkillHub 和 TeamLab 的目标版本、部署制品和健康检查验证；若无法确认，记录 blocker 并启用管理员/fake provider fallback；
- `team-knowledge-workbench` 的 package skeleton、server/client contract、构建产物和一次内部安装/重启/read-back 验证；
- 知识规范目录、taxonomy、domain/topic/path preview、Git↔WeKnora mapping 和迁移/退役 contract；
- 工作台首页、两个启动动作和 Creation Session 原型；
- principal/team membership/role binding、service identity、Git 提交人和 Skill 发布责任链模型；
- session、draft、asset revision、release、handoff、审批、operation/job/outbox/reconciliation 和反馈引用模型；
- Git merge event fixture、签名/重放/乱序/旧 SHA contract；
- WeKnora ingest/read-back contract：document/version/source/repo_path/ACL 和可检索验证；
- Skill package/digest、SkillHub release/read-back、TeamAI pinned digest/distribution/read-back、DSH handoff/load/read-back contract；
- SkillHub/DSH handoff metadata 和 fake distribution contract，不要求真实 Harness runtime；
- User-authored Plugin 的未来 manifest/capability/permission contract 预留和 fake provider contract，不要求 P0 实现用户 Plugin creation/release/runtime；
- fake Git/WeKnora/SkillHub/TeamLab provider 或 adapter contract；
- Skill input/output、effects、能力需求和风险模型；
- 目标版本的 WeKnora 状态、SkillHub/TeamLab API、DeepSeek Harness Provider/discovery/load 能力记录；
- Workbench product package 安装契约侦察：固定 commit/profile，读取官方 package/类型/README/fixture/Loader，区分 `fact/candidate/pending_checks/warning`；
- 一个最小 Workbench product package installation Spike，完成 `build → package → digest → fresh-profile install → restart → load report/read-back → functional smoke → disable/uninstall/rollback`；
- 不使用生产 Token 的验证证据。

### P0 退出

双资产 schema、非法状态、幂等、权限冲突、契约失败、运行归因、故障路径和人工 fallback 均有测试；腾讯云非生产环境可部署、可观测、可备份和可回滚；PostgreSQL migration、跨团队拒绝、Worker 重启恢复和外部操作对账可验证；WeKnora 测试 space 可完成 Git path/metadata/read-back 验证；Workbench package 可完成安装、重启、enabled/UI read-back；DSH/Harness、SkillHub、TeamLab 尚未确认的能力都有 owner、日期、blocker 和人工 fallback。

Workbench product package installation Spike 不得以“已写计划”作为完成条件：必须记录固定 DSH commit/profile、package digest、fresh-profile 安装、重启、load report、功能 smoke、disable/uninstall 和 rollback 的实际结果；若目标环境不可用，必须以 `blocked` 或 `fallback` 完成证据记录，并填写 owner、日期、原因和下一步。未达到上述条件不得将 Workbench product package 安装子项标记为完成。User-authored Plugin 的契约侦察和创建/发布能力不属于 P0 退出条件，需在后续阶段独立设计和验收。

## 4. 交付视图 B：双资产 MVP 闭环（对应工程 P1–P5）

### MVP 视图 B1：双资产 MVP 闭环（工程 P1–P5）

首页“从资料创建知识”必须创建独立 Knowledge Creation Session；会话内包含材料、候选卡片、变更包、Git provider、CI/CODEOWNERS、审核、protected main merge event、Workbench outbox/worker、WeKnora ingest/status/search、document/version/source/ACL read-back、引用和复核任务。完整闭环是：`merge event → outbox → worker → ingest → read-back → published`。

### MVP 视图 B2：Skill 交付

首页“从工作流创建 Skill”必须创建独立 Skill Creation Session；会话内包含 Skill 需求卡、Workflow Draft、模板化创建、input/output schema、知识依赖、effects/能力需求声明、golden/regression/security、Git/CI 审核、从 merge commit 打包、immutable digest、SkillHub release/read-back、pinned digest、TeamAI distribution/read-back（如启用）和 DSH handoff metadata。P1 的 Skill 交付允许使用 fake/admin provider 或管理员 fallback，但必须完成 package、digest、固定版本依赖、安装/read-back 和最小消费验证；SkillHub、TeamAI、DSH 的真实 Provider 晋级属于工程 P6，不是 MVP 视图 B 的前置条件。

- SkillHub/DSH Provider/TeamAI 未验证时使用管理员发布或 fake adapter，但必须保持 package、digest、approval、target、profile、installed revision 和回滚状态可追踪；fallback 不能使用漂移版本。User-authored Plugin 不属于该 fallback 路径的已交付能力。

### MVP 视图 B 退出条件

- 非程序员不操作 Git 即可从两个启动动作进入独立会话，并创建知识和 Skill 草稿；
- 至少两个团队/asset space 可以安装同一 `team-knowledge-workbench`，且 Git、WeKnora、Creation Session、ACL、审计和发布状态完全隔离；
- 知识创建能生成规范 repo path，WeKnora 能读回相同 knowledge ID、logical path、version、source commit 和 ACL，并通过检索验证后才标记 published；
- 用户可以同时打开多个知识/Skill 会话，暂停、恢复、归档、分叉和只读；
- 会话上下文、材料、草稿、异步操作和回调不会串线；
- 同一正式资产的并发修改检测 base revision，冲突不会静默覆盖；
- 知识检索结果带 document/version/source/ACL；
- Skill 从固定 merge commit 生成 package/digest，SkillHub read-back digest 与 package 一致；
- TeamAI（如启用）按同一个 pinned digest 完成目标安装读回，DSH handoff 不发生 digest 漂移；
- 发布版本能生成可供下游 Harness 验证的 version/digest/dependency metadata；
- 重复请求不重复创建 MR、release 或 index；
- CI 失败、契约冲突或权限超界不能发布；
- SkillHub、WeKnora 和 provider 超时有清晰状态和人工接管；
- 至少有一项真实或脱敏回放场景完成双资产生产线；
- MVP 视图 B 只允许将真实 Provider 标记为 `real_verified`，fake/admin 路径必须标记 `fallback_only` 或 `contract_verified`，不能将 fallback 结果报告为真实 release、distribution 或 loaded；
- MVP 视图 B 必须能记录三层指标的最小字段：可靠性指标完整记录，采用指标可按有效调用/尝试/用户去重，价值指标没有业务结果时明确为 `unknown`。

MVP 视图 B 退出不等于 Stable。它只能说明双资产 MVP 在受控环境可运行；进入 Pilot Beta 还需要一个明确低风险真实场景、业务结果 Owner、人工基线、目标指标和反馈回流证据。

## 5. 交付视图 C：发布交接与反馈闭环（对应工程 P5–P6）

### 交付

发布版本、digest、handoff target、交接读回、最小消费事件、三层指标聚合、反馈引用、知识复核队列、Skill 回归队列、每周复核、每月质量报告、stale/纠正率/失败率提醒、备份 owner、退役和回滚流程。

指标按以下三层逐步实现：

- **价值指标**：业务任务完成率、首次成功率、人工返工率、平均处理时长、业务错误率、已确认 Badcase 率和目标业务指标改善；
- **采用指标**：有效调用次数、执行尝试次数、活跃用户数、发布版本消费率、版本复用率、反馈覆盖率和资产维护及时率；
- **平台可靠性指标**：merge-to-index 时延、package build 成功率、Provider read-back 成功率、outbox backlog、retry rate、unknown 数量/持续时间、digest mismatch、回滚成功率和 provider error rate。

### 交付视图 C 退出条件

反馈不直接改正式资产；连续 4 周有真实消费或脱敏回放和复核记录，能够按实际 Knowledge/Skill 资产版本和固定 digest 查看采用指标，并对技术/契约/业务结果分别归因；至少一个质量或价值指标改善；知识问题能进入知识 MR，Skill 问题能进入 Skill 回归；未知交接或消费状态可人工对账；低反馈覆盖率时不把 Badcase 比例解释为真实错误率。

交付视图 C 的指标闭环不等于 Stable。脱敏回放只能证明契约、可靠性、回归和故障恢复；Pilot Beta 必须另有真实用户、真实低风险流程、业务结果 Owner、人工基线、目标指标和反馈回流。只有在真实 Provider read-back、价值 Owner 确认、关键可靠性阈值、安全治理、SLA、回滚和维护容量均满足时，才可将声明范围内的资产标记为 Stable。

## 6. 交付视图 D：SkillHub →（TeamAI，如纳入）→ DeepSeek Harness 消费能力验证（对应工程 P6）

在创作发布闭环稳定后，按固定 digest 验证 SkillHub release/read-back 和目标 Harness handoff/discovery/load；只有当 TeamAI 在 readiness matrix 中为 `in_scope: true` 时，才额外验证 TeamAI distribution/install/read-back，并将其纳入同一交接门禁。TeamAI 为 `in_scope: false` 时，可使用管理员/fake fallback 或从 SkillHub pinned digest 直接进入目标 DSH 验证，不得把 TeamAI readiness 当作阶段通过条件。纳入的路径必须证明同一个 package digest 从 SkillHub 经各启用 Provider 贯穿到 DSH loaded digest，profile/工具策略不越权，安装失败可清理，版本漂移进入 unknown/reconciling 并可回滚。

本阶段不在本项目实现 Harness Session、Run、Tool Call 或业务任务状态机；只保留交接协议、验证结果和反馈引用。

## 7. 交付视图 E：User-authored Plugin、Gateway 与受控生产能力演进（对应工程 P7）

只有在两个以上知识域或 Skill 稳定使用、出现第二 provider、人工状态查询成为瓶颈、需要集中权限/审计，或模块化单体无法接受地测试发布时，才评估 Console/Gateway/adapter、User-authored Plugin catalog/runtime、签名事件和低风险 MCP。

User-authored Plugin 是用户未来通过 Workbench 创建的业务扩展资产，不是 `team-knowledge-workbench` 自身的 Workbench product package。它应另行经历需求/Creation Session、manifest/capability/permission contract、Host/Client/API 实现、contract/golden/security/compatibility tests、Git/MR/CI/人工审核、immutable package/digest、registry/release、TeamAI 或管理员分发、DSH install/load/read-back、disable/uninstall/rollback。P0 只预留这些边界，不把用户 Plugin creation/release/runtime 作为首期交付。

MVP 视图 E 的 User-authored Plugin 不再采用“最后一次性集成”方式。详细的适用能力面、Bundle 安装步骤和证据模板以[DSH Plugin 开发与安装契约验证](../验证/05-DSH%20Plugin开发与安装契约验证.md)为准；每个增量必须在目标 DSH commit/profile 上重新打 Bundle、计算 digest、安装到 fresh profile、重启、读取 boot/Node/Client load report，再做脱敏功能 E2E。Host-only、Client-only、Mixed bridge、trace aggregation 和生产候选分别形成 Go/No-Go 证据；未确认的 package 字段、Cordis patch、session trace service、Host→Client bridge 或 UI slot 不得进入正式 User-authored Plugin。


### MVP 视图 E 的 User-authored Plugin 交付（后续）

- User-authored Plugin catalog 和最小 manifest/capability/permission contract；
- 一个低风险外部系统适配器或受控业务 Plugin；
- 权限/凭据声明、Secret Manager 引用和 profile/tool policy；
- 安全、依赖/SBOM、兼容性、health、超时/重试/幂等门禁；
- 安装、启用、禁用、撤回、回滚和运行归因；
- Plugin 故障与 Skill 质量问题的反馈分流。

新增层不能改变 Git、WeKnora、SkillHub、DSH、Plugin package 和人工审核的权威边界。

## 8. User-authored Plugin、MCP 与高风险能力

验证第三方 User-authored Plugin、Registry/Marketplace、MCP、沙箱、多租户和生产写入。必须先有工程 P7 的真实价值、隔离构建、依赖扫描、审批、二次确认、观测和回滚证据。

TeamLab 的纳入规则：未纳入本期目标分发路径时，记录 `in_scope: false`、`readiness_only/non_blocking`，不阻断 N5/P6；纳入时记录 `in_scope: true`，作为 N5/P6 正式 Provider 节点，执行 `fixed version → package/digest → target binding/install → read-back → withdraw → rollback`，任一最终 read-back 缺失则阻断该交接路径。

## 9. 统一验收矩阵

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| V-01 | 工作台与会话入口 | 首页有两个启动动作、最近创作和待处理事项；创建后进入正确的 Creation Session |
| V-02 | Workbench product package 安装 | package、canonical repository、digest、安装、重启、enabled/UI read-back 可验证；安装不被报告为资产发布 |
| V-03 | 多团队资产隔离 | 两个团队安装同一 Workbench，team/asset-space/Git/WeKnora/ACL/session/审计互相隔离 |
| V-04 | 知识目录与索引映射 | domain/topic/path preview、canonical key、Git↔WeKnora mapping、增量、移动、退役和旧索引保留可验证 |
| V-05 | 会话隔离与生命周期 | 多会话可并行；暂停、恢复、归档、分叉、只读可用且上下文不串线 |
| V-06 | 草稿与并发 | session/draft/revision 可追踪；同 base revision 并发提交触发冲突和人工合并 |
| V-07 | 双资产 schema/状态 | 合法/非法/重复/并发迁移有测试 |
| V-08 | Skill 创建 | 模板、metadata、契约和知识依赖可生成并审核 |
| V-09 | Skill 门禁 | schema、effects、能力需求、依赖、golden/regression/security 有效 |
| V-10 | Git merge event 与异步发布 | merge event 验签、event idempotency、旧 SHA/乱序处理、outbox 落库、worker lease/retry/crash recovery 可验证 |
| V-11 | WeKnora ingest/read-back | 来源/版本/ACL/document 可读回，检索验证成功后才 published；失败保留旧版 |
| V-12 | Skill package/SkillHub release | 固定 merge commit、package digest、SkillHub release id/状态/digest 可读回 |
| V-13 | SkillHub pinned digest →（TeamAI，如纳入）→ DSH | TeamAI 仅在 `in_scope: true` 时成为必需节点；其 target/installed revision/file list/digest 与 pinned digest 一致；否则使用管理员/fake fallback 或直接验证 DSH；DSH handoff/load/profile read-back 可验证 |
| V-14 | 非程序员体验 | 不操作 Git 可创建、确认、审核和发布 |
| V-15 | 交接协议 | 下游 target、version、digest 和依赖可追踪 |
| V-16 | 反馈分流与 Badcase | 报告、确认、去重、受影响调用数和反馈覆盖率可统计；知识、Skill、分发和平台问题进入正确治理任务 |
| V-17 | 身份与责任链 | DSH principal、team/role ACL、Git service identity、approved_by/released_by/executed_by 和跨团队拒绝可审计 |
| V-18 | PostgreSQL 控制面 | migration、事务/乐观锁、幂等、备份恢复、Worker 重启和数据库故障的 unknown/degraded 状态可验证 |
| V-19 | 安全审计 | 无 secret 泄露、越权和不可追踪写入 |
| V-20 | 故障恢复 | provider 半成功、超时、丢 event、重复和未知状态可对账 |
| V-21 | 稳定发布 | released/rollback 有批准、证据、digest 和旧版本 pin |
| V-22 | 运营价值 | 至少一个场景减少重复劳动或返工 |
| V-23 | User-authored Plugin 预留契约 | P0 仅保留未来 asset type、manifest/capability/permission、package/digest、distribution 和安全边界；不要求首期实现用户 Plugin creation/release/runtime |
| V-24 | Harness 能力验证（P3） | Provider/discovery/load 和反馈引用有可重复证据 |
| V-25 | 分发 contract | SkillHub/TeamLab/管理员路径中，MR、固定版本、目标交接、实际读回、回滚和 fallback 可验证 |
| V-26 | Agent Manifest 复用（后续） | 依赖 Skill/知识可追踪，不能绕过审批；不要求首期实现 |
| V-27 | User-authored Plugin Bundle 开发与安装门禁（后续） | 每个后续 Plugin 阶段都完成固定版本的 build/package/digest/fresh-profile install/restart/load-report/readback/功能 E2E，并可 disable/uninstall/rollback；未确认契约不得进入正式 User-authored Plugin |
| V-28 | Skill 消费指标与隐私 | 按实际 Skill version/digest 统计调用次数、活跃用户、分层成功、unknown、Badcase 和反馈覆盖率；重复/重试去重、团队隔离、小样本保护、敏感数据不进入报表且可对账 |

详细平台实验见[验证材料](../验证/README.md)。

## 10. Coding agent 交付规范

每次只给 coding agent 一个小任务包：背景、范围、输入输出、禁止事项、失败测试、最小实现、验收命令、证据路径和回滚方式。先做 schema、状态机、fake provider、契约和回归，再做 UI 和真实 provider。

Agent 不拥有生产凭据，不直接 merge `main`，不执行任意 shell/路径，不隐藏未验证能力。完成后必须做独立 code review、安全 review 和范围检查。

## 11. Go/No-Go

以下任一项不通过，就保持当前阶段：双资产权限隔离、审计完整性、契约和回归、知识/Skill 版本可追踪、发布目标和交接读回、未知状态处理、旧版本保留、回滚、人工接管、secret 扫描、非程序员可用性或真实业务价值。工程 P6 另需 Harness discovery/load 和反馈引用证据；工程 P7 另需 User-authored Plugin 权限、安装、健康、兼容性和回滚证据。

阶段决策不能只引用统一验收矩阵。每个阶段必须形成一条决策记录，至少包含：

```yaml
gate: <阶段门名称>
required_evidence: [<证据 manifest id>]
hard_blockers: [<未通过项>]
allowed_exception: <无或明确的 fallback/例外>
decision_owner: <阶段 Go/No-Go 决策人>
reviewer: <复核人>
decision: go | no_go | go_with_expiry
decision_date: <timestamp>
expiry_or_review_date: <timestamp>
rollback_or_next_action: <回滚点或下一步>
```

`go_with_expiry` 只能用于已登记、具备 owner、固定到期日和回滚路径的 fallback；到期未复审自动回到 `pending` 或 `blocked`。缺少 evidence manifest、Provider 最终 read-back、真实业务结果或隔离负向测试时，不得用人工签字覆盖硬阻塞。

成熟度判断必须区分：

- `Contract Beta`：契约、权限、状态机、幂等、失败路径和可靠性基础证据通过；允许 fake/admin fallback，不代表真实 Provider 或业务价值已经验证；
- `Pilot Beta`：一个明确低风险真实场景有真实用户、业务结果 Owner、人工基线、采用指标和至少一个价值指标，fallback 与真实 Provider 状态清晰分开；
- `Stable`：在声明的 asset type、asset space、provider mode、target、profile 和 package digest 范围内，三层指标、真实 Provider read-back、价值结果、安全治理、SLA、恢复和维护容量均达标。

Go 决策必须绑定 evidence manifest。没有目标版本、环境、不可变 commit/制品 digest、fixture digest、实际命令和退出码、最终 read-back、失败/回滚结果、执行人、复核人及证据自身 digest 的项目，只能保持 `pending`、`fallback_only`、`contract_verified` 或 `blocked`，不得标记为 `real_verified`、Stable 或生产就绪。
