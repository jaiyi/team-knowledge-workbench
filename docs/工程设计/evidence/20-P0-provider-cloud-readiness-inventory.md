# P0 Provider 与云端可行性盘点（只读证据边界）

> 本盘点只汇总本次会话中用户执行并回传的非生产读回，以及仓库已有的 Desktop/PG 证据。未独立登录云环境、未接入 Workbench→Provider、未验证真实资产写入。`pending`/`blocked` 不得据此提升为 `real_verified`；本文件不是 P0 Go 决策，也不是业务发布链验收。

## P0 readiness matrix

| 对象 | P0 目标与当前可用读回 | 尚缺的 P0 可行性/责任证据 | 判定与下一步 |
|---|---|---|---|
| Git | 目标仓库、受保护 ref、固定服务端版本和 owner 均未给出；本地 FakeGit 只能证明脱敏契约。 | 独立测试仓库/环境、版本、事件验签方式、只读最终读回能力、回退路径及责任人。 | `pending`；先固定目标与 owner，P0 只核对能力/阻塞，不执行真实 merge。 |
| WeKnora | 用户将独立测试 WeKnora 升级至 `v0.8.3` 并回传 app/docreader 健康、前端运行、数据库迁移 `118:false`、页面/登录/检索正常；ParadeDB `v0.25.11-pg17`，`WeKnora` 与 `paradedb` 两库读回 `pg_search 0.25.11` / `vector 0.8.4`。活动 Compose 与核验的固定候选哈希一致，`.env` 固定 `WEKNORA_VERSION=v0.8.3`、`DB_HOST=postgres`；旧 Compose 保留。 | 测试 WeKnora 的用户回传来自此前升级步骤及本次会话摘要，本轮未重新登录服务器采样。Workbench 独立测试 space/ACL/权限、版本/来源/document/retrieval 的 API 契约和只读读回、owner、回退方案尚未核验；此前用户选择这套测试 WeKnora 不备份/不恢复旧 app，不能把它当成已验证 rollback。原旧技能目录是否仍可用也未单独验证。 | **服务就绪观察，Workbench Provider readiness 仍 `pending`**；不把页面正常或检索正常记作 Workbench→WeKnora ingest/read-back。下一步先只读核对目标测试 space 与契约，后续真实写入需另行授权和硬门禁。 |
| SkillHub | 无固定目标制品、环境、API/审批链或 owner 的读回。 | 固定版本/API、审批与 immutable digest 的只读能力、目标环境、fallback/回滚责任人。 | `blocked/pending`；保持管理员/fake fallback，不做 release。 |
| DSH Desktop Workbench package | 隔离 Desktop `0.2.0-rc.2` 的 Host 清单、可见 UI、健康路由与禁用/重新启用读回见 [13](./13-DSH-isolated-desktop-host-inventory-readback.md)–[16](./16-DSH-desktop-diagnostics-artifact-readback-gap.md)；这是**用户电脑上的产品安装 Spike**，不是云端 Harness 证据。 | 独立 Host/Client 初始 load/error report、完整 artifact digest/source 宿主成对读回、fresh-profile 卸载与可重复 rollback。 | package `partial`；仅能作 Desktop 子项的证据输入，不推断云端服务能力。 |
| 云端 DSH/Harness | 尚未取得独立的目标服务端制品、部署或健康读回；Desktop 安装记录不能替代。 | 固定目标版本/制品、环境/身份策略、owner、健康与只读能力、fallback/rollback 的独立证据。 | `blocked/pending`；不执行真实 Skill load，也不借 Desktop 结果填充云端 read-back。 |
| TeamAI / TeamLab | 未提供固定目标制品、环境或 owner；默认不在本期正式目标分发路径。 | 若以后显式纳入，另定目标版本、环境、责任人、安装/撤回与 digest 读回。 | `readiness_only/non_blocking`；不将其缺失冒充本期已接通，也不擅自增加本期硬门禁。 |
| 腾讯云非生产 Workbench | 用户在轻量应用服务器上读回独立的 PostgreSQL 16.15 测试容器，无外部端口映射，合成数据的真实 `pg.Pool` 事务验证 4/4，详见 [19](./19-P0-isolated-cloud-pg16-application-transaction-readback.md)。测试角色及临时 schema 已清理；测试归档条件删除命令回显成功；测试用 Node 镜像的后续生命周期尚未核对/处理。 | 后端/Worker/对象存储制品及部署 owner、网络/TLS/密钥、备份恢复/监控/回滚路线；隔离 PG 的本地连接未验证密码认证。服务器管理入口的网络访问范围尚未收窄。 | 有限的 PG 可行性证据，不等于 Workbench 云部署或 P0-17 通过。优先收窄管理入口并规划凭据/网络边界，所有服务器变更单独确认；不复用其他测试应用的 PG。 |

## 阶段与决定

- P0 记录版本、环境、能力边界、owner、阻塞、fallback 与 rollback 路径；未知即保持 `pending`，不为了填矩阵创造 owner 或制品。P1 的 Knowledge-first 纵向切片、P2 的可信身份/Worker 恢复、P3 的真实 Knowledge 发布链均不作为本盘点的 P0 实施任务。
- P0 Workbench package、cloud/provider readiness、P0 overall 须分别决策。现在仍为 `p0_overall: no_go`；按阶段文档的受限过渡只允许隔离 fake/admin 开发，不允许真实团队资产写入、真实 Provider 发布、`real_verified` 或 Pilot。
- 下一步先收集**已有的只读材料**：Git 测试仓库/owner 与保护策略；WeKnora 独立测试 space 和只读 API 契约；SkillHub/云端 DSH-Harness 制品及 owner；腾讯云 Workbench 非生产网络和回退方案。需要登录采样或操作 Desktop/服务器、安装、卸载、改防火墙、发起 Provider 写操作、备份/恢复时，逐项确认授权与目标。
