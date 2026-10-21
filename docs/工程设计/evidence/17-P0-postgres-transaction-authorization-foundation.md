# P0-14 PostgreSQL 事件/outbox 与授权基础（本地验证）

> 范围：本地源代码和脱敏合成数据。正式持久层选择 PostgreSQL；`tests/support/fake-durable-operation.ts` 仍只是既有 SQLite fake 测试辅助。本次未连接腾讯云、真实 Provider、真实团队身份或原/隔离 Desktop。不得将本次记录视为 P0 Go。

## 已实现

- `apps/api/migrations/001_knowledge_transition_outbox.sql` 定义 asset-space、当前角色绑定、Knowledge 状态及资产快照 digest、transition event 和对应 outbox intent；FK 绑定团队/空间和 event/outbox 身份，主键与唯一键约束 transition ID、idempotency key。表中不保留完整 Knowledge 原文、Prompt、凭据或 Provider 响应。
- `apps/api/src/application/record-knowledge-transition.ts` 是**内部**命令入口，没有接入公开 HTTP 路由。要求调用方传入可信 `AuthenticatedPrincipal` 与可信 evidence verifier；在一个 PG transaction 中锁定 Knowledge 状态、检查 principal 的 team/space/role 快照与当前数据库绑定、比较状态与资产 digest、调用现有领域转换、CAS 更新状态、写 event/outbox 后提交。相同事件和相同请求经 digest 比对返回 replay，冲突拒绝；失败回滚。它不向 Provider 发送请求，outbox 仅是投递意图，不是已实现的 Worker lease/retry。当前事务层按目标状态赋权，真实业务角色策略及撤权时序仍须在 DSH 服务端集成时核实。
- `tests/integration/api/record-knowledge-transition.test.ts` 用记录型替身覆盖未认证/伪造 actor、跨团队/空间/角色、撤权、旧 principal、篡改资产、重复/冲突、失联、event/outbox 写入失败回滚和 PG event 唯一约束冲突错误映射。`tests/integration/api/postgres-transition.test.ts` 用本地 **PGlite（PostgreSQL 引擎的 WASM 隔离实例）**执行迁移，并验证原子提交、回滚、跨空间 FK 和唯一性；这比纯 SQL 文本检查强，但不是腾讯云/独立 PG 服务的并发、进程重启和备份恢复测试。

## 验证与保留缺口

- Node v24.22.0：Vitest **18 files / 159 tests**、TypeScript noEmit、build 和 `git diff --check` 通过。`pg` 和 `@types/pg` 已安装；PGlite 只在 dev/test 使用。安装时 npm 提示两个现有依赖的 install scripts 未被 allowScripts 覆盖，本次未批准或执行脚本。
- **真实 DSH 服务端 principal 注入仍不存在**：公开 API 仍只提供 `/healthz`，不能从 header/body 接受自报身份并开放写接口；可信 evidence verifier/完整 asset snapshot 的服务端来源仍需接通。当前字段 `roles` 为跨空间扁平的认证快照，数据库另按当前 team/space 绑定约束，但仍需对真实身份、并发撤权竞态和可靠的资产快照存储做独立验证。
- **生产 PG 连接/迁移工具、独立 PG 多连接并发（含同一幂等键竞态）、重启恢复和 DB restore 未验证**；录制客户端只证明 PG `23505` 的已知 event ID/idempotency-key 约束映射为 conflict，不能证明真实并发路径；**Worker lease/CAS/retry/dead-letter/人工接管/unknown 对账、真实 Provider 最终读回**未实现。本次 outbox 没有 Worker 可消费的真实业务 payload，不能把它视作完整外部操作链。
- P0-14 保持 `partial/blocking`，P0-15/16/17 仍阻塞；P0 overall 保持 `no_go`，真实资产写入不开放。下一步需在授权的隔离非生产环境中提供可信身份/Provider/PG 验证，且先完善安全的业务数据来源和 Worker 恢复闭环；不以本地 WASM 引擎测试代替云端验收。
