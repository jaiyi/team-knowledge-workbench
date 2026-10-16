# DeepSeek Harness 能力验证

> 本文是外部能力验证材料，不定义团队知识工程的产品范围。它记录公开资料和本地源码能够证明的能力，以及仍需在目标环境中验证的事项。

## 1. 验证目的

团队知识/Skill 工作台以 `team-knowledge-workbench` 作为可复用的 DSH Desktop Workbench Plugin，负责创作、测试、审核和发布；每个团队的 `team-knowledge-asset`、Git、WeKnora space 和治理策略独立。DeepSeek Harness 负责消费已发布资产的会话运行。因此需要单独验证：

```text
approved release
  → package/version/digest metadata
  → SkillHub release/read-back
  → TeamAI pinned digest distribution/read-back（如启用）
  → Harness handoff/discovery/load
  → Harness Workspace/Session 消费
```

验证结果不得反向把 Harness 的 Session、Tool Call、运行时人工 gate 或任务状态机纳入本项目。

## 2. 已有证据

基于 DeepSeek Harness 官方公开仓库、用户指南、插件开发文档以及本地 `dsh-memory-evolution-web` 实现，当前可以确认或观察到：

| 能力 | 当前结论 | 证据边界 |
|---|---|---|
| DSH Desktop Workbench Host | dsh-desktop 提供 Workbench server/client 注册、canonical repository identity、market/catalog 安装、重启、启停和宿主 state | 证明插件承载和本地安装机制，不证明共享 Team Knowledge backend 或资产治理 |
| Workbench Session ownership | `desktopWorkbenchOwnership` 提供只读 Session binding metadata | 不是授权系统；Team Knowledge 必须执行自己的身份、team/asset-space ACL |
| Workbench host security | Electron main/Harness 隔离进程、Renderer sandbox/context isolation、窄 preload IPC | 插件不能通过 DOM/preload 扩权；worker 不使用 launch token 作为通用 API credential |
| Workbench market vs asset | Workbench package 可被多个团队安装；团队分别绑定 team-knowledge-asset | 安装/启用不等于 Git approved、WeKnora indexed、SkillHub released 或 Harness loaded |
| Workspace/Session | Agent 在会话中读写 workspace、运行命令、维护计划并请求权限批准 | 属于 Harness runtime |
| Plugin | 官方插件以 TypeScript 模块和 `apply(ctx)` 扩展宿主能力 | 证明扩展模型，不证明目标 SkillHub loader 约定 |
| Skill Provider | 本地 Memory Evolution 设计使用 provider 注册正式 Skill，候选 Skill 需先评估和批准 | 属于本地实现/设计事实，需与目标发行版区分 |
| Skill 生命周期 | 本地 WebUI 展示候选、批准、发布、禁用和回滚；发布后续会话可能加载 | 不能据此声称本项目已有发布集成 |
| 动态生效边界 | 本地设计区分新会话加载和当前会话已加载版本，避免静默替换 | 需在目标部署中重复验证 |
| 单用户部署限制 | 本地 WebUI README 说明 loopback 本地单用户形态 | 不能直接泛化为企业多租户能力 |

## 3. 必须验证的交接契约

### 输入

工作台交给下游的最小信息：

```yaml
source_commit: <approved-git-commit>
asset_type: skill | knowledge
asset_id: <asset-id>
asset_version: <version>
package_digest: sha256:...
knowledge_dependencies: []
required_capabilities: []
compatible_targets: []
```

### 目标

验证目标 Harness 是否能：

1. 根据固定 version/digest 找到发布包；
2. 发现 Skill 的 metadata 和使用边界；
3. 在允许的 Workspace/Session 中加载指定版本；
4. 在加载失败、版本不兼容或权限不足时明确拒绝；
5. 不静默替换当前会话已经加载的版本；
6. 返回可关联的验证结果或反馈引用。

### 不属于交接

- 本工作台不传递运行时 Secret；
- 不把 Skill 的 capability request 当成工具授权；
- 不由本工作台启动或控制 Harness Session；
- 不把 Harness 的运行结果猜测为发布成功；
- 不复制完整 session/run/tool-call/receipt/outbox/reconciliation 数据。

### 3.1 Plugin Bundle handoff

如果交接对象是可安装 Plugin，而不是 Skill/knowledge，最小 handoff 还必须包括：

```yaml
plugin_id: <plugin-id>
plugin_version: <version>
source_commit: <approved-plugin-commit>
package_digest: sha256:...
target_dsh_commit: <immutable-dsh-ref>
target_profile: <profile>
install_mode: <fresh-profile|catalog|market>
required_permissions: []
compatible_targets: []
installed_revision: <read-back-or-null>
loaded_revision: <read-back-or-null>
```

`installed_revision`、`loaded_revision`、`enabled`、`healthy` 和功能 E2E 结果必须分开读回；package 构建成功不等于安装成功，安装成功不等于加载成功，加载成功不等于业务功能成功。Plugin handoff 同样必须经过 `build → package → digest → install → restart → load report → functional E2E`，并保留 disable/uninstall/rollback 证据。

### DSH-09：身份、服务身份与 PostgreSQL 交接状态

使用 DSH Desktop 认证上下文进入 Workbench，验证后端能将已验证的 DSH subject 映射为 `principal_id`、team membership、role 和 `asset_space_id`；客户端伪造 team/space、owner 或 approver 必须被拒绝并审计。验证 PostgreSQL 中的 session、draft revision、approval、operation/job、outbox、handoff 和 reconciliation 能关联 `requested_by`、`approved_by`、`released_by`、`executed_by`、`service_identity_id`、source commit 和 package digest。TeamLab、SkillHub 或管理员 fallback 的实际读回必须保持 `released`、`handoff_verified` 和 `loaded` 的状态区分；数据库故障、Worker 重启或 provider 半成功只能进入 `unknown/degraded/reconciling`，不能伪造成功。

**通过条件：**DSH launch token、用户登录 token 和组件服务凭据不被转发为通用 API credential；跨团队读取和提交被拒绝；重复 job 可安全恢复；外部状态能够读回或进入人工对账。

## 4. 实验矩阵

| ID | 实验 | 预期证据 | 状态 |
|---|---|---|---|
| DSH-01 | 发布包按固定 digest 查询 | Provider 返回匹配 package 或明确 not found | 待目标环境验证 |
| DSH-02 | 新 Session discovery | 新会话能看到已批准版本及来源 metadata | 待目标环境验证 |
| DSH-03 | 显式 load | Session 加载指定版本并保留 digest | 待目标环境验证 |
| DSH-04 | 版本不兼容 | Provider/Session 拒绝并返回原因 | 待目标环境验证 |
| DSH-05 | 当前会话版本稳定性 | 发布新版本不静默替换已加载版本 | 待目标环境验证 |
| DSH-06 | 权限边界 | capability request 不会绕过 Harness profile/tool policy | 待目标环境验证 |
| DSH-07 | 反馈引用 | 运行问题能引用 Skill/knowledge version，不上传敏感原文 | 待目标环境验证 |
| DSH-08 | 回滚协作 | 工作台发布旧 digest 后，下游能验证后续会话使用旧版本 | 待目标环境验证 |

每项实验记录目标版本、部署环境、脱敏 fixture、命令、预期/实际结果、失败路径、证据位置、owner、日期和下一步。没有可重复证据时，状态只能是“待目标环境验证”或“人工 fallback”。

## 5. 与本项目方案的关系

- 工作台的 `released` 只表示 Git/CI/审核和 SkillHub/管理员发布有真实证据；
- `handoff verified` 只表示目标适配器或管理员确认收到指定版本；
- `loaded`、`running` 和 `succeeded` 是 Harness/业务系统状态；
- 下游反馈回到本项目时，生成知识复核或 Skill 回归候选；
- 任何验证结果改变产品边界时，必须回到[方案总览与关键决策](../方案/00-方案总览与关键决策.md)更新，而不是在本材料中暗中扩展范围。

## 6. 安全限制

验证只能使用脱敏样例和非生产环境：

- 不提交生产 Token、Cookie、密码、业务原文或个人敏感信息；
- 不向外部环境发送未批准知识或高风险工具请求；
- 不把 provider 响应中的文本当作系统指令；
- 不用验证脚本绕过 Git/MR/CI、人工审核、profile 或工具权限；
- 所有失败、超时和未知状态必须保留证据并进入人工对账。
