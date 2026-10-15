# 平台与 Provider 能力验证

> 本文只记录外部能力的验证问题、实验和结论，不定义产品范围。Skill 管理本身是核心产品能力；本文件只验证 SkillHub、DSH loader/profile 等自动化实现是否可用。

## 1. 验证分级

- **A：已存在可靠的官方 API、源码或本地文档证据，可进入 PoC。**
- **B：架构上可行，但必须在目标版本和真实部署中验证。**
- **C：前置条件未确认，只做只读、fake provider 或人工 fallback。**
- **D：当前不建议作为正式依赖。**

技术可行不等于已经集成。每个 B/C 项必须产生版本、环境、日期和结论，并记录统一的 Provider 验证状态：

| 状态 | 含义 |
|---|---|
| `pending` | 尚未完成验证 |
| `blocked` | 存在阻塞问题，当前不可使用 |
| `fallback_only` | 只能通过 fake 或 admin fallback 使用 |
| `contract_verified` | 契约、状态机和失败路径已验证，但不代表真实 Provider 接通 |
| `real_verified` | 目标版本、目标环境和真实 Provider read-back 已验证 |
| `deprecated` | 不再作为推荐依赖 |

同时记录：

```text
provider_mode: fake | admin | real
scope_status: in_scope | readiness_only | non_blocking
```

fake/admin 结果不得报告为真实 Provider 的 `released`、`distributed`、`installed` 或 `loaded`。只有 `provider_mode: real` 且 `integration_status: real_verified`，才能作为真实 Provider 路径的证据；只有完整的 experiment/evidence manifest 才能用于 Go 判断。

## 2. 当前能力矩阵

| 能力 | 当前判断 | 必须验证 |
|---|---|---|
| Git branch/commit/MR/CI/merge event | A/B | 幂等、受保护分支、merge commit、旧 SHA、签名、重放、乱序和丢失补偿 |
| Workbench outbox/worker | B | 事件落库后确认、operation 幂等、lease/retry/crash recovery、provider 半成功和 read-back 对账 |
| WeKnora 查询/摄取/检索 | A/B | ACL、来源/版本、重复、document/read-back、检索验证、索引失败和旧版本 |
| Skill package/digest/SkillHub release | B/C | 固定 merge commit 构建、immutable digest、release API、审批、release/digest read-back、撤回和回滚 |
| TeamAI pinned digest distribution | B/C | 只消费 SkillHub digest、target workspace、init/push/pull、installed revision/file list/digest read-back、删除清理和回滚 |
| DSH handoff/load | B | pinned digest、profile、handoff id、loaded digest/read-back、权限过滤和回滚 |
| DSH Desktop Workbench package/market | B | `team-knowledge-workbench` 的 package layout、canonical repository identity、catalog/install/restart、enabled/UI read-back、卸载/回滚和市场准入；市场安装不等于资产发布 |
| 多团队 Workbench 安装 | B | 两个团队安装同一 Workbench 后的 team/asset-space binding、Git/WeKnora/session/ACL/审计隔离和 cross-team deny |
| 腾讯云 DSH/SkillHub/TeamLab 非生产部署 | B/C | 目标版本制品、网络/TLS、认证、健康检查、持久化、备份恢复、升级/回滚；未确认则管理员/fake provider fallback |
| Plugin/tool manifest and registry | B/C | 工具注册、权限、安装/启停、health、兼容性和回滚 |
| DSH Skill loader/profile | B | 固定 digest 装载、权限过滤、装载读回和回滚 |
| TeamLab 分发/协作 adapter | B/C | 目标 API/版本、service identity、固定 package/digest、审批、目标交接、读回、撤回和回滚；未确认则管理员 fallback |
| TeamAI CLI/repository/hooks/local injection | B/C（可选候选） | 仅在实际需要时验证 init/pull/push、MR、格式兼容、版本锁、灰度、安装读回、删除清理、回滚和内外网边界 |
| SkillHub/TeamAI distribution comparison | B/C | 固定版本、digest、profile、目标安装、审计、撤回和 fallback 的可替代性 |
| SkillHub 状态读取 | B | 版本、digest、owner 和状态是否可读 |
| SkillHub 上传/晋升 | C | API、审批、审计、回滚和 webhook；未确认则管理员操作 |
| MCP tools/list/call | A/B | profile 过滤、schema、ACL、审批、超时和取消 |
| OTel/观测出口 | B | DSH 事件出口、隐私策略和 run/job/asset 关联 |
| 多租户 Gateway | B | 身份、密钥、workspace 隔离和跨域拒绝 |
| 高风险 Agent 发布 | D（默认） | 人工 approval、服务端 policy、读回和回滚 |

## 3. 首先做的实验

### V-01：Git provider contract

使用 fake provider 覆盖 branch、batch commit、MR、pipeline 和状态读取；再在隔离项目验证 protected main、expected base/head SHA、merge event 签名、event id 去重、重复/乱序/丢失事件、旧 head SHA 合并拒绝和轮询补偿。

**通过条件：**重复请求不重复创建资源；事件落库后才确认接收；所有动作能关联 `principal_id`/`service_identity_id`、event、job、commit、MR 和 pipeline；旧 head SHA 合并被拒绝；事件丢失可由 merge commit 对账补发。

### V-01A：Workbench outbox/worker contract

验证 merge event 落库、outbox operation、worker lease、重复领取、崩溃恢复、provider 已完成但 read-back 超时、重试和人工补偿。知识 ingest 以 `merge_commit_sha + knowledge_scope` 去重，SkillHub release 以 `skill_id + package_digest` 去重，TeamAI/DSH 以 target/profile/pinned digest 去重。

**通过条件：**事件重复不产生重复 ingest/release；租约过期可恢复；provider 半成功进入 `unknown/reconciling` 并先 read-back 再重试；旧回调不能覆盖新 state version。
准备两个团队的独立测试 asset space 和知识库，从已合并的 Git fixture 触发 `merge event → outbox → worker → ingest → read-back`，上传带 canonical key、`repo_path`、domain/topic、source commit、version、sensitivity、ACL 的脱敏文档，测试首次 ingest、重复、增量更新、Git 路径移动/重命名、退役、ACL、hybrid search、旧版本和索引失败。

**通过条件：**结果返回 document/version/source/repo_path；Git↔WeKnora 逻辑路径可双向追溯；跨 workspace/team 拒绝；只有真实 read-back 和检索冒烟成功才能标记 `published`；索引失败不覆盖旧版本；移动和退役有 migration/alias/retired 记录；`approved` 不被错误标成 `published`。

### V-02A：DSH Desktop Workbench 安装与多团队隔离

构建真实的 `team-knowledge-workbench` server/client package，验证 canonical repository identity、构建产物、market/catalog 或内部受控安装、重启、client/server 注册、enabled、UI read-back、ownership metadata、卸载和回滚。然后让 Team A 与 Team B 安装同一版本，分别绑定独立 Git repository、WeKnora space、ACL 和 steward，尝试跨团队读取 Creation Session、source ref、draft、发布 job 和索引。

**通过条件：**安装版本和 digest 可读回；安装失败可诊断并回滚；两个团队可复用同一 Workbench 但资产、权限、会话、审计和发布状态完全隔离；`desktopWorkbenchOwnership` 只作为只读 Session metadata，不能替代授权；Workbench installed 不被报告为 asset published。

### V-02B：腾讯云非生产 DSH/SkillHub/TeamLab 部署 readiness

在腾讯云以脱敏数据部署 Team Knowledge Backend、worker、PostgreSQL、对象存储、现有 WeKnora 独立测试 space，以及目标版本可确认时的 DSH/Harness、SkillHub 和 TeamLab 服务或 provider。记录制品、版本、网络/TLS、DSH auth context 映射、principal/team/role、service identity、健康检查、日志脱敏、备份恢复、升级、回滚和 owner。若 DSH、SkillHub 或 TeamLab 没有可确认部署制品/API，只记录 blocker 并切换管理员/fake provider fallback。

**通过条件：**“服务可访问”“安装成功”“资产发布”“WeKnora indexed”“SkillHub/TeamLab released”“Harness loaded”分别有独立证据；worker 不复用 DSH launch token 或用户 token 作为 API credential；失败、未知和半成功状态可对账。

### V-03：DSH 入口和 Skill loader

固定目标 DSH commit/tag、Node/包管理器、目标 profile、安装方式和 fresh profile。先从官方源码、类型、README、fixture 与 Loader 取证，再验证入口注册、profile 传递、固定 Skill digest 装载、权限过滤、重启、升级、卸载、失败清理和回滚。每个阶段均必须经过 `build → package → digest → fresh-profile install → restart → boot/load report readback → functional E2E`，不能只验证源码 import 或开发 profile。

**通过条件：**实际装载版本、digest、profile、plugin id/name、enabled/healthy 和 load report 可读回；Skill 声明的 effects 不能突破 profile/tool policy；安装失败、禁用、卸载和回滚均可诊断并清理；失败则使用管理员安装或外部 Web/API 向导。


### V-04：Skill package → SkillHub release/read-back

固定一个已合并的 Skill commit，执行 `package → digest → SkillHub release → release/digest read-back`，验证 metadata、审批、immutable digest、重复 release、撤回、断网恢复、回滚和审计。SkillHub read-back 缺失或 digest 不一致时，不得进入 TeamAI。

**通过条件：**未审核内容不能自动生效；SkillHub 返回的 release/version/digest 与本地 package 一致；重复操作不产生重复 release；release unknown 可对账；旧 digest 可回滚。该结果只有在目标版本、真实 Provider、目标环境和最终状态 read-back 均有证据时，才能标记 `integration_status: real_verified`；fake/admin 只能标记 `fallback_only` 或 `contract_verified`，不能作为真实 SkillHub 接通证据。

TeamAI 与 TeamLab 默认不纳入本期目标分发路径：readiness matrix 记录 `in_scope: false`，状态为 `readiness_only/non_blocking`，不阻断 N5/P6。若业务侧明确纳入目标路径，则将对应 Provider 改为 `in_scope: true`，并在同一决策记录中固定版本、环境、package/digest、target、最终 read-back、撤回和回滚；该 Provider 随即成为 N5/P6 正式门禁。以下 TeamAI → DSH 实验在 TeamAI 为 `in_scope: false` 时只能作为候选能力验证，不得成为阶段通过条件。

### V-04A：SkillHub pinned digest → TeamAI → DSH

固定已读回的 SkillHub `pinned_digest`，测试 TeamAI distribution request、目标 workspace、`init`、变更分支 `push`、`pull`、Hook 生命周期、格式兼容、安装/删除清理、installed revision/file list/digest read-back，再测试 DSH handoff、profile 和 loaded digest read-back。

**通过条件：**TeamAI 不接受 `latest` 或未审核版本；TeamAI 实际 digest 与 SkillHub pinned digest 一致；DSH loaded digest/profile 与 handoff 一致；digest 漂移、安装半成功和 loaded unknown 均阻断运行并进入对账；TeamAI/DSH 不可用时管理员 fallback 可按同一个 digest 运行。真实 Provider 路径必须记录 `provider_mode: real`、目标版本、目标环境和最终 read-back；管理员/fake 路径只能标记 `fallback_only` 或 `contract_verified`，不得报告为真实分发或加载成功。

### V-05：Skill contract and regression

用一个低风险 Skill 验证 input/output schema、缺字段、未知字段、超大输入、知识依赖缺失、effects 与 profile 冲突、golden cases、回归失败、digest 变化和旧版本回滚。

**通过条件：**契约或权限冲突阻止发布/装载；回归失败不能晋升 beta/stable；运行记录包含 Skill version/digest、profile 和知识引用。

### V-06：MCP security contract

测试合法/非法/超大参数、无 token、跨 workspace、过期 token、无 approval、幂等、超时、断连和 cancellation；确认高风险工具默认不出现在普通 Agent 的列表中。

**通过条件：**拒绝有稳定错误码和审计；工具结果与真实 provider 状态一致；日志和 trace 无 token、Cookie 和敏感正文。

### V-07：Plugin/tool 扩展能力

固定目标 DSH 版本/commit、Node、profile、一个隔离外部系统和 fresh profile。详细契约取证、P1–P5 阶段和证据模板以[DSH Plugin 开发与安装契约验证](./05-DSH%20Plugin开发与安装契约验证.md)为准；本项只验证目标环境中的整体能力矩阵和 Go/No-Go。各能力面按适用范围验证：Host-only 不要求 UI/bridge/trace；Client-only 增加 Client entry、slot/mount 和 UI read-back；Mixed 增加官方 bridge/store 与断连恢复；声明 trace 能力时才增加 trace service 和统计聚合。每个适用阶段都执行 `build → package → digest → fresh-profile install → restart → load report/readback → functional E2E → disable/uninstall/rollback`。

**通过条件：**适用能力面对应的 package identity、权限、安装、load report、health、功能结果和生命周期均可读回；不适用项明确记录 `N/A` 及原因；provider unhealthy/unknown、bridge 断开、trace 服务缺失或权限拒绝时不能报告可用；失败可禁用并回到旧 digest。SBOM、依赖锁定、license/secret scan、来源 commit、package digest、target profile 和审计齐全。若能力未确认，只保留 fake provider 或人工安装，不阻塞知识 + Skill MVP。

## 4. 通用安全检查

| 检查 | 方法 | 必须结果 |
|---|---|---|
| Secret 泄露 | 扫描 Git、日志、trace、错误响应 | 无 token、Cookie、密钥 |
| 跨 workspace | 构造资源 ID 和 Webhook | 全部拒绝 |
| Webhook 重放 | 重复 event/旧 timestamp | 不重复执行 |
| Merge event 签名/越权 | 伪造 event、跨 team/asset-space 或错误 merge commit | 拒绝、隔离并审计 |
| Provider read-back 污染 | 返回伪造 document/release/install/load 状态 | 不直接成为成功状态，需校验关联 id、digest、ACL 和 source |
| Digest 篡改 | 修改 SkillHub、TeamAI 或 DSH 返回的 digest | 全链路阻断并进入对账 |
| 越权合并/晋升 | 普通用户调用 merge/promote | 拒绝并审计 |
| 权限冲突 | Skill effects 超出 profile | 发布和装载均拒绝 |
| Plugin/tool 权限 | 构造无 grant、过期 grant、跨 workspace 调用 | 全部拒绝并审计 |
| 参数注入 | 工具参数携带外部指令 | 只按 schema/策略处理 |
| 外部响应污染 | provider 返回恶意文本 | 不直接成为系统指令 |
| 任意文件上传 | 脚本、超大文件、路径穿越 | 拒绝或隔离 |
| 审计完整性 | 反查 actor/job/asset/version/digest | 每个写动作可追溯 |

## 5. 当前结论

第一版优先 fake provider、一个真实 Git/WeKnora 隔离环境和一个低风险 Skill 的非生产回放。SkillHub 自动发布、DSH UI/loader、Plugin/tool runtime、MCP 高风险工具和完整 Gateway 都必须先有实验结果，不能因为设计了 adapter 就视为已接通；但这些实现未验证不影响 Skill 管理作为产品核心能力继续交付。
