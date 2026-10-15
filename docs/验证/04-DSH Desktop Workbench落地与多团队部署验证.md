# DSH Desktop Workbench 落地与多团队部署验证

> 本文记录 `dataelement/dsh-desktop` 对 Team Knowledge Workbench 的落地约束、可复用能力和目标环境验证方法。它不把仓库实现自动提升为 Team Knowledge 已集成能力；所有目标部署仍需记录版本、环境、命令、实际读回和失败路径。

## 1. 结论摘要

推荐把 `team-knowledge-workbench` 实现为 DSH Desktop Workbench Plugin，而不是独立 Electron 应用或第二套 Agent Runtime：

```text
DSH Desktop / Workbench Market
  └─ team-knowledge-workbench（可复用产品/插件包）
       ├─ Team Knowledge UI / server adapter
       ├─ Harness 工具和 Skill 复用
       └─ 当前团队的受控 asset-space binding

Team A → team-knowledge-asset-A → Git-A + WeKnora space-A
Team B → team-knowledge-asset-B → Git-B + WeKnora space-B
```

同一个 Workbench 可以被多个部门安装，但每个团队分别沉淀自己的 asset。Workbench package identity、DSH market identity、team asset identity、SkillHub release identity 和 Harness loaded identity 必须分开。

## 2. dsh-desktop 已确认的落地事实

调研基线：公开仓库 `dataelement/dsh-desktop`，commit `115a0b474cc2c4794316171c640a8898398591fe`。以下是仓库层面的实现事实：

| 能力 | 仓库证据/实现 | 对 Team Knowledge 的含义 |
|---|---|---|
| Workbench server host | `packages/dsh-desktop-workbenches/index.js` 提供 server entry、catalog/state/market 路由和 `desktopWorkbenchOwnership` | 可复用宿主服务，但 host state 不是团队资产后端 |
| Workbench client registration | `client.js` 的 `desktopWorkbenches.register(descriptor, Component)` 校验 title、repository、layout 并返回 unregister | 不自行增加未验证的任意 `id` 注册字段 |
| Package contract | `development-guide.en.md` 要求 `exports["."]`、构建后的 `exports["./client"]`、`dsh.bundle.patch`、`dsh.client.platform: web` 和注入 `dsh-desktop-workbenches` | Team Knowledge 需要按宿主契约构建单文件 client |
| Session/workspace | Workbench 可拥有多个 Session；每个 Session 至多一个 Workbench owner；Workspace 是项目文件环境 | Workbench Creation Session 仍要与 DSH Runtime Session 分开 |
| Ownership | `desktopWorkbenchOwnership.read()` 返回只读 Session ownership metadata | 不能当作授权；后端必须重新校验身份、team/asset-space ACL |
| Market install | catalog 驱动的 package/generation 安装、完整性校验、重启要求和独立 market install state | 安装是宿主操作，不是 Team Knowledge asset release |
| UI/security | Electron main/Harness 隔离、Renderer sandbox/context isolation、窄 preload IPC | 插件不能通过 DOM 注入、Renderer Node 或宽泛 preload 绕过安全边界 |
| Extension style | 优先 host/plugin extension point，最小、版本化、可测试的 patch | Workbench 应使用宿主 slots/API，不覆盖宿主导航和权限 |

> 以上表格只描述 `dataelement/dsh-desktop` 在固定 commit `115a0b474cc2c4794316171c640a8898398591fe` 的 Workbench 实现，不自动构成所有 DSH 业务 Plugin 的通用契约。业务 Plugin 必须按[DSH Plugin 开发与安装契约验证](./05-DSH%20Plugin开发与安装契约验证.md)在目标 DSH commit/profile 中重新取证。

正式市场分发至少需要确认：构建产物、canonical GitHub repository identity、catalog entry、来源完整性、安装/重启、实际面板加载、启停和回滚。Source distribution 不会替插件自动构建，必须发布已构建产物。市场安装记录不应与 Team Knowledge 的资产发布记录混用。

内部推广可以先走受控内部安装，但必须保留与正式市场相同的 package、version、digest、target、restart、enabled 和 read-back 证据。不能因为本地加载成功就声称已经满足市场准入。

## 3. 与业务 Plugin Bundle 的边界

`team-knowledge-workbench` 的 Workbench package 与未来业务 Plugin Bundle 都可能由 DSH Desktop 安装，但不是同一种资产。Workbench 负责团队知识/Skill 创作与资产后端绑定；业务 Plugin 运行在 Harness 宿主信任边界内，必须另行满足目标 DSH 版本的 package、Cordis patch、Host/Client、权限和生命周期契约。local package、catalog 或 market 安装都只能证明宿主安装路径，不证明业务功能、知识发布或 Harness handoff 成功。

真实 Plugin 开发必须按阶段重复：

```text
固定 DSH commit/profile
→ 读取官方源码/类型/README/fixture
→ build/package/digest
→ fresh-profile install
→ restart
→ boot/Node/Client load report readback
→ functional E2E
→ disable/uninstall/rollback
```

Host-only、Client-only、Mixed bridge 和 session trace 每新增一层都要重新走完整链路；但只对插件实际声明的能力面设置通过条件。Host-only 不要求 UI/bridge/trace；Client-only 增加 Client entry、slot/mount 和 UI read-back；Mixed 增加官方 bridge/store 与断连恢复；声明 trace 能力时才增加 trace service 和统计聚合。未声明或不适用的能力记录 `N/A` 及原因。证据至少保存 source commit、package digest、target profile、install mode、installed/loaded revision、enabled/healthy、实际功能、失败清理和回滚。未确认的 session trace service、Host→Client bridge、UI slot 或 package 字段只能标记 `candidate/pending`，不能写入正式插件或市场准入契约。

## 4. Team Knowledge 的独立后端边界

DSH Desktop 当前提供的是本地插件/UI/Session ownership 机制，不是 TeamAI API，也不是共享团队控制平面。Team Knowledge Backend 必须独立负责：

- 用户、组织、团队和 asset-space 身份/授权；
- Creation Session、Draft、Revision、Approval 和 Audit；
- 每个团队的 Git repository、protected branch、CODEOWNERS 和 canonical asset；
- WeKnora space、ACL、索引和来源引用；
- SkillHub、管理员 fallback、发布、handoff 和反馈；
- 跨团队拒绝、幂等、取消、旧回调保护和 reconciliation。

`desktopWorkbenchOwnership` 只是元数据，不是授权。DSH launch token 只参与宿主根 URL 的启动交换，不是可转发给 Team Knowledge API 或后台 worker 的通用 credential。后台 worker 必须使用独立、最小权限且可审计的认证。

## 5. 多团队安装验证

### 5.1 绑定模型

每个团队绑定一套独立配置：

```yaml
team_id: team-a
asset_space_id: asset-a
asset_repo: <team-a-repository>
git_root: knowledge/
weknora_space_id: <team-a-space>
taxonomy_version: v1
steward_ids: []
review_policy: <team-a-policy>
distribution_targets: []
```

Team B 使用不同的 repo、space、ACL、steward 和 policy。客户端不能仅凭请求参数切换 `asset_space_id`；服务端根据身份和 Workbench installation binding 授权并读回。

### 5.2 必须验证

1. Team A、Team B 安装同一 Workbench version/digest；
2. 两个安装都能完成 panel/server registration 和 UI read-back；
3. A 的 Creation Session、source ref、draft、Git commit、WeKnora document、approval 和 audit 在 B 不可见；
4. B 的同类资源在 A 不可见；
5. 伪造 `team_id`、`asset_space_id`、Session ownership 或 repository 参数全部被拒绝并审计；
6. Workbench uninstall/reinstall 不删除团队资产、Git 历史、WeKnora 正式文档或发布审计；
7. DSH mode switch 不会误认为后台 job 已取消，后台任务有显式 owner、cancellation 和 reconciliation。

## 6. P0 腾讯云非生产部署

当前腾讯云已有 WeKnora，但尚无已确认的 DSH、SkillHub 或 TeamLab 部署。因此 P0 应增加一条部署与 readiness 线：

```text
Tencent Cloud non-production
  ├─ Team Knowledge Backend/API
  ├─ worker/job/reconciliation
  ├─ PostgreSQL control plane
  ├─ encrypted object storage
  ├─ existing WeKnora isolated test space
  ├─ DSH/Harness（目标制品可部署时）
  ├─ SkillHub/TeamLab（目标制品/API 可部署时）
  └─ fake/admin provider fallback

Developer desktop
  └─ DSH Desktop + locally/market installed Workbench
```

DSH Desktop Electron 客户端不是腾讯云服务部署对象。P0 部署检查至少包括：

- 目标版本、制品来源、digest 和 license；
- 网络、域名、TLS、身份和服务间认证；
- team/asset-space ACL 和跨团队拒绝；
- WeKnora 独立测试 space；
- DSH/SkillHub/TeamLab health/readiness、持久化和 restart 行为；
- PostgreSQL migration、私网/TLS、Secret Manager、备份/PITR、恢复演练和 Worker 重启；
- DSH auth context 到 `principal_id`/team/role 的映射，以及 service identity 的最小权限；
- 数据库/对象存储、备份/恢复和资源预算；
- 日志脱敏、审计、监控、告警和 trace correlation；
- 升级、降级、回滚和 unknown/reconciling 处置；
- 不使用生产 Token、Cookie、密码、业务原文或个人敏感信息。

如果 DSH、SkillHub 或 TeamLab 尚无可确认的 server/provider 部署方式，不阻塞知识/Skill MVP，但必须记录 blocker、owner、日期和管理员/fake provider fallback。以下状态必须分开：

```text
service reachable
≠ Workbench installed
≠ asset published
≠ WeKnora indexed
≠ SkillHub released
≠ handoff verified
≠ Harness loaded
≠ Harness running
```

## 7. 知识 Git 目录与 WeKnora 结构验证

推荐每个 `team-knowledge-asset` 使用如下 canonical repository 结构，路径相对于绑定的 `asset_repository` root：

```text
<asset_repository root>/
├── README.md
├── taxonomy/v1.yaml
├── knowledge/<domain>/<topic>/<knowledge-slug>/
├── skills/<domain>/<name>/
├── profiles/
└── CODEOWNERS
```

P1 默认同一个 repository 同时承载 Knowledge 和 Skill；如拆仓，必须通过 `asset_repository_id`、`team_id`、`asset_space_id`、`repository_kind`、repository identity、protected ref 和 ACL 显式绑定。

Workbench 创建知识时必须展示目标 `repo_path`，并校验 taxonomy、domain/topic、slug、重复 canonical key、owner、sensitivity 和 CODEOWNERS。`KNOWLEDGE.md` 保存可读正文，`metadata.yaml` 保存知识 ID、版本、状态、owner、taxonomy、敏感级别、来源 commit 和 WeKnora space，`sources.yaml` 保存受控来源引用。原始敏感材料不直接进入 Git。

WeKnora 的内部 collection/index 不要求与 Git 目录物理相同，但必须使用稳定的逻辑映射：

```text
Git repo_path
  ↔ knowledge_id / canonical key
  ↔ domain / topic / slug
  ↔ version / source_commit
  ↔ sensitivity / status / ACL
  ↔ WeKnora document / collection / space
```

首次 ingest、增量更新、重复 ingest、移动/重命名、合并、退役、ACL 变更和失败重试都必须读回 mapping。Git 是事实来源；不能先在 WeKnora 后台改分类，再让 Git 失去来源。移动或退役要保留 alias/redirect、旧版本或退役记录，索引失败时保留旧可用版本。

## 8. 证据模板

每次实验至少记录：

```yaml
experiment_id: <id>
target_version: <version>
environment: tencent-cloud-non-production | desktop-local
provider_mode: fake | admin | real
scope_status: in_scope | readiness_only | non_blocking
integration_status: pending | blocked | fallback_only | contract_verified | real_verified
team_id: <team>
asset_space_id: <asset-space>
workbench_version: <version>
plugin_version: <version-or-null>
target_dsh_commit: <immutable-ref-or-null>
target_profile: <profile-or-null>
install_mode: fresh-profile | local-package | catalog | market
artifact_digest: sha256:<artifact-or-null>
package_digest: sha256:...
source_commit: <commit>
fixture_digest: sha256:<fixture-or-null>
fixture: <脱敏 fixture>
commands: []
expected: <预期>
actual: <实际>
readback:
  - kind: install | restart | load | health | ui | provider | rollback
    status: succeeded | failed | unknown
    reference: <safe-reference>
failure_cleanup: <result>
rollback: <result>
status: pending | passed | failed | blocked | unknown | reconciling | fallback_only
decision: go | no_go | go_with_expiry
decision_date: <timestamp>
expiry_or_review_date: <timestamp>
hard_blockers: []
decision_record_id: <decision-reference>
decision_owner: <principal>
reviewer: <principal>
reviewed_by: <principal>
rollback_or_next_action: <action>
fallback_expires_at: <timestamp-or-null>
owner: <owner>
executed_at: <timestamp>
next_action: <action>
evidence_digest: sha256:...
```

## 9. 不可混淆的结论

- `team-knowledge-workbench` 是可复用 Workbench 产品包；`team-knowledge-asset` 是团队独立资产域；
- DSH Workbench market 是插件分发渠道，不是知识/Skill canonical registry；
- Workbench host state 不是 Team Knowledge backend；
- Session ownership metadata 不是授权；launch token 不是通用 API credential；
- Git 是知识事实和 Skill 源码权威，WeKnora 是逻辑映射后的索引检索层；
- Workbench installed 不等于 asset published；
- asset published 不等于 WeKnora indexed、SkillHub released、Harness loaded、running 或 business success。
