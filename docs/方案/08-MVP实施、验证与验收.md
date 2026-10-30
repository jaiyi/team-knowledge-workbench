# MVP 实施、验证与验收

> 本文是唯一的实施路线和验收入口。首期交付知识与 Skill 创作发布闭环；DeepSeek Harness 的会话执行由下游能力验证和交接验证覆盖，不作为本工作台 Runtime 建设。[开发工程设计与集成基线](11-开发工程设计与集成基线.md)负责把现行五入口映射为拟议 API、授权与跨平台读回，以及 SkillHub/TeamAI 的待证选型门；它不取代本文件阶段、节点或成熟度门禁。

**风险登记表及决策占位**见[12-未决工程风险与决策记录](12-未决工程风险与决策记录.md)：R-01–R-09 的产品边界已裁决并在产品/方案对齐，其中 R-02 的 Skill 仅在经审合入 canonical Git protected main 后为 `已发布`，合并前为 `审核中`，管理员固定包 fallback 不使其已发布；R-09 区分个人 Inbox 留链接与知识入口在明确选择、授权且受限获取能力验证后抓取解析。除 R-07 专项模型治理不在产品范围，其余服务端或目标集成证据均待验证；个人 Inbox 的 I-01–I-04 工程风险另列。规则或文档对齐不构成工程验证通过、豁免或 Provider 能力证明；各项按下述阶段门给出 Spike 证据后再决策。

## 1. 交付方式

采用：**一个知识域、一个高频低风险工作流、一个 Git provider、一个 worker、一个知识 steward、一个 Skill owner、一个发布目标、一个下游 Harness 验证环境和一个腾讯云非生产部署环境**。

每个阶段留下版本、环境、fixture、运行命令、预期/实际结果、失败动作、owner、回滚方式和 Go/No-Go 决策。P0 的部署对象是 Team Knowledge Backend、worker、PostgreSQL、对象存储、现有 WeKnora 的独立测试空间，以及目标版本可确认时的 DSH/Harness、SkillHub 和 TeamLab 服务或 provider；DSH Desktop Electron 客户端通过本地/市场安装 Workbench Plugin，不作为腾讯云服务部署。拟复用 DSH Desktop 身份上下文但须在阶段 2 验证安全交换与撤权；不以公司统一身份系统接入作为 P0 前提，未验证前不得写真实团队资产。

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

试点输入卡还需附一页**用户任务观察记录**：第一受益者在现有文档、群聊或系统中如何找到答案；一周内重复问答、找不到/找错、等待领域负责人确认的具体样本；第一用户维护资料花费的时间；审核人当前处理纠错和过期内容的方式；每项记录来源、时间窗口和是否允许将脱敏片段用于试点。由受益者、贡献者和结果 Owner 分别确认，不能把竞品案例或产品设想当作本团队已验证需求。以既有人工流程的耗时/返工和可信答案样本建立基线；观察窗口、目标改善与停止条件由业务侧确定，不在方案中预填成果。

Provider 不得只用一句“如启用”描述。阶段 0 需要建立并持续更新以下 readiness matrix；每次状态变化都必须关联证据 manifest、责任人和复审日期：

| Provider | 目标版本/环境 | provider_mode | integration_status | 本阶段必需证据 | 允许 fallback 的阶段 | 阻塞条件 | 回滚路径 |
|---|---|---|---|---|---|---|---|
| Git | `<待确认>` | `fake \| admin \| real` | `pending \| blocked \| fallback_only \| contract_verified \| real_verified` | merge event 验签、protected ref、commit/path/read-back | 阶段 2–7 可使用 fake；真实试点前须明确 real 或受控 admin | 无法证明 canonical repository、签名或 merge commit | 保留旧 commit，撤销 MR/事件并人工对账 |
| WeKnora | `<待确认>` | `fake \| admin \| real` | 同上 | ingest、document/version/source/ACL、授权检索及按 ID/版本撤回、旧索引/撤权主体负向检索、外部直连限制 | 阶段 2–4 可使用 fake；Knowledge-first 真实消费前须 read-back，不能用 fallback 冒充可验证撤权 | 无法关联 source commit、ACL 或可检索状态；声明范围无法撤回旧索引/封锁直连时阻断该范围真实试点 | 旧版仅在仍获授权且有效时服务；否则先阻断受控入口、升级外部封锁/对账，保留旧证据 |
| SkillHub（仅有独立 Registry 需求并经选型时） | `<待确认>` | `fake \| admin \| real` | 同上；未选用记 `not_selected` 于选型记录，不伪造接入成功 | release id、version/digest、撤回 read-back；正式审核仍由 Git 完成 | 未选用不构成首期阻塞；阶段 7 可用有期限的管理员固定包 fallback | 已选择却 release digest 不一致或无最终状态 | 固定旧 digest，撤回未确认 release；逐目标安装另验 |
| TeamAI（优先验证多端分发） | `<待确认>` | `fake \| admin \| real` | 同上 | 已批准 source/package digest→同仓或经审 MR 的团队仓库固定 commit→成员首次 init/授权→目标 DSH SessionStart 是否触发或主动 pull→实际落盘路径/文件清单/摘要、DSH profile discovery/load read-back；离线、撤回和本地修改 | 阶段 7–8 可 fallback；知识 MVP 不依赖 TeamAI，未确认 DSH Hook 时不能声称自动下发 | `latest` 漂移、镜像仓未经审、目标 workspace 错误、未初始化/Hook 不兼容、路径不受 DSH loader 支持、摘要漂移或无法验证目标安装 | 停止同步并按固定旧包/摘要回滚；离线/旧副本留待办，不能标记全员已撤回 |
| DSH/Harness | `<待确认>` | `fake \| admin \| real` | 同上 | handoff、discovery、显式 load、profile/tool policy、loaded digest | 阶段 2–7 可使用 contract/fallback；真实 loaded 只在阶段 8验证 | 无法证明 loaded digest、权限策略或版本兼容 | 清理目标 profile，回退旧版本并重新对账 |
| TeamLab/其他分发 | `<待确认>` | `fake \| admin \| real` | 同上 | target binding、固定 package、安装/撤回 read-back | 非核心路径默认 fallback | 目标绑定或撤回不可读回 | 管理员固定版本操作并记录审计 |
| Tool/MCP Demo Provider（隔离非生产） | `<待确认>` | `fake \| real`，分别记录原型假目录与真实 Demo | 同上 | 标准契约版本、目录/详情/schema、主体和字段权限/环境检查、只读合成测试调用、来源/审计/失败回执及撤权拒绝 | 契约可先用 fake 开发；真实 Demo 验收须目标实际调用读回 | 未授权目标/字段、写入效果、任意 URL 或无审计的调用 | 停用测试目标，撤销仅测试主体授权并复核审计；不影响生产 |
| 大盘合成知识真实链（Git/WeKnora 测试空间） | `<待确认>` | `real`（真实非生产链；输入仍为合成 fixture） | 同上 | 入口②审核/merge/worker/index/ACL 检索→入口⑤授权读回、资产 ID/版本去重、项目×产品线、具体文档深链；修订/索引失败/撤权/旧版残留 | 静态大盘仅演示，不计真实集成通过 | 无来源/版本/ACL、错误绿色状态、旧索引仍可读或深链越权 | 阻断对应查询并按原目标读回/对账；保留旧证据 |

`fake` 或 `admin` 可以满足契约和受控技术验证，但不能单独满足真实 Provider、Pilot Beta 或 Stable 的证据要求；fallback 必须有有效期、操作人、原因、固定 package/digest、回滚路径和到期复审日期。**合成内容与接入真实度是两条轴**：原型预置=`演示数据/fake`，合成数据经真实非生产 Provider 调用/读回=`非生产真实集成`，正式业务数据与生产授权/质量/价值=`生产真实能力`，后者不能由前两者推出。未选择 SkillHub 时记录 `not_selected` 仅为选型结果，不扩充 `integration_status` 枚举，也不构成缺失的 Provider 通过证据。

首期不是“先做完 Knowledge、以后再做 Skill”，而是 **Knowledge-first、Skill 同期进入 MVP**：Knowledge 作为首条业务闭环先行验证，Skill 可在确有查询需求时引用已获授权的固定知识版本；Skill 在同一个 MVP 周期内完成创建、契约、测试、打包、安装/发布 fallback 和最小消费验证。SkillHub、TeamAI、DSH 的真实 Provider 能力可以分阶段验证，但不得因为 Provider 尚未 `real_verified` 而省略 Skill 本身的 MVP 交付。

实施路线采用“主链路顺序 + 节点性双资产验收”：先完成能支撑 Skill 固定依赖的 Knowledge 基础能力，但每个重要功能完成后，都必须同步验证 Workbench Plugin 的构建、打包、安装、重启和最小 read-back；涉及 Skill 的节点还必须验证 Skill package、digest、安装或 fallback release。这样既保持 Knowledge-first 的业务优先级，又避免 Skill 和安装契约拖到 MVP 末尾才暴露问题。

| 节点 | 重要功能完成标准 | Knowledge 验证 | Skill/Plugin 验证 | 节点安装与回滚门禁 |
|---|---|---|---|---|
| N0 工程骨架 | Backend、Worker、Workbench client、配置和健康检查可启动 | 健康检查、身份上下文和 fake provider smoke | 最小 Plugin manifest/tool contract | `build → package → digest → fresh-profile install → restart → boot/load report` |
| N1 控制面与隔离 | session、ACL、job、outbox、审计和双 asset-space 隔离可用 | 两个 asset-space 的 session/job/ACL 隔离 smoke | 同一 package 在两个 profile 安装，确认 enabled/UI/read-back，不能共享可变资产 | 固定 package digest、双 profile 安装、重启、隔离 smoke、disable/uninstall |
| N2 Knowledge 发布链与大盘合成验证 | Creation Session、Git merge、WeKnora read-back 和 retrieval smoke 可用；合成知识经入口②真实非生产链进入入口⑤ | 新增/修改基线冲突、受审退役/移动、紧急撤权与三方对账；合成材料/旧版经审核、worker、测试 space 索引/ACL 检索；大盘 ID/版本去重、项目×产品线及有权具体文档深链和旧索引/撤权负向读回均有证据 | Skill fixture、Knowledge dependency 声明和 contract fixture 可随同测试 | 增量 package 安装、fixture contract/read-back、失败回滚 |
| N3 Skill MVP | Workflow、Skill contract、测试、受审 Git 发布、package builder 和明确标记的 fallback 路径可用 | Skill 依赖的 Knowledge ID/version/source commit 可读回 | `Workflow → Skill → golden/regression/security → Git MR/CI/指定审核人 → canonical protected main merge（此前审核中，此后已发布）→ package/digest → 安装或 fallback + 受控 load/read-back（标明 fake/admin/real，各自独立）` | fresh-profile 安装、restart、load/read-back、digest 对账、rollback |
| N4 消费与反馈、Tool Demo | Knowledge/Skill 消费事件、独立反馈引用和三层指标最小闭环；标准 Tool 契约及非生产合成只读 Demo 验收 | Knowledge 引用、修订任务和反馈分流可对账；大盘仅真实扫描才显示范围/批次/来源，预置诊断标 fixture | Skill version/digest、technical/contract/business status 和反馈引用可对账；Demo Tool 经目录/权限/环境→受控调用→来源/审计/失败回执，权限拒绝可复验 | 消费版本对账；失败后 disable/uninstall 或回退上一版本 |
| N5 Provider 交接 | 外部 Provider 适配器和 read-back contract 可用 | 不改变 Git/WeKnora canonical source 和检索权威 | 按选型门逐层验证 SkillHub release（若选择）→ TeamAI distribution（如启用）→ DSH pinned digest/read-back；管理员 fallback 单独标记 | 每个真实 Provider 节点重复 `build/package/digest/install/restart/load/read-back/rollback` |
| N6 MVP 发布候选 | 双资产版本、ACL、旧版、指标和回滚证据齐全 | Knowledge 发布、消费和反馈闭环验收 | Skill package、digest、fallback/真实 release 和最小消费验收 | 发布候选 fresh-profile 安装、端到端 smoke、disable/uninstall/rollback |

每个节点必须记录目标版本、环境、package/artifact digest、fixture digest、实际命令和退出码、read-back、失败路径、回滚结果、执行人、复核人和证据自身 digest。未完成节点性打包和安装测试的功能，不得进入下一个 MVP 节点；节点测试失败时可以保留已通过的旧版本，但只能阻断该失败步骤的成功/安装声明，不撤销已核实的 Skill canonical Git `已发布`，也不得将未核实 Git merge 的 Skill 或未读回 WeKnora 的知识标记已发布。N0–N6 是能力验收节点，不与下述实施阶段编号一一对应：阶段 6 先验证 N4 中的 Knowledge 反馈和通用事件契约，阶段 7 产出 N3 Skill 制品后补验 N4 中的 Skill 最小消费；N4 双资产验收须在 N3 完成之后才能整体通过。


### 阶段 0：方案冻结与实施输入

- **目标**：将产品边界转成可开发、可验收且不误解业务责任的实施基线。
- **输入**：已批准方案、验证计划、Provider 能力现状、目标环境，以及待确认的试点场景、三类角色、人工基线、目标指标和停止条件。
- **主要设计/开发项**：冻结只建设知识与 Skill 创作、测试、审核、发布和反馈控制面；明确不建设 Harness Runtime、通用任务运行器或完整业务状态机；统一术语和状态词典；建立风险登记表和依赖清单；围绕试点输入卡中的一个目标团队和低风险场景观察受益者现有入口、贡献者的维护负担、审核人处理纠错/过期的路径，并标注已确认与待验证的用户假设；业务流程 Owner 还需明确专家/审核可用维护时间、替补与超载时的缩小/暂停决定人。如能招募其他团队，可作为扩样观察，不构成阶段 0 退出前置条件。
- **输出**：实施基线、试点输入卡、范围清单、状态词典、风险登记表、任务拆分表和阶段验收清单。
- **测试**：方案结构检查；状态/边界正反例评审；缺少试点输入时的阻塞测试；敏感数据和生产凭据扫描。
- **证据**：批准版本、评审记录、输入卡版本、风险 owner 和决策记录。
- **退出条件**：工程团队能明确做什么、不做什么、何时算成功；所有缺失业务输入都有 owner 和截止时间。
- **阻塞条件**：范围仍包含通用 Runtime 或高风险生产写入；没有业务结果 Owner 或人工基线；无法区分 fake/admin 与 real provider 证据。

### 阶段 1：领域模型、状态机与接口详细设计

- **目标**：在业务代码前冻结控制面数据模型、状态迁移、外部契约和错误语义。
- **输入**：阶段 0 基线、既有对象关系、Provider contract。
- **主要设计/开发项**：定义 `team`、`asset_space`、`asset_repository`、`connection_binding`、`connection_config_revision`、`credential_binding`、`creation_session`、`draft`、`draft_revision`、`asset_revision`、`knowledge`、`skill`、`release`、`handoff`、`outbox_operation`、`worker_attempt`、`reconciliation_record`、`feedback`、`consumption_event`、`metric_aggregate`、`audit_event`；另冻结 Workbench 评论独立持久化的 `comment_id`、条目/草稿修订锚点、状态与有权读回，以及仅在目标 DSH 回合契约实测后启用的 `turn_id/reply_id/终态` 关联和新稿 CAS/人工改写退路；绘制 Creation Session、Draft、Release、Handoff、Outbox、Provider Operation 与配置草案/验证/激活/停用状态机；设计 API schema、错误码、幂等键、`operation_id`、`correlation_id` 和 `expected_state_version`；设计 migration、唯一约束、乐观锁、索引、审计、soft delete、备份恢复和数据保留；定义 merge、read-back、package、release、handoff、consumption、feedback event。**Tool/MCP 另需冻结**版本化标准接入契约、目录/详情/schema、主体与字段权限/环境、真实申请回执或未知、只读合成试参、来源/审计和失败映射，禁止不同 Provider 不支持的语义被默认为批准。**大盘另需冻结**资产 ID+版本去重、项目×产品线正交关联、来源/权限/窗口与具体文档深链的重鉴权，以及扫描批次与人工 fixture 的来源标记。**Knowledge 另需冻结**新增/修改/退役 tombstone/移动重命名的稳定 ID、base revision、旧 document ID、逐入口可见性；紧急撤权先阻断 epoch 后审计 Git、更正的权限及外部直连负向读回；定期 Git/PG/WeKnora 扫描游标、频率/范围、责任人与不可完成条件；目标 WeKnora 下架/旧索引能力未经实测保持待验证。**TeamAI 若选用**需冻结团队仓库与 canonical repo 的同仓/受审镜像关系、固定包/commit 映射、`teamai_session_pull|managed_target` 下发方式、目标机首次 init/授权、Hook 适配、逐目标摘要与离线撤回，不把仓库可拉取当目标已装载。专家判断、待办转交及贡献更正先作为与现有候选/草稿修订、身份和审计关联的操作契约设计，不另立一套资产批准或消费主体画像状态机。
- **输出**：领域模型图、状态机、OpenAPI/JSON Schema、ERD/migration、事件契约、错误码表、权限矩阵和 API examples。
- **设计冻结门**：必须同时冻结数据字典、合法/非法状态迁移、API request/response、错误模型、幂等和唯一约束、事务边界、并发策略、Provider callback/read-back、审批/发布/回滚授权、迁移兼容策略、审计事件、evidence manifest schema 及其正向/负向/故障测试矩阵；未形成这些设计物只能进入设计评审，不能进入控制面实现或真实 Provider 接入。
- **测试**：先写状态迁移和 schema contract tests；覆盖非法迁移、重复幂等、旧版本更新、跨团队访问和错误响应；数据库约束使用 integration test。
- **证据**：schema digest、migration checksum、测试结果、契约评审记录和权限矩阵版本。
- **退出条件**：核心对象和异步操作可以由测试独立创建、推进、查询和恢复；外部调用均可追踪；关键隔离和唯一性约束在数据库层生效。
- **阻塞条件**：状态只能由页面文案表达；异步接口无法查询最终状态；没有幂等/旧版本保护；权限依赖客户端 team 参数；事件无法关联 canonical commit 和 provider operation。

### 阶段 2：外部契约与技术 Spike

- **目标**：先证明身份、隔离和最短发布链可行，再决定真实 Provider 接入顺序。
- **输入**：阶段 1 契约、目标 DSH/Git/WeKnora 版本、TeamAI 分发候选版本、SkillHub（仅独立 Registry 需求获批时）的目标版本，以及获准的隔离非生产测试身份/凭据和合成 Tool Demo Provider；不得输入生产凭据。
- **主要设计/开发项**：完成 DSH auth context 到 `principal_id`、`team_id`、`asset_space_id` 的可验证交换设计与后端重新授权；验证 Workbench 安装时 Backend 地址/环境的受信分发与拒绝错误目标；完成 Git webhook/merge event 的签名、重放、乱序、旧 SHA 和幂等 Spike；完成 Git → fake WeKnora → read-back 的 ID、路径、版本、source commit、ACL 和检索映射，再对真实 WeKnora 测试 space 验证；**实测**目标版本按 document ID/版本下架、ACL 收紧、旧 path/旧索引的负向检索与直连访问阻断（不能只测有权正向命中），记录不支持时的隔离限制与 blocked 状态；完成 Git MR/CI/指定审核人/protected merge→固定 Skill package/digest、DSH 目标校验/loader 的 Spike，优先验证 TeamAI 分发与逐目标读回；独立 Registry 契约有需求时才验证 SkillHub release，否则记录管理员固定包 fallback；以标准 Tool/MCP 契约在隔离非生产环境调用只读合成 Demo Tool，验证发现、详情、主体/字段权限/环境、受控试参、来源与审计/失败回执；验证管理员配置草案、连接检查的权限范围/非生产 fixture/真实读回、密钥引用轮换与旧配置在途操作的对账；为各 Provider 记录 `provider_mode`、`integration_status`、版本、环境、owner、阻塞原因和 fallback；注入 timeout、重复提交、响应丢失、read-back 不一致和迟到回调。
- **Spike 记录格式**：每个 Spike 单独登记 `hypothesis`、`timebox`、`fixture`、`expected_result`、`actual_result`、`decision`、`owner`、`evidence_digest` 和对后续阶段的影响；至少拆分为控制面/跨团队拒绝、Git → outbox → worker → WeKnora、Skill package/digest/fallback、Workbench Plugin 安装，以及 **DSH 原生会话最小消费/知识引用观测**五类实验。最后一类须固定 Desktop/Harness commit、profile、插件身份和数据 owner 授权，用合成非生产会话分别检查宿主事件订阅/有权 Session Query、真实 Skill 调用与尝试、加载包 digest 映射、知识查询/零结果/检索/答案实际引用、漏投底账、权限撤销和字段白名单；先定是否能接入，再决定是否用 OTel/OTLP 作为技术观测传输，不能预设其能提供未采样分母或业务结果。**R-05 评论回合另建 Spike**：用有权合成评论验证真实投递、唯一 turn/comment、持久 reply、成功/失败/取消/超时终态、刷新读回及最小化权限边界，不拿上述消费观测或 OTel span 代替回复完成；缺契约只保留 Workbench 评论和人工改写。**R-09 来源链接另建 Spike**：个人 Inbox/导航只存定位且零抓取；知识入口用户明确选用、来源/用途/空间授权后，以隔离非生产脱敏链接验证限定来源、每跳重定向/DNS/实际地址、文件内容和解析器安全，失败只留最小待核定位；未通过则该链接抓取能力不开放，不能以管理员连接检查通过替代。失败时只能选择调整设计、保留 fallback 或阻断后续阶段，不得以“接口可访问”代替成功。
- **输出**：Provider capability matrix、Spike fixture、fake provider、真实 Provider blocker 清单、evidence manifest 模板和 read-back 字段映射。
- **测试**：contract、sandbox integration、签名/重放、故障注入和凭据扫描；真实 Provider 仅在非生产执行。
- **证据**：目标版本/环境、fixture digest、命令及退出码、provider read-back、失败/回滚结果、复核人及证据 digest。
- **退出条件**：身份/隔离通过；Git → WeKnora 最短链路有可重复证据；标准 Tool 契约与隔离非生产合成 Demo 的实际受控调用/失败回执有证据（无法获准测试目标则明确 blocked，不称 Tool 已跑通）；每个选用的 Provider 有 real/fallback/blocked 状态和下一步，未选用 Provider 记录选型结果；fake provider 足以支撑开发。
- **阻塞条件**：无法证明请求属于正确 asset-space；read-back 无法关联 source commit；Tool Demo 缺获准非生产只读目标、字段/主体授权或审计/失败读回时其真实集成验收 blocked，契约设计可继续但不报调用成功；只有 HTTP 成功没有业务状态；未验证能力被当作 P1 硬依赖。

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
- **主要设计/开发项**：实现 principal、membership、role binding、ACL、service identity 和资源范围校验；实现 repository identity 唯一性、路径规范化及绝对路径、`..`、符号链接逃逸拒绝；拆分创建、编辑、审核、发布、对账、回滚和指标查看权限；为 Git bot、WeKnora adapter、publisher 和 Worker 使用独立 credential binding；增加仅管理员可进入的「团队空间与连接」站内子页/Backend API：按空间维护配置草案、版本与激活状态，检查 Git、WeKnora 和按需启用的 Skill/DSH 目标绑定，展示非敏感状态、读回证据和责任人，Secret Manager 只保留服务端引用、不得回显明文；PostgreSQL/对象存储连接仍由平台运维配置而非团队用户填写。记录 `approved_by`、`released_by`、`executed_by`、`reconciled_by` 和接管原因。所有查询、写入、session、job、outbox、callback 和 provider operation 都必须由服务端从认证上下文推导并绑定 `team_id`/`asset_space_id`；repository、WeKnora space 和 distribution target 不能由客户端覆盖；数据库约束、RLS 或等价 repository 层策略必须防止漏加隔离过滤。
- **输出**：身份/权限模块、ACL middleware、repository binding、审计事件、权限 API 和最小授权配置。
- **测试**：权限矩阵、两个 asset-space isolation、跨团队读写、路径逃逸、凭据复用、成员撤销和服务身份边界 security tests；两台独立 Desktop 安装同一包后分别读自己的有权空间，普通用户不能读/改连接或回显密钥；平台/空间管理员分别做错 repo/space、越权目标、失效凭据、配置版本冲突、连接超时、轮换及激活回滚测试，外调中的旧配置按原目标读回对账。
- **隔离硬门禁**：必须覆盖跨团队资源 ID、伪造/重放 merge event、旧 callback、客户端篡改 team/asset-space、权限撤销后的已有 session/异步任务/回调、repository path 穿越和 Worker 使用错误 service identity；任一负向测试失败，不得进入真实数据、真实 Provider 或试点。
- **证据**：隔离报告、授权日志、审计查询、credential binding 清单和 secret scan。
- **退出条件**：同一 Workbench 服务于两个 asset-space 时，草稿、检索、任务、发布、指标和审计完全隔离；客户端不能扩大授权；有权管理员可在站内绑定/检查/激活/停用受限连接并查询错误与证据，普通成员无需逐机配置 Provider，数据库与共享密钥不出服务端。
- **阻塞条件**：隔离只在 UI；共享用户 Token；服务操作不可追溯；binding 可被客户端切换；越权没有自动化回归。

### 阶段 5：Knowledge-first 垂直切片与 Git 发布链

- **目标**：交付第一个可独立验收的 Knowledge 创作到发布闭环，并以明确标合成的材料通过真实非生产 Git/WeKnora 测试链验证入口⑤大盘；业务场景和角色使用阶段 0 的待填配置，合成样本不代替试点。
- **输入**：已确认的 `<pilot_scenario>` 或脱敏 fixture、Creation Session 设计、Git/WeKnora contract、阶段 4 权限能力。
- **主要设计/开发项**：由材料/知识 owner 先冻结首期格式×大小×语言/版式、关键内容与覆盖判定、形成/生效/截止及复核规则；仅对经目标解析实测支持的获准资料实现上传/脱敏、固定原件版本/hash、逐页/段/工作表或单元格定位与覆盖/未读范围、失败原因及时间证据。扫描件与复杂表格仅在实测通过后纳入；不支持、漏页漏表、关键锚点缺失或时效不明仅留有权最小待人工核对线索，服务端阻断可送审正式知识候选，补证后按固定原件重验。实现候选卡片、冲突和待确认项；实现草稿、修订、确认、暂停/恢复、分叉/只读和并发 base revision；评论按当前条目/草稿修订独立持久保存、刷新可查，目标 DSH 未实测可核回合/回复终态前只允许人工改写，不自动以回复替换待核稿；生成规范 knowledge path、metadata、sources、CHANGELOG 和变更包；通过 Git provider 创建分支/MR，执行格式、敏感信息、taxonomy、owner、链接和权限门禁；只接受 protected main merge event；由 outbox/Worker 调用 WeKnora ingest，读回 document/version/source/repo_path/ACL 并执行 retrieval smoke；只有 read-back 和检索通过才标记固定版本 `published`，失败保留旧版证据，旧版如无权或已失效须先阻断访问。按[工程设计的增改退役/对账契约](11-开发工程设计与集成基线.md#52-knowledge-增改退役与权限变更契约拟议)实现新建/修订的版本冲突、显式退役 tombstone、稳定 ID 移动/重命名、紧急访问阻断与旧索引逐项撤回/负向读回，持久游标核 Git/PG/WeKnora；无法证明外部不可检索时留 `withdrawal_unknown/revocation_unknown/manual_required` 并暂停相应访问，不伪称退役完成。
- **输出**：Knowledge-first E2E、页面/API、Git change package、merge event、WeKnora published/read-back、人工接管和回滚。
- **测试**：Creation Session、Git webhook、`创建 → 确认 → MR → merge → ingest → read-back → 检索` E2E；按 owner 冻结的支持矩阵，用授权脱敏原件与输出逐区块对照 hash/版本、页/段/表格锚点、已读/未读/排除范围和形成/生效/截止时间，覆盖正常长文本、跨页、复杂表格/扫描件（不支持则拒绝）、损坏/截断文件、缺页漏表/附件、旧版/过期或时效不明；缺关键锚点、权限、覆盖或时效时拒绝可送审正式候选与 MR，补证按固定原件重验，解析成功也不代替业务事实确认。以明确标识的合成材料/已有知识版本从入口②真实走草稿、指定审核人、protected merge、worker、WeKnora 测试索引/ACL/有权检索，再由入口⑤大盘按资产 ID/版本去重展示来源、进展、项目×产品线与有权具体文档深链；两版并发修改、旧 base revision 冲突与人工合并，新增同键重复，审核后退役/负向检索、移动/重命名旧 path 残留；紧急撤权先阻断受控入口、再查外部直连/旧版/缓存，旧 callback 不得复活；Webhook 漏投、重复/乱序或旧 SHA、合规站外 Git merge、未经审核 Git diff 隔离、PG 与 WeKnora 漂移、索引半成功/不可读回及扫描游标恢复的三方对账 fixture；大盘对索引失败、撤权、旧版残留展示 unknown/阻断而非假成功，未运行真实扫描的诊断只标预置 fixture。另覆盖敏感资料和 ACL 测试；让第一用户从真实或脱敏材料起步，在不操作 Git 的前提下看到来源、待确认点、草稿变更和下一步，暂停后返回原位置；让有权 steward 对过期资料[拒绝/限定范围/要求补证]，验证决定绑定候选及修订、阻断该候选而不误改已发布版本，补证形成新修订并重新确认；让受益者从可用的消费入口找到可核对来源的答案。阶段 5 仅验证“报告错/旧/缺内容”的入口原型或授权人工登记，并保留资产版本与来源；反馈候选处理、事件归因和回访闭环在阶段 6 验收。无法接入既有入口时明示为试点临时入口，不暗示已嵌入日常工作。
- **证据**：owner 批准的支持矩阵与时效规则、脱敏原件/解析结果逐区块比对、正负例与送审阻断回执；fixture digest、MR/merge commit、outbox/attempt、WeKnora read-back、检索结果、审计、失败和回滚记录。
- **退出条件**：首期范围经材料/知识 owner 冻结且以脱敏原件验证解析覆盖/定位/时效正负例；不支持或关键缺失不生成可送审正式候选，人工补证重验后才可继续。第一用户无需直接操作 Git 完成确认和提交；新增/修订知识在实际检索后才发布；隔离非生产合成知识从入口②通过真实受审 Git/Worker/WeKnora 测试空间读回进入入口⑤，有权具体文档链接、去重与双维关联可验证，修订/索引失败/撤权/旧版残留不冒称成功；退役和紧急撤权的声明范围有旧索引/外部入口负向读回或明确 blocked+安全升级（后者**不等于**退役/撤权成功）；持久对账能发现漏 event 和索引漂移且旧 callback 不复活已撤内容；消费入口可查到已读回版本，反馈入口原型或授权人工登记可记录问题、来源和资产版本；正式反馈处理和消费归因留给阶段 6。
- **阻塞条件**：草稿未经确认进入 WeKnora；merge event 可伪造或重复副作用；索引未读回却显示 published；合成知识未沿入口②真实审核/worker/WeKnora 测试空间走通却将大盘预置卡标非生产真实集成，或具体文档深链越权；无法保留仍获授权的旧版或对失效旧版即时阻断；退役仍能从受控/声明范围外部入口检索却显示已撤回；扫描漏 commit/残留索引后错误推进游标；无法人工补偿；数据无法脱敏。

### 阶段 6：消费、反馈与三层指标

- **目标**：建立发布后的 Knowledge 和 Skill 消费、反馈与指标最小闭环，不从技术成功推断业务成功。
- **输入**：已发布 Knowledge、可用的知识消费入口、反馈分流规则和试点指标配置；Skill 的真实消费制品由阶段 7 产出，不作为阶段 6 的输入或退出前置条件。
- **主要设计/开发项**：接收最小消费事件和 feedback reference，不复制完整 Prompt、输出、Token、Cookie、业务文件或 Tool Call trace；区分 invocation、attempt 和活跃主体并去重；分别记录 `technical_status`、`contract_status`、`business_status`，支持 `passed`、`failed`、`not_evaluable`、`unknown`；实现可靠性、采用、价值三层聚合和 team/asset-space/version/digest 隔离；将反馈分流为知识 MR、Skill regression、Provider/分发故障或平台问题；为 unknown、digest mismatch、handoff pending 和低反馈覆盖率提供下一步、责任人、超时和告警。反馈从用户回答/资料出处进入时，最小化保留问题类别、引用及资产版本、发现入口和获授权的复核人；受理后给用户可返回的状态与处理结果，复核发现是权限或工具问题时不错误修改知识。过期提醒来自明确的 owner/复核日期或受影响版本事件，进入队列等人工确认，不自动标记所有旧资料为错误或跳过审核发布。
- **消费事件契约**：Skill 最小事件至少包含 `event_id`、`idempotency_key`、`invocation_id`、`attempt_no`、`team_id`、`asset_space_id`、asset/version/digest、actor type/ref、时间、三层状态、`outcome_reference`、`feedback_reference` 和 schema version；Knowledge 另定义含零结果的 `knowledge_query`、有权版本 `knowledge_retrieval`、答案实际 `knowledge_citation` 和独立业务结果，绑定 `query_id/task_id/knowledge_id/version/source_commit` 与可读回的 document/version，不把检索算引用或把引用算任务成功。有效调用、执行尝试、重试、unknown 与 `not_evaluable` 的分母规则必须按预设范围、观察窗口和结果截止时间可计算、可对账；并列已判定通过率、包含 unknown 的保守下界、裁决覆盖率、可信开始/查询底账的观测覆盖率及版本归因率。未知 digest、跨团队事件、迟到/重复事件必须拒绝或进入 reconciliation，迟到结果修订须留报表快照。没有业务结果证据只能记为 `unknown`；没有可信总体底账或知识实际引用证据时，相应总体率显示“不可计算”，不能只拿收到的事件推算；低反馈覆盖率和小样本不得直接发布 Badcase 率或价值结论。
- **输出**：Consumption Event API、Feedback Candidate、指标聚合、最小报表、Badcase 分流和运营复核记录。
- **测试**：schema/idempotency、重复/重试/迟到事件、状态分母规则、ACL、敏感字段拒绝、反馈去重、小样本保护和事件对账；增测知识零结果、错误版本、只检索未引用/已引用未复核、多文档/多查询任务去重，Skill 开始事件漏投、未归因 digest、截止后补回执及不同观测覆盖下的“不可计算”退化；以一条“回答缺来源/内容过期”的反馈走通报告、受理/误报分流、指派、修订、审核、发布读回、回访确认，验证各阶段可见但不把受理和入库当业务效果；以无人认领、待核实、Provider unknown 和指标覆盖不足分别展示可执行下一步；验证待办超载时申请暂缓/转交/升级均有接收者或下次检查时间，未接收不转移责任，贡献归因更正留痕且无权者不可修改。
- **证据**：事件样本、聚合查询、对账、脱敏报表、反馈处理、周/月复核和告警记录。
- **退出条件**：Knowledge 按实际 `knowledge_id/version/source_commit` 归因，查询/零结果、检索与实际引用分列；只有目标宿主或其它经授权的消费方能提供可核实际引用和可信查询底账时才计算相应的总体率，否则如实显示已观测样本/“不可计算”。能查看去重后的有权主体、分层结果（有证据时）、`unknown`、Badcase 和反馈/裁决/观测覆盖率；反馈可关联版本、进入修订任务并回访。Skill 的 `skill_id/version/package_digest` 事件契约和测试 fixture 在本阶段通过，但不要求尚未生成的 Skill 产生真实消费；阶段 7 完成 package、安装或 fallback 与读回后，须按固定 digest 补验最小消费、去重、三层结果、反馈分流和版本归因。无业务证据时为 `unknown`；脱敏回放只可证明契约、可靠性、回归和故障恢复，不能替代 Pilot Beta 所需的真实用户、真实低风险流程、人工基线、业务结果 Owner 和价值指标。
- **阻塞条件**：把发布/安装/load 当消费；用单一 outcome 推断三层成功；重试重复计为调用；敏感数据进入长期指标；低覆盖率下直接解释 Badcase 率。

### 阶段 7：Skill 契约、测试与打包

- **目标**：在 Knowledge-first 的最小发布和消费链路通过后，仍在同一 MVP 内交付完整的 Skill 资产生产线；Skill 不是 P1 之外的后续功能，而是以 Knowledge-first 为前置顺序的第二条 MVP 资产路径。
- **节点依赖**：阶段 7 复用阶段 6 的消费事件与反馈契约，不要求阶段 8 的真实 SkillHub、TeamAI 或 DSH Provider 已 `real_verified`；N3 的 Git 受审合并、package、digest、安装/read-back、明确标记的管理员固定包 fallback 和最小消费测试是本阶段的交付/退出门禁，不是进入阶段 7 的前置条件。
- **输入**：工作流候选、Knowledge 依赖、目标 DSH Skill package/layout 校验结果、固定包/管理员 fallback 契约；SkillHub 契约只在独立 Registry 选型后补入，另需指标配置。
- **主要设计/开发项**：实现 Workflow Draft 和 Skill Creation Session；生成 `skills/<domain>/<name>/`、`contract/` 和测试目录；确需知识查询时才声明固定 `knowledge_dependencies` 的 ID/version、查询用途及零结果/无权/失效的用户核实与停止判断策略，声明 effects、网络/数据范围、能力需求、风险等级和 profile；建立 golden/boundary/regression/security fixture；静态校验与未经批准 Draft 的可执行试跑分离：Runner 隔离及负向证据未通过前只允许不执行候选代码/Tool 的静态检查，浏览器规则演练不得充作真实测试或送审证据；真实试跑须在经准入的隔离非生产 Runner 中用获准脱敏 fixture，限制权限、网络/文件/进程、跨空间与资源/成本，失败时阻断送审；核实经审核合入 canonical protected main 的 commit 后标记 Skill `已发布`，再从该 commit 构建 package，计算 `package_digest`，禁止 `latest` 和未提交工作区；先用 fake/admin 验证 Registry 契约或管理员固定包路径的独立操作/撤回、旧版本 pin 和 digest read-back，不把 fake/admin 回执视为真实 Registry release。
- **输出**：Skill contract、测试集、package builder、digest、release metadata、回滚包和质量门禁。
- **测试**：contract/golden/regression/security；恶意输入、越权 effects、依赖漂移、不可复现构建、digest mismatch、资源限制和失败回滚。
- **证据**：merge commit、manifest、package/digest、测试报告、SBOM、release/read-back 或 fallback 记录。
- **退出条件**：固定 commit 可重复构建；Git 指定审核人/CI/canonical protected main merge 的审核与 Skill `已发布` 证据、目标 DSH 格式校验与包测试分别留证，合并前（含已批准未合并）仍为 `审核中`；契约、依赖、测试证据完整，未经批准 Draft 的可执行试跑须已通过隔离 Runner 安全准入和负向测试，不能由静态扫描、虚构演练或有权限的普通 Tool 调用代替；**选用 Registry 时**其独立 release/read-back 与 digest 一致，未选用则有期限的管理员固定包 fallback 有审计/目标/回滚证据，不伪称 Registry release，且 fallback 不使未合并 Skill 已发布；至少完成一条与 Knowledge 固定版本依赖关联的 Skill MVP 路径，包括 Skill package、安装或管理员/fake fallback、load/read-back、最小消费和回滚，并按阶段 6 契约补验 Skill 版本/digest 归因、去重、三层结果和反馈分流；Provider 状态如实记录。
- **阻塞条件**：Skill 只有 Prompt；依赖 `latest`；无法核实 canonical Git 经审 merge 却标 Skill 已发布；构建不可复现；digest 不一致；能力声明绕过权限或人工确认。

### 阶段 8：候选 Skill Registry、可选 TeamAI 与 DSH Provider 集成

- **目标**：在 Skill 包和控制面稳定后，按固定 digest 逐段验证真实发布（若选 SkillHub 或经 ADR 批准的等价实现）、可选分发和 Harness load；不建设 Harness Runtime。
- **输入**：immutable package/digest、Provider 版本、目标 profile、非生产凭据和 handoff contract。
- **主要设计/开发项**：先按选型门验证 SkillHub register/release/read-back（若选择；否则按 ADR 验证等价实现或标注受控管理员固定包）；TeamAI（如启用）仅消费固定批准包：实测同仓/经审核镜像仓的 Git 版本对应、成员在有权 workspace/user scope 首次 `init` 和最小只读 Git 授权、SessionStart Hook 在目标 DSH 的触发时点与主动 `pull`、目标目录/已装文件清单和摘要、离线重连、本地编辑冲突及撤回残留；逐目标完成读回后才记 installed，不能因仓库 merge 或连接卡检查成功推断全员自动安装；验证 DSH discovery、显式 load、profile/tool policy、loaded digest 和版本不兼容拒绝；原生会话要调用 WeKnora 时另验只读 Plugin/MCP 或受控查询工具、身份/空间 ACL、来源引用、撤权拒绝与配置模板的安全安装，不因 Skill 同步或 WeKnora 端点可访问即声称检索已接通；统一 `requested → submitted → provider_pending → readback_verified → succeeded`，异常进入 `unknown → reconciling`；执行 `build → package → digest → fresh-profile install → restart → load report/read-back → 功能 smoke → disable/uninstall/rollback`。
- **输出**：Provider integration evidence、pinned digest chain、handoff/load read-back、故障恢复和回滚结果，或明确 fallback/blocked 结论。
- **测试**：非生产 contract/integration/E2E；版本漂移、目标错误、权限越界、安装失败、回滚、超时、read-back mismatch 和迟到回调；security review。
- **证据**：目标版本/环境、package/fixture digest、命令及退出码、各层 read-back、失败/回滚、执行/复核人及证据 digest。
- **退出条件**：对已通过真实目标验证的路径，同一固定包 digest 贯穿所选 Registry release、目标安装（TeamAI 如启用）和 DSH loaded digest，且失败可清理、回滚和对账；真实 DSH load 或所选 Provider 未通过时，仅允许以限期 fallback/blocked 结论结束该项 Spike，不得宣称 N5 的真实集成验收通过、目标已 loaded 或 Stable。
- **阻塞条件**：把 HTTP 200、安装成功或 handoff request 当 loaded；重新解析 `latest`；没有最终 read-back；目标 profile/工具策略不明；证据缺少不可变版本或复核人。

### 阶段 9：非生产试点、复盘与成熟度决策

- **目标**：在业务侧确认的首个低风险场景中验证端到端价值，并决定 Contract Beta、Pilot Beta、Stable 或回退。
- **输入**：试点输入卡、阶段 5/6/8 证据、非生产环境、人工基线、目标指标、维护和回滚责任。
- **主要设计/开发项**：建立真实试点 roster；角色可兼任但必须分别记录创作/维护、审核/发布、业务结果确认、平台执行和 Go/No-Go 责任；执行固定周期 Knowledge-first 试点；先从第一受益者真实工作里的找答案/核对出处任务进入，再让第一用户在 Workbench 完成一次新增和一次修订，让审核人处理一次通过或退回；另对生产数据中台目录/字段权限/审批与调用、真实团队材料授权及大盘扫描逐项决定是否另开试点，不能从合成 Demo 自动升级；每周检查采用、可靠性、反馈覆盖率、unknown、人工接管和维护负担；每月复盘价值指标和 Badcase；演练 Provider 故障、Worker 重启、数据库恢复、旧版回滚、权限撤销和敏感数据事件；形成继续、扩样、fallback、暂停、修复或退役决策。
- **输出**：试点报告、指标和对账数据、反馈闭环、故障演练、维护容量评估、成熟度决策和 backlog。
- **测试**：完整 E2E、业务结果抽样、用户可用性、故障恢复、安全权限回归、覆盖率/SLO/容量检查。
- **证据**：试点版本/环境、参与者授权、fixture/asset/package digest、消费事件、业务结果引用、反馈覆盖率、回滚、复盘和 evidence manifest。
- **退出条件**：Contract Beta 通过契约、权限、状态机、幂等、失败路径和可靠性证据；Pilot Beta 另需真实用户、业务结果 Owner、人工基线、采用指标和至少一个价值指标；Stable 仅对声明的 asset type、asset-space、provider mode、target、profile 和 digest 范围授予，并要求三层指标、真实 Provider read-back、安全治理、恢复和维护容量达标。
- **阻塞条件**：角色或基线未确认；没有业务证据却宣称价值成功；关键 unknown 未对账；回滚/恢复/权限撤销失败；把单一场景结果扩大为全局 Stable。

### 路线级依赖、并行和验收约束

- 阶段 0、1 先冻结边界和契约；阶段 2 可并行验证多个 Provider，但不得反向改变 canonical source 和控制面状态机。
- 阶段 3 可与阶段 2 并行开发 fake provider、fixture、CI 和部署基础；阶段 4 必须在真实团队资产写入前完成。
- 阶段 5 是首个 Knowledge 业务垂直切片；阶段 6 依赖其发布/read-back，先验收 Knowledge 消费与反馈及双资产通用契约；阶段 7 在同一 MVP 内完成 Skill contract、测试、打包、安装/read-back 和按阶段 6 契约补验的最小消费，不得延期为后续产品。
- 阶段 8 依赖 immutable digest 和 Provider evidence；TeamAI、DSH 的真实集成不得成为 Knowledge MVP 的硬阻塞，但 Skill MVP 本身的 package、安装/fallback 和最小消费不得省略。
- 阶段 9 不能用技术验收替代业务 Go/No-Go。任何 `blocked`、`unknown` 或 `manual_intervention` 都要保留责任人、超时和下一步。
- 每个实现任务至少提供可复制的 `format/lint/typecheck`、`unit`、`integration`、`contract`、`security/secret scan`、`migration/restore`、`failure injection`、`coverage` 和目标环境 `read-back` 命令；命令、版本、退出码、输出摘要和证据 digest 进入 evidence manifest。

## 3. P0：双资产边界与能力侦察

### 交付

- 一批明确标为合成、可回放的知识材料、已有版本、项目×产品线及权限主体 fixture；真实业务样本仅在另获授权、完成脱敏并进入相应试点门禁后使用；
- 腾讯云非生产 Team Knowledge Backend、worker、PostgreSQL、对象存储、网络/TLS、DSH auth context 映射、日志脱敏、备份恢复和监控基础；
- 已有 WeKnora 的独立测试 space，以及 Git↔WeKnora mapping 的验证数据；
- DSH/Harness、SkillHub 和 TeamLab 的目标版本、部署制品和健康检查验证；若无法确认，记录 blocker 并启用管理员/fake provider fallback；
- `team-knowledge-workbench` 的 package skeleton、server/client contract、构建产物和一次内部安装/重启/read-back 验证；同时冻结可信 Backend 地址/环境的安装分发契约，确认客户端不持 Git/WeKnora/PostgreSQL/TeamAI **共享服务凭据**；TeamAI 若选用时成员授权的目标端 Git 只读身份与首次 `init` 另列；
- 首位 platform owner 的受控初始化、团队资产空间/连接配置数据模型、仅管理员可见子页与服务端绑定/验证/激活契约；目标版本读回和凭据轮换作为待实测门禁，而非原型已有功能；
- 知识规范目录、taxonomy、domain/topic/path preview、Git↔WeKnora mapping 和迁移/退役 contract；
- 五入口 Workbench 默认首页、个人 Inbox 暂存与本人使用反馈并列，以及按需创建 Knowledge/Skill Creation Session 的原型；标准 Tool/MCP 契约与隔离合成 Demo 方案，以及入口②→Git/WeKnora→入口⑤大盘的真实非生产链路测试卡（见 V-32–V-34）；
- principal/team membership/role binding、service identity、Git 提交人和 Skill 发布责任链模型；
- session、draft、asset revision、release、handoff、审批、operation/job/outbox/reconciliation 和反馈引用模型；
- Git merge event fixture、签名/重放/乱序/旧 SHA contract；
- WeKnora ingest/read-back contract：document/version/source/repo_path/ACL 和可检索验证；
- Skill package/digest、可选 SkillHub Registry release/read-back、优先验证 TeamAI pinned digest/distribution/read-back、DSH handoff/load/read-back contract；无需独立 Registry 时以 Git 审核固定包和有期限管理员 fallback 留证；
- 已选 Registry（若有）/DSH handoff metadata 与受控目标分发 contract，不要求真实 Harness runtime；
- Plugin manifest/tool contract 的预留边界和 fake provider contract，不要求真实 Plugin runtime；
- fake Git/WeKnora/受控分发 provider 或 adapter contract；SkillHub 仅在选型有独立 Registry 需求时添加相应 fake/真实契约；合成 Tool Demo 需另有非生产真实调用证据；
- Skill input/output、effects、能力需求和风险模型；
- 目标 DSH/WeKnora 状态、TeamAI（优先验证）与按需选用的 SkillHub/TeamLab API 和 DSH Provider/discovery/load 能力记录；
- DSH Plugin 可安装契约侦察：固定 commit/profile，读取官方 package/类型/README/fixture/Loader，区分 `fact/candidate/pending_checks/warning`；
- 一个最小 Host-only Plugin Bundle Spike，完成 `build → package → digest → fresh-profile install → restart → load report/read-back → functional smoke → disable/uninstall/rollback`；
- 不使用生产 Token 的验证证据。

### P0 退出

双资产 schema、非法状态、幂等、权限冲突、契约失败、运行归因、故障路径和人工 fallback 均有测试；腾讯云非生产环境可部署、可观测、可备份和可回滚；PostgreSQL migration、跨团队拒绝、Worker 重启恢复和外部操作对账可验证；WeKnora 测试 space 可完成 Git path/metadata/read-back 验证；Workbench package 可完成安装、重启、enabled/UI read-back；标准 Tool 契约和非生产 Demo 的测试目标/授权/实际读回有可执行 Spike 卡，未经测试保持 blocked；DSH/Harness 与选用的 SkillHub/TeamAI/TeamLab 尚未确认能力各有 owner、日期、blocker 和有期限 fallback/阻断结论，不因未选用 Registry 判 P0 失败。

Host-only Bundle Spike 不得以“已写计划”作为完成条件：必须记录固定 DSH commit/profile、package digest、fresh-profile 安装、重启、load report、功能 smoke、disable/uninstall 和 rollback 的实际结果；若目标环境不可用，必须以 `blocked` 或 `fallback` 完成证据记录，并填写 owner、日期、原因和下一步。未达到上述条件不得进入 P1 的正式 Plugin 依赖或将 Plugin 契约侦察标记为完成。

## 4. P1：双资产 MVP 闭环（Knowledge-first，Skill 同期完成）

### 知识交付

从「提炼知识&经验」的有权材料和明确知识去向按需创建独立 Knowledge Creation Session；会话内包含材料、候选卡片、变更包、Git provider、CI/CODEOWNERS、审核、protected main merge event、Workbench outbox/worker、WeKnora ingest/status/search、document/version/source/ACL read-back、引用和复核任务。完整闭环是：`merge event → outbox → worker → ingest → read-back → published`。入口中的浏览、事实/经验核对与非知识去向不强制生成会话。

### Skill 交付

从「打磨可复用的技能」核到有权候选/指定版本，或从材料第五步的稳定缺口，按需创建独立 Skill Creation Session；会话内包含 Skill 需求卡、Workflow Draft、模板化创建、input/output schema、按需知识查询说明与固定引用、effects/能力需求声明、golden/regression/security、Git/CI 审核、从 merge commit 打包、immutable digest、候选 SkillHub release/read-back 或明确标记的管理员固定包 fallback、pinned digest、TeamAI distribution/read-back（如启用）和 DSH handoff metadata。仅查看候选、引用已适用旧版不必创建新资产。P1 的 Skill 交付允许使用 fake/admin provider 或管理员 fallback，但必须完成 package、digest、实际声明的固定版本引用（无知识查询需求可为空）、安装/read-back 和最小消费验证；SkillHub、TeamAI、DSH 的真实 Provider 晋级属于 P3，不是 P1 双资产 MVP 的前置条件。

- SkillHub/DSH Provider/TeamAI 未验证时使用管理员发布或 fake adapter，但必须保持 package、digest、approval、target、profile、installed revision 和回滚状态可追踪；fallback 不能使用漂移版本。

### 数据源与大盘纵向验证交付

入口④的虚构 Tool 广场只保留为明确标注的产品演示；首期另交付[标准 Tool/MCP adapter 契约及非生产可真实调用的合成 Demo Tool](11-开发工程设计与集成基线.md#55-数据中台-toolmcp-标准接入契约与真实-demo拟议)，涵盖目录、详情/schema、权限及环境检查、受控只读试参、带来源结果、审计和故障回执。没有真实数据中台 Provider 时仅对合成 Demo 的目标环境声明非生产真实集成；生产目录、申请审批、字段权限和调用统计仍依提供方/数据责任方/DSH 宿主各自授权与读回逐项验收。入口⑤以[合成知识的真实 Git/WeKnora 纵向链](11-开发工程设计与集成基线.md#56-合成知识经真实链路进入资产大盘拟议)验证最新进展、全局概览和授权深链；只有经过来源/目标授权并实测的 WeKnora 指定来源文档 ID/版本、逐文档权限与安全深链才给原文外跳；正式知识的 WeKnora 索引/读回不能代替原件托管证据，映射缺失改用有权原系统定位/人工核对，不建 Workbench 持久原文阅读或来源全文索引。合成输入、非生产真集成、生产真能力分别标记，不用合成样本冒充业务成果或 AI 自动诊断。

### P1 退出

- 非程序员可在五入口中查看有权反馈/来源/资产，按需从材料或 Skill 候选/指定版本进入独立会话，创建知识和 Skill 草稿而无需操作 Git；只读、沿用旧版和单独提交反馈不会自动建会话；
- 至少两个团队/asset space 可以安装同一 `team-knowledge-workbench`，且 Git、WeKnora、Creation Session、ACL、审计和发布状态完全隔离；各成员从受信安装配置连接同一 Backend，按服务端权限选空间，不需要在个人电脑重复填写 Provider/数据库连接；有权管理员可在站内检查绑定、失败原因及配置版本，凭据只由服务端引用且不能回显；
- 知识创建能生成规范 repo path，WeKnora 能读回相同 knowledge ID、logical path、version、source commit 和 ACL，并通过检索验证后才标记 published；
- 用户可以同时打开多个知识/Skill 会话，暂停、恢复、归档、分叉和只读；
- 会话上下文、材料、草稿、异步操作和回调不会串线；
- 同一正式资产的并发修改检测 base revision，冲突不会静默覆盖；
- 知识检索结果带 document/version/source/ACL；
- Skill 从固定 merge commit 生成 package/digest；选择 SkillHub 且目标真实接入时读回 digest 一致；选择管理员 fallback 时标明真实路径、操作者、包/目标/回滚证据，不伪称 SkillHub release；
- TeamAI（如启用）按同一个 pinned digest 完成目标安装读回，DSH handoff 不发生 digest 漂移；
- 发布版本能生成可供下游 Harness 验证的 version/digest/dependency metadata；
- 重复请求不重复创建 MR、release 或 index；
- CI 失败、契约冲突或权限超界不能发布；
- SkillHub、WeKnora 和 provider 超时有清晰状态和人工接管；
- 至少有一项真实或脱敏回放场景完成双资产生产线；
- 入口④标准契约经评审、合成 Demo Tool 在获准的隔离非生产 Provider 完成真实只读调用、字段/主体拒绝、来源及审计/失败回执；如目标不可获得须以 blocked 结项，不能把静态虚构目录算通过；
- 入口⑤至少一批合成知识从入口②经受审 Git/Worker/WeKnora 测试空间检索读回进入大盘；版本/来源/项目×产品线/按 ID+版本去重/有权具体文档深链正确；修订、索引失败、撤权和旧版残留有负向证据，fixture 线索不称智能巡检；
- P1 只允许将真实 Provider 标记为 `real_verified`，fake/admin 路径必须标记 `fallback_only` 或 `contract_verified`，不能将 fallback 结果报告为真实 release、distribution 或 loaded；合成 Demo 的真实非生产读回也不得外推为生产 Provider/业务授权已通过；
- P1 必须能记录三层指标的最小字段：可靠性指标完整记录，采用指标可按有效调用/尝试/用户去重，价值指标没有业务结果时明确为 `unknown`。

P1 退出不等于 Stable。P1 只能说明双资产 MVP 在受控环境可运行；进入 Pilot Beta 还需要一个明确低风险真实场景、业务结果 Owner、人工基线、目标指标和反馈回流证据。

## 5. P2：发布交接与反馈闭环

### 交付

发布版本、digest、handoff target、交接读回、最小消费事件、三层指标聚合、反馈引用、知识复核队列、Skill 回归队列、每周复核、每月质量报告、stale/纠正率/失败率提醒、备份 owner、退役和回滚流程。

指标按以下三层逐步实现：

- **价值指标**：业务任务完成率、首次成功率、人工返工率、平均处理时长、业务错误率、已确认 Badcase 率和目标业务指标改善；
- **采用指标**：有效调用次数、执行尝试次数、活跃用户数、发布版本消费率、版本复用率、反馈覆盖率和资产维护及时率；
- **平台可靠性指标**：merge-to-index 时延、package build 成功率、Provider read-back 成功率、outbox backlog、retry rate、unknown 数量/持续时间、digest mismatch、回滚成功率和 provider error rate。

### P2 退出

P2 的质量与指标目标须分证据报告：连续 4 周有真实消费或脱敏回放和复核记录，能按实际 Knowledge/Skill 资产版本及固定 digest 查看采用或回放指标，知识问题能进入知识 MR、Skill 问题能进入 Skill 回归，未知交接/消费状态可人工对账；低反馈覆盖率时不把 Badcase 比例解释为真实错误率。回放仅证明契约与技术闭环，不能满足“价值指标改善”；后者必须有业务结果 Owner 核验的真实低风险任务、人工基线和结果证据，缺少这些时价值保持 `unknown`，P2 的价值目标未通过。

P2 的指标闭环不等于 Stable。脱敏回放只能证明契约、可靠性、回归和故障恢复；Pilot Beta 必须另有真实用户、真实低风险流程、业务结果 Owner、人工基线、目标指标和反馈回流。只有在真实 Provider read-back、价值 Owner 确认、关键可靠性阈值、安全治理、SLA、回滚和维护容量均满足时，才可将声明范围内的资产标记为 Stable。

## 6. P3：候选 Skill release／可选分发 → DeepSeek Harness 消费能力验证

在创作发布闭环稳定后，按固定 digest 分别验证经选型门确认的 SkillHub release/read-back（或具备等价治理能力的替代方案）、可选 TeamAI distribution/install/read-back，以及目标 Harness handoff/discovery/load。只有采用某 Provider 且取得目标环境真实读回，才声明相应 Provider 的 release/install；管理员固定包 fallback 另列 mode 与期限。必须证明：同一个 package digest 从已审 commit/经验证的 release 或 fallback 贯穿可选分发到 DSH loaded digest，profile/工具策略不越权，安装失败可清理，版本漂移进入 unknown/reconciling 并可回滚。

本阶段不在本项目实现 Harness Session、Run、Tool Call 或业务任务状态机；只保留交接协议、验证结果和反馈引用。

## 7. P4：控制台/Gateway 与受控 Plugin 管理演进

只有在两个以上知识域或 Skill 稳定使用、出现第二 provider、人工状态查询成为瓶颈、需要集中权限/审计，或模块化单体无法接受地测试发布时，才评估 Console/Gateway/adapter、Plugin catalog/runtime、签名事件和低风险 MCP。

P4 的 Plugin 不再采用“最后一次性集成”方式。详细的适用能力面、Bundle 安装步骤和证据模板以[DSH Plugin 开发与安装契约验证](../验证/05-DSH%20Plugin开发与安装契约验证.md)为准；每个增量必须在目标 DSH commit/profile 上重新打 Bundle、计算 digest、安装到 fresh profile、重启、读取 boot/Node/Client load report，再做脱敏功能 E2E。Host-only、Client-only、Mixed bridge、trace aggregation 和生产候选分别形成 Go/No-Go 证据；未确认的 package 字段、Cordis patch、session trace service、Host→Client bridge 或 UI slot 不得进入正式业务 Plugin。


### Plugin 交付

- Plugin catalog 和最小 manifest/tool contract；
- 一个低风险外部系统适配器或受控内置 Plugin；
- 权限/凭据声明、Secret Manager 引用和 profile/tool policy；
- 安全、依赖/SBOM、兼容性、health、超时/重试/幂等门禁；
- 安装、启用、禁用、撤回、回滚和运行归因；
- Plugin 故障与 Skill 质量问题的反馈分流。

新增层不能改变 Git、WeKnora、SkillHub、DSH、Plugin package 和人工审核的权威边界。

## 8. 独立业务 Plugin、MCP 与高风险能力

验证第三方业务 Plugin、Registry/Marketplace、通用 MCP、沙箱、多租户和生产写入。入口④的版本化 Tool/MCP **标准接入契约及受控只读合成 Demo**已在阶段 1–2/P1 单列 V-32，不以其低风险实验声称第三方生产 Plugin、生产业务 Tool 或高风险能力已通过 P4。上述扩展仍须先有 P4 的真实价值、隔离构建、依赖扫描、审批、二次确认、观测和回滚证据。

## 9. 统一验收矩阵

**验收矩阵列：编号｜主题｜验收证据与失败条件。**下列 V 项按对应阶段与声明范围逐一取证；未列真实环境和读回的项目不能由原型截图代替。

| 编号 | 主题 | 验收证据与失败条件 |
|---|---|---|
| V-01 | 工作台与会话入口 | 五个一级入口一致（首项「我的工作台」）、默认先看个人 Inbox 主动暂存，再看本人有权的使用与反馈；材料/Skill 候选仅在进入正式创作或修订时创建正确的 Creation Session；首次使用能说明本次任务可获得什么、需要谁确认，回访可一键回到未完成动作；首页不得把发布数当业务价值 |
| V-02 | Workbench Plugin 安装 | package、canonical repository、digest、安装、重启、enabled/UI read-back 可验证；安装不被报告为资产发布 |
| V-03 | 多团队资产隔离与集中配置 | 两台以上 Desktop 安装同一 Workbench，受信 Backend 地址/环境分发和身份交换可验；普通用户仅见本人有权空间、不逐机填 Provider 共享凭据；team/asset-space/Git/WeKnora/ACL/session/审计互相隔离；管理员子页可按权限做配置草案→连接检查→激活/停用，版本并发、密钥轮换/不回显、旧操作对账和失败回滚可验证；如选 TeamAI，卡片仅允许绑定获批仓库/target、pull 模式及逐设备 init/授权状态，不把配置通过或测试 HTTP 200 当真实发布、安装 |
| V-04 | 知识目录与索引映射 | domain/topic/path preview、空间内唯一 canonical key、稳定 asset ID、Git↔WeKnora 多版本/旧 document ID 映射可验证；新增/修订冲突、显式 tombstone 退役、移动/重命名旧路径残留及旧索引不可见性分别有正负向证据，不把 Git path 删除当已下架 |
| V-05 | 会话隔离与生命周期 | 多会话可并行；暂停、恢复、归档、分叉、只读可用且上下文不串线；暂停后由首页/待办返回原阶段、草稿和证据，归档/只读展示原因和恢复或新建路径 |
| V-06 | 草稿与并发 | session/draft/revision 可追踪；同 base revision 并发提交触发冲突和人工合并 |
| V-07 | 双资产 schema/状态 | 合法/非法/重复/并发迁移有测试 |
| V-08 | Skill 创建 | 模板、metadata、契约及确需查询时的固定知识引用与失败核实说明可生成并审核；无知识需求不强制绑定 |
| V-09 | Skill 门禁与未批准 Draft 的测试隔离 | schema、effects、能力需求、依赖及 golden/regression/security 各有证据；静态检查不得执行候选代码、脚本或真实 Tool，不产生真实试跑通过回执。真实试跑仅在安全/平台批准且用无害/恶意脚本与 Tool fixture 完成负向验证的隔离非生产 Runner 中使用获准脱敏输入，核最小权限/无生产凭据、网络/文件/进程/跨空间拒绝、CPU/内存/时间/并发/成本上限、超时终止、清理与最小审计；Runner 未就绪、撤权、超额或隔离失败时执行与送审保持阻断，不能以静态扫描、原型规则演练、DSH/CI/通用 Tool 替代真实测试 |
| V-10 | Git merge event 与异步发布 | merge event 验签、经审核 protected commit 验证、逐资产稳定 ID/change kind 幂等、旧 SHA/乱序处理、outbox 落库、worker lease/retry/crash recovery；漏 webhook 与合规站外 merge 可从持久游标补 receipt，未经审核/意外路径不自动索引，游标扫不全不推进 |
| V-11 | WeKnora ingest/read-back | 指定版本来源/ACL/document/path 与有权检索读回后才 published；部分索引失败仅在旧版仍安全获授权时继续服务；退役/迁移/紧急撤权核旧版、旧 path、指定主体及直连入口的负向读回，无法证实保持 unknown/blocked 并升级，不以服务端过滤冒充外部撤权 |
| V-12 | Skill Git 已发布/package/条件性 Registry release | 指定版本在 canonical Git protected main 上经 MR/CI/指定审核人批准且 merge commit 可核实后才标 `已发布`；MR 提交、CI 或批准但未合并仍 `审核中`，漏 event/未知 merge 先对账且不得凭 webhook、PG、打包或 fallback 晋级；固定 merge commit 构建 package digest、目标 DSH Skill 格式校验与业务测试各自留证且不互相代替；独立 Registry 选型通过才核其 release id/状态/digest 真实读回（未知/失败不得显示 Registry 成功但不撤销已证实 Git 发布），否则有期限管理员固定包 fallback 核操作者、目标、摘要和回滚；fallback 自身不发布 Skill |
| V-13 | 固定 digest → 可选 TeamAI → DSH | 选用 TeamAI 时验证 `init` 前/后、有权/无权 Git 身份、同仓或受审镜像仓 source→commit→文件摘要、下一次 SessionStart 自动 pull 与显式主动 pull、运行中/离线/Hook 缺失、本地编辑冲突、停用/撤回与旧副本；逐 target installed revision/file list/digest 与批准 pinned digest 映射一致才写 installed，DSH handoff/load/profile 独立读回；不启用 TeamAI 则记录受控目标安装及其读回，不伪称 TeamAI 自动下发 |
| V-14 | 非程序员体验 | 不操作 Git 可创建、确认、审核和发布；第一用户在预览中辨认来源/推断及版本差异，审核退回后能按意见在原会话修订；发布排队、失败或 unknown 时知道责任人、已验证到哪一步及下一步，不会误以为已生效 |
| V-15 | 交接协议 | 下游 target、version、digest 和依赖可追踪 |
| V-16 | 反馈分流与 Badcase | 无运行事件也可报告最小疑点，独立 Feedback Candidate 能受理、确认、去重、分流、补证、关闭、回访并按受影响调用数/覆盖率统计；用户从带来源的回答或资产详情反馈缺失/错误/过期，能看责任人/指派、核验和处理状态；知识、Skill、分发、平台或业务流程问题进入正确路径，误报、无运行引用或无人认领均有回执，反馈不直接改正式资产，也不强制创建 Creation Session；仅正式修订决定和服务端授权后关联新会话 |
| V-17 | 身份与责任链 | DSH principal、team/role ACL、Git service identity、approved_by/released_by/executed_by 和跨团队拒绝可审计 |
| V-18 | PostgreSQL 控制面 | migration、事务/乐观锁、幂等、备份恢复、Worker 重启和数据库故障的 unknown/degraded 状态可验证 |
| V-19 | 安全审计 | 无 secret 泄露、越权和不可追踪写入 |
| V-20 | 故障恢复 | provider 半成功、超时、丢 event、重复/乱序、迟到旧 callback、索引孤儿/旧版残留、撤权竞态均能用 Git/PG/WeKnora 持久对账发现；原目标先读回再补偿，权限收紧即时阻断受控入口，外部不可阻断则安全升级而非报告成功；人工接管、告警和恢复游标有证据 |
| V-21 | 稳定发布 | Skill 的 Git `已发布` 以经审核的 canonical protected main merge 取证，Knowledge `published` 以 WeKnora 授权读回/检索取证；选用时 Registry released、安装、加载与 rollback 各自另核批准、digest、读回及旧版本 pin，管理员 fallback 不充任任一资产的发布证据 |
| V-22 | 运营价值 | 至少一个由业务结果 Owner 确认的真实低风险场景，记录人工基线、观察窗口和结果证据，验证找答案/重复解释/返工等实际任务是否改善；同时核算贡献与审核负担，覆盖不足或仅有上传/发布/安装计数时标记 unknown，不报告改善 |
| V-23 | Plugin 预留契约 | P0 有 manifest/tool contract、权限边界；不要求真实业务 Plugin runtime |
| V-24 | Harness 能力验证（P3） | Provider/discovery/load 和反馈引用有可重复证据 |
| V-25 | 分发 contract | SkillHub/TeamLab/管理员路径中，MR、固定版本、目标交接、实际读回、回滚和 fallback 可验证 |
| V-26 | Agent Manifest 复用（后续） | 依赖 Skill/知识可追踪，不能绕过审批；不要求首期实现 |
| V-27 | Plugin Bundle 开发与安装门禁 | 每个阶段都完成固定版本的 build/package/digest/fresh-profile install/restart/load-report/readback/功能 E2E，并可 disable/uninstall/rollback；未确认契约不得进入正式 Plugin |
| V-28 | Skill 消费指标与隐私 | 按实际 Skill version/digest 统计调用次数、活跃用户、分层成功、unknown、Badcase 和反馈覆盖率；重复/重试去重、团队隔离、小样本保护、敏感数据不进入报表且可对账；发布、安装、加载和测试用例不能计为业务消费；缺业务结果或反馈覆盖不足时 UI 显示来源、样本/覆盖率与 unknown，而不是宣称价值已实现 |
| V-29 | 专家自主判断（Knowledge 阶段 5、Skill 阶段 7） | 有权专家针对指定候选与草稿修订拒绝、限定范围、暂缓或要求补证，能看到来源/推断和决策回执；拒绝、暂缓或缺证候选不能提交，无权者不能代签；补证后的新修订不得沿用旧确认，旧正式版本不能被静默覆盖，发布仍走 Git/人审/read-back |
| V-30 | 维护容量与归因（阶段 6 起） | 责任人看到待办、估计复核时间和资源缺口，可暂缓/请求转交/升级；无接收者或 owner 缺失明确指向业务 Owner/asset owner，未接收不变更责任、不自动批准；本人能申请更正错误贡献归因，有权者核验留痕，不修改原审批身份；无权者或跨团队查看/更正被拒绝 |
| V-31 | 团队决策与反监控（阶段 6 原型，试点验证） | 授权团队卡列基线、窗口、样本、覆盖率、unknown、维护负担和资源决策；极小样本、交叉筛选和差值反推时抑制/合并，禁止个人排行、按人消费轨迹、Agent 使用评分与从 `actor_ref` 推断个人绩效；覆盖不足不能宣称减员、节省人力或改善。业务结果与维护成本须在实际试点由不同责任方核验 |
| V-32 | Tool 标准接口与非生产 Demo（阶段 1–2、P1） | 标准契约版本、Provider 能力/未知映射和 adapter 测试可重复；隔离非生产的只读合成 Demo 真调用覆盖目录→详情/schema→主体/字段/环境与 DSH policy→受控试参→结果来源→审计/失败回执、撤权拒绝；原型假目录、非生产真调用、生产真实能力分别标识，未授权/未提供/超时不冒充批准或成功 |
| V-33 | 合成知识→资产大盘真实链（阶段 5、N2、P1） | 一批标合成的材料/旧版从入口②走真实草稿/指定审核人/Git protected merge/worker/WeKnora 测试空间 ACL 索引与检索读回，再由入口⑤按资产 ID/版本去重展示发布事件、来源、正交项目×产品线及有权具体文档 ID/版本深链；修订/索引失败/撤权/旧版残留及跨主体/空间负向测试有读回，不将合成输入当业务授权、质量或价值结论 |
| V-34 | 大盘诊断来源与成熟度（阶段 6 起） | 真实扫描才显示授权范围、批次、时间窗、来源、覆盖/未知、待核候选；人工预置线索标 fixture，不冒称 AI 巡检；所有卡片和计数区分演示数据、非生产真实集成、生产真实能力，权限过滤与小样本抑制先于聚合 |
| V-35 | 分层成功率与知识引用统计（阶段 6，Pilot 复验） | 同空间/环境/准确资产版本/窗口固定独立开始或查询底账；Skill distinct `invocation_id` 与重试尝试分开，技术/契约/业务三层分别列已判定通过率、含 unknown 的保守下界、覆盖率与截止时间；Knowledge 含零结果查询、真实检索与答案引用分开，多文档/重复查询去重，适用性由授权复核；丢事件、无 digest/版本、无引用真值、无业务回执时不能推断总体成功或把 unknown 算明确失败，缺底账显示“不可计算” |
| V-36 | 目标 DSH 原生观测与可选 OTel（阶段 2 Spike、阶段 8 真实补验） | 固定 Desktop/Harness commit、profile、Host Plugin 授权、环境/主体和合成任务，验证事件订阅或有权 Session Query 的实际可用性、调用/重试/知识引用版本/digest 归因、开始底账、跨空间与撤权拒绝、漏投/迟到/幂等/读回；字段白名单阻止 Prompt/回答/Tool 敏感原文/密钥和完整 trace 外传，只有最小事件进入指标；OTel/OTLP 如采用须证明模式、采样、脱敏、传输/留存和故障处理，不能以 span `OK`、反馈日志或采样 span 代替领域消费事件及业务结果；目标未通过时仅有契约 fixture、手动待核反馈和“不可计算”，不宣称 DSH 已接通 |
| V-37 | 个人 Inbox 暂存与明确知识 intake（阶段 3–5；真实敏感输入另设准入） | `InboxItem` 是 PG 私有对象，与反馈/Session/正式资产分开；本人跨设备恢复、第二主体及跨空间拒绝、撤权/过期链接、对象加密/最短留存/删除与备份例外按批准策略验证；保存、回访或仅打开知识页不抓取/解析外部链接，也不触发会话、DSH、Git 或 WeKnora，选择具体内容/目标空间/分享范围并获授权的单独提交只返回 `submission_id`/受理回执、不建 Session；其后另行明确正式知识创作/修订时重新核来源/用途/目标空间/基线及动作权限并建唯一 Knowledge Session/Draft，过期或无权不建；IM connector 默认关闭，未来另测消息同意/群聊 ACL/撤回。缺数据 owner 留存策略不得开放真实敏感内容。 |
| V-38 | 材料解析范围、完整性与时效门（阶段 5；R-04） | 材料/知识 owner 批准格式×大小×语言/版式支持矩阵、关键内容与覆盖阈值、形成/生效/截止/复核规则；逐脱敏原件固定版本/hash 对照页/段/工作表/单元格、附件、已读/部分/未读/排除范围及原因。正常与跨页正例、扫描/复杂表格在纳入前的实测，以及损坏、截断、漏页漏表/附件、旧版、无权/过期或时效不明负例均留目标解析证据。缺关键锚点、覆盖不足、越界或时效不明仅留有权最小「待人工核对」线索，服务端拒绝生成/送审正式知识候选及 MR；补证按固定版本重验，模型置信度、上传成功和业务人工确认都不能替代解析证据。合成 fixture/原型不证明真实格式支持、业务事实核证或 WeKnora published。 |
| V-39 | Workbench 持久评论与 DSH 回合关联（阶段 2 Spike、阶段 5 回归；R-05） | Workbench 对有权评论独立持久化 `comment_id`/固定条目及草稿修订、刷新后查询/审计，重复点击同键不生成多条，跨团队/撤权拒绝且不复制未经授权正文。目标 Desktop/Harness 固定版本/身份/非生产 fixture 下，分别验证投递、唯一 `turn_id`/持久 `reply_id`/成功终态与评论对应、成功后按当前版本 CAS 只生成一个新待核稿；双击/重试/响应丢失/刷新/并发人工改稿/旧回复迟到、失败/超时/取消/未知归属不覆盖较新稿、不自动重发。若宿主不能提供可靠关联及完成回执，仍可评论与人工改写，自动原生回复标未接通；原型预置回复、`accepted` 或 OTel span 不能充当真实完成证据。 |

| V-40 | Skill 可选知识查询与缺失核实（阶段 7–8；R-06） | 无知识查询的 Skill 可不声明 `knowledge_dependencies`；确需查询的 Skill 固定声明对象/版本/用途，在 `SKILL.md` 写明零结果、无权、指定版不可用/过期或时效不明时告知用户并请求核实，停止依赖该知识的结论而不绕权检索、不把未知说成知识不存在。获准脱敏 fixture 分别核可用正例及零结果/撤权/跨空间/失效负例；运行时知识 ACL 与失权拒绝由检索链路单独验证。Skill 的 Git 发布、目标安装/加载不因知识侧状态自动重写；首期不以反向索引、逐目标连锁停用作为验收门。目标 DSH/WeKnora 查询未实测时只保留说明与契约测试，不声称真实运行通过。 |

| V-41 | 历史原文外部阅读（阶段 2 Spike、阶段 5/6 回归；R-08） | Workbench 只管理有权来源的最小定位、固定版本、核证锚点与处理状态，不提供持久全文/默认原件归档或独立来源全文索引。分别以获准脱敏来源和正式知识版验证：仅 WeKnora 确有独立来源 document ID/version、目标文档级 ACL 与真实深链时显示外部「在 WeKnora 阅读」，跳转后目标重新鉴权；知识版链接不冒充来源原件。无来源文档、映射失效、旧版、撤权、跨空间与无权负例不渲染虚假入口，转有权原系统定位或人工核对。目标缺安全深链时标 `pending`，不宣称原文已接入；创作时授权临时核对与材料解析门仍按 V-38 验收。 |

| V-42 | Inbox 留链接与知识入口受限抓取（阶段 2 Spike、阶段 5 按声明范围验收；R-09） | 用脱敏非生产链接验证 Inbox 保存、回访、导航和最小候选受理零抓取/解析；知识入口用户明确选用链接、当前主体/来源/用途/目标空间获准且来源连接器与解析能力通过目标验证时才临时抓取固定版本，返回覆盖/未读/拒绝的可核回执，不自动受理团队候选、建 Session/Draft、长期保存原件或索引。以无权/撤权、跨空间、越界来源、重定向每跳、DNS 重绑定、私网/元数据目的地、文件超限、伪装类型、恶意/损坏解析内容及超时为负例，核授权/allowlist/实际连接地址、字节与类型限制、扫描/隔离、最小拒绝审计与无外传；失败只保留有权定位，正式候选仍过 V-38 的固定版本/覆盖门。未获目标正负向证据时仅链接定位及获准其他材料路径可继续，不声称链接抓取能力上线，也不拿管理员连接测试或静态 HTML 替代。 |

详细平台实验见[验证材料](../验证/README.md)。产品体验以[用户价值与指标](01-问题、用户与产品范围.md#2-用户与责任)、[日常反馈闭环](02-端到端知识工作流.md#51-日常反馈--周期复核--下次使用)、[Workbench 如何解决专家判断与维护负担](../产品/03-Workbench如何解决.md)和[工作台逐屏设计](09-工作台信息架构与核心对象.md)为设计输入；V-01、V-05、V-14、V-16、V-22、V-28–V-31 应分别附首次使用、回访、审核退回、反馈纠错、Provider `unknown`、小样本无结论、专家拒绝/补证、无人认领/转交、归因更正及反推隐私的脱敏录屏或逐步操作记录。阶段 0 先用纸面原型/脱敏 fixture 评估这些交互是否可理解，**不能将原型通过记为功能已实现**；阶段 5 实现 V-29 的 Knowledge 授权判断/修订门禁，阶段 7 扩展到 Skill；阶段 6 实现 V-30 的队列/归因更正及 V-31 的最小授权聚合与负向权限测试，低风险真实试点再观察受益者、贡献者、审核人的任务结果与负担。fixture 与产品设想均不代替真实价值验收。

## 10. Coding agent 交付规范

每次只给 coding agent 一个小任务包：背景、范围、输入输出、禁止事项、失败测试、最小实现、验收命令、证据路径和回滚方式。先做 schema、状态机、fake provider、契约和回归，再做 UI 和真实 provider。

Agent 不拥有生产凭据，不直接 merge `main`，不执行任意 shell/路径，不隐藏未验证能力。完成后必须做独立 code review、安全 review 和范围检查。

## 11. Go/No-Go

以下任一项不通过，就保持当前阶段：双资产权限隔离、审计完整性、契约和回归、知识/Skill 版本可追踪、发布目标和交接读回、未知状态处理、旧版本保留、回滚、人工接管、secret 扫描、非程序员可用性或真实业务价值。P3 另需 Harness discovery/load 和反馈引用证据；P4 另需 Plugin 权限、安装、健康、兼容性和回滚证据。

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

阶段决策还须分别列 `V-32` Demo 的目标 Provider/主体/环境及受控调用读回、`V-33` 合成知识的真实 Git/WeKnora 测试空间和大盘负向读回、`V-34` 是否运行过真实授权扫描，以及 `V-35/V-36` 的知识/Skill 统计底账、版本归因、真实宿主观测授权与未通过范围；任何一项只有预置 fixture、缺少目标授权或读回时不得把该能力标为非生产真实集成。若 V-32 的非生产 Demo 环境或 V-33 的真实测试链缺失，**P1 相应纵向验收及完整 P1 Go/No-Go 保持 blocked**；V-36 目标 DSH 观测尚未验证时，不阻断独立的合成事件契约/反馈开发，但自动原生消费率与相关真实宿主接入必须保持 blocked/“不可计算”。可继续独立契约开发，但不能以其他能力通过覆盖它。生产数据中台授权、真实团队材料质量及业务价值各有独立 Go/No-Go，不得因合成链技术通过而放行。

成熟度判断必须区分：

- `Contract Beta`：契约、权限、状态机、幂等、失败路径和可靠性基础证据通过；允许 fake/admin fallback，不代表真实 Provider 或业务价值已经验证；
- `Pilot Beta`：一个明确低风险真实场景有真实用户、业务结果 Owner、人工基线、采用指标和至少一个价值指标，fallback 与真实 Provider 状态清晰分开；
- `Stable`：在声明的 asset type、asset space、provider mode、target、profile 和 package digest 范围内，三层指标、真实 Provider read-back、价值结果、安全治理、SLA、恢复和维护容量均达标。

Go 决策必须绑定 evidence manifest。没有目标版本、环境、不可变 commit/制品 digest、fixture digest、实际命令和退出码、最终 read-back、失败/回滚结果、执行人、复核人及证据自身 digest 的项目，只能保持 `pending`、`fallback_only`、`contract_verified` 或 `blocked`，不得标记为 `real_verified`、Stable 或生产就绪。
