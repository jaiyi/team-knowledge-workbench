# User-authored Plugin 开发与安装契约验证

> 本文验证的是未来用户自建业务 Plugin 的契约发现、安装和运行验证计划，不是 `team-knowledge-workbench` 自身的 Workbench product package 安装验证。后者属于 P0 的 Workbench product package installation Spike，不能用本文的 Plugin 证据替代，也不能由 Workbench product package 安装成功推断用户 Plugin creation/release/runtime 已实现。

> 当前状态：契约发现与验证计划。目标 DSH commit/profile 尚未固定；尚无实际 Bundle 安装、重启、加载读回或功能 E2E 结果。下文的 `fact` 仅指官方资料或既有仓库事实，不能替代目标版本验证；未填充的实验记录不得标记为 `confirmed`。

## 1. 结论与证据等级

DSH/Cordis 官方仓库提供插件开发教程、Cordis API、Bundle/profile、Client modules/resources/slots、官方 fixture 和测试入口；这些是正式调研的第一手来源。社区 Creator/Builder Skill 可以帮助作者按步骤搭建插件，但不能替代目标版本的 Loader、类型检查、安装测试或安全审查。

| 等级 | 含义 | 可采取的动作 |
|---|---|---|
| `fact` | 目标 commit 的源码、类型、README、fixture 或安装读回直接证明 | 可以进入对应 PoC |
| `candidate` | 官方示例或相邻版本出现，但目标 profile/Loader 尚未证明 | 只能做隔离实验，不能写正式接口 |
| `pending_checks` | 需要在目标安装环境、真实 profile 或运行时确认 | 保留 blocker/owner/date |
| `warning` | 可能破坏兼容性、安全或数据边界 | 必须增加测试或人工审批 |

| 契约项 | 当前等级 | 进入正式 User-authored Plugin 前的证据 |
|---|---|---|
| `apply(ctx)`、依赖注入和副作用清理 | `candidate/pending_checks` | 目标 commit 类型/README + Host-only Bundle smoke + unload read-back |
| package identity、入口、`exports`、Bundle metadata | `pending_checks` | 目标 Loader/fixture 取证 + package digest + fresh-profile install |
| `cordis.patch.yml` 结构和 overlay 语义 | `pending_checks` | 目标 profile/fixture 取证 + boot/load report |
| session trace service 和字段 | `pending_checks` | 目标类型/事件实现 + 脱敏 trace E2E |
| Client bridge、UI slot 和 mount 生命周期 | `pending_checks` | Client fixture/类型 + UI/bridge E2E 和卸载清理 |
| 权限、依赖、SBOM、安装回滚 | `pending_checks` | 权限 read-back、扫描结果、disable/uninstall/rollback |



- `docs/development.md`、`docs/cordis-api/`、`docs/cordis-tutorial/`；
- `docs/user/develop/basic/`、`docs/user/develop/framework/`、`docs/user/develop/practice/`；
- `packages/bundle/*`、`packages/boot/*`、`packages/client/*` 的 README、类型和 profile；
- `apps/web/tests/fixtures/plugins/`、Plugin install/manager E2E、client-plugin-live E2E；
- `docs/subsystems/slots.md`、client modules/resources、upgrade guide 和目标发行版 lockfile。

### 官方资料与社区 Skill 的定位

| 来源 | 定位 | 能否作为正式契约 |
|---|---|---|
| `deepseek-ai/deepseek-harness` 官方仓库、目标 commit 的源码/类型/README/fixture/E2E | 一手开发与运行时证据 | 可以；仍需在目标 profile 安装读回 |
| `win4r/deepseek-harness-plugin-creator` | 社区作者向 Skill/模板，帮助拆解插件需求和目录 | 不可以；不能替代 Loader、类型和安装测试 |
| `oil-oil/build-deepseek-harness-plugin` | 社区构建向 Skill/流程提示，帮助生成 Plugin 草稿 | 不可以；不能替代 digest、权限、E2E 和回滚 |
| 团队内部验证脚本与目标环境安装读回 | 项目阻断依据 | 可以；必须绑定目标版本、profile、digest 和证据 |

社区 Skill 可以纳入作者 checklist，但不得单独批准发布、授予宿主权限或报告插件已加载。

本文的安装对象是未来 User-authored Plugin；`team-knowledge-workbench` 自身的 Workbench product package 使用 P0 专用证据模板和安装门禁。

## 2. 必须固定的测试身份

每次实验必须固定并记录：

```yaml
dsh_repository: <official-repository>
dsh_commit_or_tag: <immutable-ref>
node_version: <version>
package_manager: <name-and-version>
os_arch: <os-and-arch>
profile: <target-profile>
install_mode: fresh-profile | local-package | catalog | market
target_environment: desktop-local | tencent-cloud-non-production
source_commit: <user-plugin-source-commit>
package_digest: sha256:...
```

不得把开发 profile 的热加载成功、源码 import 成功或动态 Creator 成功当成可安装 Bundle 证据。

## 3. 真实可安装契约取证清单

在实现业务代码前，从目标 commit 的源码、类型和 README 中逐项确认：

1. `package.json` 的正式身份字段、`name`/version、`type`、入口和 `exports`；
2. Node/Host entry、Browser/Client entry、是否需要 `browser`/`files`/额外 metadata；
3. `dsh.bundle.patch` 的字段类型、路径解析和目标 profile；
4. `dsh.client.platform` 以及其他 client/external 字段是否真实存在且必须；
5. `cordis.patch.yml` 顶层结构、`insert` 行结构、`id`/`name` 语义、相对路径和 overlay 规则；
6. dependencies、peerDependencies、内置包版本、Node/browser 双面打包边界；
7. package digest、catalog/registry 元数据、兼容 profile、权限和安装审批；
8. Loader 如何生成 boot manifest、Node load report、Client load report，以及如何报告 disabled/missing/broken；
9. install、restart、enable、disable、uninstall、reinstall、rollback 的实际命令和状态读回。

未被目标版本证实的字段统一标记为 `candidate`，不进入正式 `dsh-decision-map` 包。

## 4. 运行时契约取证清单

### Host/Node

确认正式的 Cordis `apply(ctx)`、`inject`、`ctx.on`、`ctx.effect`、服务注册和 disposer 语义；不得自行假设 `ctx.trace`、`ctx.session`、`ctx.sessions` 或其他 service 名称。

### Session trace

从目标包的类型、README、事件声明、Session/Turn/Step 实现和官方观测出口确认：

- 当前 session ID 如何获取；
- trace/log/observation 服务名称和注入方式；
- turn、step、tool call/result、token usage、开始/结束时间字段；
- 事件顺序、重复/重放、持久化和权限边界；
- 是否允许插件读取原文，如何脱敏和限制保留期。

### Client/Browser

确认 Client entry、Client Loader、Host→Client Remote/Connection/store bridge；确认 slot catalog 的真实 slot ID、owner、register/inject 签名、排序、mount/unmount、权限和版本兼容性。不能用 `shell.overlay`、`settings.section` 等候选名替代目标版本证据。

## 5. 分阶段 Bundle → 安装 → E2E 门禁

每个阶段都必须生成可安装产物，不允许等到最后一次性集成。

### User Plugin-P0：契约侦察

读取官方源码、类型、README、fixture 和目标 profile，产出 `fact/candidate/pending_checks/warning` 表。固定 DSH commit、Node、包管理器和 fresh profile。没有固定身份不得开始 Plugin PoC。

### User Plugin-P1：Host-only smoke

用最小 Host 插件验证官方已确认的 `apply(ctx)`、健康探针或低风险工具：

```text
source test → build → package → digest → fresh-profile install
→ restart → boot manifest/Node load report → functional smoke
→ disable → uninstall → reinstall/rollback
```

读回至少包含 package/version/digest/profile、plugin id/name、loaded/enabled/healthy、失败原因和日志关联。重复安装必须幂等，损坏包、缺依赖、启动异常必须可诊断并清理。

### User Plugin-P2：Client-only UI smoke

仅使用已确认的 Client entry、platform、module 和 slot。重复打包、安装、重启和读回，验证 Client load report、UI mount/unmount、刷新、宿主重启、缺 slot/权限拒绝和卸载清理。slot 未确认时不得实现业务 UI。

### User Plugin-P3：Mixed bridge E2E

使用官方确认的 Host→Client bridge/store，传输最小脱敏数据。验证：

```text
Host event/data → official bridge → Client store → UI slot
```

同时验证 bridge 断连、session 切换、权限失败、宿主重启、插件 disable/uninstall 后监听器和 UI 是否清理。

### User Plugin-P4：Trace aggregation E2E

先对不依赖 DSH 的纯函数写单元测试，再接真实服务。测试空 trace、乱序、重复、缺 token、缺结束时间、并列慢步骤、未知事件、超大 token 和敏感字段脱敏。Bundle 安装后用脱敏会话验证 `timeline` 和 `stats`（总 token、工具调用次数、轮次数、最耗时步骤），并验证无服务、权限拒绝、损坏数据、断连和重启恢复。

### User Plugin-P5：候选发布与生命周期

在 fresh profile 和升级 profile 都验证：

- SBOM、依赖锁定、license、secret scan、package digest；
- profile/permission/网络/文件系统边界；
- install、enable、disable、uninstall、reinstall、upgrade、rollback；
- crash/restart、超时、unknown/degraded/reconciling 和失败清理；
- 审计中的 source commit、package digest、target profile、actor/service identity、actual/readback。

通过后才允许进入正式 User-authored Plugin 或 `dsh-decision-map`。未通过则保留旧 digest、管理员/fake provider fallback 和 blocker。

## 6. E2E 证据模板

```yaml
experiment_id: DSH-USER-PLUGIN-<stage>-<number>
target_version: <dsh-version-and-commit>
environment: desktop-local | tencent-cloud-non-production
provider_mode: fake | admin | real
scope_status: in_scope | readiness_only | non_blocking
integration_status: pending | blocked | fallback_only | contract_verified | real_verified
profile: <profile>
install_mode: <mode>
source_commit: <plugin-commit>
artifact_digest: sha256:<artifact-or-null>
package_digest: sha256:...
fixture_digest: sha256:<fixture-or-null>
fixture: <sanitized-fixture>
commands: []
expected: <expected-state-and-function>
actual: <observed-state-and-function>
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

## 7. 安全边界

Plugin 代码运行在宿主信任边界内，审查强度高于 Skill。禁止把 token、Cookie、password、API key、未脱敏模型上下文、业务原文或敏感工具参数写入 trace、日志、测试 fixture、Bundle 或错误响应。插件必须使用最小权限、锁定依赖、SBOM、secret/license 检查、health/readback、disable/unload 和按 digest 回滚。插件安装、Workbench 安装、Skill 发布、Harness loaded 和业务成功必须分别记账。

## 8. 当前结论

官方确实提供了可复用的 DSH/Cordis 开源文档、源码、fixtures 和 E2E 测试入口；社区也有 Creator/Builder Skill。但没有任何社区 Skill 可以替代目标版本的真实可安装契约。当前正式结论是：先做契约取证和最小 Bundle 安装 Spike，随后按 User Plugin-P1–User Plugin-P5 逐层扩展；在 package identity、patch、trace service、bridge 和 UI slot 均取得目标版本证据前，不创建带有猜测 API 的正式 `dsh-decision-map`。
